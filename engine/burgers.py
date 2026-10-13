"""
Deep study 2 (Oct 2026): sonic-boom waveforms with the augmented Burgers equation, and how loud they are (PLdB).

Along the under-track ray from the aircraft to the ground (or to the turning point of a Mach-cutoff leg), in
retarded time tau, the boom pressure p(s, tau) obeys (Cleveland 1995; Rallabhandi 2011, sBOOM):

    dp/ds = beta/(rho c^3) p dp/dtau                                   nonlinear steepening
          + delta/(2 c^3) d2p/dtau2                                   thermoviscous absorption
          + sum_nu (dc_nu / c^2) theta_nu d2/dtau2 (1 + theta_nu d/dtau)^-1 p     O2 and N2 relaxation
          - (1/2) d ln A/ds p + (1/2) d ln(rho c)/ds p                 ray-tube spreading and impedance

solved by operator splitting: nonlinearity with a conservative Godunov scheme (exact Riemann flux for
f = -a p^2/2), absorption and relaxation exactly in the frequency domain, spreading/impedance as an amplitude factor
(p^2 A / (rho c) conserved: no wind). Absorption and relaxation follow ISO 9613-1 (1993): for each process the
attenuation f^2 A_nu fr_nu / (fr_nu^2 + f^2) Np/m fixes dc_nu / c^2 = A_nu / (2 pi), theta_nu = 1 / (2 pi fr_nu),
and the same term gives the dispersion (Kramers-Kronig consistent).

Ray geometry (stratified, no wind, under-track ray): the wavefront normal makes angle psi with the horizontal where
cos(psi(z)) = c(z) / V (Snell, V = aircraft speed); horizontal range R(z) = int cot(psi) dz; the ray-tube area is
A ~ R(z) sin(psi(z)) (lateral width R dphi, along-track width V dt sin psi).

Source: Carlson's N-wave (NASA TP-1122, engine/boom.py, without ground reflection) at h0 = 10 body lengths below
the aircraft, where the atmosphere is still nearly uniform; then the equation above to the ground, x K_R = 1.9.

Perceived loudness: Stevens Mark VII as implemented in PyLdB (Utah State University, MIT licence, vendored in
engine/vendor/pyldb_mk7.py) with quiet margins so the Hann edge window never touches a shock.
"""
import math
import numpy as np

from boom import carlson, lift_parameter, isa, PSF, K_R

GAMMA, R_AIR, BETA = 1.4, 287.05, 1.2
T0, T01, PR = 293.15, 273.16, 101325.0


# ---------------- atmosphere ----------------
def humidity_molar_pct(T, p, rh_pct):
    """ISO 9613-1: molar concentration of water vapour h (%) from relative humidity."""
    C = -6.8346 * (T01 / T) ** 1.261 + 4.6151
    psat_pr = 10.0 ** C
    return rh_pct * psat_pr / (p / PR)


def iso9613(T, p, rh_pct):
    """Classical coefficient (Np/m per Hz^2) and, per relaxation process, (A_nu [Np/m per Hz], fr_nu [Hz]) such that
    alpha_nu(f) = A_nu fr f^2 / (fr^2 + f^2)."""
    h = humidity_molar_pct(T, p, rh_pct); pa = p / PR
    frO = pa * (24.0 + 4.04e4 * h * (0.02 + h) / (0.391 + h))
    frN = pa * (T / T0) ** -0.5 * (9.0 + 280.0 * h * math.exp(-4.170 * ((T / T0) ** (-1 / 3) - 1)))
    cl = 1.84e-11 / pa * (T / T0) ** 0.5
    AO = (T / T0) ** -2.5 * 0.01275 * math.exp(-2239.1 / T)     # alpha_O = AO f^2 / (frO + f^2/frO)
    AN = (T / T0) ** -2.5 * 0.1068 * math.exp(-3352.0 / T)
    return cl, ((AO, frO), (AN, frN))


def alpha_iso_db_per_m(f, T, p, rh_pct):
    """ISO 9613-1 eq. (5), dB/m (for the verification test)."""
    cl, ((AO, frO), (AN, frN)) = iso9613(T, p, rh_pct)
    return 8.686 * f * f * (cl + AO * frO / (frO * frO + f * f) + AN * frN / (frN * frN + f * f))


