"""
Live ensemble spread for the map's Auto margin (issue #7).

Latest GEFS 00Z run, 31 members, forecast hours 0-54 every 6 h: boomless Mach per member for every flight level
and direction (same physics as the map), then the member standard deviation. The app turns it into a margin
k(FL) * sqrt(spread^2 + 0.012^2), with k calibrated in the hindcast (study/gefs_eval.py) to keep flights with
a boom on the ground at 0.5%.

Output (--out): g{fh:03d}_FL{fl}.png, 6 x 6 tiles of 180 x 91 on a 2-degree grid (lon -180..178, lat 90..-90),
tile i = direction 10 i deg, value v -> spread 0.001 v (the spread field is smooth; ~0.2 MB per file); and part_{fh}.json with run and fh (gefs.json is written by --combine).
"""
import argparse, datetime as dt, glob, json, os, sys, time
import numpy as np
from PIL import Image

import build
from physics import mmax_grid
from gefs import MEMBERS, WANT, BASE

FHS = list(range(0, 55, 6))
K = {350: 3.69, 450: 3.86, 550: 3.73}          # gefs_eval.json, 0.5% gate, 24 h lead


def src(run, mem, part, fh):
    d, h = run[:8], run[8:]
    sub = {"a": "pgrb2ap5", "b": "pgrb2bp5"}[part]
    return f"{BASE}/gefs.{d}/{h}/atmos/{sub}/ge{mem}.t{h}z.pgrb2{part}.0p50.f{fh:03d}"


def latest_run():
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 4):
        run = (now - dt.timedelta(days=back)).strftime("%Y%m%d") + "00"
        if all(build.S.head(src(run, "p30", p, FHS[-1]) + ".idx", timeout=30).status_code == 200 for p in ("a", "b")):
            return run
    raise RuntimeError("no complete GEFS 00Z run in the last 4 days")


def member(run, mem, fh):
    F = {}
    for part in ("a", "b"):
        need = WANT - set(F)
        if need:
            F.update(build.fetch(run, fh, need, src=src(run, mem, part, fh)))
    if {k for k in WANT if k[0] != "RH"} - set(F):
        raise RuntimeError("missing levels")
    st = lambda v: np.stack([F[(v, f"{p} mb")][::2, ::2] for p in build.PLEV])
    RH = st("RH") if all(("RH", f"{p} mb") in F for p in build.PLEV) else None
    return st("TMP"), st("UGRD"), st("VGRD"), st("HGT"), RH


def run_fh(run, fh, zfoot, out):
    s1 = {fl: 0.0 for fl in build.FLS}; s2 = {fl: 0.0 for fl in build.FLS}; n = 0
    for mem in MEMBERS:
        try:
            T, U, V, Z, RH = member(run, mem, fh)
        except Exception as e:
            print(f"f{fh:03d} {mem} skipped: {e}", file=sys.stderr, flush=True)
            continue
        for fl in build.FLS:
            M = mmax_grid(np.array(build.PLEV, float), T, U, V, Z, zfoot, fl, build.HEADINGS, RH=RH)["M"]
            M = np.where(np.isfinite(M) & (M > 1.0), M, 0.98).astype(np.float64)
            s1[fl] = s1[fl] + M; s2[fl] = s2[fl] + M * M
        n += 1
    if n < 20:
        raise RuntimeError(f"f{fh:03d}: only {n} members")
    for fl in build.FLS:
        sd = np.sqrt(np.maximum(s2[fl] / n - (s1[fl] / n) ** 2, 0.0))
        tiles = [np.clip(np.round(np.roll(t[::2, ::2], 90, axis=-1) / 0.001), 0, 255).astype(np.uint8) for t in sd]
        ny, nx = tiles[0].shape
        atlas = np.zeros((6 * ny, 6 * nx), np.uint8)
        for i, t in enumerate(tiles):
            r, c = divmod(i, 6)
            atlas[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = t
        Image.fromarray(atlas, "L").save(os.path.join(out, f"g{fh:03d}_FL{fl}.png"), optimize=True)
    json.dump({"run": run, "fh": fh, "members": n}, open(os.path.join(out, f"part_{fh:03d}.json"), "w"))
    print(f"f{fh:03d}: {n} members", flush=True)


def combine(out):
    parts = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(out, "part_*.json")))]
    runs = {p["run"] for p in parts}
    if len(runs) != 1:
        raise RuntimeError(f"mixed runs {runs}")
    run = runs.pop()
    t0 = dt.datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    fhs = sorted(p["fh"] for p in parts)
    meta = {"run": run, "run_time": t0.isoformat().replace("+00:00", "Z"), "fhs": fhs,
            "valid_times": [(t0 + dt.timedelta(hours=h)).isoformat().replace("+00:00", "Z") for h in fhs],
            "members": min(p["members"] for p in parts), "fls": build.FLS, "pattern": "g{fh:03d}_FL{fl}.png",
            "cols": 6, "nx": 180, "ny": 91, "d": 2, "lon0": -180, "lat0": 90, "sd_step": 0.001, "k": K, "s_extra": 0.012,
            "source": "NOAA GEFS v12 0.5 deg (pgrb2a+b), 31 members, boomless Mach spread per direction"}
    json.dump(meta, open(os.path.join(out, "gefs.json"), "w"), indent=1)
    for f in glob.glob(os.path.join(out, "part_*.json")):
        os.remove(f)
    print("combined", run, fhs)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run")
    ap.add_argument("--fh", default=",".join(map(str, FHS)))
    ap.add_argument("--out", default="gefs_live")
    ap.add_argument("--combine", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.combine:
        combine(a.out); sys.exit(0)
    run = a.run or latest_run()
    print("GEFS run", run, flush=True)
    grun = build.latest_run()
    F0 = build.fetch_fields(grun, 0)
    zfoot, _ = build.fetch_orog(grun, F0)
    zfoot = np.maximum(zfoot, 0.0).astype(np.float32)
    for fh in map(int, a.fh.split(",")):
        run_fh(run, fh, zfoot, a.out)
