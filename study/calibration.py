"""
Deep study 3 (Oct 2026): is the margin's probability honest, and what is the best predictive distribution?

Truth = boomless Mach from IGRA2 balloons (12 stations, engine/validate.py rows with GFS and IFS forecasts, every 2nd
day, Oct 2025 - Sep 2026). Spread = GEFS 31-member standard deviation of the boomless Mach, 24 h forecast valid
00 UTC on the weekly hindcast dates (study-data-gefs), read at the station, same direction. The join keeps the
weekly dates that are also balloon dates: 00 UTC launches every 14 days.

1. Spread-skill: does the GEFS spread predict the error?
2. The shipped predictive model: forecast GFS, sigma = sqrt(s^2 + e^2), e = 0.012 (0.015 mountains); PIT,
   coverage of one-sided quantiles, exceedance at k = 2, 3, 4 vs the Gaussian.
3. EMOS / NGR (Gneiting et al. 2005): truth ~ N(a + b1 GFS + b2 IFS, c + d s^2 + g (IFS - GFS)^2), fitted by
   minimum CRPS (closed form) on one half-year, scored on the other (both ways).
4. Tails: standardized unsafe residuals vs Gaussian; generalized Pareto above the 95th percentile; the k a
   one-sided 1e-3 / 1e-4 quantile needs (Gaussian, empirical, GPD, split-conformal).
Block bootstrap by launch date for intervals (rows within a launch are strongly correlated).

Output: study/results/calibration.json. Usage: python calibration.py <rows.jsonl> [gefs dir]
"""
import json, math, os, sys
from collections import defaultdict
import numpy as np
from scipy import optimize, stats

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
from validate import STATIONS, EXTRA          # noqa: E402

ROWS = sys.argv[1]
GDIR = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/study_data_gefs"
MTN = {"USM00072365", "USM00072476", "USM00072572"}
ALL = {**STATIONS, **EXTRA}


def bilin(a, lat, lon):
    fi, fj = (lon % 360.0), min(180.0, max(0.0, 90.0 - lat))
    i0, j0 = int(fi) % 360, min(179, int(fj)); di, dj = fi - int(fi), fj - j0; i1 = (i0 + 1) % 360
    return (a[..., j0, i0] * (1 - di) + a[..., j0, i1] * di) * (1 - dj) + (a[..., j0 + 1, i0] * (1 - di) + a[..., j0 + 1, i1] * di) * dj


def assemble():
    gefs = {}
    for f in sorted(os.listdir(GDIR)):
        if f.startswith("study_gefs_") and f.endswith(".npz"):
            gefs[f[11:19]] = np.load(os.path.join(GDIR, f))
    X = defaultdict(list)
    for line in open(ROWS):
        r = json.loads(line)
        if not r["time"].endswith("T00:00"):
            continue
        d = r["time"][:10].replace("-", "")
        if d not in gefs or "f24_ifs" not in r:
            continue
        lat, lon = ALL[r["station"]][1], ALL[r["station"]][2]
        g = gefs[d]
        for fl in ("350", "450", "550"):
            if fl not in r["obs"] or fl not in r["f24_1p00"] or fl not in r["f24_ifs"]:
                continue
            ob, gf, fi = (np.array(r[k][fl], float) for k in ("obs", "f24_1p00", "f24_ifs"))
            sdr = g[f"gefs_{fl}_sd"].astype(np.float32)        # (36, 181, 360)
            mean = g[f"gefs_{fl}_mean"].astype(np.float32)
            sd = 0.0005 * np.array([bilin(sdr[h], lat, lon) for h in range(36)])
            j0, i0 = int(90 - lat), int(lon % 360)
            nocor = np.array([min(mean[h, j0 + dj, (i0 + di) % 360] for dj in (0, 1) for di in (0, 1)) == 0 for h in range(36)])
            m = np.isfinite(ob) & np.isfinite(gf) & np.isfinite(fi) & ~nocor
            n = int(m.sum())
            if not n:
                continue
            X["obs"] += list(ob[m]); X["gfs"] += list(gf[m]); X["ifs"] += list(fi[m]); X["sd"] += list(sd[m])
            X["date"] += [d] * n; X["station"] += [r["station"]] * n; X["fl"] += [int(fl)] * n
            X["mtn"] += [r["station"] in MTN] * n; X["head"] += list(np.arange(36)[m] * 10)
    return {k: np.array(v) for k, v in X.items()}


def crps_gauss(mu, sig, y):
    z = (y - mu) / sig
    return sig * (z * (2 * stats.norm.cdf(z) - 1) + 2 * stats.norm.pdf(z) - 1 / math.sqrt(math.pi))


