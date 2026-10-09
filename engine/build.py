"""
Download the latest NOAA GFS 1-degree run (AWS Open Data, byte-range via .idx)
and build Mach-cutoff atlases for the web app.

Output (in --out, default site/data):
  manifest.json
  f{HHH}_FL{LLL}.png   grayscale atlas, 4x4 tiles of 360x181 (lon -180..179, lat 90..-90)
     tiles 0-11 : M_max for direction of travel 0,30,...,330 deg true
     tile 12    : min over headings (works in any direction)
     tile 13    : max over headings (best direction)
     tile 14    : speed of sound at cruise, value = c - 200 (m/s)
     tile 15    : land fraction * 255
  M encoding: M = 1.0 + 0.002 * value
Usage:
  python build.py                     # latest available run, f000..f048 every 6 h
  python build.py --run 2026100912    # specific run
  python build.py --grib-dir DIR      # use local files gfs.tHHz.pgrb2.1p00.fXXX instead of downloading
"""
import argparse, datetime as dt, json, os, sys, time
import numpy as np
import requests
import pygrib
from PIL import Image

from physics import mmax_grid

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
PLEV = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
        450, 400, 350, 300, 250, 200, 150, 100, 70, 50]
FLS = [350, 400, 450, 500, 550, 600]
HEADINGS = list(range(0, 360, 30))
FHOURS = list(range(0, 49, 6))
M_STEP = 0.002

WANT = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT") for p in PLEV}
WANT |= {("HGT", "surface"), ("LAND", "surface"), ("TMP", "2 m above ground"),
         ("UGRD", "10 m above ground"), ("VGRD", "10 m above ground")}

S = requests.Session()


def url(run, fh):
    d, h = run[:8], run[8:]
    return f"{BASE}/gfs.{d}/{h}/atmos/gfs.t{h}z.pgrb2.1p00.f{fh:03d}"


def get(u, **kw):
    for attempt in range(5):
        try:
            r = S.get(u, timeout=60, **kw)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return None
        except requests.RequestException as e:
            print("  retry", attempt, e, file=sys.stderr)
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"failed: {u}")


def latest_run():
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 48, 6):
        t = now - dt.timedelta(hours=back)
        run = t.strftime("%Y%m%d") + f"{(t.hour // 6) * 6:02d}"
        if S.head(url(run, FHOURS[-1]) + ".idx", timeout=30).status_code == 200:
            return run
    raise RuntimeError("no complete GFS run found in last 48 h")


def fetch_fields(run, fh, grib_dir=None):
    """Return dict {(var, level): 2D array} for one forecast hour."""
    if grib_dir:
        path = os.path.join(grib_dir, os.path.basename(url(run, fh)))
        out = {}
        for g in pygrib.open(path):
            key = (IDX_NAME.get(g.shortName, g.shortName), level_str(g))
            if key in WANT and key not in out:
                out[key] = g.values.astype(np.float32)
        return out
    idx = get(url(run, fh) + ".idx").text.strip().splitlines()
    rows = []
    for i, line in enumerate(idx):
        parts = line.split(":")
        start = int(parts[1])
        end = int(idx[i + 1].split(":")[1]) - 1 if i + 1 < len(idx) else None
        key = (parts[3], parts[4])
        if key in WANT:
            rows.append((start, end, key))
    seen, keep = set(), []
    for r in rows:                      # first occurrence of each field only
        if r[2] not in seen:
            seen.add(r[2]); keep.append(r)
    # merge contiguous byte ranges into fewer requests
    blobs, cur = [], None
    for s, e, k in keep:
        if cur and cur[1] is not None and s == cur[1] + 1:
            cur = [cur[0], e, cur[2] + [k]]
        else:
            if cur: blobs.append(cur)
            cur = [s, e, [k]]
    blobs.append(cur)
    tmp = f"/tmp/gfs_{run}_{fh:03d}.grb2"
    with open(tmp, "wb") as f:
        for s, e, _ in blobs:
            rng = f"bytes={s}-{'' if e is None else e}"
            f.write(get(url(run, fh), headers={"Range": rng}).content)
    order = [k for _, _, ks in blobs for k in ks]
    out = {}
    for g, k in zip(pygrib.open(tmp), order):
        out[k] = g.values.astype(np.float32)
    os.remove(tmp)
    missing = WANT - set(out)
    if missing:
        raise RuntimeError(f"f{fh:03d} missing {sorted(missing)[:5]}")
    return out


