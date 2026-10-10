"""
Is the fixed 1 km buffer enough? (issue #15, first look)

For every land column of a GFS run (2-degree profiles from the live map) and 8 directions of travel at FL550,
find where a boom flown at the boomless limit turns (the caustic: the level of max V_P = c + w.e between the
floor and cruise, as in physics.py), the vertical gradient of V_P just above it, and Haglund's safe cutoff height
    dZ_S = R^(1/3) L^(2/3),  R = a / |dV_P/dz|,  L = signal length (SST-class, ~60 m).
At the limit the caustic sits exactly 1 km above the highest terrain; flying a margin d below the limit lifts it
by about d c_a / |dV_P/dz|. We count the columns where the caustic is lower than dZ_S above the ground.
Usage: python buffer_check.py [prof_f000.bin] [manifest.json]
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
from boom import safe_cutoff_height
from physics import isa_pressure_hpa

PROF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "site", "data", "prof_f000.bin")
MAN = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "site", "data", "manifest.json")
man = json.load(open(MAN))
P = man["profiles"]; L = P["levels"]; ny, nx = P["ny"], P["nx"]
a = np.fromfile(PROF, "<i2").astype(np.float32).reshape(4 * L + 1, ny, nx)
c, u, v, Z, ground = a[:L] / 10, a[L:2 * L] / 10, a[2 * L:3 * L] / 10, a[3 * L:4 * L], a[4 * L]
plev = np.array(man["plev"], float)
p_a = float(isa_pressure_hpa(550 * 100 * 0.3048))
lat = 90 - 2 * np.arange(ny)
BUF, SIG_LEN = 1000.0, 60.0

res = {"limit": [], "margin": []}
for j in range(ny):
    if abs(lat[j]) > 60: continue
    for i in range(nx):
        if ground[j, i] <= 5: continue                      # crude land test: terrain above sea level
        zf = ground[j, i] + BUF
        for hd in range(0, 360, 45):
            e = (math.sin(math.radians(hd)), math.cos(math.radians(hd)))
            Vp = c[:, j, i] + u[:, j, i] * e[0] + v[:, j, i] * e[1]
            z = Z[:, j, i]
            ok = (plev > p_a) & (z > zf)
            if ok.sum() < 2: continue
            idx = np.where(ok)[0]
            k = idx[np.argmax(Vp[idx])]                     # level of max V_P (the caustic at the limit)
            kk = k + 1                                      # next level up (plev descending -> higher)
            if kk >= L or plev[kk] <= p_a: continue
            g = (Vp[kk] - Vp[k]) / max(z[kk] - z[k], 1.0)   # dV_P/dz just above the caustic
            if g >= 0: continue
            dzs = safe_cutoff_height(c[k, j, i], g, SIG_LEN)
            zc = max(z[k], zf) - ground[j, i]               # caustic height above the highest terrain at the limit
            ca = np.interp(np.log(p_a), np.log(plev[::-1]), c[::-1, j, i])
            w = math.cos(math.radians(lat[j]))
            res["limit"].append((zc, dzs, w))
            res["margin"].append((zc + 0.05 * ca / abs(g), dzs, w))
out = {}
for k, rows in res.items():
    r = np.array(rows)
    w = r[:, 2] / r[:, 2].sum()
    out[k] = dict(columns=len(r), dzs_median_m=round(float(np.median(r[:, 1]))), dzs_p90_m=round(float(np.quantile(r[:, 1], 0.9))),
                  short_pct=round(100 * float(w[r[:, 0] < r[:, 1]].sum()), 1),
                  caustic_median_m=round(float(np.median(r[:, 0]))))
out["run"] = man["run"]; out["signal_length_m"] = SIG_LEN; out["fl"] = 550
print(json.dumps(out, indent=1))
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
json.dump(out, open(os.path.join(HERE, "results", "buffer_check.json"), "w"), indent=1)
