"""
Hindcast data for the value-of-information study (runs in GitHub Actions; the sandbox cannot reach AWS).

For every week from --start to --end (00 UTC), compute the boomless Mach field (36 directions) twice:
  ana : GFS analysis (run D 00Z, f000)            -> stands in for the atmosphere that actually happened
  f24 : GFS 24 h forecast (run D-1 00Z, f024)     -> what a dispatcher would have had the day before
Flight levels FL350, FL450, FL550. Same physics as the live map (engine/physics.py v2, 1 km buffer,
max terrain over the boom footprint).

Output: one compressed .npz per date with, for each kind and FL,
  {kind}_{fl}_M : uint8 (36, 181, 360), value v -> M = 1 + 0.0025 v, 0 = no corridor   (GFS native grid, lon 0..359)
  {kind}_{fl}_c, _u, _v : float16 (181, 360), sound speed and wind at cruise (m/s)
plus land (uint8 0..255) and zfoot (terrain under the footprint, m).
"""
import argparse, datetime as dt, os, sys, time
import numpy as np

import build
from physics import mmax_grid

FLS = [350, 450, 550]


def fields(run, fh):
    F = build.fetch_fields(run, fh)
    st = lambda v: np.stack([F[(v, f"{p} mb")] for p in build.PLEV])
    RH = st("RH") if all(("RH", f"{p} mb") in F for p in build.PLEV) else None
    return F, st("TMP"), st("UGRD"), st("VGRD"), st("HGT"), RH


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-10-09")
    ap.add_argument("--end", default="2026-10-08")
    ap.add_argument("--step-days", type=int, default=7)
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--nshards", type=int, default=1)
    ap.add_argument("--out", default="study_out")
    ap.add_argument("--buffer", default="1000", help='metres, or "haglund" for the computed safe height')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    hb = a.buffer if a.buffer == "haglund" else float(a.buffer)
    d0, d1 = dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end)
    dates = [d0 + dt.timedelta(days=i) for i in range(0, (d1 - d0).days + 1, a.step_days)]
    mine = dates[a.shard::a.nshards]
    zfoot = None
    for d in mine:
        t0 = time.time()
        out = {}
        try:
            for kind, run, fh in (("ana", d.strftime("%Y%m%d") + "00", 0),
                                  ("f24", (d - dt.timedelta(days=1)).strftime("%Y%m%d") + "00", 24)):
                F, T, U, V, Z, RH = fields(run, fh)
                if zfoot is None:
                    zfoot, _ = build.fetch_orog(run, F)
                    zfoot = np.maximum(zfoot, 0.0).astype(np.float32)
                if "land" not in out:
                    out["land"] = np.clip(np.round(F[("LAND", "surface")] * 255), 0, 255).astype(np.uint8)
                for fl in FLS:
                    r = mmax_grid(np.array(build.PLEV, float), T, U, V, Z, zfoot, fl, build.HEADINGS, RH=RH, h_buf=hb)
                    out[f"{kind}_{fl}_M"] = build.encode_M(r["M"])
                    if kind == "ana" and fl == FLS[0] and np.ndim(r["h_buf"]) == 2:
                        out["hbuf"] = np.clip(np.round(r["h_buf"] / 10), 0, 255).astype(np.uint8)   # metres / 10
                    out[f"{kind}_{fl}_c"] = r["c_a"].astype(np.float16)
                    out[f"{kind}_{fl}_u"] = r["U_a"].astype(np.float16)
                    out[f"{kind}_{fl}_v"] = r["V_a"].astype(np.float16)
        except Exception as e:
            print(f"{d} skipped: {e}", file=sys.stderr, flush=True)
            continue
        out["zfoot"] = zfoot.astype(np.float16)
        np.savez_compressed(os.path.join(a.out, f"study_{d:%Y%m%d}.npz"), **out)
        print(f"{d} done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
