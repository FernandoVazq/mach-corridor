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
# two-model mean (GFS 1 deg + ECMWF IFS) per direction where both exist
for r in rows:
    for kind in ("ana", "f06", "f12", "f24"):
        a, b = r.get(f"{kind}_1p00"), r.get(f"{kind}_ifs")
        if a and b:
            r[f"{kind}_mean"] = {fl: [None if (x is None or y is None) else round((x + y) / 2, 4) for x, y in zip(a[fl], b[fl])] for fl in a}
SRC = [s for s in SRC if any(s in r for r in rows)] + sorted({k for r in rows for k in r if k not in ("station", "name", "time", "obs") and k not in SRC})
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
    """RMS, bias, 95th percentile of |error|; and the unsafe side (model allows more than the balloon, e > 0):
    semi-RMS sqrt(2 mean(max(e,0)^2)) (equals the RMS for a symmetric error) and its 99th percentile."""
    e = np.array(e)
    return dict(n=int(len(e)), rmse=round(float(np.sqrt((e ** 2).mean())), 4), bias=round(float(e.mean()), 4),
                p95_abs=round(float(np.quantile(np.abs(e), 0.95)), 4),
                unsafe_semi_rms=round(float(np.sqrt(2 * (np.clip(e, 0, None) ** 2).mean())), 4),
                unsafe_share=round(float((e > 0).mean()), 3), p99=round(float(np.quantile(e, 0.99)), 4)) if len(e) else None


out = defaultdict(dict)
for (s, g), e in E.items():
    out[g][s] = stat(e)
out = {g: out[g] for g in sorted(out)}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(dict(launches=len(rows), first=min(r["time"] for r in rows), last=max(r["time"] for r in rows), stats=out), open(OUT, "w"), indent=1)
for g in ["all", "FL350", "FL450", "FL550", "winter", "rest", "anydir"]:
    if g in out:
        print(g.ljust(8), "  ".join(f"{s} {out[g][s]['rmse']:.4f}({out[g][s]['bias']:+.4f})" for s in SRC if out[g].get(s)))
