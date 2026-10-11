"""
Chart datasets for the study dashboard, built from study/results (analysis.py, margin.py).
Usage: python datasets.py [results dir] [datasets dir]
"""
import json, os, sys
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "results")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "datasets")
FUEL_USD, NONFUEL, PAX, HEAD_FL, HEAD_M = 1.47, 8700.0, 52.0, 550, 0.05
CITY = {"KJFK": "New York", "KLAX": "Los Angeles", "KSFO": "San Francisco", "KBOS": "Boston", "KSEA": "Seattle",
        "KORD": "Chicago", "KATL": "Atlanta", "KDFW": "Dallas", "KIAD": "Washington", "KDEN": "Denver", "KMIA": "Miami",
        "CYYZ": "Toronto", "CYVR": "Vancouver", "MMMX": "Mexico City", "EGLL": "London", "LFPG": "Paris",
        "EDDF": "Frankfurt", "LEMD": "Madrid", "UUEE": "Moscow", "LTFM": "Istanbul", "HECA": "Cairo", "OMDB": "Dubai",
        "VIDP": "Delhi", "ZBAA": "Beijing", "ZSPD": "Shanghai", "SKBO": "Bogotá", "SAEZ": "Buenos Aires",
        "SBGR": "São Paulo", "SCEL": "Santiago", "FAOR": "Johannesburg", "HKJK": "Nairobi", "DNMM": "Lagos",
        "GMMN": "Casablanca"}
FLS = (350, 450, 550)

rows = json.load(open(os.path.join(RES, "rows.json")))
rob = json.load(open(os.path.join(RES, "robustness.json")))
rm = json.load(open(os.path.join(RES, "route_mach.json")))
mev = json.load(open(os.path.join(RES, "margin_eval.json")))
name = lambda code: " → ".join(CITY[c] for c in code.split("-"))

G = defaultdict(list)
for r in rows:
    if r["land_nm"] > 0:
        G[(r["fl"], r["policy"], round(r["par"], 3))].append(r)
sel = lambda fl, pol, par: G[(fl, pol, round(par, 3))]
mean = lambda xs: float(np.mean(xs)) if xs else 0.0


def dist_boom(rs):
    return 100 * sum(r["boom_nm"] for r in rs) / max(sum(r["land_nm"] for r in rs), 1e-9)


def flights_boom(rs):
    return 100 * mean([r["boom_nm"] > 20 for r in rs])


def vot(rs):
    out = []
    for r in rs:
        h = r["saved_min"] / 60
        if r["saved_min"] > 1:
            out.append(((r["dfuel_kg"] * FUEL_USD - NONFUEL * h) / PAX) / h)
    return np.array(out)


D = {}
f, o = sel(HEAD_FL, "fcst", HEAD_M), sel(HEAD_FL, "oracle", 0)
rb = next(x for x in rob if x["fl"] == HEAD_FL and abs(x["margin"] - HEAD_M) < 1e-9)
dates = sorted({r["date"] for r in rows})
fx, cl = sel(HEAD_FL, "fixed", 1.05), sel(HEAD_FL, "clim", 0.02)
D["headline"] = [dict(id="headline", saved=round(mean([r["saved_min"] for r in f]), 1),
                      perfect=round(mean([r["saved_min"] for r in o]), 1),
                      captured_pct=round(100 * mean([r["saved_min"] for r in f]) / mean([r["saved_min"] for r in o])),
                      share_15min_pct=round(100 * mean([r["saved_min"] >= 15 for r in f])),
                      boom_pct_real=rb["boom"], flights_boom_pct_real=rb["anyb"],
                      breakeven_median=int(round(float(np.median(vot(f))))),
                      fixed105_saved=round(mean([r["saved_min"] for r in fx]), 1), fixed105_boom=round(dist_boom(fx), 3),
                      clim02_saved=round(mean([r["saved_min"] for r in cl]), 1), clim02_boom=round(dist_boom(cl), 3),
                      flights=len({(r["route"], r["date"], r["fl"]) for r in rows}), routes=len({r["route"] for r in rows}),
                      dates=len(dates), first=f"{dates[0][:4]}-{dates[0][4:6]}-{dates[0][6:]}",
                      last=f"{dates[-1][:4]}-{dates[-1][4:6]}-{dates[-1][6:]}", margin=HEAD_M)]

LBL = {"fixed": "One fixed Mach (no weather)", "fcst": "Day-before forecast", "clim": "Static chart (climatology)", "oracle": "Perfect knowledge"}
SET = {"fixed": lambda p: f"M{p:.2f}", "fcst": lambda p: f"margin {p:.2f}", "clim": lambda p: f"{int(round(p * 100))}th percentile", "oracle": lambda p: "perfect"}
PARS = {"fixed": [round(1.05 + 0.01 * i, 2) for i in range(16)], "fcst": [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07],
        "clim": [0.02, 0.05, 0.1, 0.2, 0.3, 0.5], "oracle": [0]}
D["policies"] = [dict(fl=fl, policy=LBL[k], kind=k, setting=SET[k](p), par=p, saved=round(mean([r["saved_min"] for r in sel(fl, k, p)]), 1),
                      boom_pct=round(dist_boom(sel(fl, k, p)), 3), flights_boom_pct=round(flights_boom(sel(fl, k, p)), 1), id=f"{fl}-{k}-{p}")
                 for fl in FLS for k in ("fixed", "fcst", "clim", "oracle") for p in PARS[k]]

