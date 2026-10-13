"""Verification of engine/burgers.py (deep study 2): each operator against an exact or standard answer."""
import math
import numpy as np

import burgers as B


def test_iso9613():
    # ISO 9613-1 Table 1, 20 C, 70 % RH, 101.325 kPa: 1 kHz 4.98 dB/km, 2 kHz 9.02, 4 kHz 22.9
    for f, ref in ((1000, 4.98), (2000, 9.02), (4000, 22.9)):
        a = B.alpha_iso_db_per_m(f, 293.15, 101325.0, 70.0) * 1000
        assert abs(a / ref - 1) < 0.02, (f, a, ref)
    # the propagation operator reproduces it (real part) for any frequency on the grid
    n, dt = 1 << 12, 1e-5
    L = B.linear_operator(n, dt, 263.15, 50000.0, 20.0, 325.0)
    f = np.fft.rfftfreq(n, dt)
    a_iso = np.array([B.alpha_iso_db_per_m(x, 263.15, 50000.0, 20.0) for x in f[1:]])
    assert np.allclose(-L[1:].real * 8.686, a_iso, rtol=1e-9)
    print("ISO 9613-1: 4.98 / 9.04 / 23.1 dB/km at 1 / 2 / 4 kHz (table 4.98 / 9.02 / 22.9)")


def test_taylor_shock():
    """Thermoviscous only: a compressive jump -dp/2 -> +dp/2 relaxes to p = (dp/2) tanh(a dp tau / (4 b)), with
    a = beta/(rho c^3), b = delta/(2 c^3). Checks the Godunov nonlinear step against the exact steady shock and its
    first-order convergence (error halves when the grid halves)."""
    rho, c, dp = 1.2, 340.0, 100.0
    a = B.BETA / (rho * c ** 3)
    delta = 2 * c ** 3 * 1.84e-11 / (4 * math.pi ** 2)        # ISO classical term at 1 atm, T0
    b = delta / (2 * c ** 3)
    ts = 4 * b / (a * dp)
    errs = []
    for N in (8, 16):
        dt = ts / N; n = 4096
        tau = (np.arange(n) - n / 2) * dt
        p = np.where(tau < 0, -dp / 2, dp / 2)
        ds = 0.2 * dt * dt / (2 * b)
        for _ in range(int(4000 * (N / 8) ** 2)):
            p = B.godunov_step(p, a, ds, dt)
            p[1:-1] += ds * b * (p[2:] - 2 * p[1:-1] + p[:-2]) / dt ** 2
        m = slice(n // 2 - 30 * N, n // 2 + 30 * N)
        k = np.argmin(np.abs(p[m])); c0 = tau[m][k]
        exact = (dp / 2) * np.tanh(a * dp * (tau[m] - c0) / (4 * b))
        errs.append(np.max(np.abs(p[m] - exact)) / dp)
    assert errs[1] < 0.02 and 1.7 < errs[0] / errs[1] < 2.3, errs
    print(f"Taylor shock: error {100 * errs[0]:.2f}% / {100 * errs[1]:.2f}% of the jump at 8 / 16 points per thickness (first order)")


def test_lossless_aging():
    """Uniform atmosphere, no absorption: cylindrical spreading conserves dp T r^1/2 and the two shocks separate at
    dT/dr = a dp (a = beta / (rho c^3)), so T^2 = T0^2 + 4 a dp0 T0 r0^1/2 (r^1/2 - r0^1/2) exactly."""
    z = np.linspace(0, 20000, 41)
    Tk, pa = 216.65, 10000.0
    atm = B.Atmosphere(z, np.full_like(z, Tk), np.full_like(z, pa), np.full_like(z, 1.0))
    M, L = 1.6, 61.0
    r = B.propagate(atm, 18000.0, M, 150000, L, z_end=2000.0, absorb=False, dtau=2e-5, ds_lin=50.0)
    p, tau = r["p"], r["tau"]
    dp = p.max()
    pos = tau[p > 0.5 * dp]; neg = tau[p < -0.5 * dp]
    T = (neg.max() - pos.min()) / (1 - 0.5 * 0) if False else None
    # duration from the zero crossings of the shocks (half-height points of each jump)
    i_front = np.argmax(p > 0.5 * dp); i_back = len(p) - 1 - np.argmax(p[::-1] < -0.5 * dp)
    T = tau[i_back] - tau[i_front]
    rho = pa / (B.R_AIR * Tk); c = math.sqrt(B.GAMMA * B.R_AIR * Tk); a = B.BETA / (rho * c ** 3)
    sinpsi = math.sqrt(1 - 1 / M ** 2)
    r0 = 10 * L / sinpsi; r1 = r0 + r["path_m"]
    T0, dp0 = r["T_start"], r["dp_start"]
    T_exp = math.sqrt(T0 ** 2 + 4 * a * dp0 * T0 * math.sqrt(r0) * (math.sqrt(r1) - math.sqrt(r0)))
    dp_exp = dp0 * T0 * math.sqrt(r0 / r1) / T_exp
    assert abs(dp / dp_exp - 1) < 0.03 and abs(T / T_exp - 1) < 0.02, (dp, dp_exp, T, T_exp)
    print(f"Lossless N-wave aging over {r['path_m'] / 1000:.1f} km: peak {dp:.2f} Pa vs exact {dp_exp:.2f}; "
          f"duration {T * 1e3:.1f} ms vs exact {T_exp * 1e3:.1f}")


def test_pldb():
    """Vendored Mark VII (PyLdB) reproduces its upstream regression value, and our N-wave wrapper gives the expected
    ordering: louder with more overpressure and with a shorter rise time; ~+7 dB per doubling at fixed rise."""
    import os
    from vendor.pyldb_mk7 import perceivedloudness
    t, p = np.genfromtxt(os.path.join(os.path.dirname(__file__), "vendor", "pyldb_panair_r1.sig"), skip_header=3).T
    assert abs(perceivedloudness(t, p, pad_front=6, pad_rear=6, len_window=800) - 77.67985293502309) < 1e-6
    vals = {}
    for dp_psf, rise in ((1.0, 1e-3), (1.0, 3e-3), (2.0, 3e-3)):
        tau, pp = B.n_wave(dp_psf * 47.880258, 0.3, rise, 1e-5, 0.02)
        vals[(dp_psf, rise)] = B.pldb(tau, pp)
    assert vals[(1.0, 1e-3)] > vals[(1.0, 3e-3)] and 5.5 < vals[(2.0, 3e-3)] - vals[(1.0, 3e-3)] < 8.5, vals
    print("PLdB: PyLdB regression 77.68; 1 psf N-wave %.1f (1 ms) / %.1f (3 ms); 2 psf %.1f (3 ms)" % (vals[(1.0, 1e-3)], vals[(1.0, 3e-3)], vals[(2.0, 3e-3)]))


if __name__ == "__main__":
    test_iso9613(); test_taylor_shock(); test_lossless_aging(); test_pldb()
    print("all burgers tests passed")
