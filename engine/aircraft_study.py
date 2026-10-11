"""
Aircraft study: what about the airplane changes the boomless speed, and what changes how loud it is.

1. The Mach-cutoff limit is a property of the air between the aircraft and the ground. The airplane enters only
   through (a) the altitude it cruises at, (b) the length of its boom signal, which sets the safe height of the
   turning point (Haglund: dZ = R^(1/3) L^(2/3)), and (c) climb or descent.
2. When the boom does reach the ground, its strength follows Carlson's simplified method (NASA TP-1122) with the
   lift-dominated shape factor K_S = max(0.06, 0.85 sqrt(K_L)), calibrated on TP-1122 sample 2 and checked against
   Concorde (2.15 vs 1.94 psf measured), SR-71 (1.04 vs 0.9) and the Concorde-class Carlson result (1.89 vs 1.66):
   within ~15%. Shaped low-boom designs (X-59) are outside this method.
Output: study/results/aircraft.json
"""
import json, math, os
import numpy as np
from boom import carlson, lift_parameter, isa, PSF

C_KS = 0.85
DMDZ = -0.0064 / 500          # boomless Mach per metre of floor (sensitivity study, GFS land columns, FL550 median)
R_TYP = 89000.0               # ray radius of curvature for the ISA lapse (Haglund R = c / |dV_P/dz|)


def psf(W_t, L, M, fl, ground=0.0):
    h = fl * 100 * 0.3048; _, pv, av = isa(h); _, pg, ag = isa(ground)
    KL = lift_parameter(M, W_t * 1000 * 9.80665, pv, L)
    KS = max(0.06, C_KS * math.sqrt(KL))
    dp, dt = carlson(M, h - ground, pv, pg, av, L, KS)
    return dp / PSF, dt, KS, KL, ag


def buffer_for(L_sig):
    return R_TYP ** (1 / 3) * L_sig ** (2 / 3)


TYPES = [  # name, mid-cruise weight t, length m, design Mach, cruise FL, seats
    ("Concorde", 157, 61.66, 2.0, 550, 100),
    ("Boom Overture", 160, 61.0, 1.7, 550, 65),
    ("Aerion AS2 (bizjet)", 58, 51.8, 1.4, 450, 10),
    ("NASA N+3 concept", 119, 61.0, 1.6, 500, 120),
    ("Boom XB-1 (demonstrator)", 6, 18.9, 1.3, 360, 0),
    ("F/A-18 (FaINT test aircraft)", 15, 17.1, 1.3, 370, 0),
]


def main():
    sens = json.load(open(os.path.join(os.path.dirname(__file__), "..", "study", "results", "sensitivity.json")))
    alt = {r["fl"]: r for r in sens["altitude"] if r["source"].startswith("Balloon")} or {r["fl"]: r for r in sens["altitude"]}
    med_at = lambda fl: float(np.interp(fl, sorted(alt), [alt[k]["any_median"] for k in sorted(alt)]))
    types = []
    for n, W, L, Md, fl, seats in TYPES:
        p_d, dt_d, ks, kl, ag = psf(W, L, Md, fl)
        Mc = med_at(fl)
        p_c, dt_c, *_ = psf(W, L, max(Mc, 1.05), fl)
        Lsig = ag * dt_c
        buf = buffer_for(Lsig)
        _, _, ac = isa(fl * 100 * 0.3048)
        types.append(dict(name=n, weight_t=W, length_m=L, design_mach=Md, fl=fl, seats=seats, psf_design=round(p_d, 2),
                          boomless_mach_median=round(Mc, 3), psf_if_cutoff_fails=round(p_c, 2), signal_m=round(Lsig),
                          safe_height_m=round(buf), mach_vs_1km_buffer=round((buf - 1000) * DMDZ, 4),
                          ground_speed_kt_no_wind=round(Mc * ac * 1.943844), shape_factor=round(ks, 3)))
        print(types[-1])
    grid = [dict(weight_t=W, length_m=L, psf=round(psf(W, L, 1.4, 550)[0], 3)) for W in range(10, 261, 10) for L in range(15, 101, 5)]
    by_fl = [dict(name=n, fl=fl, psf=round(psf(W, L, 1.4, fl)[0], 3)) for n, W, L, *_ in TYPES[:3] for fl in range(300, 651, 25)]
    by_mach = [dict(name=n, mach=round(M, 2), psf=round(psf(W, L, M, 550)[0], 3)) for n, W, L, *_ in TYPES[:3] for M in np.arange(1.1, 2.21, 0.05)]
    # aircraft of Overture-like density: weight ~ 160 t (L / 61 m)^2.5
    by_len = []
    for L in range(10, 121, 10):
        W = 160 * (L / 61.0) ** 2.5
        sig = isa(0)[2] * psf(W, L, 1.15, 550)[1]
        by_len.append(dict(length_m=L, weight_t=round(W, 1), signal_m=round(sig), safe_height_m=round(buffer_for(sig)),
                           mach_vs_1km_buffer=round((buffer_for(sig) - 1000) * DMDZ, 4)))
    out = dict(types=types, psf_grid_m14_fl550=grid, psf_by_fl_m14=by_fl, psf_by_mach_fl550=by_mach, buffer_by_length=by_len,
               model=dict(ks="max(0.06, 0.85*sqrt(K_L))", accuracy="~15% vs Concorde, SR-71 and Carlson's sample problems", dMdz=DMDZ, R=R_TYP))
    p = os.path.join(os.path.dirname(__file__), "..", "study", "results", "aircraft.json")
    json.dump(out, open(p, "w"), indent=1)
    print("wrote", p)


if __name__ == "__main__":
    main()
