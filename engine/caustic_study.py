"""
Loudness below the turning point for real aircraft (issue #39), from engine/caustic.py.
1. FaINT check: F-18 at M1.15, 37,000 ft, ground psf vs caustic height in Haglund heights, against Cliatt et al.
   (2016) Table 2.
2. Aircraft: free-field boom at the turning height, Haglund height, depth needed for 0.11 and 0.05 psf.
3. Waveforms on the ground for Boom Overture at 0.5, 1 and 1.5 Haglund heights.
Output: study/results/caustic.json
"""
import json, os
import numpy as np
from caustic import ground_psf, aircraft_wave, haglund, depth_for, isa, PSF, Q_COEF, S_COEF, S_SAFETY

R = 89e3
FAINT = [  # Cliatt et al. 2016 Table 2: RatioZS bin -> measured ground psf range (caustic height = (RatioZS + 1) dZ_S)
    dict(bin="caustic > 2 dZ_S", lo=2.0, hi=3.5, psf=[0.01, 0.10]),
    dict(bin="1-2 dZ_S", lo=1.0, hi=2.0, psf=[0.03, 0.09]),
    dict(bin="0.2-1 dZ_S", lo=0.2, hi=1.0, psf=[0.03, 0.33]),
]
TYPES = [("Concorde", 157, 61.66, 550), ("Boom Overture", 160, 61.0, 550), ("Aerion AS2", 58, 51.8, 450),
         ("NASA N+3", 119, 61.0, 500), ("Boom XB-1", 6, 18.9, 360), ("F-18 (FaINT)", 15, 17.1, 370)]


def main():
    h = 37000 * 0.3048
    dp, T = aircraft_wave(15, 17.1, 1.15, h, 2000); sig = T * isa(2000)[2]; dz = haglund(R, sig)
    curve = [dict(r=round(float(r), 3), psf={f"R{int(Rr/1e3)}": round(ground_psf(15, 17.1, 1.15, h, r * haglund(Rr, sig), Rr)[0], 4) for Rr in (50e3, 89e3, 150e3)})
             for r in np.r_[np.linspace(0.1, 1, 10), np.linspace(1.2, 3.4, 12)]]
    faint = []
    for b in FAINT:
        ps = [ground_psf(15, 17.1, 1.15, h, r * haglund(Rr, sig), Rr)[0] for r in np.linspace(b["lo"], b["hi"], 9) for Rr in (50e3, 89e3, 150e3)]
        faint.append(dict(**b, model=[round(min(ps), 3), round(max(ps), 3)]))
    types = []
    for n, W, L, fl in TYPES:
        hh = fl * 100 * 0.3048; M = 1.15
        dpf, Tf = aircraft_wave(W, L, M, hh, 1500); sg = Tf * isa(1500)[2]; dzs = haglund(R, sg)
        d11, d05 = depth_for(W, L, M, hh, R, 0.11), depth_for(W, L, M, hh, R, 0.05)
        types.append(dict(name=n, fl=fl, mach=M, free_psf=round(dpf / PSF, 3), signal_m=round(sg), haglund_m=round(dzs),
                          psf_at_1_haglund=round(ground_psf(W, L, M, hh, dzs, R)[0], 3), psf_at_2_haglund=round(ground_psf(W, L, M, hh, 2 * dzs, R)[0], 4),
                          depth_011_m=None if d11 is None else round(d11), depth_005_m=None if d05 is None else round(d05),
                          depth_011_over_haglund=None if d11 is None else round(d11 / dzs, 3)))
        print(types[-1])
    waves = []
    hh = 550 * 100 * 0.3048
    _, To = aircraft_wave(160, 61.0, 1.15, hh, 1500); dzo = haglund(R, To * isa(1500)[2])
    for r in (0.5, 1.0, 1.5):
        pk, t, p, T = ground_psf(160, 61.0, 1.15, hh, r * dzo, R)
        sel = np.abs(t) < 0.4; step = max(1, int(sel.sum() / 400))
        waves.append(dict(r=r, peak_psf=round(pk, 4), t_ms=[round(float(x) * 1000, 1) for x in t[sel][::step]], psf=[round(float(x) / PSF, 5) for x in p[sel][::step]]))
    out = dict(R_m=R, faint=faint, faint_curve=curve, faint_haglund_m=round(dz), types=types, waves_overture=waves,
               fits=dict(quiet="D_0.11/dZ_S = %s + 0.05" % (" + ".join(f"{c}·{t}" for c, t in zip(Q_COEF, ["1", "ln(dp_free/0.11)", "ln(R/89 km)", "ln(L/100 m)"]))),
                         shadow="psf = %s·dp_free·exp(%s)" % (S_SAFETY, " + ".join(f"{c}·{t}" for c, t in zip(S_COEF, ["1", "r^1.5", "r", "ln(R/89 km)", "ln(L/100 m)"])))),
               model="Linear fold-caustic (Airy) theory, Carlson incident N-wave, rigid ground, 2 ms rise time; engine/caustic.py")
    p = os.path.join(os.path.dirname(__file__), "..", "study", "results", "caustic.json")
    json.dump(out, open(p, "w"), indent=1); print("wrote", p); print(json.dumps(faint, indent=1))


if __name__ == "__main__":
    main()
