"""Ship the per-point margin to the app: site/geo/sigma.png (+ sigma.json).
k per flight level = the multiple of sigma that keeps flights with a boom on the ground at the Phase 1 gate
(0.5%) in the cross-validated hindcast (margin_eval.json)."""
import json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = 0.5
ev = json.load(open(os.path.join(HERE, "results", "margin_eval.json")))
sf = json.load(open(os.path.join(HERE, "results", "sigma_fields.json")))
zone = np.array(Image.open(os.path.join(HERE, "..", "site", "geo", "zone.png")))
jj, ii = np.meshgrid(np.minimum(np.arange(181) * 10, 1799), np.arange(360) * 10, indexing="ij")
reg = zone[jj, ii] <= 36                                               # regulated zone at the 1-degree nodes
k, med, rows = {}, {}, []
for fl in sf["fls"]:
    xs = ev["point"][str(fl)]
    a, p = np.array([x["anyb"] for x in xs]), np.array([x["par"] for x in xs])
    o = np.argsort(a)
    k[fl] = round(float(np.interp(GATE, a[o], p[o])), 2)
    s = np.array(sf["fields"][str(fl)], float) * sf["scale"]          # (181, 360), lat 90..-90 at nodes
    med[fl] = round(float(np.median(s[reg])), 4)
    rows.append(np.clip(np.round(s / 1e-4) - 100, 0, 255).astype(np.uint8))
Image.fromarray(np.vstack(rows), "L").save(os.path.join(HERE, "..", "site", "geo", "sigma.png"), optimize=True)
meta = {"file": "sigma.png", "fls": sf["fls"], "k": k, "scale": 1e-4, "offset": 100, "nx": 360, "ny": 181, "lon0": -180, "lat0": 90,
        "land_median": med, "gate_flights_pct": GATE, "s_extra": sf["s_extra"],
        "source": "RMS of GFS 24 h forecast minus analysis, 53 weekly hindcasts Oct 2025 - Oct 2026, combined with 0.012 real-world error"}
json.dump(meta, open(os.path.join(HERE, "..", "site", "geo", "sigma.json"), "w"), indent=1)
print(meta["k"], meta["land_median"], os.path.getsize(os.path.join(HERE, "..", "site", "geo", "sigma.png")))
