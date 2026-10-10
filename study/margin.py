"""
Margin per point (issue #1): replace the single world margin with  m(x) = k * sigma(x).

sigma(x)^2 = sigma_ana(x)^2 + S_EXTRA^2
  sigma_ana(x): RMS of (24 h forecast - analysis) boomless Mach at that grid point and flight level, over all
                36 headings and the weekly hindcast dates where both have a corridor (smoothed ~2 deg)
  S_EXTRA     : the part of the real-world error the analysis cannot see (validation vs radiosondes:
                0.015 total vs ~0.008 against the analysis -> 0.012), the same term the robustness check adds.

Evaluation (no in-sample fitting): 2-fold cross-validation over dates, sigma from the other half.
"Truth" = analysis + correlated error (sigma 0.012, 300 nm), 3 seeds, common random numbers for every policy.
Outputs study/results/margin_eval.json and the shipped field site/data/margin.json (per FL, 1-degree, k applied).
"""
import json, math, os, sys
import numpy as np
from scipy.ndimage import gaussian_filter

sys.argv = sys.argv[:1] + sys.argv[1:]
from common import *                                   # noqa: E402  (loads routes and samples S)
from common import KT

S_EXTRA, SMOOTH = 0.012, 1.5
FL_EVAL = (350, 450, 550)

# ---------- error fields ----------
nd = len(files)
acc = {(fl, fold): [np.zeros((181, 360)), np.zeros((181, 360)), np.zeros((181, 360))] for fl in FL_EVAL for fold in (0, 1, 2)}
for di, f in enumerate(files):
    z = np.load(f)
    for fl in FL_EVAL:
        a, b = z[f"ana_{fl}_M"].astype(np.int16), z[f"f24_{fl}_M"].astype(np.int16)
        ok = (a > 0) & (a < 255) & (b > 0) & (b < 255)
        e = np.where(ok, (b - a) * 0.0025, 0.0)
        for fold in (di % 2, 2):                       # fold 2 = all dates
            s = acc[(fl, fold)]
            s[0] += (e * e).sum(0); s[1] += e.sum(0); s[2] += ok.sum(0)
    print("errors", dates[di], flush=True)


def sigma_field(fl, fold):
    s2, s1, n = acc[(fl, fold)]
    w = gaussian_filter(n, SMOOTH, mode="wrap")
    rms = np.sqrt(gaussian_filter(s2, SMOOTH, mode="wrap") / np.maximum(w, 1))
    bias = gaussian_filter(s1, SMOOTH, mode="wrap") / np.maximum(w, 1)
    glob_rms = math.sqrt(s2.sum() / max(n.sum(), 1))
    few = w < 30                                       # too few samples: fall back to the global value
    rms = np.where(few, glob_rms, rms)
    bias = np.where(few, 0.0, bias)
    return np.sqrt(rms ** 2 + S_EXTRA ** 2), bias, glob_rms


SIG = {(fl, fold): sigma_field(fl, fold) for fl in FL_EVAL for fold in (0, 1, 2)}
for fl in FL_EVAL:
    sg, bs, g = SIG[(fl, 2)]
    land = REG
    print(f"FL{fl}: global analysis RMS {g:.4f}; sigma_tot over regulated land p10/p50/p90 "
          f"{np.percentile(sg[land], 10):.4f}/{np.percentile(sg[land], 50):.4f}/{np.percentile(sg[land], 90):.4f}; "
          f"bias p50 {np.percentile(bs[land], 50):+.4f}", flush=True)

# ---------- sample sigma and bias along routes ----------
SR = {}
for r in routes:
    for fl in FL_EVAL:
        for fold in (0, 1):
            sg, bs, _ = SIG[(fl, fold)]
            SR[(r["name"], fl, fold)] = (bilin(sg, r["lat"], r["lon"]), bilin(bs, r["lat"], r["lon"]))

# ---------- common random "truth" error ----------
rng = np.random.default_rng(11)
NOISE = {}
for seed in range(3):
    for r in routes:
        if r["reg"].sum() == 0: continue
        k = len(r["lat"]); rho = math.exp(-r["seg"] / 300.0)
        for d in dates:
            e = np.empty(k); e[0] = rng.normal()
            for i in range(1, k): e[i] = rho * e[i - 1] + math.sqrt(1 - rho * rho) * rng.normal()
            NOISE[(seed, r["name"], d)] = 0.012 * e


def evaluate(fl, margin_of):
    """margin_of(r, d, smp) -> margin array. Returns saved min / flight, % flights with >20 nm boom, % distance."""
    land_nm = boom_nm = anyb = n = 0; saved = []
    for r in routes:
        if r["reg"].sum() == 0: continue
        for di, d in enumerate(dates):
            smp = S[(r["name"], d, fl)]
            tb, _, _ = fly(r, smp, M_SUB)
            m = margin_of(r, di, smp)
            Mf = smp["Mf"] - m
            M = np.where(Mf >= FLOOR, np.minimum(Mf, DESIGN), M_SUB)
            t, _, Mfl = fly(r, smp, M)
            saved.append(60 * (tb - t))
            for seed in range(3):
                truth = dict(smp); truth["Mt"] = smp["Mt"] + NOISE[(seed, r["name"], d)]
                _, nm = boom(r, truth, Mfl)
                land_nm += r["reg"].sum() * r["seg"]; boom_nm += nm; anyb += nm > 20; n += 1
    return dict(saved=round(float(np.mean(saved)), 2), anyb=round(100 * anyb / n, 2), boom=round(100 * boom_nm / land_nm, 4))


out = {"s_extra": S_EXTRA, "smooth_deg": SMOOTH, "uniform": {}, "point": {}, "point_bias": {}}
for fl in FL_EVAL:
    out["uniform"][fl] = [dict(par=m, **evaluate(fl, lambda r, di, smp, m=m: m)) for m in np.round(np.arange(0.03, 0.081, 0.005), 3)]
    print("uniform", fl, out["uniform"][fl], flush=True)
    cv = lambda r, di: SR[(r["name"], fl, 1 - di % 2)]       # sigma from the other half of the dates
    out["point"][fl] = [dict(par=k, **evaluate(fl, lambda r, di, smp, k=k: k * cv(r, di)[0])) for k in np.round(np.arange(1.5, 5.01, 0.25), 2)]
    print("point", fl, out["point"][fl], flush=True)
    out["point_bias"][fl] = [dict(par=k, **evaluate(fl, lambda r, di, smp, k=k: cv(r, di)[1] + k * cv(r, di)[0])) for k in np.round(np.arange(1.5, 5.01, 0.25), 2)]
    print("point+bias", fl, out["point_bias"][fl], flush=True)

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "margin_eval.json"), "w") as f:
    json.dump(out, f)

# ---------- shipped field: sigma_tot per FL (all dates) on the app grid (lon -180..179) ----------
fields = {}
for fl in FL_EVAL:
    sg = np.roll(SIG[(fl, 2)][0], 180, axis=1)
    fields[str(fl)] = np.round(sg * 1e4).astype(int).tolist()
with open(os.path.join(OUT, "sigma_fields.json"), "w") as f:
    json.dump({"fls": list(FL_EVAL), "scale": 1e-4, "lon0": -180, "lat0": 90, "d": 1, "s_extra": S_EXTRA, "fields": fields}, f)
print("done")
