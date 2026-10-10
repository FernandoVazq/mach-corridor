"""
How useful is knowing the boomless Mach? Value-of-information study on a year of GFS hindcasts.
Method: see common.py. This script writes study/results (rows, route Mach, robustness).
"""
from common import *
from common import CLIMB, KT

# climatology chart: per route sample, the q-quantile of the truth over the year (per level)
CLIM = {}
for r in routes:
    for fl in FLS:
        st = np.stack([S[(r["name"], d, fl)]["Mt"] for d in dates])
        CLIM[(r["name"], fl)] = {q: np.quantile(st, q, axis=0) for q in (0.02, 0.05, 0.1, 0.2, 0.3, 0.5)}

def policy_M(kind, par, r, smp, fl):
    if kind == "ban": return np.full_like(smp["Mt"], M_SUB)
    if kind == "oracle": m = smp["Mt"]
    elif kind == "fcst": m = smp["Mf"] - par
    elif kind == "fixed": m = np.full_like(smp["Mt"], par)
    elif kind == "clim": m = CLIM[(r["name"], fl)][par]
    return np.where(m >= FLOOR, np.minimum(m, DESIGN), M_SUB)

POLICIES = [("ban", 0)] + [("oracle", 0)] + [("fcst", m) for m in (-0.01, 0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07)] + \
           [("fixed", round(1.02 + 0.01 * i, 2)) for i in range(24)] + [("clim", q) for q in (0.02, 0.05, 0.1, 0.2, 0.3, 0.5)]
rows = []
for r in routes:
    for d in dates:
        for fl in FLS:
            smp = S[(r["name"], d, fl)]
            tb, fb, _ = fly(r, smp, M_SUB)
            for kind, par in POLICIES:
                if kind == "ban": continue
                M = policy_M(kind, par, r, smp, fl)
                t, fu, Mfl = fly(r, smp, M)
                share, nm = boom(r, smp, Mfl)
                rows.append(dict(route=r["name"], region=r["region"], east=bool(r["east"]), date=d, fl=fl, policy=kind, par=par,
                                 land_nm=float(r["reg"].sum() * r["seg"]), dist=float(r["dist"]), saved_min=float(60 * (tb - t)),
                                 dfuel_kg=float(fu - fb), boom_share=float(share), boom_nm=float(nm),
                                 avail=float((r["reg"] & (smp["Mt"] >= FLOOR)).sum() / max(r["reg"].sum(), 1)),
                                 ban_h=float(tb)))
print(len(rows), "flight-policy rows")
with open(os.path.join(OUT, "rows.json"), "w") as f:
    json.dump(rows, f)
# per route-date route-mean Mach (truth vs forecast) for the variability / skill charts
mm = []
for r in routes:
    if r["reg"].sum() == 0: continue
    for d in dates:
        for fl in FLS:
            smp = S[(r["name"], d, fl)]
            mm.append(dict(route=r["name"], date=d, fl=fl, Mt=float(smp["Mt"][r["reg"]].mean()), Mf=float(smp["Mf"][r["reg"]].mean()),
                           Mt_min=float(smp["Mt"][r["reg"]].min()), err=float((smp["Mf"] - smp["Mt"])[r["reg"]].mean())))
with open(os.path.join(OUT, "route_mach.json"), "w") as f:
    json.dump(mm, f)
print("done")

# --- robustness: the GFS analysis is not the real atmosphere. Against real soundings the day-ahead error is about
# 0.015 Mach (validation/), against the analysis only ~0.008. Add the missing part (sigma 0.012, correlated over
# ~300 nm of track) to the "truth" and see how much boom exposure the margin still prevents.
rng = np.random.default_rng(7)
rob = []
for fl in (350, 450, 550):
    for m in (0.02, 0.03, 0.04, 0.05, 0.07):
        land_nm = boom_nm = anyb = n = 0; saved = []
        for seed in range(3):
            for r in routes:
                if r["reg"].sum() == 0: continue
                for d in dates:
                    smp = S[(r["name"], d, fl)]
                    k = len(smp["Mt"]); rho = math.exp(-r["seg"] / 300.0)
                    e = np.empty(k); e[0] = rng.normal()
                    for i in range(1, k): e[i] = rho * e[i - 1] + math.sqrt(1 - rho * rho) * rng.normal()
                    truth = dict(smp); truth["Mt"] = smp["Mt"] + 0.012 * e
                    M = np.where(smp["Mf"] - m >= FLOOR, np.minimum(smp["Mf"] - m, DESIGN), M_SUB)
                    _, _, Mfl = fly(r, smp, M)
                    sh, nm = boom(r, truth, Mfl)
                    land_nm += r["reg"].sum() * r["seg"]; boom_nm += nm; anyb += nm > 20; n += 1
        rob.append(dict(fl=fl, margin=m, boom=round(100 * boom_nm / land_nm, 3), anyb=round(100 * anyb / n, 1)))
        print(rob[-1], flush=True)
with open(os.path.join(OUT, "robustness.json"), "w") as f:
    json.dump(rob, f)
