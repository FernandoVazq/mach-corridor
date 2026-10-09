"""
Download the latest NOAA GFS run (AWS Open Data, byte-range via .idx) and build
Mach-cutoff atlases + vertical profiles for the web app.   (v2)

Output (in --out, default site/data):
  manifest.json
  f{HHH}_FL{LLL}.png   grayscale atlas, 6 cols x 7 rows of 360x181 tiles (lon -180..179, lat 90..-90)
     tiles 0-35 : boomless Mach for direction of travel 0,10,...,350 deg true
     tile 36    : min over the 36 directions (works in any direction)
     tile 37    : max over the 36 directions (best direction)
     tile 38    : speed of sound at cruise, value = c - 200 (m/s)
     tile 39    : land fraction * 255
     tile 40/41 : cruise wind u / v, value = wind + 128 (m/s)
  M encoding: value 0 = no corridor (M <= 1); M = 1.0 + 0.0025 * value
  prof_f{HHH}.bin      int16 little-endian, shape (4L+1, 91, 180) on a 2-degree grid:
                       [c*10 (L), u*10 (L), v*10 (L), Z (L), ground (1)]   for the 3D column view
Usage:
  python build.py [--run YYYYMMDDHH] [--out DIR]
"""
import argparse, datetime as dt, json, os, sys, time
import numpy as np
import requests
import pygrib
from PIL import Image

from physics import mmax_grid, footprint_max, virtual_temperature, sound_speed, H_BUF_DEFAULT

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
PLEV = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
        450, 400, 350, 300, 250, 200, 150, 100, 70, 50]
FLS = [350, 400, 450, 500, 550, 600]
HEADINGS = list(range(0, 360, 10))
FHOURS = list(range(0, 49, 6))
M_STEP = 0.0025
COLS, ROWS = 6, 7
NX, NY = 360, 181

WANT = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT", "RH") for p in PLEV}
WANT |= {("HGT", "surface"), ("LAND", "surface")}
OPTIONAL = {(v, k) for (v, k) in WANT if v == "RH"}

S = requests.Session()


def url(run, fh, res="1p00"):
    d, h = run[:8], run[8:]
    return f"{BASE}/gfs.{d}/{h}/atmos/gfs.t{h}z.pgrb2.{res}.f{fh:03d}"


def get(u, **kw):
    for attempt in range(5):
        try:
            r = S.get(u, timeout=90, **kw)
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


def fetch(run, fh, want, res="1p00"):
    """Byte-range download of selected messages -> {(var, level): 2D array}."""
    idx_r = get(url(run, fh, res) + ".idx")
    if idx_r is None:
        raise RuntimeError(f"no idx for {url(run, fh, res)}")
    idx = idx_r.text.strip().splitlines()
    rows, seen = [], set()
    for i, line in enumerate(idx):
        parts = line.split(":")
        key = (parts[3], parts[4])
        if key in want and key not in seen:
            seen.add(key)
            end = int(idx[i + 1].split(":")[1]) - 1 if i + 1 < len(idx) else None
            rows.append((int(parts[1]), end, key))
    blobs, cur = [], None
    for s, e, k in rows:
        if cur and cur[1] is not None and s == cur[1] + 1:
            cur = [cur[0], e, cur[2] + [k]]
        else:
            if cur: blobs.append(cur)
            cur = [s, e, [k]]
    blobs.append(cur)
    tmp = f"/tmp/gfs_{run}_{res}_{fh:03d}.grb2"
    with open(tmp, "wb") as f:
        for s, e, _ in blobs:
            f.write(get(url(run, fh, res), headers={"Range": f"bytes={s}-{'' if e is None else e}"}).content)
    order = [k for _, _, ks in blobs for k in ks]
    out = {k: np.asarray(g.values, dtype=np.float32) for g, k in zip(pygrib.open(tmp), order)}
    os.remove(tmp)
    return out


def fetch_fields(run, fh):
    F = fetch(run, fh, WANT)
    missing = (WANT - OPTIONAL) - set(F)
    if missing:
        raise RuntimeError(f"f{fh:03d} missing {sorted(missing)[:5]}")
    return F


def fetch_orog(run, F0):
    """Max terrain over the boom footprint (+/-0.5 deg) from GFS 0.25-deg orography."""
    try:
        q = fetch(run, 0, {("HGT", "surface")}, res="0p25")[("HGT", "surface")]
        return footprint_max(q, radius_cells=2), "GFS 0.25 deg orography, max over +/-0.5 deg"
    except Exception as e:  # fall back to 1-deg max over neighbours
        print("0.25 orography failed, using 1-deg:", e, file=sys.stderr)
        z = F0[("HGT", "surface")]
        m = z.copy()
        for dj in (-1, 1):
            m = np.maximum(m, np.roll(z, dj, axis=1))
        m = np.maximum(m, np.vstack([m[1:], m[-1:]]))
        m = np.maximum(m, np.vstack([m[:1], m[:-1]]))
        return m, "GFS 1 deg orography, max over neighbours (fallback)"


def to_display(a):
    return np.roll(a, 180, axis=-1)


def encode_M(M):
    v = np.round((np.nan_to_num(M, nan=0.0) - 1.0) / M_STEP)
    return np.clip(v, 0, 255).astype(np.uint8)


def weighted_cdf(values, weights, thresholds):
    w = weights / weights.sum()
    return [round(float(w[values >= t].sum()), 4) for t in thresholds]


