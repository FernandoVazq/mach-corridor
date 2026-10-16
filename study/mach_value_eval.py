"""
Value of Mach (study/mach_value.mjs output -> study/results/mach_value.json).

Per flight (city pair x direction x departure time) and aircraft, from the router's own block time, fuel and cost:
  steps : each +0.1 Mach step of the design (cruise) Mach -> minutes, fuel, airline cost per passenger, passenger time
          value, break-even value of time; per 1000 nm of open-water supersonic distance against distance / speed
  shift : the corridor (boomless) Mach over land moved by delta (margin - delta), design Mach fixed -> minutes per
          +0.01 and the chance of > 0.11 psf with the forecast error unchanged
Flights are split by the share of the route over regulated land at the design Mach: oceanic < 35%, mixed 35-75%,
overland > 75%. Uncertainty: percentile bootstrap over city pairs (both directions and all departures resampled
together), 1000 draws; medians with IQR and 95% CI.
Usage: python study/mach_value_eval.py <raw.json> <out.json>
"""
import json, sys, math
import numpy as np

raw = json.load(open(sys.argv[1])); out_path = sys.argv[2]
A_KT = math.sqrt(1.4 * 287.053 * 216.65) * 1.943844          # ISA speed of sound at FL550, kt
FUEL = {"2025": 0.71, "2026avg": 1.20, "now": 1.50}           # $/kg: IATA $90/bbl (2025), $152 (2026 forecast), $190 (latest week)
VOT, LF = raw["E0"]["vot"], raw["E0"]["lf"]
AC = {a["id"]: a for a in raw["aircraft"]}
CLS = (("oceanic", 0, .35), ("mixed", .35, .75), ("overland", .75, 1.01))
rng = np.random.default_rng(7); B = 1000

def pair_key(r): return "-".join(sorted([r["from"], r["to"]]))

def boot(v, keys, stat):
    v = np.asarray(v, float); keys = np.asarray(keys); uk = np.unique(keys)
    groups = [v[keys == k] for k in uk]; est = float(stat(v))
    bs = [stat(np.concatenate([groups[i] for i in rng.integers(0, len(uk), len(uk))])) for _ in range(B)]
    return est, float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))

def summ(rows, f):
    rows = [x for x in rows if np.isfinite(f(x))]
    if len(rows) < 5: return None
    v = np.array([f(x) for x in rows]); k = [x["key"] for x in rows]
    med, mean = boot(v, k, np.median), boot(v, k, np.mean)
    return {"n": len(v), "pairs": len(set(k)), "median": med[0], "median_ci": med[1:], "mean": mean[0], "mean_ci": mean[1:],
            "p10": float(np.percentile(v, 10)), "p25": float(np.percentile(v, 25)), "p75": float(np.percentile(v, 75)),
            "p90": float(np.percentile(v, 90)), "sd": float(np.std(v, ddof=1))}

def ols(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float); c = np.polyfit(x, y, 1); yh = np.polyval(c, x)
    return {"slope": float(c[0]), "intercept": float(c[1]), "r2": float(1 - ((y - yh) ** 2).sum() / ((y - y.mean()) ** 2).sum()), "n": len(x)}

def op(x, ac, p): return x["fuel"] * p + ac["nonFuelPerBH"] * x["block"]

res = {"run": raw["run"], "departures_h": raw["deps"], "flights": len(raw["rows"]), "pairs": len({pair_key(r) for r in raw["rows"]}),
       "a_kt_FL550": A_KT, "fuel_usd_per_kg": FUEL, "vot_usd_h": VOT, "load_factor": LF, "classes": CLS, "aircraft": {}}

