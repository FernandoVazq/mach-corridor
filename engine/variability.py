"""
Study 1 (deep studies, Oct 2026): how the boomless corridor varies with the hour, the season and the year.

Runs in GitHub Actions (.github/workflows/variability.yml); the sandbox cannot reach AWS.

collect: for every --step-days day from --start to --end and each GFS cycle 00/06/12/18 UTC, read the GFS
analysis (f000, 1 degree) and, on the 2-degree land nodes between 60 S and 75 N (same physics, floor and terrain
as the live map, engine/physics.py, 1 km buffer over the DEM footprint maximum), store
  M_{fl}_min / M_{fl}_max   uint8   boomless Mach, worst and best of 36 directions, FL350/450/550 (1 + 0.0025 v, 0 = none)
  M_550_h                   uint8   (8, N) FL550 for directions 0, 45, ..., 315
  predictors (float16, N):  t2m, tsfc (K) | ttrop (K), ztrop (m) | c550, u550, v550, c350, u350, v350 (m/s) |
                            u250, v250 (m/s) | cmax (m/s) and zcmax (m): largest sound speed between floor and FL550
                            (virtual temperature, no wind) and its height | cfloor (m/s) at the floor
one row per analysis, packed per shard: var_shard{k}.npz with arrays (time, N) and the node table.

merge: concatenate shards in time order -> var_{year}.npz files (< 100 MB each) + nodes.npz.
"""
import argparse, datetime as dt, glob, os, sys, time
import numpy as np

import build
from physics import mmax_grid, virtual_temperature, sound_speed, isa_pressure_hpa, FT

FLS = [350, 450, 550]
H8 = list(range(0, 360, 45))
EXTRA = {("TMP", "2 m above ground"), ("TMP", "surface"), ("TMP", "tropopause"), ("HGT", "tropopause")}


def nodes_from(land):
    lat = np.linspace(90, -90, 181); lon = np.arange(360.0)
    J, I = np.meshgrid(np.arange(0, 181, 2), np.arange(0, 360, 2), indexing="ij")
    m = (land[J, I] > 0.5) & (lat[J] >= -60) & (lat[J] <= 75)
    return J[m], I[m], lat[J[m]], np.where(lon[I[m]] > 180, lon[I[m]] - 360, lon[I[m]])


