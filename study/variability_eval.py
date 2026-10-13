"""
Deep study 1 (Oct 2026): how the boomless corridor changes with the hour, the season and the year, and why.

Data: study-variability branch (engine/variability.py) — GFS analyses at 00/06/12/18 UTC every 3rd day,
Apr 2021 - Sep 2026, 3,627 land nodes on a 2-degree grid (60 S - 75 N); boomless Mach worst/best of 36 directions at
FL350/450/550, FL550 for 8 directions, and its physical drivers. Climate indices from NOAA PSL/CPC.

Analyses (cos-latitude weights; "usable" = boomless Mach >= 1.10 in the worst direction, i.e. a corridor in every
direction with room for a ~0.05 margin):
  1. Variance decomposition of the FL550 worst-direction Mach per node: annual cycle (3 harmonics), diurnal cycle
     (by local solar time), year-to-year, and the rest (weather); medians by region.
  2. Diurnal cycle by local time: amplitude and best/worst local hour by region and season.
  3. Seasonal cycle: usable share by month and region, FL350/450/550; east vs west.
  4. Drivers: multiple regression of anomalies on floor/max sound speed, cruise sound speed, cruise wind, tropopause,
     surface temperature, jet wind; R^2, standardized coefficients, predictor correlations.
  5. Persistence: autocorrelation of anomalies at 6 h ... 9 days (how fast the corridor "forgets").
  6. Year to year: annual usable share by region; monthly anomalies vs ENSO (ONI) and QBO (30 hPa), with lags.
Output: study/results/variability.json. Usage: python variability_eval.py [data dir]
"""
import glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/study_var"
STEP = 0.0025
REGIONS = {  # name: (lat0, lat1, lon0, lon1)
    "Contiguous US": (25, 50, -125, -66), "Europe": (36, 71, -10, 40), "East Asia": (20, 46, 100, 145),
    "India": (8, 32, 68, 92), "Middle East": (12, 40, 34, 60), "Brazil": (-33, 5, -62, -35), "Australia": (-40, -11, 113, 154),
    "Russia": (50, 72, 40, 180), "Canada": (50, 72, -140, -55), "Sahara-Sahel": (10, 32, -15, 35), "Southern Africa": (-35, -10, 12, 40),
    "Mexico-Central America": (8, 25, -118, -77)}


def dec(a):
    a = a.astype(np.float32)
    return np.where(a > 0, 1 + STEP * a, np.nan)


def load():
    files = sorted(glob.glob(os.path.join(DATA, "var_*.npz")))
    parts = [np.load(f) for f in files]
    t = np.concatenate([p["time"] for p in parts])
    keys = [k for k in parts[0].files if k != "time"]
    X = {k: np.concatenate([p[k] for p in parts]) for k in keys}
    nd = np.load(os.path.join(DATA, "nodes.npz"))
    return t, X, nd


def read_index(path, missing=(-99.9, -99.99, -999, 99.99, -9.99)):
    """PSL monthly format: first line 'y0 y1', then 'year v1..v12'. Returns {(year, month): value}."""
    out = {}
    try:
        lines = open(path).read().split("\n")
    except OSError:
        return out
    for ln in lines[1:]:
        f = ln.split()
        if len(f) == 13 and f[0].isdigit():
            for m in range(12):
                v = float(f[m + 1])
                if v not in missing and abs(v) < 90:
                    out[(int(f[0]), m + 1)] = v
    return out


