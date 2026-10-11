"""
Does the GEFS ensemble know when the forecast is wrong? (issue #7)

Data: the weekly hindcast (study-data: GFS analysis = truth, GFS 24 h forecast) and, for the same dates, the
31-member GEFS 24 h forecast (study-data-gefs: mean, 10th percentile, member spread of the boomless Mach).

1. Skill: error of the GFS forecast vs the GEFS mean, against the analysis, over regulated land.
2. Spread-skill: is the forecast error larger where the ensemble spread is larger? (binned RMS error)
3. Flights: margin = k * sqrt(spread^2 + 0.012^2) vs the static per-point margin (margin.py) vs one margin,
   each calibrated to 0.5% of flights with a boom (real-world error added as in margin.py); minutes saved.
Usage: python gefs_eval.py <study-data dir> <gefs dir>
"""
import glob, json, math, os, sys
import numpy as np

GEFS = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/study_data_gefs"
sys.argv = sys.argv[:2]
from common import *                                  # noqa: E402  (routes, samples S, fly, boom, bilin)

gf = {os.path.basename(f)[11:19]: f for f in glob.glob(os.path.join(GEFS, "study_gefs_*.npz"))}
D = [d for d in dates if d in gf]
print(len(D), "dates with GEFS")
FLE = (350, 450, 550)
dec = lambda E: np.where(E > 0, 1.0 + 0.0025 * E.astype(np.float32), 0.98)

# ---------- 1-2: grid statistics over regulated nodes ----------
node = REG.copy()
stats = {fl: dict(gfs=[], mean=[], sd=[]) for fl in FLE}
for d in D:
    z, g = np.load(os.path.join(DATA, f"study_{d}.npz")), np.load(gf[d])
    for fl in FLE:
        a, f = z[f"ana_{fl}_M"], z[f"f24_{fl}_M"]
        ok = (a > 0) & (a < 255) & (f > 0) & (f < 255) & node[None]
        ta = dec(a)[ok]
        stats[fl]["gfs"].append(dec(f)[ok] - ta)
        stats[fl]["mean"].append(dec(g[f"gefs_{fl}_mean"])[ok] - ta)
        stats[fl]["sd"].append(g[f"gefs_{fl}_sd"][ok].astype(np.float32) * 0.0005)
skill, ss = {}, {}
for fl in FLE:
    e1, e2, sd = (np.concatenate(stats[fl][k]) for k in ("gfs", "mean", "sd"))
    skill[fl] = dict(rmse_gfs=round(float(np.sqrt((e1 ** 2).mean())), 4), rmse_gefs_mean=round(float(np.sqrt((e2 ** 2).mean())), 4),
                     bias_gfs=round(float(e1.mean()), 4), spread_median=round(float(np.median(sd)), 4),
                     corr_abs_err_spread=round(float(np.corrcoef(np.abs(e1), sd)[0, 1]), 3), n=int(len(e1)))
    q = np.quantile(sd, np.linspace(0, 1, 11))
    ss[fl] = [dict(spread=round(float(sd[(sd >= q[i]) & (sd <= q[i + 1])].mean()), 4),
                   rmse=round(float(np.sqrt((e1[(sd >= q[i]) & (sd <= q[i + 1])] ** 2).mean())), 4)) for i in range(10)]
    print(fl, skill[fl]); print("   spread-skill deciles", [(x["spread"], x["rmse"]) for x in ss[fl]], flush=True)

# ---------- 3: flights ----------
def sd_heading(SD, lat, lon, brg):
    h = brg / 10.0; k0 = np.floor(h).astype(int) % 36; k1 = (k0 + 1) % 36
    fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
    i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
    di, dj, i1 = fi - np.floor(fi), fj - j0, (np.floor(fi).astype(int) + 1) % 360
    def at(k):
        X = lambda j, i: SD[k, j, i].astype(np.float32) * 0.0005
        return (X(j0, i0) * (1 - di) + X(j0, i1) * di) * (1 - dj) + (X(j0 + 1, i0) * (1 - di) + X(j0 + 1, i1) * di) * dj
    return np.maximum(at(k0), at(k1))