IDX_NAME = {"t": "TMP", "u": "UGRD", "v": "VGRD", "gh": "HGT", "orog": "HGT", "lsm": "LAND",
            "2t": "TMP", "10u": "UGRD", "10v": "VGRD", "land": "LAND"}


def level_str(g):
    t = g.typeOfLevel
    if t == "isobaricInhPa": return f"{g.level} mb"
    if t == "surface": return "surface"
    if t == "heightAboveGround": return f"{g.level} m above ground"
    return t


def to_display(a):
    """GFS lon 0..359 -> -180..179 (lat already 90..-90)."""
    return np.roll(a, 180, axis=-1)


def encode_M(M):
    return np.clip(np.round((M - 1.0) / M_STEP), 0, 255).astype(np.uint8)


def build(run, out_dir, grib_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    stats = {}
    for fh in FHOURS:
        t0 = time.time()
        F = fetch_fields(run, fh, grib_dir)
        st = lambda v: np.stack([F[(v, f"{p} mb")] for p in PLEV])
        T, U, V, Z = st("TMP"), st("UGRD"), st("VGRD"), st("HGT")
        Zs, Ts = F[("HGT", "surface")], F[("TMP", "2 m above ground")]
        Us, Vs = F[("UGRD", "10 m above ground")], F[("VGRD", "10 m above ground")]
        land = F[("LAND", "surface")]
        for fl in FLS:
            M, ca = mmax_grid(np.array(PLEV, float), T, U, V, Z, Zs, Ts, Us, Vs, fl, HEADINGS)
            tiles = [encode_M(to_display(m)) for m in M]
            tiles.append(encode_M(to_display(M.min(axis=0))))
            tiles.append(encode_M(to_display(M.max(axis=0))))
            tiles.append(np.clip(np.round(to_display(ca) - 200), 0, 255).astype(np.uint8))
            tiles.append(np.clip(np.round(to_display(land) * 255), 0, 255).astype(np.uint8))
            ny, nx = tiles[0].shape
            atlas = np.zeros((4 * ny, 4 * nx), np.uint8)
            for i, t in enumerate(tiles):
                r, c = divmod(i, 4)
                atlas[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = t
            Image.fromarray(atlas, "L").save(os.path.join(out_dir, f"f{fh:03d}_FL{fl}.png"), optimize=True)
            worst = M.min(axis=0)[land > 0.5]
            stats.setdefault(str(fl), []).append(
                {"fh": fh, "land_any_heading_median": round(float(np.median(worst)), 4),
                 "land_any_heading_p10": round(float(np.percentile(worst, 10)), 4),
                 "global_max": round(float(M.max()), 4)})
        print(f"f{fh:03d} done in {time.time() - t0:.1f}s", flush=True)

    run_t = dt.datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    manifest = {
        "run": run,
        "run_time": run_t.isoformat().replace("+00:00", "Z"),
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "NOAA GFS 1.0 deg (AWS Open Data noaa-gfs-bdp-pds)",
        "forecast_hours": FHOURS,
        "valid_times": [(run_t + dt.timedelta(hours=h)).isoformat().replace("+00:00", "Z") for h in FHOURS],
        "flight_levels": FLS,
        "headings": HEADINGS,
        "grid": {"nx": 360, "ny": 181, "lon0": -180, "lat0": 90, "dlon": 1, "dlat": -1},
        "atlas": {"cols": 4, "rows": 4, "tile_heading": list(range(12)), "tile_min": 12,
                  "tile_max": 13, "tile_c": 14, "tile_land": 15},
        "encoding": {"M0": 1.0, "M_step": M_STEP, "c_offset": 200},
        "file_pattern": "f{fh:03d}_FL{fl}.png",
        "stats": stats,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print("wrote", out_dir)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run")
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--grib-dir")
    a = ap.parse_args()
    run = a.run or latest_run()
    print("GFS run", run, flush=True)
    build(run, a.out, a.grib_dir)
