"""Analytic checks for the ray tracer and its agreement with mmax_grid (math checks in the roadmap)."""
import math
import numpy as np
from rays import Profile, trace, omega
from physics import mmax_grid
from test_physics import PLEV, column


def test_isothermal_cone():
    """Uniform still air: the front is the textbook Mach cone, boom lands h*sqrt(M^2-1) behind."""
    c0, h = 300.0, 15000.0
    prof = Profile.from_functions(lambda z: (c0, 0.0, 0.0, 0.0, 0.0, 0.0))
    for M in (1.2, 1.6, 2.0):
        r = trace(prof, h, M, dt=0.02)
        assert r["ground"]
        behind = M * c0 * r["t_end"] - r["y"][-1]
        exact = h * math.sqrt(M * M - 1)
        assert abs(behind / exact - 1) < 1e-6, (M, behind, exact)
        mu = math.degrees(math.atan2(h, behind))
        assert abs(math.sin(math.radians(mu)) - 1 / M) < 1e-6
    print("isothermal: cone sin(mu) = 1/M to 1e-6")


def test_linear_gradient_arc():
    """c = c_g - g z (still air): rays are circular arcs of radius V_t/g.
    Turning height (c_g - V_t)/g, horizontal range R sin(theta_a), time ln(sec + tan)/g."""
    cg, g, za = 340.0, 0.004, 12000.0
    prof = Profile.from_functions(lambda z: (cg - g * z, 0.0, 0.0, -g, 0.0, 0.0))
    ca = cg - g * za
    for M in (1.02, 1.05, 1.08):
        Vt = M * ca
        if Vt >= cg:
            continue
        th = math.acos(ca / Vt)
        r = trace(prof, za, M, dt=0.01, z_floor=-1e9)
        i = int(np.argmin(r["z"]))
        # refine the minimum with a parabola through the three samples around it
        z3, y3, t3 = r["z"][i - 1:i + 2], r["y"][i - 1:i + 2], r["t"][i - 1:i + 2]
        a = np.polyfit(t3, z3, 2); tt = -a[1] / (2 * a[0]); zt = np.polyval(a, tt)
        yt = np.polyval(np.polyfit(t3, y3, 2), tt)
        assert abs(zt - (cg - Vt) / g) < 0.05, (zt, (cg - Vt) / g)
        assert abs(yt / ((Vt / g) * math.sin(th)) - 1) < 1e-5, (yt, (Vt / g) * math.sin(th))
        assert abs(tt / (math.log(1 / math.cos(th) + math.tan(th)) / g) - 1) < 1e-5
    print("linear gradient: turning height, range and time match the circular-arc solution")


def test_invariant_conserved():
    """Smooth ISA-like column with a jet: omega and the horizontal wavenumber stay constant to 1e-6."""
    def f(z):
        T = 216.65 + 71.5 * 0.5 * (1 - math.tanh((z - 11000) / 1500))
        dT = -71.5 * 0.5 / 1500 / math.cosh((z - 11000) / 1500) ** 2
        c = math.sqrt(1.4 * 287.05 * T); dc = 0.5 * 1.4 * 287.05 * dT / c
        u = 45 * math.exp(-((z - 10500) / 3000) ** 2); du = -2 * (z - 10500) / 3000 ** 2 * u
        v = 8 * math.sin(z / 4000); dv = 8 / 4000 * math.cos(z / 4000)
        return c, u, v, dc, du, dv
    prof = Profile.from_functions(f)
    for psi in (0, 90, 225):
        for alpha in (0, 20, -35):
            r = trace(prof, 16000.0, 1.6, psi, alpha, z_floor=-1e9, dt=0.05, t_max=400)
            w = np.array([omega(prof, s) for s in r["state"]])
            assert np.max(np.abs(w / w[0] - 1)) < 1e-6, (psi, alpha, np.max(np.abs(w / w[0] - 1)))
            assert np.ptp(r["state"][:, 3]) == 0 and np.ptp(r["state"][:, 4]) == 0
    print("invariant: omega conserved to 1e-6 on every ray")


def test_agrees_with_mmax_grid():
    """The traced on-track ray turns above the floor just below mmax_grid's Mach and reaches it just above."""
    jet = lambda z: 40 * np.exp(-((z - 10500) / 3000) ** 2)
    for hd, kw in ((90, dict(u_of_z=jet)), (270, dict(u_of_z=jet)), (0, {})):
        T, U, V, Z = column(**kw)
        zf = 1000.0
        Mx = float(mmax_grid(PLEV, T, U, V, Z, np.zeros((1, 1)), 450, [hd], h_buf=zf, lateral=False)["M"][0, 0, 0])
        prof = Profile(Z[:, 0, 0], np.sqrt(1.4 * 287.05 * T[:, 0, 0]), U[:, 0, 0], V[:, 0, 0])
        za = float(np.interp(np.log(float(_p(450))), np.log(PLEV[::-1]), Z[::-1, 0, 0]))
        lo = trace(prof, za, Mx - 0.0015, hd, 0, z_floor=zf, dt=0.1)
        hi = trace(prof, za, Mx + 0.0015, hd, 0, z_floor=zf, dt=0.1)
        assert not lo["ground"] and hi["ground"], (hd, Mx, lo["z_turn"], hi["z_turn"])
    print("tracer agrees with mmax_grid within 0.0015 Mach")


def _p(fl):
    from physics import isa_pressure_hpa
    return isa_pressure_hpa(fl * 100 * 0.3048)


if __name__ == "__main__":
    test_isothermal_cone(); test_linear_gradient_arc(); test_invariant_conserved(); test_agrees_with_mmax_grid()
    print("all ray tests passed")
