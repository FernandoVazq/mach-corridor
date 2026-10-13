"""
Deep study 2 (Oct 2026): what the boom sounds like — augmented Burgers waveforms and perceived loudness (PLdB).

Part A, primary boom on the ground (steady level flight, under-track, standard atmosphere): peak psf, rise time
and PLdB for six aircraft, with and without absorption/relaxation, against Carlson's psf; humidity and temperature
sensitivity for Overture.
Part B, Mach-cutoff legs: the incident wave reaching the turning height (augmented Burgers from cruise, so its rise
time is physical) goes through the linear Airy caustic model (engine/caustic.py) to the ground at depths of 0.5-3
Haglund heights; ground psf and PLdB.
Part C, convergence: the same case at two time steps.

Output: study/results/boom_physics.json. Usage: python boom_physics.py [quick]
"""
import json, math, os, sys, time
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
import burgers as B                      # noqa: E402
import caustic as C                      # noqa: E402
from boom import PSF, K_R, isa, carlson  # noqa: E402

TYPES = [  # name, weight t, length m, Mach, FL  (engine/aircraft_study.py; F-18 and XB-1 at their test conditions)
    ("Concorde", 157, 61.66, 2.0, 550),
    ("Boom Overture", 160, 61.0, 1.7, 550),
    ("Aerion AS2 (bizjet)", 58, 51.8, 1.4, 450),
    ("NASA N+3 concept", 119, 61.0, 1.6, 500),
    ("Boom XB-1 (demonstrator)", 6, 18.9, 1.3, 360),
    ("F/A-18 (FaINT test aircraft)", 15, 17.1, 1.3, 370),
]
DT = 2e-5


def ground_case(args):
    name, W, L, M, fl, rh, dT, absorb, dtau = args
    atm = B.Atmosphere.isa(rh_surface=rh, dT=dT)
    t0 = time.time()
    r = B.propagate(atm, fl * 30.48, M, W * 1000, L, z_end=0.0, absorb=absorb, dtau=dtau)
    tau, p = r["tau"], r["p"] * K_R
    out = dict(name=name, mach=M, fl=fl, rh_surface=rh, dT=dT, absorb=absorb, dtau=dtau,
               psf=round(float(p.max()) / PSF, 3), psf_carlson=round(r["carlson_dp_free"] * K_R / PSF, 3),
               duration_ms=round(float(_duration(tau, p)) * 1e3, 1), duration_carlson_ms=round(r["carlson_T"] * 1e3, 1),
               rise_ms=round(B.rise_time(tau, p) * 1e3, 3), pldb=round(B.pldb(tau, p), 1), seconds=round(time.time() - t0))
    print(json.dumps(out), flush=True)
    return out


def _duration(tau, p):
    dp = p.max(); i0 = np.argmax(p > 0.5 * dp); i1 = len(p) - 1 - np.argmax(p[::-1] < -0.5 * p.max())
    return tau[i1] - tau[i0]


def cutoff_case(args):
    """Boomless leg: augmented Burgers gives the physical rise time of the wave arriving near the turning height
    (cruise -> where the ray is 10 degrees off horizontal, turning at 2.5 km); then, for caustics 0.5-3 Haglund
    heights above flat ground, the linear Airy model (engine/caustic.py) gives the ground waveform, its psf and PLdB.
    Each depth uses the Mach that turns exactly there (ISA)."""
    name, W, L, fl, R, rh = args
    h = fl * 30.48
    atm = B.Atmosphere.isa(rh_surface=rh)
    z_ref = 2500.0
    M = atm.c(z_ref) / atm.c(h)
    V = M * atm.c(h)
    zz = np.linspace(h, z_ref, 4000); cz = np.array([atm.c(x) for x in zz])
    z10 = float(zz[np.argmax(cz / V > math.cos(math.radians(10)))])
    r = B.propagate(atm, h, M, W * 1000, L, z_end=z10, absorb=True, dtau=DT)
    rise_inc = B.rise_time(r["tau"], r["p"])
    r_ll = B.propagate(atm, h, M, W * 1000, L, z_end=z10, absorb=False, dtau=DT)
    rise_ll = B.rise_time(r_ll["tau"], r_ll["p"])
    dp0, T0 = C.aircraft_wave(W, L, M, h, z_ref)
    sig = T0 * C.isa(z_ref)[2]                       # signal length (m), as engine/caustic_study.py
    dzs = C.haglund(R, sig)
    out = []
    for D_ratio in (0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0):
        D = D_ratio * dzs
        MD = atm.c(D) / atm.c(h)                      # Mach whose under-track ray turns D above the ground
        dp_free, T = C.aircraft_wave(W, L, MD, h, D)
        Vt = C.isa(D)[2]
        rows = {}
        for lbl, rise in (("physical_rise", max(rise_inc, 1e-4)), ("model_2ms", 0.002)):
            t, p = C.shadow_signal(dp_free, T, MD, D, R, Vt, rise=rise, fs=20000)
            rows[lbl] = dict(psf=round(float(np.max(np.abs(p))) / PSF, 4), pldb=round(B.pldb(t, p), 1))
        out.append(dict(name=name, fl=fl, R_km=R / 1000, haglund_m=round(dzs), depth_ratio=D_ratio, depth_m=round(D),
                        mach=round(MD, 4), incident_free_psf=round(dp_free / PSF, 3),
                        incident_rise_ms=round(rise_inc * 1e3, 3), incident_rise_lossless_ms=round(rise_ll * 1e3, 3), **rows))
        print(json.dumps(out[-1]), flush=True)
    return out


def main():
    quick = len(sys.argv) > 1 and sys.argv[1] == "quick"
    jobs = []
    for n, W, L, M, fl in TYPES:
        jobs.append((n, W, L, M, fl, 60.0, 0.0, True, DT))
        jobs.append((n, W, L, M, fl, 60.0, 0.0, False, DT))
    ov = TYPES[1]
    for rh in (20.0, 90.0):
        jobs.append((ov[0], ov[1], ov[2], ov[3], ov[4], rh, 0.0, True, DT))
    for dT in (-15.0, 15.0):
        jobs.append((ov[0], ov[1], ov[2], ov[3], ov[4], 60.0, dT, True, DT))
    jobs.append((ov[0], ov[1], ov[2], ov[3], ov[4], 60.0, 0.0, True, 1e-5))      # convergence
    if quick:
        jobs = jobs[:2]
    cjobs = [(TYPES[1][0], TYPES[1][1], TYPES[1][2], 550, R, 60.0) for R in (60e3, 100e3, 150e3)]
    cjobs += [(TYPES[5][0], TYPES[5][1], TYPES[5][2], 370, 100e3, 60.0)]
    with Pool(2) as P:
        ground = P.map(ground_case, jobs, chunksize=1)
        cut = [r for rs in P.map(cutoff_case, cjobs if not quick else cjobs[:1], chunksize=1) for r in rs]
    res = dict(method="augmented Burgers (engine/burgers.py) from Carlson's N-wave at 10 body lengths; ISO 9613-1 "
                      "absorption and O2/N2 relaxation; ray-tube spreading, no wind; ground x1.9; PLdB = Stevens Mark VII "
                      "(PyLdB). Cutoff legs: incident rise time from augmented Burgers to the 10-degree ray height, then "
                      "the linear Airy caustic model (engine/caustic.py) to the ground.",
               atmosphere="ISA, relative humidity 60% at the surface decaying with a 3 km scale (1% floor), unless noted",
               ground=ground, cutoff=cut)
    json.dump(res, open(os.path.join(HERE, "results", "boom_physics.json" if not quick else "boom_physics_quick.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
