"""
Validation of the boomless Mach against weather balloons (issues #10 winter, #11 monthly, #6 resolution).

For each radiosonde launch (00Z / 12Z) at the listed stations in [start, end]:
  observed  boomless Mach from the sounding itself (NOAA IGRA2, interpolated to the map's 23 pressure levels)
  GFS 1 deg   analysis (f000 at launch time) and forecasts from earlier runs (--leads, default 0,24 h;
              f06 / f12 = the run 6 / 12 h before launch, i.e. re-planning shortly before departure)
  GFS 0.25 deg  the same two, to measure what resolution buys
Every column uses the same physics as the map (physics.mmax_grid, 36 directions, lateral rays, virtual
temperature) and the same floor (GFS 0.25 deg orography, max over the footprint, + 1 km), so differences come
from the atmosphere only.

Output: rows_<shard>.jsonl, one row per (launch, flight level) with 36-direction arrays.
Usage: python validate.py --start 2025-12-01 --end 2026-02-28 [--every 2] [--shard i --nshards n] [--out dir]
"""
import argparse, datetime as dt, io, json, os, sys, time, zipfile
import numpy as np
import requests

import build
from physics import mmax_grid, footprint_max

STATIONS = {   # IGRA2 id: (name, lat, lon)
    "USM00072747": ("International Falls MN", 48.57, -93.38),
    "USM00072249": ("Fort Worth TX", 32.83, -97.30),
    "RQM00078526": ("San Juan PR", 18.43, -66.00),
    "USM00072493": ("Oakland CA", 37.73, -122.22),
    "USM00072501": ("Upton NY", 40.87, -72.86),
    "USM00072202": ("Miami FL", 25.75, -80.38),
}
IGRA = "https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/access/data-por/{}-data.txt.zip"
FLS = [350, 450, 550]
LEADS = [0, 24]
PLEV = np.array(build.PLEV, float)


def igra_soundings(sid, t0, t1):
    """{datetime: dict(p, z, t, rh, u, v)} for launches at 00Z/12Z between t0 and t1 (IGRA2 fixed-width)."""
    r = requests.get(IGRA.format(sid), timeout=300)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    out, cur, keep = {}, None, False
    with z.open(z.namelist()[0]) as fh:
        for raw in io.TextIOWrapper(fh, encoding="ascii", errors="ignore"):
            if raw.startswith("#"):
                y, m, d, h = int(raw[13:17]), int(raw[18:20]), int(raw[21:23]), int(raw[24:26])
                keep = False
                if h in (0, 12) and t0.year - 1 <= y <= t1.year + 1:
                    t = dt.datetime(y, m, d, h, tzinfo=dt.timezone.utc)
                    keep = t0 <= t <= t1
                    if keep:
                        cur = out[t] = {k: [] for k in ("p", "z", "t", "rh", "dpd", "wd", "ws")}
                continue
            if not keep:
                continue
            f = lambda a, b: int(raw[a:b]) if raw[a:b].strip() not in ("", "-9999", "-8888") else None
            p = f(9, 15)
            if p is None or p <= 0:
                continue
            for k, a, b, sc in (("z", 16, 21, 1), ("t", 22, 27, 0.1), ("rh", 28, 33, 0.1), ("dpd", 34, 39, 0.1),
                                ("wd", 40, 45, 1), ("ws", 46, 51, 0.1)):
                v = f(a, b)
                cur[k].append(np.nan if v is None else v * sc)
            cur["p"].append(p / 100.0)
    return out