class Atmosphere:
    """Column given on heights z (m, ascending) with T (K), p (Pa), RH (%)."""

    def __init__(self, z, T, p, rh):
        self.z, self.T, self.p, self.rh = (np.asarray(a, float) for a in (z, T, p, rh))

    @classmethod
    def isa(cls, rh_surface=60.0, top=20000.0, dT=0.0):
        z = np.linspace(0, top, 401)
        T, p = [], []
        for h in z:
            t, pp, _ = isa(h); T.append(t + dT); p.append(pp)
        rh = np.clip(rh_surface * np.exp(-z / 3000.0), 1.0, 100.0)      # moist boundary layer, dry aloft
        return cls(z, T, p, rh)

    def at(self, z):
        T = np.interp(z, self.z, self.T); p = float(np.exp(np.interp(z, self.z, np.log(self.p))))
        return T, p, float(np.interp(z, self.z, self.rh))

    def c(self, z):
        return math.sqrt(GAMMA * R_AIR * self.at(z)[0])

    def rho(self, z):
        T, p, _ = self.at(z)
        return p / (R_AIR * T)


# ---------------- numerics ----------------
def godunov_step(p, a, ds, dtau):
    """One conservative step of dp/ds - d/dtau(a p^2 / 2) = 0 (i.e. dp/ds = a p dp/dtau), flux f = -a p^2/2."""
    f = lambda q: -0.5 * a * q * q
    pL, pR = p[:-1], p[1:]
    fl, fr = f(pL), f(pR)
    F = np.where(pL <= pR, np.minimum(fl, fr), np.where((pR < 0) & (pL > 0), 0.0, np.maximum(fl, fr)))
    out = p.copy()
    out[1:-1] -= ds / dtau * (F[1:] - F[:-1])
    return out


def linear_operator(n, dtau, T, p, rh, c, absorb=True):
    """Complex exponent per metre in the rfft domain (convention d/dtau -> i w)."""
    w = 2 * np.pi * np.fft.rfftfreq(n, dtau)
    if not absorb:
        return np.zeros_like(w, dtype=complex)
    cl, procs = iso9613(T, p, rh)
    f = w / (2 * np.pi)
    L = -cl * f * f + 0j                                            # thermoviscous (Np/m)
    for A, fr in procs:
        th = 1.0 / (2 * np.pi * fr); k = A / (2 * np.pi)               # dc_nu / c^2
        L = L + k * th * (1j * w) ** 2 / (1 + 1j * w * th)
    return L


def n_wave(dp, T, rise, dtau, quiet):
    """N-wave of peak dp (Pa) and duration T (s), linear shocks of 10-90 % rise 'rise' (s), with quiet margins."""
    n = int(round((T + 2 * quiet) / dtau)); t = np.arange(n) * dtau - quiet
    p = np.where((t >= 0) & (t <= T), dp * (1 - 2 * t / T), 0.0)
    if rise > dtau:
        k = max(1, int(round(rise / 0.8 / dtau)))
        p = np.convolve(p, np.ones(k) / k, mode="same")
    return t, p


def ray_geometry(atm, z_a, M, z_end, n=2000):
    """Under-track ray from the aircraft at z_a down to z_end: arrays z (descending), path s, area A (relative)."""
    V = M * atm.c(z_a)
    z = np.linspace(z_a, z_end, n)
    c = np.array([atm.c(x) for x in z])
    cos_psi = c / V
    if np.any(cos_psi >= 1.0):
        raise ValueError("ray turns before z_end (Mach cutoff)")
    psi = np.arccos(cos_psi)
    dz = -np.diff(z)
    Rh = np.concatenate([[0.0], np.cumsum(dz / np.tan(0.5 * (psi[1:] + psi[:-1])))])
    s = np.concatenate([[0.0], np.cumsum(dz / np.sin(0.5 * (psi[1:] + psi[:-1])))])
    A = np.maximum(Rh, 1e-9) * np.sin(psi)
    return z, s, A, psi