def weighted_quantile(values, weights, q):
    o = np.argsort(values)
    cw = np.cumsum(weights[o]) / weights.sum()
    return float(values[o][np.searchsorted(cw, q)])


def build(run, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    lat = np.linspace(90, -90, NY)[:, None] * np.ones((1, NX))
    area = np.cos(np.radians(lat))
    thresholds = [round(1.0 + 0.01 * i, 2) for i in range(41)]
    stats, orog_note, have_rh = {}, None, True
    zground = None
    for fh in FHOURS:
        t0 = time.time()
        F = fetch_fields(run, fh)
        if zground is None:
            zground, orog_note = fetch_orog(run, F)
            zground = np.maximum(zground, 0.0)
        st = lambda v: np.stack([F[(v, f"{p} mb")] for p in PLEV])
        T, U, V, Z = st("TMP"), st("UGRD"), st("VGRD"), st("HGT")
        RH = None
        if all(("RH", f"{p} mb") in F for p in PLEV):
            RH = st("RH")
        else:
            have_rh = False
        land = F[("LAND", "surface")]
        stat_mask = (land > 0.5) & (lat > -60)

        # 2-degree profiles for the 3D column view (virtual-temperature sound speed)
        Tv = virtual_temperature(T, RH, np.array(PLEV, np.float32)[:, None, None]) if RH is not None else T
        c = sound_speed(Tv)
        sub = lambda X: np.roll(X[..., ::2, ::2], 90, axis=-1)  # 91 x 180, lon -180..178
        prof = np.concatenate([np.round(sub(c) * 10), np.round(sub(U) * 10), np.round(sub(V) * 10),
                               np.round(sub(Z)), np.round(sub(zground))[None]]).astype("<i2")
        prof.tofile(os.path.join(out_dir, f"prof_f{fh:03d}.bin"))

        for fl in FLS:
            r = mmax_grid(np.array(PLEV, float), T, U, V, Z, zground, fl, HEADINGS, RH=RH)
            M = r["M"]
            Mmin = np.nanmin(np.where(np.isnan(M), 0.0, M), axis=0)
            Mmax = np.nanmax(np.where(np.isnan(M), 0.0, M), axis=0)
            tiles = [encode_M(to_display(m)) for m in M]
            tiles += [encode_M(to_display(Mmin)), encode_M(to_display(Mmax)),
                      np.clip(np.round(to_display(r["c_a"]) - 200), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(land) * 255), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(r["U_a"]) + 128), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(r["V_a"]) + 128), 0, 255).astype(np.uint8)]
            atlas = np.zeros((ROWS * NY, COLS * NX), np.uint8)
            for i, t in enumerate(tiles):
                rr, cc = divmod(i, COLS)
                atlas[rr * NY:(rr + 1) * NY, cc * NX:(cc + 1) * NX] = t
            Image.fromarray(atlas, "L").save(os.path.join(out_dir, f"f{fh:03d}_FL{fl}.png"), optimize=True)
            vals, w = Mmin[stat_mask], area[stat_mask]
            stats.setdefault(str(fl), []).append({
                "fh": fh,
                "land_any_median": round(weighted_quantile(vals, w, 0.5), 4),
                "land_any_p10": round(weighted_quantile(vals, w, 0.1), 4),
                "land_any_cdf": weighted_cdf(vals, w, thresholds),
                "land_best_p90": round(weighted_quantile(Mmax[stat_mask], w, 0.9), 4),
                "max_value_clipped": bool(np.nanmax(M) > 1.0 + 255 * M_STEP),
            })
        print(f"f{fh:03d} done in {time.time() - t0:.1f}s", flush=True)

    run_t = dt.datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    iso = lambda t: t.isoformat().replace("+00:00", "Z")
    manifest = {
        "version": 2,
        "run": run,
        "run_time": iso(run_t),
        "generated": iso(dt.datetime.now(dt.timezone.utc).replace(microsecond=0)),
        "source": "NOAA GFS 1.0 deg pressure levels + 0.25 deg orography (AWS Open Data noaa-gfs-bdp-pds)",
        "physics": {"h_buf_m": H_BUF_DEFAULT, "terrain": orog_note, "lateral_rays": True,
                    "virtual_temperature": have_rh, "surface_layer_used": False},
        "forecast_hours": FHOURS,
        "valid_times": [iso(run_t + dt.timedelta(hours=h)) for h in FHOURS],
        "flight_levels": FLS,
        "headings": HEADINGS,
        "plev": PLEV,
        "grid": {"nx": NX, "ny": NY, "lon0": -180, "lat0": 90, "dlon": 1, "dlat": -1},
        "atlas": {"cols": COLS, "rows": ROWS, "tile_min": 36, "tile_max": 37, "tile_c": 38,
                  "tile_land": 39, "tile_u": 40, "tile_v": 41},
        "encoding": {"M0": 1.0, "M_step": M_STEP, "c_offset": 200, "wind_offset": 128},
        "profiles": {"pattern": "prof_f{fh:03d}.bin", "nx": 180, "ny": 91, "lon0": -180, "lat0": 90, "d": 2,
                     "fields": ["c*10", "u*10", "v*10", "z"], "levels": len(PLEV), "extra": "ground_m"},
        "stats_thresholds": thresholds,
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
    a = ap.parse_args()
    run = a.run or latest_run()
    print("GFS run", run, flush=True)
    build(run, a.out)