def to_levels(s, z_sfc):
    """Sounding -> (T K, U, V, Z, RH) on PLEV; None if it does not reach 70 hPa."""
    s = {k: [np.nan if x is None else x for x in v] for k, v in s.items()}
    p = np.array(s["p"], float); o = np.argsort(-p); p = p[o]
    if p.min() > 70 or p.max() < 500:
        return None
    lp = np.log(p)
    def interp(x, need=True):
        x = np.array(x, float)[o]; ok = np.isfinite(x)
        if ok.sum() < 4:
            return None
        return np.interp(-np.log(PLEV), -lp[ok], x[ok], left=np.nan, right=np.nan)
    T = interp(s["t"]); Z = interp(s["z"])
    wd, ws = np.array(s["wd"], float), np.array(s["ws"], float)
    U = interp(-ws * np.sin(np.radians(wd))); V = interp(-ws * np.cos(np.radians(wd)))
    dpd = np.array(s["dpd"], float)
    td = np.array(s["t"], float) - dpd
    es = lambda tc: 6.112 * np.exp(17.67 * tc / (tc + 243.5))
    rh = np.where(np.isfinite(td), 100 * es(td) / es(np.array(s["t"], float)), np.array(s["rh"], float))
    RH = interp(rh)
    if any(x is None for x in (T, Z, U, V)):
        return None
    above = PLEV < p.max()
    sel = (PLEV >= 70) & (PLEV <= p.max())          # levels between the top needed for FL550 and the ground
    top_ok = np.isfinite(T[sel]).all() and np.isfinite(Z[sel]).all()
    if not top_ok:
        return None
    # levels below the surface: far below the floor so physics ignores them; values copied from the lowest level
    k0 = np.argmax(np.isfinite(T) & np.isfinite(Z) & np.isfinite(U))
    for X in (T, U, V, RH if RH is not None else T):
        X[:k0] = X[k0]
    Z[:k0] = z_sfc - 500.0 - 50.0 * np.arange(k0, 0, -1)
    fill = lambda X: np.where(np.isfinite(X), X, np.interp(np.arange(len(X)), np.where(np.isfinite(X))[0], X[np.isfinite(X)]))
    T, U, V, Z = (fill(X) for X in (T, U, V, Z))
    RH = fill(RH) if RH is not None and np.isfinite(RH).sum() > 4 else None
    return T + 273.15, U, V, Z, RH


def column_M(T, U, V, Z, RH, zg):
    sh = lambda a: np.asarray(a, np.float32)[:, None, None]
    out = {}
    for fl in FLS:
        M = mmax_grid(PLEV, sh(T), sh(U), sh(V), sh(Z), np.full((1, 1), zg, np.float32), fl, build.HEADINGS,
                      RH=None if RH is None else sh(RH))["M"][:, 0, 0]
        out[fl] = [None if not np.isfinite(m) else round(float(m), 4) for m in M]
    return out


