"""
Loudness below the turning point (issue #39): how loud a boom is on the ground when its caustic (the Mach-cutoff
turning point) sits a distance D above the ground.

Linear fold-caustic theory in a stratified moving atmosphere (Guiraud 1965; Gill & Seebass 1973; Plotkin & Cantril
1976; the same physics behind Haglund's safe cutoff height):

  Near the turning height the effective sound speed in the direction of travel V_P(z) grows towards the ground at
  rate g = |dV_P/dz|; the ray radius of curvature is R = V_t / g (V_t: trace velocity = V_P at the turning point).
  For a frequency component of wavenumber k = w / V_t the vertical structure obeys the Airy equation with argument
      xi = beta * dz,      beta = (2 k^2 / R)^(1/3)          (dz > 0 below the turning point: evanescent)
  Matching the Airy function to the geometric-acoustics (GO) wave above the turning point gives, for each frequency,
      p(D, w) = P_inc(w) * 2 sqrt(pi) (beta z_ref)^(1/4) * e^(-i pi/4 sgn w) * G(beta D)
  where P_inc is the free-field GO spectrum at a reference height z_ref above the turning point and G is the
  Airy solution with a rigid ground: G(x) = Ai(x) - Ai'(x_g)/Bi'(x_g) Bi(x) at the ground x = x_g (pressure doubling).

  Incident wave: Carlson's N-wave (boom.carlson, without the ground-reflection factor), launched at the cruise ray
  angle sin(theta) = sqrt(M^2-1)/M; GO amplitude grows as (sin theta)^(-1/2) towards the turning point, which fixes
  z_ref = R sin^2(theta) / 2. Shocks get a finite rise time (default 2 ms) so the spectrum is integrable at the caustic.

  Every frequency decays like exp(-2/3 xi^(3/2)): the higher it is, the faster. Haglund's dZ_S = R^(1/3) L^(2/3)
  is the depth where the N-wave's fundamental (k = 2 pi / L) reaches xi = (8 pi^2)^(1/3) = 4.3.

Not modelled: nonlinearity at the caustic itself (only matters within ~0.2 dZ_S), turbulence, absorption,
non-uniform gradient below the turning point. Checked against NASA FaINT (Cliatt et al. 2016, Table 2).
"""
import math
import numpy as np
from scipy.special import airy

from boom import carlson, lift_parameter, isa, PSF, K_R


def n_wave(dp, T, rise=0.002, fs=20000, pad=8):
    """Free-field N-wave: peak dp (Pa), duration T (s); the two shocks get a finite rise time (Hann smoothing)."""
    n = int(round(pad * T * fs)); t = (np.arange(n) - n / 2) / fs
    p = np.where(np.abs(t) <= T / 2, -2 * dp * t / T, 0.0)
    k = max(1, int(rise * fs / 2))
    if k > 1:
        w = np.hanning(2 * k + 1); w /= w.sum(); p = np.convolve(p, w, mode="same")
    return t, p


def shadow_signal(dp_free, T, M, D, R, Vt, rise=0.002, fs=20000):
    """Ground waveform (Pa) when the caustic sits D metres above a rigid ground. dp_free, T: free-field N-wave from
    the aircraft (no ground reflection); M: aircraft Mach (sets the launch ray angle); R: ray radius of curvature (m);
    Vt: trace velocity at the turning point (m/s)."""
    t, p = n_wave(dp_free, T, rise, fs)
    P = np.fft.rfft(p); w = 2 * np.pi * np.fft.rfftfreq(len(p), 1 / fs)
    sin_t = math.sqrt(max(M * M - 1, 1e-6)) / M
    z_ref = R * sin_t ** 2 / 2
    k = w / Vt
    beta = np.cbrt(2 * k ** 2 / R)
    xg = beta * D
    ai, aip, bi, bip = airy(xg)
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        G = ai - aip / bip * bi                        # rigid ground at x = xg: exactly 2 Ai for deep shadows
        G = np.where(np.isfinite(G), G, 0.0)
        H = 2 * math.sqrt(math.pi) * np.power(beta * z_ref, 0.25) * np.exp(-1j * math.pi / 4) * G
    H[0] = 0.0                                          # no DC
    return t, np.fft.irfft(P * H, n=len(p))


def aircraft_wave(W_t, L, M, h, z_turn):
    """Free-field N-wave reaching the turning height z_turn from cruise altitude h (standard atmosphere)."""
    _, pv, av = isa(h); _, pt, _ = isa(z_turn)
    KL = lift_parameter(M, W_t * 1000 * 9.80665, pv, L)
    KS = max(0.06, 0.85 * math.sqrt(KL))                # as engine/aircraft_study.py
    dp, T = carlson(M, h - z_turn, pv, pt, av, L, KS)
    return dp / K_R, T


def ground_psf(W_t, L, M, h, D, R, z_ground=0.0, rise=0.002):
    """Peak ground overpressure (psf) and the waveform, for a caustic D metres above ground."""
    z_turn = z_ground + D
    dp, T = aircraft_wave(W_t, L, M, h, z_turn)
    Vt = isa(z_turn)[2]
    t, p = shadow_signal(dp, T, M, D, R, Vt, rise)
    return float(np.max(np.abs(p))) / PSF, t, p, T


def haglund(R, sig_len):
    return R ** (1 / 3) * sig_len ** (2 / 3)


def depth_for(W_t, L, M, h, R, target_psf, d_max=12000.0):
    d_max = min(d_max, h - 300.0)
    """Smallest caustic height above ground (m) with ground psf <= target (bisection; psf falls with depth)."""
    lo, hi = 1.0, d_max
    if ground_psf(W_t, L, M, h, hi, R)[0] > target_psf:
        return None
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if ground_psf(W_t, L, M, h, mid, R)[0] > target_psf: lo = mid
        else: hi = mid
    return hi


# ---- closed forms for the site (fit to the model above over 6 aircraft, M 1.1-1.25, FL400-550, R 50-150 km) ----
# depth below the caustic where the ground boom reaches 0.11 psf, in Haglund heights (max fit error 0.043; +0.05 added)
Q_COEF = (0.3848, 0.3642, 0.0494, -0.1008)
# ground psf for a caustic r Haglund heights up: ln(psf / dp_free) fit, near-limit error -19%..+26%; x1.25 conservative
S_COEF = (1.308, 0.5662, -3.5556, 0.1023, -0.3039)
S_SAFETY = 1.25


def quiet_ratio(dp_free_psf, R, sig):
    c = Q_COEF
    return c[0] + c[1] * math.log(dp_free_psf / 0.11) + c[2] * math.log(R / 89e3) + c[3] * math.log(sig / 100) + 0.05


def shadow_psf_fit(dp_free_psf, r, R, sig):
    c = S_COEF
    return S_SAFETY * dp_free_psf * math.exp(c[0] + c[1] * r ** 1.5 + c[2] * r + c[3] * math.log(R / 89e3) + c[4] * math.log(sig / 100))
