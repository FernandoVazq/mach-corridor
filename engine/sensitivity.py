"""
Trade study: what decides whether the boom reaches the ground? (one-factor-at-a-time sensitivities on real columns
plus a variance decomposition of the boomless Mach)

Boomless Mach, on-track ray (lateral rays add a crosswind correction):
    M = ( max_{floor <= z < cruise} [ c(z) + w(z).e ] - w_cruise.e ) / c_cruise
       = c(z*) / c_cruise                    thermal term: how much faster sound is down low than at cruise
       + (w(z*) - w_cruise).e / c_cruise     wind term: along-track wind down low minus at cruise

Columns: real atmospheres from (a) a year of balloon soundings at 6 US stations (IGRA2, all seasons, 00/12 UTC)
and (b) the GFS global 2-degree profiles of the live map (every land column below 60 deg). Each factor is perturbed
by a realistic amount and the change of the boomless Mach is recorded per column and direction of travel.
Output: JSON for the Physics tab and the study report.
Usage: python sensitivity.py [--soundings soundings.json.gz] [--prof prof_f000.bin --manifest manifest.json] [--out f]
"""
import argparse, gzip, json, math, os, sys
import numpy as np

import build
from physics import mmax_grid, sound_speed, virtual_temperature

PLEV = np.array(build.PLEV, float)
G_R = 1.4 * 287.05
HEADS = [0, 90, 180, 270]
KT = 0.514444


def batch_M(T, U, V, Z, RH, zg, fl, hd, h_buf=1000.0, lateral=True):
    """T,U,V,Z,RH (L,N), zg (N) -> boomless Mach (N) for one heading"""
    sh = lambda a: None if a is None else np.asarray(a, np.float32)[:, None, :]
    return mmax_grid(PLEV, sh(T), sh(U), sh(V), sh(Z), np.asarray(zg, np.float32)[None, :], fl, [hd],
                     RH=sh(RH), h_buf=h_buf, lateral=lateral)["M"][0, 0]


def taper(Z, zg, z0, z1):
    """weight 1 below zg+z0, 0 above zg+z1 (smooth)"""
    h = Z - zg[None]
    return np.clip((z1 - h) / (z1 - z0), 0, 1)


def along(hd):
    return math.sin(math.radians(hd)), math.cos(math.radians(hd))


def z_of_fl(Z, fl):
    from physics import isa_pressure_hpa
    p = isa_pressure_hpa(fl * 100 * 0.3048)
    return np.array([np.interp(np.log(p), np.log(PLEV[::-1]), Z[::-1, i]) for i in range(Z.shape[1])])


def factors(fl):
    """name -> (label, unit perturbation, function(T,U,V,Z,RH,zg,hd) -> (T,U,V,Z,RH,zg, kwargs))"""
    def f_T_all(T, U, V, Z, RH, zg, hd): return T + 1.0, U, V, Z, RH, zg, {}
    def f_T_low(T, U, V, Z, RH, zg, hd): return T + 2.0 * taper(Z, zg, 1000, 3000), U, V, Z, RH, zg, {}
    def f_T_cruise(T, U, V, Z, RH, zg, hd):
        zc = z_of_fl(Z, fl); return T + 1.0 * np.clip(1 - np.abs(Z - zc[None]) / 2000, 0, 1), U, V, Z, RH, zg, {}
    def f_inv(T, U, V, Z, RH, zg, hd): return T - 5.0 * taper(Z, zg, 0, 1500), U, V, Z, RH, zg, {}
    def f_rh(T, U, V, Z, RH, zg, hd):
        R = (RH if RH is not None else np.full_like(T, 30.0)) + 20 * taper(Z, zg, 3000, 5000)
        return T, U, V, Z, np.clip(R, 0, 100), zg, {}
    def wind(level):
        def f(T, U, V, Z, RH, zg, hd):
            s, c = along(hd); w = 10 * KT
            if level == "all": wgt = np.ones_like(T)
            elif level == "low": wgt = taper(Z, zg, 2000, 4000)
            else:
                zc = z_of_fl(Z, fl); wgt = np.clip(1 - np.abs(Z - zc[None]) / 3000, 0, 1)
            return T, U + w * s * wgt, V + w * c * wgt, Z, RH, zg, {}
        return f
    def f_cross(T, U, V, Z, RH, zg, hd):
        s, c = along(hd + 90); w = 10 * KT; wgt = taper(Z, zg, 2000, 4000)
        return T, U + w * s * wgt, V + w * c * wgt, Z, RH, zg, {}
    def f_terrain(T, U, V, Z, RH, zg, hd): return T, U, V, Z, RH, zg + 500, {}
    def f_buffer(T, U, V, Z, RH, zg, hd): return T, U, V, Z, RH, zg, {"h_buf": 1500.0}
    def f_lateral(T, U, V, Z, RH, zg, hd): return T, U, V, Z, RH, zg, {"lateral": False}
    return {
        "T_all": ("Whole column 1 K warmer", "+1 K", f_T_all),
        "T_low": ("Lowest 1–3 km 2 K warmer (sunny afternoon)", "+2 K", f_T_low),
        "T_cruise": ("Air at cruise 1 K warmer", "+1 K", f_T_cruise),
        "inversion": ("Night inversion: ground 5 K colder", "−5 K at ground", f_inv),
        "humidity": ("20% more humidity below 4 km", "+20% RH", f_rh),
        "wind_all": ("10 kt tailwind at every height", "+10 kt", wind("all")),
        "wind_low": ("10 kt tailwind in the lowest 3 km", "+10 kt", wind("low")),
        "wind_cruise": ("10 kt tailwind at cruise only", "+10 kt", wind("cruise")),
        "crosswind": ("10 kt crosswind in the lowest 3 km", "+10 kt", f_cross),
        "terrain": ("Terrain 500 m higher", "+500 m", f_terrain),
        "buffer": ("Safety buffer 1.0 → 1.5 km", "+500 m", f_buffer),
        "lateral": ("Ignoring side rays (on-track ray only)", "off", f_lateral),
    }


