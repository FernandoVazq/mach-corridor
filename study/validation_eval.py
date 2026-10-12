"""
Error of the boomless Mach against weather balloons (engine/validate.py output).

Errors are model minus balloon, per launch, flight level and direction of travel (36), where both are finite.
Reports RMSE and bias for the GFS analysis and the 6, 12 and 24 h forecasts (when present) at 1 deg and 0.25 deg: overall, by level, by
month, by station, winter (Dec-Feb) vs the rest, and for the "any direction" value (min over 36 directions).
Usage: python validation_eval.py <rows.jsonl> [out.json]
"""
import json, os, sys
from collections import defaultdict
import numpy as np

ROWS = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "validation.json")
SRC = ["ana_1p00", "f06_1p00", "f12_1p00", "f24_1p00", "ana_0p25", "f24_0p25"]
FLS = ["350", "450", "550"]

rows = [json.loads(l) for l in open(ROWS)]
print(len(rows), "launches")
E = defaultdict(list)          # (src, group) -> errors
for r in rows:
    mon, st = r["time"][:7], r["name"]
    winter = r["time"][5:7] in ("12", "01", "02")
    for fl in FLS:
        o = np.array([np.nan if v is None else v for v in r["obs"][fl]], float)
        for s in SRC:
            if s not in r:
                continue
            m = np.array([np.nan if v is None else v for v in r[s][fl]], float)
            ok = np.isfinite(o) & np.isfinite(m)
            e = list((m - o)[ok])
            for g in ("all", f"FL{fl}", f"month:{mon}", f"station:{st}", "winter" if winter else "rest", f"FL{fl}:" + ("winter" if winter else "rest")):
                E[(s, g)] += e
            if ok.any():
                E[(s, "anydir")].append(float(np.nanmin(m) - np.nanmin(o)))


def stat(e):
    e = np.array(e)
    return dict(n=int(len(e)), rmse=round(float(np.sqrt((e ** 2).mean())), 4), bias=round(float(e.mean()), 4),
                p95_abs=round(float(np.quantile(np.abs(e), 0.95)), 4)) if len(e) else None


out = defaultdict(dict)
for (s, g), e in E.items():
    out[g][s] = stat(e)
out = {g: out[g] for g in sorted(out)}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(dict(launches=len(rows), first=min(r["time"] for r in rows), last=max(r["time"] for r in rows), stats=out), open(OUT, "w"), indent=1)
for g in ["all", "FL350", "FL450", "FL550", "winter", "rest", "anydir"]:
    if g in out:
        print(g.ljust(8), "  ".join(f"{s} {out[g][s]['rmse']:.4f}({out[g][s]['bias']:+.4f})" for s in SRC if out[g].get(s)))