def propagate(atm, z_a, M, W_kg, L, z_end=0.0, h0_bl=10.0, absorb=True, nonlinear=True, dtau=1e-5, quiet=0.02,
              ds_lin=25.0, rise0=None):
    """Free-field waveform (Pa) arriving at z_end along the under-track ray. Returns dict with tau, p, the Carlson
    start and ground values for comparison."""
    h0 = h0_bl * L
    z0 = z_a - h0
    _, pv, av = isa(z_a)
    KL = lift_parameter(M, W_kg * 9.80665, pv, L)
    KS = max(0.06, 0.85 * math.sqrt(KL))                 # as engine/aircraft_study.py and caustic.py
    pg0 = atm.at(z0)[1]
    dp0, T0w = carlson(M, h0, pv, pg0, av, L, KS, K_t=1.0)
    dp0 /= K_R
    zg, sg, Ag, psi = ray_geometry(atm, z_a, M, z_end)
    keep = zg <= z0
    z, s, A = zg[keep], sg[keep] - sg[keep][0], Ag[keep]
    rise = rise0 if rise0 is not None else max(4 * dtau, 1e-4)
    # room for the shocks to separate: each moves outward by up to ~half the final duration
    _, pg_end, _ = atm.at(z_end)
    T_end = carlson(M, z_a - z_end, pv, pg_end, av, L, KS, K_t=1.0)[1]
    quiet = max(quiet, 0.75 * T_end)
    tau, p = n_wave(dp0, T0w, rise, dtau, quiet)
    n = len(p)
    # pad to a fast FFT length
    nf = 1 << int(math.ceil(math.log2(n)))
    p = np.concatenate([p, np.zeros(nf - n)]); tau = np.arange(nf) * dtau - quiet
    def medium(x):
        T, pp, rh = atm.at(x); c = math.sqrt(GAMMA * R_AIR * T); rho = pp / (R_AIR * T)
        return T, pp, rh, c, rho
    i = 0; s_now = 0.0
    T_, pp_, rh_, c_, rho_ = medium(z[0])
    Lop = linear_operator(nf, dtau, T_, pp_, rh_, c_, absorb)
    zi = lambda sv: float(np.interp(sv, s, z))
    Ai = lambda sv: float(np.interp(sv, s, A))
    s_end = s[-1]
    while s_now < s_end - 1e-6:
        step = min(ds_lin, s_end - s_now)
        # nonlinear sub-steps (CFL)
        if nonlinear:
            a = BETA / (rho_ * c_ ** 3)
            done = 0.0
            while done < step - 1e-9:
                pm = max(np.max(np.abs(p)), 1e-6)
                h = min(step - done, 0.8 * dtau / (a * pm))
                p = godunov_step(p, a, h, dtau); done += h
        # linear absorption/relaxation over the step, exact in frequency
        if absorb:
            P = np.fft.rfft(p); P *= np.exp(Lop * step); p = np.fft.irfft(P, n=nf)
        # spreading + impedance
        s_new = s_now + step
        T2, pp2, rh2, c2, rho2 = medium(zi(s_new))
        p *= math.sqrt((rho2 * c2) / (rho_ * c_) * Ai(s_now) / Ai(s_new))
        s_now = s_new; T_, pp_, rh_, c_, rho_ = T2, pp2, rh2, c2, rho2
        i += 1
        if absorb and i % 4 == 0:
            Lop = linear_operator(nf, dtau, T_, pp_, rh_, c_, absorb)
    pgz = atm.at(z_end)[1]
    dpc, Tc = carlson(M, z_a - z_end, pv, pgz, av, L, KS)
    return dict(tau=tau, p=p, dp_start=dp0, T_start=T0w, KS=KS, carlson_dp_free=dpc / K_R, carlson_T=Tc, path_m=s_end)


def rise_time(tau, p):
    """10-90 % rise time (s) of the front shock."""
    k = int(np.argmax(p)); pk = p[k]
    pre = p[:k + 1]
    i10 = np.where(pre <= 0.1 * pk)[0]; i90 = np.where(pre >= 0.9 * pk)[0]
    if not len(i10) or not len(i90):
        return float("nan")
    a = i10[i10 < i90[0]]
    if not len(a):
        return float("nan")
    return float(tau[i90[0]] - tau[a[-1]])


def pldb(tau_s, p_pa, quiet_ms=20.0):
    """Stevens Mark VII PLdB (PyLdB), with quiet margins added so the edge window never touches the signal."""
    from vendor.pyldb_mk7 import perceivedloudness
    dt_ms = (tau_s[1] - tau_s[0]) * 1e3
    nz = int(quiet_ms / dt_ms)
    p = np.concatenate([np.zeros(nz), p_pa / PSF, np.zeros(nz)])
    t = np.arange(len(p)) * dt_ms
    return float(perceivedloudness(t, p, pad_front=6, pad_rear=6, len_window=min(800, nz)))
