"""
GEFS ensemble spread of the boomless Mach (issue #7), for the hindcast dates of the value-of-information study.

For each date D (00 UTC): the GEFS run of D-1 00Z, forecast hour 24 (same lead as the study's GFS "f24"),
31 members (gec00, gep01..gep30), 0.5 deg pgrb2a + pgrb2b (together they hold all 23 pressure levels the
map uses). Each member -> boomless Mach with the same physics as the live map (physics.mmax_grid, 1 km
buffer, lateral rays, virtual temperature), sampled to the 1-degree GFS grid.

Output study_gefs_YYYYMMDD.npz, for FL350/450/550 (36 headings, 181 x 360, lon 0..359):
  gefs_{fl}_mean  uint8, M = 1 + 0.0025 v (0 = no corridor)     ensemble mean
  gefs_{fl}_p10   uint8, same encoding                         10th percentile over members
  gefs_{fl}_sd    uint8, sd = 0.0005 v                          member standard deviation
A member without a corridor at a point counts as M 0.98 (as in the route sampling).
"""
import argparse, datetime as dt, os, sys, time
import numpy as np

import build
from physics import mmax_grid

BASE = "https://noaa-gefs-pds.s3.amazonaws.com"
MEMBERS = ["c00"] + [f"p{i:02d}" for i in range(1, 31)]
FLS = [350, 450, 550]
WANT = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT", "RH") for p in build.PLEV}


def src(day, mem, part, fh=24):
    d = day.strftime("%Y%m%d")
    sub = {"a": "pgrb2ap5", "b": "pgrb2bp5"}[part]
    return f"{BASE}/gefs.{d}/00/atmos/{sub}/ge{mem}.t00z.pgrb2{part}.0p50.f{fh:03d}"


def member_fields(day, mem):
    F = {}
    for part in ("a", "b"):
        need = WANT - set(F)
        if not need:
            break
        F.update(build.fetch(day.strftime("%Y%m%d") + "00", 24, need, src=src(day, mem, part)))
    miss = {k for k in WANT if k[0] != "RH"} - set(F)
    if miss:
        raise RuntimeError(f"{mem}: missing {sorted(miss)[:4]}")
    st = lambda v: np.stack([F[(v, f"{p} mb")][::2, ::2] for p in build.PLEV])   # 0.5 -> 1 deg
    RH = st("RH") if all(("RH", f"{p} mb") in F for p in build.PLEV) else None
    return st("TMP"), st("UGRD"), st("VGRD"), st("HGT"), RH


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-10-09")
    ap.add_argument("--end", default="2026-10-08")
    ap.add_argument("--step-days", type=int, default=14)
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--nshards", type=int, default=1)
    ap.add_argument("--members", type=int, default=31)
    ap.add_argument("--out", default="gefs_out")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    d0, d1 = dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end)
    dates = [d0 + dt.timedelta(days=i) for i in range(0, (d1 - d0).days + 1, a.step_days)]
    zfoot = None
    for d in dates[a.shard::a.nshards]:
        t0, run = time.time(), d - dt.timedelta(days=1)
        if zfoot is None:
            F0 = build.fetch_fields(d.strftime("%Y%m%d") + "00", 0)
            zfoot, _ = build.fetch_orog(d.strftime("%Y%m%d") + "00", F0)
            zfoot = np.maximum(zfoot, 0.0).astype(np.float32)
        stacks = {fl: [] for fl in FLS}
        for mem in MEMBERS[:a.members]:
            try:
                T, U, V, Z, RH = member_fields(run, mem)
            except Exception as e:
                print(f"{d} {mem} skipped: {e}", file=sys.stderr, flush=True)
                continue
            for fl in FLS:
                M = mmax_grid(np.array(build.PLEV, float), T, U, V, Z, zfoot, fl, build.HEADINGS, RH=RH)["M"]
                stacks[fl].append(np.where(np.isfinite(M) & (M > 1.0), M, 0.98).astype(np.float32))
        n = len(stacks[FLS[0]])
        if n < 10:
            print(f"{d}: only {n} members, skipped", file=sys.stderr, flush=True)
            continue
        out = {"members": np.array(n)}
        for fl in FLS:
            S = np.stack(stacks[fl])                                   # (n, 36, 181, 360)
            out[f"gefs_{fl}_mean"] = build.encode_M(S.mean(0))
            out[f"gefs_{fl}_p10"] = build.encode_M(np.quantile(S, 0.1, axis=0))
            out[f"gefs_{fl}_sd"] = np.clip(np.round(S.std(0) / 0.0005), 0, 255).astype(np.uint8)
        np.savez_compressed(os.path.join(a.out, f"study_gefs_{d:%Y%m%d}.npz"), **out)
        print(f"{d} done: {n} members in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