SDR = {}
for d in D:
    g = np.load(gf[d])
    for fl in FLE:
        SD = g[f"gefs_{fl}_sd"]
        for r in routes:
            SDR[(r["name"], d, fl)] = sd_heading(SD, r["lat"], r["lon"], r["brg"])
sig = json.load(open(os.path.join(OUT, "sigma_fields.json")))
SIGR = {}
for fl in FLE:
    sg = np.roll(np.array(sig["fields"][str(fl)], float) * sig["scale"], -180, axis=1)   # back to lon 0..359
    for r in routes:
        SIGR[(r["name"], fl)] = bilin(sg, r["lat"], r["lon"])

rng = np.random.default_rng(11)
NOISE = {}
for seed in range(3):
    for r in routes:
        if r["reg"].sum() == 0: continue
        k = len(r["lat"]); rho = math.exp(-r["seg"] / 300.0)
        for d in D:
            e = np.empty(k); e[0] = rng.normal()
            for i in range(1, k): e[i] = rho * e[i - 1] + math.sqrt(1 - rho * rho) * rng.normal()
            NOISE[(seed, r["name"], d)] = 0.012 * e


def evaluate(fl, margin_of):
    land_nm = boom_nm = anyb = n = 0; saved = []
    for r in routes:
        if r["reg"].sum() == 0: continue
        for d in D:
            smp = S[(r["name"], d, fl)]
            tb, _, _ = fly(r, smp, M_SUB)
            Mf = smp["Mf"] - margin_of(r, d)
            M = np.where(Mf >= FLOOR, np.minimum(Mf, DESIGN), M_SUB)
            t, _, Mfl = fly(r, smp, M)
            saved.append(60 * (tb - t))
            for seed in range(3):
                truth = dict(smp); truth["Mt"] = smp["Mt"] + NOISE[(seed, r["name"], d)]
                _, nm = boom(r, truth, Mfl)
                land_nm += r["reg"].sum() * r["seg"]; boom_nm += nm; anyb += nm > 20; n += 1
    return dict(saved=round(float(np.mean(saved)), 2), anyb=round(100 * anyb / n, 2), boom=round(100 * boom_nm / land_nm, 4))


def at_gate(rows, gate=0.5):
    a = np.array([x["anyb"] for x in rows]); s = np.array([x["saved"] for x in rows]); p = np.array([x["par"] for x in rows])
    o = np.argsort(a)
    return dict(saved=round(float(np.interp(gate, a[o], s[o])), 2), par=round(float(np.interp(gate, a[o], p[o])), 3))


fl_out = {}
for fl in FLE:
    U = [dict(par=m, **evaluate(fl, lambda r, d, m=m: m)) for m in np.round(np.arange(0.035, 0.0851, 0.005), 3)]
    P = [dict(par=k, **evaluate(fl, lambda r, d, k=k: k * SIGR[(r["name"], fl)])) for k in np.round(np.arange(2.5, 6.01, 0.25), 2)]
    G = [dict(par=k, **evaluate(fl, lambda r, d, k=k: k * np.sqrt(SDR[(r["name"], d, fl)] ** 2 + 0.012 ** 2))) for k in np.round(np.arange(2.5, 6.01, 0.25), 2)]
    fl_out[fl] = dict(uniform=U, point=P, ensemble=G, gate=dict(uniform=at_gate(U), point=at_gate(P), ensemble=at_gate(G)))
    print(fl, "at the 0.5% gate:", fl_out[fl]["gate"], flush=True)

json.dump(dict(dates=len(D), skill=skill, spread_skill=ss, flights=fl_out), open(os.path.join(OUT, "gefs_eval.json"), "w"), indent=1)
print("done")