def main():
    t, X, nd = load()
    lat, lon = nd["lat"], nd["lon"]
    w = np.cos(np.radians(lat)); w = w / w.sum()
    yr = np.array([int(s[:4]) for s in t]); mo = np.array([int(s[4:6]) for s in t]); hr = np.array([int(s[8:10]) for s in t])
    import datetime as dt
    tt = np.array([dt.datetime.strptime(s, "%Y%m%d%H") for s in t])
    doy = np.array([x.timetuple().tm_yday + x.hour / 24 for x in tt])
    th = (tt - tt[0]).astype("timedelta64[h]").astype(float) if hasattr(tt[0], "hour") else None
    th = np.array([(x - tt[0]).total_seconds() / 3600 for x in tt])
    out = dict(analyses=len(t), first=t[0], last=t[-1], nodes=len(lat), source="GFS analyses (engine/variability.py)")

    M = {fl: dec(X[f"M_{fl}_min"]) for fl in (350, 450, 550)}
    Mb = {fl: dec(X[f"M_{fl}_max"]) for fl in (350, 450, 550)}
    Mh = dec(X["M_550_h"])                                   # (T, 8, N): 0, 45, ..., 315
    usable = lambda A, thr=1.10: np.where(np.isnan(A), 0.0, (A >= thr).astype(float))
    reg = {r: (lat >= b[0]) & (lat <= b[1]) & (lon >= b[2]) & (lon <= b[3]) for r, b in REGIONS.items()}
    reg["All land"] = np.ones(len(lat), bool)
    out["region_nodes"] = {r: int(m.sum()) for r, m in reg.items()}

    # ---------- 1. variance decomposition (FL550 worst direction; no-corridor counted as 1.0) ----------
    A = np.where(np.isnan(M[550]), 1.0, M[550])
    ang = 2 * np.pi * doy / 365.25
    H = np.column_stack([np.ones_like(ang)] + [f(k * ang) for k in (1, 2, 3) for f in (np.cos, np.sin)])
    coef, *_ = np.linalg.lstsq(H, A, rcond=None)
    seas = H @ coef
    r1 = A - seas
    # diurnal by local solar time bin (4 bins of 6 h) per node
    lst = (hr[:, None] + lon[None, :] / 15.0) % 24
    lbin = (lst // 6).astype(int)                            # 0: 0-6, 1: 6-12, 2: 12-18, 3: 18-24 local
    di = np.zeros_like(r1)
    dcomp = np.zeros((4, len(lat)))
    for b in range(4):
        m = lbin == b
        s = np.where(m, r1, 0).sum(0) / np.maximum(m.sum(0), 1)
        dcomp[b] = s
        di = np.where(m, s[None, :], di)
    r2 = r1 - di
    yy = np.zeros_like(r2)
    for y in np.unique(yr):
        m = yr == y
        yy[m] = r2[m].mean(0)
    r3 = r2 - yy
    tot = A.var(0)
    frac = dict(annual_cycle=seas.var(0) / tot, diurnal=di.var(0) / tot, year_to_year=yy.var(0) / tot, weather=r3.var(0) / tot)
    out["variance_fl550_worst"] = {r: {k: round(float(np.median(v[m])), 3) for k, v in frac.items()} | {"sd_mach": round(float(np.median(np.sqrt(tot[m]))), 4)}
                                   for r, m in reg.items()}

    # ---------- 2. diurnal cycle by local time ----------
    labels = ["00-06", "06-12", "12-18", "18-24"]
    dz = {}
    for r, m in reg.items():
        prof = [float(np.sum(w[m] * dcomp[b][m]) / w[m].sum()) for b in range(4)]
        use = []
        for b in range(4):
            mm = (lbin == b)
            u = usable(M[550])
            use.append(float(np.sum((np.where(mm, u, 0).sum(0) / np.maximum(mm.sum(0), 1))[m] * w[m]) / w[m].sum()))
        amp = np.ptp(dcomp[:, m], axis=0)
        dz[r] = dict(anomaly_by_local_time=dict(zip(labels, [round(x, 4) for x in prof])),
                     usable_by_local_time=dict(zip(labels, [round(x, 3) for x in use])),
                     node_amplitude_median=round(float(np.median(amp)), 4), node_amplitude_p90=round(float(np.quantile(amp, 0.9)), 4),
                     best_local=labels[int(np.argmax(prof))], worst_local=labels[int(np.argmin(prof))])
    out["diurnal_fl550"] = dz
    # diurnal of the drivers (floor sound speed and 2 m temperature)
    for key in ("cfloor", "t2m", "cmax", "c550"):
        V = X[key].astype(np.float32)
        V = np.where(np.isfinite(V), V, np.nan)
        an = V - np.nanmean(V, 0)
        prof = [float(np.nanmedian(np.where(lbin == b, an, np.nan).mean(0) if False else np.nanmean(np.where(lbin == b, an, np.nan), 0))) for b in range(4)]
        out.setdefault("diurnal_drivers_all_land_median", {})[key] = dict(zip(labels, [round(x, 3) for x in prof]))

    # ---------- 3. seasonal cycle by month ----------
    sc = {}
    for r, m in reg.items():
        row = {}
        for fl in (350, 450, 550):
            u = usable(M[fl])
            row[f"FL{fl}"] = [round(float(np.sum(u[mo == k][:, m].mean(0) * w[m]) / w[m].sum()), 3) for k in range(1, 13)]
        u15 = usable(M[550], 1.15)
        row["FL550_ge_1.15"] = [round(float(np.sum(u15[mo == k][:, m].mean(0) * w[m]) / w[m].sum()), 3) for k in range(1, 13)]
        e = Mh[:, 2, :]; wv = Mh[:, 6, :]                    # 90 (eastbound) and 270 (westbound)
        row["FL550_east_minus_west_mach"] = [round(float(np.nanmedian((e - wv)[mo == k][:, m])), 4) for k in range(1, 13)]
        row["FL550_median_worst"] = [round(float(np.nanmedian(np.where(np.isnan(M[550]), 1.0, M[550])[mo == k][:, m])), 4) for k in range(1, 13)]
        sc[r] = row
    out["seasonal_by_month"] = sc

    # ---------- 4. drivers ----------
    an = lambda V: V - (H @ np.linalg.lstsq(H, V, rcond=None)[0])
    pred = {}
    pred["cmax"] = X["cmax"].astype(np.float32); pred["cfloor"] = X["cfloor"].astype(np.float32)
    pred["c550"] = X["c550"].astype(np.float32)
    pred["wind550"] = np.hypot(X["u550"].astype(np.float32), X["v550"].astype(np.float32))
    pred["jet250"] = np.hypot(X["u250"].astype(np.float32), X["v250"].astype(np.float32))
    pred["ttrop"] = X["ttrop"].astype(np.float32); pred["ztrop"] = X["ztrop"].astype(np.float32)
    pred["t2m"] = X["t2m"].astype(np.float32)
    names = list(pred)
    ok = np.all([np.isfinite(pred[k]).all(0) for k in names], axis=0) & np.isfinite(A).all(0)
    idx = np.where(ok)[0]
    rng = np.random.default_rng(3); sub = rng.choice(idx, min(1500, len(idx)), replace=False)
    R2_all, R2_phys, betas, corr = [], [], [], []
    for j in sub:
        y = an(A[:, j:j + 1])[:, 0]
        Z = np.column_stack([an(pred[k][:, j:j + 1])[:, 0] for k in names])
        Zs = (Z - Z.mean(0)) / np.maximum(Z.std(0), 1e-9); ys = (y - y.mean()) / max(y.std(), 1e-9)
        b, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(ys)), Zs]), ys, rcond=None)
        R2_all.append(1 - np.var(ys - np.column_stack([np.ones(len(ys)), Zs]) @ b) / np.var(ys))
        betas.append(b[1:])
        corr.append([np.corrcoef(Zs[:, i], ys)[0, 1] for i in range(len(names))])
        Zp = Zs[:, [names.index("cmax"), names.index("c550")]]
        bp, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(ys)), Zp]), ys, rcond=None)
        R2_phys.append(1 - np.var(ys - np.column_stack([np.ones(len(ys)), Zp]) @ bp) / np.var(ys))
    betas, corr = np.array(betas), np.array(corr)
    out["drivers_fl550_worst_anomalies"] = dict(
        nodes_sampled=len(sub), r2_all_predictors_median=round(float(np.median(R2_all)), 3),
        r2_cmax_c550_only_median=round(float(np.median(R2_phys)), 3),
        standardized_beta_median={k: round(float(np.median(betas[:, i])), 3) for i, k in enumerate(names)},
        correlation_median={k: round(float(np.median(corr[:, i])), 3) for i, k in enumerate(names)},
        note="anomalies about each node's annual cycle; worst direction, so the wind term enters through the direction "
             "that limits; cmax = largest sound speed between floor and FL550 (no wind), c550 = sound speed at cruise")
    # predictor correlation matrix (all land, anomalies, pooled sample)
    P = np.column_stack([an(pred[k][:, sub])[:, :].ravel() for k in names])
    out["predictor_correlations"] = dict(names=names, matrix=np.round(np.corrcoef(P.T), 2).tolist())

    # ---------- 5. persistence ----------
    lags_h = [6, 12, 18, 24, 72, 144, 216]
    ac = {}
    for L in lags_h:
        pairs_a, pairs_b = [], []
        tidx = {x: i for i, x in enumerate(th)}
        ii = [(i, tidx[th[i] + L]) for i in range(len(th)) if (th[i] + L) in tidx]
        if not ii:
            continue
        a_i = np.array([p[0] for p in ii]); b_i = np.array([p[1] for p in ii])
        R = r1                                                   # anomaly about the annual cycle (incl. diurnal)
        num = np.sum((R[a_i] - R.mean(0)) * (R[b_i] - R.mean(0)), 0); den = R.var(0) * len(a_i)
        ac[f"{L}h"] = {r: round(float(np.median((num / den)[m])), 3) for r, m in reg.items()}
    out["autocorrelation_fl550_worst"] = ac

    # ---------- 6. year to year and climate indices ----------
    ann = {}
    for r, m in reg.items():
        u = usable(M[550])
        ann[r] = {str(y): round(float(np.sum(u[yr == y][:, m].mean(0) * w[m]) / w[m].sum()), 3) for y in np.unique(yr)
                  if set(mo[yr == y]) == set(range(1, 13))}            # full calendar years only (2021 and 2026 are partial)
    out["annual_usable_fl550"] = ann
    oni = read_index(os.path.join(DATA, "idx_oni.data")); qbo = read_index(os.path.join(DATA, "idx_qbo.data"))
    months = sorted({(y, m) for y, m in zip(yr, mo)})
    cl = {}
    for r, m in reg.items():
        u = usable(M[550])
        ser = np.array([np.sum(u[(yr == y) & (mo == mm)][:, m].mean(0) * w[m]) / w[m].sum() for y, mm in months])
        clim = np.array([np.mean([ser[i] for i, (y2, m2) in enumerate(months) if m2 == mm]) for _, mm in months])
        anom = ser - clim
        row = {}
        for nm, ix in (("ONI", oni), ("QBO30", qbo)):
            for lag in (0, 3):
                xs, ys = [], []
                for i, (y, mm) in enumerate(months):
                    k = (y + (mm - 1 - lag) // 12, (mm - 1 - lag) % 12 + 1)
                    if k in ix:
                        xs.append(ix[k]); ys.append(anom[i])
                if len(xs) > 24:
                    c = np.corrcoef(xs, ys)[0, 1]
                    row[f"{nm}_lag{lag}"] = dict(r=round(float(c), 3), r2=round(float(c * c), 3), n=len(xs))
        cl[r] = row
    out["climate_indices_vs_monthly_usable_anomaly"] = cl
    out["indices_available"] = dict(oni_months=len(oni), qbo_months=len(qbo))
    json.dump(out, open(os.path.join(HERE, "results", "variability.json"), "w"), indent=1)
    print(json.dumps({k: out[k] for k in ("analyses", "first", "last", "nodes")}, indent=1))


if __name__ == "__main__":
    main()