def emos_fit(D, idx, use_ifs=True, use_dis=True):
    def unpack(th):
        a, b1, b2, c, d, g = th
        mu = a + b1 * D["gfs"][idx] + (b2 * D["ifs"][idx] if use_ifs else 0)
        var = c ** 2 + d ** 2 * D["sd"][idx] ** 2 + (g ** 2 * (D["ifs"][idx] - D["gfs"][idx]) ** 2 if use_dis else 0)
        return mu, np.sqrt(var)
    def loss(th):
        mu, sig = unpack(th)
        return float(np.mean(crps_gauss(mu, sig, D["obs"][idx])))
    th0 = [0.0, 0.5 if use_ifs else 1.0, 0.5 if use_ifs else 0.0, 0.012, 1.0, 0.5]
    res = optimize.minimize(loss, th0, method="Nelder-Mead", options=dict(maxiter=20000, maxfev=20000, xatol=1e-7, fatol=1e-9))
    th = res.x
    def predict(jdx):
        a, b1, b2, c, d, g = th
        mu = a + b1 * D["gfs"][jdx] + (b2 * D["ifs"][jdx] if use_ifs else 0)
        var = c ** 2 + d ** 2 * D["sd"][jdx] ** 2 + (g ** 2 * (D["ifs"][jdx] - D["gfs"][jdx]) ** 2 if use_dis else 0)
        return mu, np.sqrt(var)
    return th, predict


def boot_dates(D, fn, B=500, seed=1):
    dates = np.unique(D["date"]); rng = np.random.default_rng(seed)
    by = {d: np.where(D["date"] == d)[0] for d in dates}
    v = []
    for _ in range(B):
        pick = rng.choice(dates, len(dates))
        idx = np.concatenate([by[d] for d in pick])
        v.append(fn(idx))
    return [round(float(np.quantile(v, .025)), 5), round(float(np.quantile(v, .975)), 5)]