def grid_column(F, lat, lon, res):
    """Bilinear column at (lat, lon) from global fields {(var, level): 2-D} (lat 90..-90, lon 0..)."""
    d = 1.0 if res == "1p00" else 0.25
    ny, nx = F[("TMP", "500 mb")].shape
    fi, fj = (lon % 360) / d, (90 - lat) / d
    i0, j0 = int(fi) % nx, int(fj); di, dj = fi - int(fi), fj - j0; i1 = (i0 + 1) % nx
    b = lambda A: (A[j0, i0] * (1 - di) + A[j0, i1] * di) * (1 - dj) + (A[j0 + 1, i0] * (1 - di) + A[j0 + 1, i1] * di) * dj
    st = lambda v: np.array([b(F[(v, f"{int(p)} mb")]) for p in PLEV])
    RH = st("RH") if all(("RH", f"{int(p)} mb") in F for p in PLEV) else None
    return st("TMP"), st("UGRD"), st("VGRD"), st("HGT"), RH


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-12-01"); ap.add_argument("--end", default="2026-02-28")
    ap.add_argument("--every", type=int, default=2, help="use every n-th day")
    ap.add_argument("--shard", type=int, default=0); ap.add_argument("--nshards", type=int, default=1)
    ap.add_argument("--res", default="1p00,0p25"); ap.add_argument("--out", default="val_out")
    ap.add_argument("--soundings", default="", help="JSON from --fetch-soundings (download IGRA once)")
    ap.add_argument("--fetch-soundings", action="store_true")
    ap.add_argument("--leads", default="0,24", help="forecast lead times, hours (0 = analysis)")
    a = ap.parse_args()
    global LEADS
    LEADS = [int(x) for x in a.leads.split(",")]
    os.makedirs(a.out, exist_ok=True)
    t0 = dt.datetime.fromisoformat(a.start).replace(tzinfo=dt.timezone.utc)
    t1 = dt.datetime.fromisoformat(a.end).replace(hour=12, tzinfo=dt.timezone.utc)
    times = [t0 + dt.timedelta(hours=12 * k) for k in range(int((t1 - t0).total_seconds() // 43200) + 1)]
    times = [t for t in times if (t - t0).days % a.every == 0][a.shard::a.nshards]
    snd = {}
    if a.soundings:
        J = json.load(open(a.soundings))
        snd = {sid: {dt.datetime.fromisoformat(k): v for k, v in d.items()} for sid, d in J.items()}
    else:
        for sid in STATIONS:
            try:
                snd[sid] = igra_soundings(sid, t0, t1)
                print(f"{sid}: {len(snd[sid])} launches", flush=True)
            except Exception as e:
                print(f"{sid} failed: {e}", file=sys.stderr, flush=True)
    if a.fetch_soundings:
        tolist = lambda v: [None if (isinstance(x, float) and np.isnan(x)) else x for x in v]
        json.dump({sid: {t.isoformat(): {k: tolist(v) for k, v in s.items()} for t, s in d.items()} for sid, d in snd.items()},
                  open(os.path.join(a.out, "soundings.json"), "w"))
        print("soundings saved", sum(len(d) for d in snd.values()))
        return
    # floor: GFS 0.25 deg orography, max over the footprint, at each station (same for every source)
    run0 = t0.strftime("%Y%m%d") + "00"
    q = build.fetch(run0, 0, {("HGT", "surface")}, res="0p25")[("HGT", "surface")]
    fm = np.maximum(footprint_max(q, radius_cells=2), 0)                   # 1-deg grid
    zfl = {sid: float(fm[int(round(90 - la)), int(round(lo % 360)) % 360]) for sid, (_, la, lo) in STATIONS.items()}
    fout = open(os.path.join(a.out, f"rows_{a.shard}.jsonl"), "w")
    for t in times:
        launches = {sid: s[t] for sid, s in snd.items() if t in s}
        if not launches:
            continue
        tt = time.time()
        src = {}
        for res in a.res.split(","):
            for fh in LEADS:
                kind, run = ("ana" if fh == 0 else f"f{fh:02d}"), t - dt.timedelta(hours=fh)
                try:
                    src[(res, kind)] = build.fetch(run.strftime("%Y%m%d%H"), fh, build.WANT - {("HGT", "surface"), ("LAND", "surface")}, res=res)
                except Exception as e:
                    print(f"{t} {res} {kind} failed: {e}", file=sys.stderr, flush=True)
        for sid, s in launches.items():
            name, la, lo = STATIONS[sid]
            lev = to_levels(s, zfl[sid] - 1000)
            if lev is None:
                continue
            row = {"station": sid, "name": name, "time": t.isoformat()[:16], "obs": column_M(*lev, zfl[sid])}
            for (res, kind), F in src.items():
                try:
                    row[f"{kind}_{res}"] = column_M(*grid_column(F, la, lo, res), zfl[sid])
                except Exception as e:
                    print(f"{t} {sid} {res} {kind}: {e}", file=sys.stderr, flush=True)
            fout.write(json.dumps(row) + "\n"); fout.flush()
        print(f"{t:%Y-%m-%d %HZ}: {len(launches)} launches, {time.time() - tt:.0f}s", flush=True)
    fout.close()


if __name__ == "__main__":
    main()