D["margins"] = [dict(fl=x["fl"], margin=x["margin"], truth="Analysis + real-world error (σ 0.012)", boom_pct=x["boom"],
                     flights_boom_pct=x["anyb"], id=f"{x['fl']}-{x['margin']}-real") for x in rob] + \
               [dict(fl=fl, margin=m, truth="GFS analysis only", boom_pct=round(dist_boom(sel(fl, "fcst", m)), 3),
                     flights_boom_pct=round(flights_boom(sel(fl, "fcst", m)), 1), id=f"{fl}-{m}-ana")
                for fl in FLS for m in (0.02, 0.03, 0.04, 0.05, 0.07)]

mon = defaultdict(list)
for fl in FLS:
    for r in sel(fl, "fcst", HEAD_M):
        mon[(r["date"][:6], fl)].append(r["saved_min"])
D["monthly"] = [dict(month=f"{m[:4]}-{m[4:]}-01", level=f"FL{fl}", saved=round(mean(v), 1), n=len(v)) for (m, fl), v in sorted(mon.items())]

byr = defaultdict(list); byo = defaultdict(list)
for r in f: byr[r["route"]].append(r)
for r in o: byo[r["route"]].append(r["saved_min"])
D["routes"] = sorted([dict(route=name(k), code=k, region=v[0]["region"], direction="eastbound" if v[0]["east"] else "westbound",
                           overland_nm=int(round(v[0]["land_nm"])), saved_mean=round(mean([r["saved_min"] for r in v]), 1),
                           saved_p10=round(float(np.quantile([r["saved_min"] for r in v], 0.1)), 1),
                           saved_p90=round(float(np.quantile([r["saved_min"] for r in v], 0.9)), 1),
                           perfect_mean=round(mean(byo[k]), 1), ban_hours=round(v[0]["ban_h"], 2)) for k, v in byr.items()],
                     key=lambda x: -x["saved_mean"])

pairs = {}
for x in D["routes"]:
    a, b = x["code"].split("-")
    key = tuple(sorted((a, b)))
    pairs.setdefault(key, {})[x["direction"]] = x["saved_mean"]
D["direction"] = sorted([dict(pair=f"{CITY[k[0]]} ↔ {CITY[k[1]]}", eastbound=v.get("eastbound", 0), westbound=v.get("westbound", 0),
                              gap=round(v.get("westbound", 0) - v.get("eastbound", 0), 1)) for k, v in pairs.items()], key=lambda x: -x["gap"])

keep = {"VIDP-EDDF", "UUEE-ZBAA", "KJFK-KLAX"}
D["daily_mach"] = [dict(route=name(x["route"]), date=f"{x['date'][:4]}-{x['date'][4:6]}-{x['date'][6:]}", actual=round(x["Mt"], 3),
                        forecast=round(x["Mf"], 3), lowest_actual=round(x["Mt_min"], 3))
                   for x in rm if x["route"] in keep and x["fl"] == HEAD_FL]

D["breakeven"] = []
for fl in FLS:
    v = vot(sel(fl, "fcst", HEAD_M))
    for s in np.round(np.arange(0, 1.0001, 0.025), 3):
        D["breakeven"].append(dict(fl=fl, share=float(s), value_of_time=int(round(float(np.quantile(v, s))))))

# margin per point vs one margin (margin.py): the frontier of minutes saved against flights with a boom
D["margin_point"] = [dict(fl=int(fl), kind=lab, par=x["par"], saved=x["saved"], flights_boom_pct=x["anyb"], boom_pct=x["boom"],
                          id=f"{fl}-{key}-{x['par']}")
                     for key, lab in (("uniform", "One margin everywhere"), ("point", "Margin per point (k·σ)"))
                     for fl, xs in mev[key].items() for x in xs]

# GEFS (gefs_eval.py): spread-skill deciles and the margin frontier with the ensemble
ge = os.path.join(RES, "gefs_eval.json")
if os.path.exists(ge):
    G = json.load(open(ge))
    D["spread_skill"] = [dict(fl=int(fl), decile=i + 1, spread=x["spread"], rmse=x["rmse"], id=f"{fl}-{i + 1}")
                         for fl, xs in G["spread_skill"].items() for i, x in enumerate(xs)]
    LB = {"uniform": "One margin everywhere", "point": "Margin per point (k·σ)", "ensemble": "Ensemble margin (k·spread)"}
    D["margin_frontier"] = [dict(fl=int(fl), kind=LB[k], par=x["par"], saved=x["saved"], flights_boom_pct=x["anyb"], id=f"{fl}-{k}-{x['par']}")
                            for fl, v in G["flights"].items() for k in LB for x in v[k]]
    D["margin_gate"] = [dict(fl=int(fl), kind=LB[k], saved_at_gate=v["gate"][k]["saved"], par=v["gate"][k]["par"], id=f"{fl}-{k}")
                        for fl, v in G["flights"].items() for k in LB]
# computed buffer (Haglund) vs fixed 1 km: same policy, minutes saved
hg = os.path.join(HERE, "results_haglund", "rows.json")
if os.path.exists(hg):
    H = json.load(open(hg)); out = []
    for tag, rs in (("Fixed 1 km", rows), ("Computed (Haglund)", H)):
        for fl in FLS:
            f_ = [r["saved_min"] for r in rs if r["fl"] == fl and r["policy"] == "fcst" and abs(r["par"] - HEAD_M) < 1e-9 and r["land_nm"] > 0]
            o_ = [r["saved_min"] for r in rs if r["fl"] == fl and r["policy"] == "oracle" and r["land_nm"] > 0]
            out.append(dict(buffer=tag, fl=fl, saved=round(mean(f_), 2), perfect=round(mean(o_), 2), id=f"{tag}-{fl}"))
    D["buffer_compare"] = out

os.makedirs(OUT, exist_ok=True)
for k, v in D.items():
    with open(os.path.join(OUT, f"{k}.json"), "w") as fh:
        json.dump(v, fh, ensure_ascii=False)
    print(k, len(v))
print(D["headline"][0])