def main():
    D = assemble()
    n = len(D["obs"])
    dates = np.unique(D["date"])
    out = dict(samples=n, launch_dates=len(dates), stations=len(np.unique(D["station"])), first=dates[0], last=dates[-1],
               note="samples = station x level x direction; directions and levels of one launch are strongly correlated, "
                    "so intervals bootstrap whole launch dates")
    err = D["gfs"] - D["obs"]                     # > 0: forecast allows more than the balloon (unsafe)
    e_rw = np.where(D["mtn"], 0.015, 0.012)
    # 1. spread-skill
    q = np.quantile(D["sd"], [0, .2, .4, .6, .8, 1.0])
    out["spread_skill"] = [dict(sd_lo=round(float(lo), 4), sd_hi=round(float(hi), 4), n=int(((D["sd"] >= lo) & (D["sd"] <= hi)).sum()),
                                rmse=round(float(np.sqrt(np.mean(err[(D["sd"] >= lo) & (D["sd"] <= hi)] ** 2))), 4),
                                mean_sd=round(float(D["sd"][(D["sd"] >= lo) & (D["sd"] <= hi)].mean()), 4))
                           for lo, hi in zip(q[:-1], q[1:])]
    out["corr_abs_err_sd"] = round(float(np.corrcoef(np.abs(err), D["sd"])[0, 1]), 3)
    # 2. shipped model
    sig = np.sqrt(D["sd"] ** 2 + e_rw ** 2)
    z = err / sig
    out["shipped"] = dict(mean_z=round(float(z.mean()), 3), sd_z=round(float(z.std()), 3),
                          crps=round(float(np.mean(crps_gauss(D["gfs"], sig, D["obs"]))), 5),
                          exceed={f"k{k}": dict(observed=round(float((z > k).mean()), 5), gaussian=round(float(stats.norm.sf(k)), 6),
                                                ci95=boot_dates(D, lambda idx, k=k: float((z[idx] > k).mean())))
                                  for k in (1, 2, 3, 4)},
                          pit_deciles=[round(float(x), 4) for x in np.histogram(stats.norm.cdf(-z), bins=10, range=(0, 1))[0] / n])
    # 3. EMOS, half-year hold-out both ways
    half = dates[len(dates) // 2]
    A = np.where(D["date"] < half)[0]; Bi = np.where(D["date"] >= half)[0]
    variants = {"gfs_only_spread": (False, False), "gfs_ifs_spread": (True, False), "gfs_ifs_spread_disagreement": (True, True)}
    em = {}
    for name, (ui, ud) in variants.items():
        scores, pars, zz = [], [], np.empty(n)
        for tr, te in ((A, Bi), (Bi, A)):
            th, pred = emos_fit(D, tr, ui, ud)
            mu, sg = pred(te)
            scores.append(float(np.mean(crps_gauss(mu, sg, D["obs"][te]))))
            zz[te] = (mu - D["obs"][te]) / sg
            pars.append([round(float(x), 5) for x in th])
        em[name] = dict(crps_heldout=round(float(np.mean(scores)), 5), params_by_half=pars,
                        mean_z=round(float(zz.mean()), 3), sd_z=round(float(zz.std()), 3),
                        exceed={f"k{k}": round(float((zz > k).mean()), 5) for k in (2, 3, 4)})
        if name == "gfs_ifs_spread_disagreement":
            Z_best = zz.copy()
    out["emos"] = em
    # equal-risk comparison: how much faster could the flown Mach be with the held-out EMOS (GFS + IFS + spread)
    # than with the shipped rule (GFS - k sigma_shipped), at the same rate of samples whose truth falls below it?
    mu_e = np.empty(n); sg_e = np.empty(n)
    for tr, te in ((A, Bi), (Bi, A)):
        th, pred = emos_fit(D, tr, True, False)
        mu_e[te], sg_e[te] = pred(te)
    eq = {}
    for k in (2.0, 3.0, 4.0):
        flown_s = D["gfs"] - k * sig
        rate = float((D["obs"] < flown_s).mean())
        ke = float(optimize.brentq(lambda kk: float((D["obs"] < mu_e - kk * sg_e).mean()) - rate, 0.0, 8.0)) if rate > 0 else None
        flown_e = mu_e - ke * sg_e if ke is not None else None
        eq[f"k{int(k)}"] = dict(rate=round(rate, 5), events=int((D["obs"] < flown_s).sum()), k_emos=round(ke, 2) if ke else None,
                                mean_margin_shipped=round(float((D["gfs"] - flown_s).mean()), 4),
                                mean_gain_mach=round(float((flown_e - flown_s).mean()), 4) if ke else None)
    out["equal_risk_emos_vs_shipped"] = eq
    out["crps_mean_of_models_shipped_sigma"] = round(float(np.mean(crps_gauss(0.5 * (D["gfs"] + D["ifs"]), sig, D["obs"]))), 5)
    # 4. tails of the shipped standardized error (unsafe side) and of the best EMOS
    tails = {}
    for lbl, zz in (("shipped", z), ("emos_best", Z_best)):
        u = np.quantile(zz, 0.95); exc = zz[zz > u] - u
        c, loc, scale = stats.genpareto.fit(exc, floc=0)
        p_u = float((zz > u).mean())
        def gpd_k(p):
            return float(u + stats.genpareto.ppf(1 - p / p_u, c, loc=0, scale=scale))
        tails[lbl] = dict(threshold_z=round(float(u), 3), gpd_shape=round(float(c), 3), gpd_scale=round(float(scale), 3),
                          k_needed={f"p{p}": dict(gaussian=round(float(stats.norm.isf(p)), 2),
                                                  empirical=round(float(np.quantile(zz, 1 - p)), 2) if p >= 1e-3 else None,
                                                  gpd=round(gpd_k(p), 2)) for p in (1e-2, 1e-3, 1e-4)},
                          max_z=round(float(zz.max()), 2))
    out["tails"] = tails
    # split-conformal: k from one half guarantees >= 1 - p coverage on exchangeable data of the other
    conf = {}
    for p in (1e-2, 1e-3):
        ks = []
        for tr, te in ((A, Bi), (Bi, A)):
            k = float(np.quantile(z[tr], min(1.0, (1 - p) * (1 + 1 / len(tr))), method="higher"))
            ks.append(dict(k=round(k, 2), heldout_exceed=round(float((z[te] > k).mean()), 5)))
        conf[f"p{p}"] = ks
    out["conformal_shipped"] = conf
    # by level
    out["by_fl"] = {str(fl): dict(n=int((D["fl"] == fl).sum()), rmse=round(float(np.sqrt(np.mean(err[D["fl"] == fl] ** 2))), 4),
                                  sd_z=round(float(z[D["fl"] == fl].std()), 3), mean_sd=round(float(D["sd"][D["fl"] == fl].mean()), 4),
                                  exceed_k3=round(float((z[D["fl"] == fl] > 3).mean()), 5))
                    for fl in (350, 450, 550)}
    path = os.path.join(HERE, "results", "calibration.json")
    json.dump(out, open(path, "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items()}, indent=1)[:6000])


if __name__ == "__main__":
    main()