for aid, ac in AC.items():
    pax = ac["seats"] * LF
    steps, shift, ref = [], [], []
    for r in raw["rows"]:
        o = r["ac"][aid]; sw = o["sweep"]; d = sw[-1]
        if not d["inRange"]: continue
        k = pair_key(r); share = d["dLand"] / d["dist"]
        cls = next(c for c, lo, hi in CLS if lo <= share < hi)
        dw = max(0.0, d["dSuper"] - d["dBoomless"])                       # open-water supersonic nm at design Mach
        for a, b in zip(sw[:-1], sw[1:]):
            dt = a["block"] - b["block"]
            x = {"key": k, "cls": cls, "M0": a["M"], "gc": r["gc"], "dw": dw, "min": 60 * dt, "fuel": b["fuel"] - a["fuel"],
                 "pct": 100 * (a["block"] - b["block"]) / a["block"], "tv": VOT * dt, "phys": 60 * dw / A_KT * (1 / a["M"] - 1 / b["M"])}
            for n, p in FUEL.items():
                x["dop_" + n] = (op(b, ac, p) - op(a, ac, p)) / pax
                x["be_" + n] = x["dop_" + n] / dt if dt > 2 / 60 else float("nan")   # $ per passenger-hour saved (steps >= 2 min)
            steps.append(x)
        base = next(s for s in o["shift"] if abs(s["delta"]) < 1e-9)
        for s in o["shift"]:
            dt = base["block"] - s["block"]
            x = {"key": k, "cls": cls, "delta": s["delta"], "min": 60 * dt, "p": s["pTrue"], "dB": base["dBoomless"], "dB_s": s["dBoomless"],
                 "tv": VOT * dt}
            for n, p in FUEL.items(): x["dop_" + n] = (op(s, ac, p) - op(base, ac, p)) / pax
            shift.append(x)
        ref.append({"key": k, "cls": cls, "share": share, "gc": r["gc"], "dw": dw, "dB": d["dBoomless"],
                    "ban_min": 60 * (o["ban"]["block"] - d["block"]), "b789_min": 60 * (r["b789"]["block"] - d["block"]),
                    "block_h": d["block"], "p": d["pFlight"]})
    S = {"name": ac["name"], "design": ac["design"], "seats": ac["seats"], "flights": len(ref), "pairs": len({x["key"] for x in ref}),
         "class_counts": {c: sum(x["cls"] == c for x in ref) for c, _, _ in CLS}}
    S["ref"] = {c: {m: summ([x for x in ref if c == "all" or x["cls"] == c], lambda x, m=m: x[m])
                    for m in ("share", "gc", "dw", "dB", "ban_min", "b789_min", "block_h", "p")} for c in ("all",) + tuple(c for c, _, _ in CLS)}
    S["steps"] = []
    for M0 in sorted({round(x["M0"], 1) for x in steps}):
        g = [x for x in steps if abs(x["M0"] - M0) < 1e-9]
        e = {"M0": M0, "M1": round(M0 + .1, 1), "phys_per_1000nm": 60 * 1000 / A_KT * (1 / M0 - 1 / (M0 + .1)),
             "per_1000nm_water": summ([x for x in g if x["dw"] > 500], lambda x: 1000 * x["min"] / x["dw"]),
             "vs_physics": ols([x["phys"] for x in g], [x["min"] for x in g]) if np.std([x["phys"] for x in g]) > 0 else None}
        for c in ("all",) + tuple(c for c, _, _ in CLS):
            gc = [x for x in g if c == "all" or x["cls"] == c]
            e[c] = {"min": summ(gc, lambda x: x["min"]), "pct": summ(gc, lambda x: x["pct"]), "fuel": summ(gc, lambda x: x["fuel"]),
                    "tv": summ(gc, lambda x: x["tv"]), **{f"dop_{n}": summ(gc, lambda x, n=n: x["dop_" + n]) for n in FUEL},
                    **{f"be_{n}": summ(gc, lambda x, n=n: x["be_" + n]) for n in FUEL}}
        S["steps"].append(e)
    S["shift"] = []
    for dl in sorted({x["delta"] for x in shift}):
        g = [x for x in shift if abs(x["delta"] - dl) < 1e-9]; gb = [x for x in g if x["dB"] >= 100]
        S["shift"].append({"delta": dl, "min_all": summ(g, lambda x: x["min"]), "min_corridor": summ(gb, lambda x: x["min"]),
                           "p_mean": float(np.mean([x["p"] for x in g])), "p_mean_ci": boot([x["p"] for x in g], [x["key"] for x in g], np.mean)[1:],
                           "tv": summ(gb, lambda x: x["tv"]), **{f"dop_{n}": summ(gb, lambda x, n=n: x["dop_" + n]) for n in FUEL}})
    # minutes per +0.01 corridor Mach: per flight OLS over delta -0.04..+0.04, flights with >= 100 nm of corridor
    per = {}
    for x in shift:
        if x["dB"] >= 100 and abs(x["delta"]) <= 0.041: per.setdefault((x["key"], id(x["dB"]), x["dB"]), []).append(x)
    sl = []
    for (k, _, dB), g in per.items():
        c = np.polyfit([x["delta"] for x in g], [x["min"] for x in g], 1)
        sl.append({"key": k, "s": c[0] * .01, "s1000": c[0] * .01 * 1000 / dB})
    S["shift_slope"] = {"min_per_001": summ(sl, lambda x: x["s"]), "min_per_001_per_1000nm": summ(sl, lambda x: x["s1000"]),
                        "phys_per_001_per_1000nm_at_1_12": 60 * 1000 / A_KT * (1 / 1.12 - 1 / 1.13)}
    res["aircraft"][aid] = S
    print(aid, "done", S["flights"], S["class_counts"])