def path_angle(M0, gamma_deg):
    """level-flight limit M0 -> limit at flight-path angle gamma (climb > 0): M cos(theta + gamma) = 1 with the
    turning condition fixing theta = acos(1/M0) (no wind change with the tilt)"""
    th = np.arccos(np.clip(1 / np.asarray(M0), -1, 1))
    return 1 / np.cos(th + math.radians(gamma_deg))


def load_soundings(path, nmax=1200, seed=1):
    import validate
    J = json.load(gzip.open(path, "rt")) if path.endswith(".gz") else json.load(open(path))
    cols, meta = [], []
    for sid, d in J.items():
        for t, s in d.items():
            meta.append((sid, t)); cols.append(s)
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(cols))[:nmax]
    T, U, V, Z, R, ZG, M = [], [], [], [], [], [], []
    for i in idx:
        lev = validate.to_levels(cols[i], -1e9)
        if lev is None:
            continue
        t, u, v, z, rh = lev
        # ground = lowest reported height of the launch
        zz = [x for x in cols[i]["z"] if x is not None and np.isfinite(x)]
        zg = float(min(zz)) if zz else 0.0
        T.append(t); U.append(u); V.append(v); Z.append(z); R.append(rh if rh is not None else np.full_like(t, 30.0)); ZG.append(zg)
        M.append(meta[i])
    st = lambda X: np.array(X, float).T
    return st(T), st(U), st(V), st(Z), st(R), np.array(ZG), M


def load_gfs(prof, man, nmax=1500, seed=2):
    m = json.load(open(man)); P = m["profiles"]; L = P["levels"]; ny, nx = P["ny"], P["nx"]
    a = np.fromfile(prof, "<i2").astype(np.float32).reshape(4 * L + 1, ny, nx)
    c, u, v, Z, g = a[:L] / 10, a[L:2 * L] / 10, a[2 * L:3 * L] / 10, a[3 * L:4 * L], a[4 * L]
    lat = 90 - 2 * np.arange(ny)
    J, I = np.where((g > 5) & (np.abs(lat)[:, None] <= 60))
    rng = np.random.default_rng(seed); k = rng.permutation(len(J))[:nmax]
    J, I = J[k], I[k]
    T = c[:, J, I] ** 2 / G_R                     # virtual temperature from the stored sound speed
    return T, u[:, J, I], v[:, J, I], Z[:, J, I], None, g[J, I], list(zip(lat[J].tolist(), (-180 + 2 * I).tolist()))


def decompose(T, U, V, Z, RH, zg, fl, hd, h_buf=1000.0):
    """thermal and wind terms of the on-track boomless Mach (no lateral rays)"""
    Tv = virtual_temperature(T, RH, PLEV[:, None]) if RH is not None else T
    c = sound_speed(Tv)
    s, co = along(hd)
    Vp = c + U * s + V * co
    from physics import isa_pressure_hpa, cruise_interp
    p_a = float(isa_pressure_hpa(fl * 100 * 0.3048)); k, wk = cruise_interp(PLEV, p_a)
    lerp = lambda X: (1 - wk) * X[k] + wk * X[k + 1]
    ca, wa = lerp(c), lerp(U * s + V * co)
    ok = (PLEV[:, None] > p_a) & (Z > (zg + h_buf)[None])
    Vm = np.where(ok, Vp, -np.inf); kk = np.argmax(Vm, axis=0); n = np.arange(Vp.shape[1])
    good = np.isfinite(Vm[kk, n])
    thermal = c[kk, n] / ca; windt = ((U * s + V * co)[kk, n] - wa) / ca
    return thermal[good], windt[good], (Z[kk, n] - zg)[good]