def one(run, jj, ii, zf_nodes):
    want = build.WANT | EXTRA
    F = build.fetch(run, 0, want)
    miss = (build.WANT - build.OPTIONAL) - set(F)
    if miss:
        raise RuntimeError(f"missing {sorted(miss)[:3]}")
    P = np.array(build.PLEV, float)
    st = lambda v: np.stack([F[(v, f"{p} mb")][jj, ii] for p in build.PLEV])[:, None, :]
    T, U, V, Z = st("TMP"), st("UGRD"), st("VGRD"), st("HGT")
    RH = st("RH") if all(("RH", f"{p} mb") in F for p in build.PLEV) else None
    zg = zf_nodes[None, :]
    out = {}
    for fl in FLS:
        r = mmax_grid(P, T, U, V, Z, zg, fl, build.HEADINGS, RH=RH)
        M = r["M"][:, 0, :]
        out[f"M_{fl}_min"] = build.encode_M(np.nanmin(np.where(np.isnan(M), 0.0, M), axis=0))
        out[f"M_{fl}_max"] = build.encode_M(np.nanmax(np.where(np.isnan(M), 0.0, M), axis=0))
        if fl == 550:
            Mh = M[[h // 10 for h in H8]]
            out["M_550_h"] = build.encode_M(np.where(np.isnan(Mh), 0.0, Mh))
            out["c550"], out["u550"], out["v550"] = r["c_a"][0], r["U_a"][0], r["V_a"][0]
            za = r["z_cruise"][0]
        if fl == 350:
            out["c350"], out["u350"], out["v350"] = r["c_a"][0], r["U_a"][0], r["V_a"][0]
    k250 = build.PLEV.index(250)
    out["u250"], out["v250"] = U[k250, 0], V[k250, 0]
    Tv = virtual_temperature(T, RH, P[:, None, None]) if RH is not None else T
    c = sound_speed(Tv)[:, 0, :]
    zfl = zf_nodes + 1000.0
    Zn = Z[:, 0, :]
    inside = (Zn > zfl[None]) & (Zn < za[None])
    cm = np.where(inside, c, -1.0)
    k = cm.argmax(axis=0)
    out["cmax"] = np.where(inside.any(axis=0), cm.max(axis=0), np.nan)
    out["zcmax"] = np.where(inside.any(axis=0), np.take_along_axis(Zn, k[None], 0)[0], np.nan)
    lo = np.clip((Zn <= zfl[None]).sum(axis=0) - 1, 0, len(P) - 2)
    z0, z1 = np.take_along_axis(Zn, lo[None], 0)[0], np.take_along_axis(Zn, lo[None] + 1, 0)[0]
    c0, c1 = np.take_along_axis(c, lo[None], 0)[0], np.take_along_axis(c, lo[None] + 1, 0)[0]
    w = np.clip((zfl - z0) / np.maximum(z1 - z0, 1.0), 0, 1)
    out["cfloor"] = (1 - w) * c0 + w * c1
    g = lambda key: F[key][jj, ii] if key in F else np.full(len(jj), np.nan, np.float32)
    out["t2m"], out["tsfc"] = g(("TMP", "2 m above ground")), g(("TMP", "surface"))
    out["ttrop"], out["ztrop"] = g(("TMP", "tropopause")), g(("HGT", "tropopause"))
    return out, F[("LAND", "surface")]


def collect(a):
    os.makedirs(a.out, exist_ok=True)
    d0, d1 = dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end)
    days = [d0 + dt.timedelta(days=i) for i in range(0, (d1 - d0).days + 1, a.step_days)]
    runs = [d.strftime("%Y%m%d") + f"{h:02d}" for d in days for h in (0, 6, 12, 18)]
    mine = runs[a.shard::a.nshards]
    # nodes and floor from a fixed recent run, so every shard and year uses the same nodes and terrain
    ref = a.ref_run
    F0 = build.fetch_fields(ref, 0)
    jj, ii, lat, lon = nodes_from(F0[("LAND", "surface")])
    zf, note = build.fetch_orog(ref, F0)
    zf = np.maximum(zf, 0.0)[jj, ii].astype(np.float32)
    print(f"{len(jj)} land nodes; floor: {note}", flush=True)
    rows, times = {}, []
    for run in mine:
        t0 = time.time()
        try:
            o, _ = one(run, jj, ii, zf)
        except Exception as e:
            print(f"{run} skipped: {e}", flush=True); continue
        for kk, v in o.items():
            rows.setdefault(kk, []).append(v.astype(np.uint8) if kk.startswith("M_") else np.asarray(v, np.float16))
        times.append(run)
        print(f"{run} {time.time() - t0:.0f}s", flush=True)
    np.savez_compressed(os.path.join(a.out, f"var_shard{a.shard:02d}.npz"), time=np.array(times),
                        **{k: np.stack(v) for k, v in rows.items()}, jj=jj, ii=ii, lat=lat, lon=lon, zfloor=zf)


def merge(a):
    parts = [np.load(p) for p in sorted(glob.glob(os.path.join(a.inp, "**", "var_shard*.npz"), recursive=True))]
    t = np.concatenate([p["time"] for p in parts]); o = np.argsort(t); t = t[o]
    keys = [k for k in parts[0].files if k not in ("time", "jj", "ii", "lat", "lon", "zfloor")]
    os.makedirs(a.out, exist_ok=True)
    np.savez_compressed(os.path.join(a.out, "nodes.npz"), **{k: parts[0][k] for k in ("jj", "ii", "lat", "lon", "zfloor")})
    allk = {k: np.concatenate([p[k] for p in parts])[o] for k in keys}
    years = np.array([s[:4] for s in t])
    for y in sorted(set(years)):
        m = years == y
        np.savez_compressed(os.path.join(a.out, f"var_{y}.npz"), time=t[m], **{k: v[m] for k, v in allk.items()})
    print(len(t), "analyses", t[0], "->", t[-1])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["collect", "merge"])
    ap.add_argument("--start", default="2021-04-01")
    ap.add_argument("--end", default="2026-09-30")
    ap.add_argument("--step-days", type=int, default=3)
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--nshards", type=int, default=1)
    ap.add_argument("--ref-run", default="2026100100")
    ap.add_argument("--inp", default="shards")
    ap.add_argument("--out", default="var_out")
    a = ap.parse_args()
    collect(a) if a.mode == "collect" else merge(a)