json.dump(res, open(out_path, "w"), indent=1)
o = res["aircraft"]["overture"]
for e in o["steps"]:
    oc = e["oceanic"]; f = lambda s: "-" if s is None else "%.1f" % s["median"]
    print(e["M0"], "->", e["M1"], "| /1000nm water", f(e["per_1000nm_water"]), "phys %.2f" % e["phys_per_1000nm"],
          "| oceanic min", f(oc["min"]), "pct", f(oc["pct"]), "| dop now", f(oc["dop_now"]), "2025", f(oc["dop_2025"]), "| tv", f(oc["tv"]),
          "| all min", f(e["all"]["min"]), "overland", f(e["overland"]["min"]))
print("slope", o["shift_slope"]["min_per_001"]["median"], o["shift_slope"]["min_per_001_per_1000nm"]["median"])
for s in o["shift"]: print(s["delta"], "%.2f" % s["min_corridor"]["median"], "%.3f%%" % (100 * s["p_mean"]), "dop_now %.1f" % s["dop_now"]["median"], "tv %.1f" % s["tv"]["median"])
for c in o["ref"]: print(c, {m: round(v["median"], 2) for m, v in o["ref"][c].items() if v})

# design-level comparison with the 787-9 (same flights): hours saved, extra airline cost per passenger, break-even value of time
b7 = raw["b789"]
for aid, ac in AC.items():
    pax = ac["seats"] * LF; rows = []
    for r in raw["rows"]:
        o = r["ac"][aid]; d = o["sweep"][-1]
        if not d["inRange"]: continue
        share = d["dLand"] / d["dist"]; cls = next(c for c, lo, hi in CLS if lo <= share < hi)
        x = {"key": pair_key(r), "cls": cls, "dh": r["b789"]["block"] - d["block"]}
        for n, p in FUEL.items():
            extra = op(d, ac, p) / pax - (r["b789"]["fuel"] * p + b7["nonFuelPerBH"] * r["b789"]["block"]) / (b7["seats"] * LF)
            x["extra_" + n] = extra; x["be_" + n] = extra / x["dh"] if x["dh"] > 0.25 else float("nan")
        rows.append(x)
    res["aircraft"][aid]["vs787"] = {c: {m: summ([x for x in rows if c == "all" or x["cls"] == c], lambda x, m=m: x[m])
                                         for m in ["dh"] + [f"{a}_{n}" for a in ("extra", "be") for n in FUEL]}
                                     for c in ("all",) + tuple(c for c, _, _ in CLS)}
res["margin_auto"] = {"typical_FL550": 0.0556, "k_FL550": 4.0, "us_FL550_median": 0.0606,
                      "note": "MC.marginTypical() and MC.kEffective() on run " + raw["run"] + " (study/mach_value.mjs page)"}
json.dump(res, open(out_path, "w"), indent=1)
for aid in AC:
    v = res["aircraft"][aid]["vs787"]["all"]
    print(aid, "dh %.2f" % v["dh"]["median"], "extra now %.0f 2025 %.0f" % (v["extra_now"]["median"], v["extra_2025"]["median"]),
          "be now %.0f [%.0f-%.0f] 2025 %.0f" % (v["be_now"]["median"], *v["be_now"]["median_ci"], v["be_2025"]["median"]))