def study(cols, fl, tag):
    T, U, V, Z, RH, zg, _ = cols
    out = {"n_columns": int(T.shape[1]), "fl": fl, "source": tag, "factors": {}}
    F = factors(fl)
    base = {hd: batch_M(T, U, V, Z, RH, zg, fl, hd) for hd in HEADS}
    for key, (label, unit, f) in F.items():
        d = []
        for hd in HEADS:
            t, u, v, z, rh, g, kw = f(T.copy(), U.copy(), V.copy(), Z.copy(), None if RH is None else RH.copy(), zg.copy(), hd)
            m = batch_M(t, u, v, z, rh, g, fl, hd, **kw)
            ok = np.isfinite(m) & np.isfinite(base[hd]) & (base[hd] > 1.0)
            d.append((m - base[hd])[ok])
        d = np.concatenate(d)
        out["factors"][key] = dict(label=label, unit=unit, median=round(float(np.median(d)), 4),
                                   p10=round(float(np.quantile(d, 0.1)), 4), p90=round(float(np.quantile(d, 0.9)), 4), n=int(len(d)))
        print(tag, fl, key, out["factors"][key], flush=True)
    # flight level +2000 ft
    d = np.concatenate([(batch_M(T, U, V, Z, RH, zg, fl + 20, hd) - base[hd])[np.isfinite(base[hd]) & (base[hd] > 1)] for hd in HEADS])
    d = d[np.isfinite(d)]
    out["factors"]["altitude"] = dict(label="Cruise 2,000 ft higher", unit="+2,000 ft", median=round(float(np.median(d)), 4),
                                      p10=round(float(np.quantile(d, 0.1)), 4), p90=round(float(np.quantile(d, 0.9)), 4), n=int(len(d)))
    # flight-path angle (analytic): descent and climb of 3 degrees
    b = np.concatenate([base[hd][np.isfinite(base[hd]) & (base[hd] > 1)] for hd in HEADS])
    for g_, key, lab in ((-3, "descent", "Descending at 3°"), (3, "climb", "Climbing at 3°")):
        d = path_angle(b, g_) - b
        out["factors"][key] = dict(label=lab, unit=f"{g_:+d}°", median=round(float(np.median(d)), 4),
                                   p10=round(float(np.quantile(d, 0.1)), 4), p90=round(float(np.quantile(d, 0.9)), 4), n=int(len(d)))
    # heading: spread between the best and worst of 36 directions in the same air
    M36 = mmax_grid(PLEV, T[:, None, :].astype(np.float32), U[:, None, :].astype(np.float32), V[:, None, :].astype(np.float32),
                    Z[:, None, :].astype(np.float32), zg[None, :].astype(np.float32), fl, list(range(0, 360, 10)),
                    RH=None if RH is None else RH[:, None, :].astype(np.float32))["M"][:, 0, :]
    spread = np.nanmax(M36, 0) - np.nanmin(M36, 0)
    out["heading_spread"] = dict(median=round(float(np.nanmedian(spread)), 4), p10=round(float(np.nanquantile(spread, 0.1)), 4),
                                 p90=round(float(np.nanquantile(spread, 0.9)), 4))
    # variance decomposition: thermal vs wind term (on-track ray, all headings)
    th, wt = [], []
    for hd in range(0, 360, 30):
        a_, b_, _ = decompose(T, U, V, Z, RH, zg, fl, hd); th.append(a_); wt.append(b_)
    th, wt = np.concatenate(th), np.concatenate(wt); tot = th + wt
    vt, vw, cv = np.var(th), np.var(wt), np.cov(th, wt)[0, 1]
    out["variance"] = dict(thermal_share=round(float(vt / np.var(tot)), 3), wind_share=round(float(vw / np.var(tot)), 3),
                           covariance_share=round(float(2 * cv / np.var(tot)), 3), thermal_mean=round(float(th.mean()), 4),
                           wind_mean=round(float(wt.mean()), 4), thermal_sd=round(float(th.std()), 4), wind_sd=round(float(wt.std()), 4))
    out["base"] = dict(median=round(float(np.nanmedian(M36.min(0))), 4))
    # global importance: regress the boomless Mach on natural day-to-day variations of the main drivers
    X, y = [], []
    zc = z_of_fl(Z, fl)
    def layer(A, lo, hi):
        w = ((Z - zg[None]) >= lo) & ((Z - zg[None]) <= hi)
        return np.where(w.any(0), (A * w).sum(0) / np.maximum(w.sum(0), 1), np.nan)
    near = lambda A: np.array([np.interp(zc[i], Z[:, i], A[:, i]) for i in range(A.shape[1])])
    Tl, Tc = layer(T, 1000, 3000), near(T)
    for j, hd in enumerate(range(0, 360, 10)):
        s_, c_ = along(hd)
        wl, wc = layer(U * s_ + V * c_, 1000, 3000), near(U * s_ + V * c_)
        m = M36[j]
        ok = np.isfinite(m) & np.isfinite(Tl) & np.isfinite(wl) & (m > 0.99)
        X.append(np.stack([Tl[ok], Tc[ok], wl[ok], wc[ok], zg[ok]], 1)); y.append(m[ok])
    X, y = np.concatenate(X), np.concatenate(y)
    sd = X.std(0); Xs = (X - X.mean(0)) / sd
    A = np.c_[Xs, np.ones(len(y))]
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    r2 = 1 - ((y - A @ coef) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    names = ["Temperature 1–3 km above ground", "Temperature at cruise", "Along-track wind 1–3 km above ground",
             "Along-track wind at cruise", "Terrain height"]
    units = ["K", "K", "kt", "kt", "m"]
    scale = [1, 1, 1 / KT, 1 / KT, 1]
    out["importance"] = dict(r2=round(float(r2), 3), y_sd=round(float(y.std()), 4), drivers=[
        dict(name=n, natural_sd=round(float(s_ * sc), 1), unit=u, mach_per_sd=round(float(c), 4))
        for n, s_, u, sc, c in zip(names, sd, units, scale, coef[:5])])
    return out


def altitude_curve(cols, tag):
    T, U, V, Z, RH, zg, _ = cols
    rows = []
    for fl in range(300, 610, 25):
        M = mmax_grid(PLEV, T[:, None, :].astype(np.float32), U[:, None, :].astype(np.float32), V[:, None, :].astype(np.float32),
                      Z[:, None, :].astype(np.float32), zg[None, :].astype(np.float32), fl, list(range(0, 360, 10)),
                      RH=None if RH is None else RH[:, None, :].astype(np.float32))["M"][:, 0, :]
        anyd = np.nanmin(np.where(np.isfinite(M), M, 0.98), 0)
        rows.append(dict(source=tag, fl=fl, any_p10=round(float(np.quantile(anyd, 0.1)), 4), any_median=round(float(np.median(anyd)), 4),
                         any_p90=round(float(np.quantile(anyd, 0.9)), 4), usable_pct=round(100 * float((anyd >= 1.05 + 0.05).mean()), 1)))
        print(rows[-1], flush=True)
    return rows


def horizontal(prof, man, fl=550):
    """how much the boomless Mach changes over 2 degrees (~120-220 km): an upper bound on what a single column misses"""
    m = json.load(open(man)); P = m["profiles"]; L = P["levels"]; ny, nx = P["ny"], P["nx"]
    a = np.fromfile(prof, "<i2").astype(np.float32).reshape(4 * L + 1, ny, nx)
    c, u, v, Z, g = a[:L] / 10, a[L:2 * L] / 10, a[2 * L:3 * L] / 10, a[3 * L:4 * L], a[4 * L]
    M = mmax_grid(PLEV, c ** 2 / G_R, u, v, Z, g, fl, [90])["M"][0]
    lat = 90 - 2 * np.arange(ny)
    land = (g > 5) & (np.abs(lat)[:, None] <= 60)
    dx = np.abs(np.roll(M, -1, 1) - M)[land & np.roll(land, -1, 1)]
    dy = np.abs(M[1:] - M[:-1])[(land[1:] & land[:-1])]
    d = np.concatenate([dx[np.isfinite(dx)], dy[np.isfinite(dy)]])
    return dict(fl=fl, per_2deg_median=round(float(np.median(d)), 4), per_2deg_p90=round(float(np.quantile(d, 0.9)), 4))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--soundings", default="")
    ap.add_argument("--prof", default=os.path.join("..", "site", "data", "prof_f000.bin"))
    ap.add_argument("--manifest", default=os.path.join("..", "site", "data", "manifest.json"))
    ap.add_argument("--out", default=os.path.join("..", "study", "results", "sensitivity.json"))
    a = ap.parse_args()
    res = {"studies": [], "altitude": []}
    sets = [("GFS global land columns", load_gfs(a.prof, a.manifest))]
    if a.soundings:
        sets.insert(0, ("Balloon soundings, 6 US stations, 12 months", load_soundings(a.soundings)))
    for tag, cols in sets:
        for fl in (350, 450, 550):
            res["studies"].append(study(cols, fl, tag))
        res["altitude"] += altitude_curve(cols, tag)
    res["horizontal"] = horizontal(a.prof, a.manifest)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(res, open(a.out, "w"), indent=1, ensure_ascii=False)
    print("wrote", a.out)
