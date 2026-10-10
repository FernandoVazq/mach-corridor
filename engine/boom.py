"""
Loudness v0 (issue #12): ground overpressure of the primary boom, and how far above the ground a Mach-cutoff
caustic must sit to be quiet.

1. Carlson, "Simplified Sonic-Boom Prediction", NASA TP-1122 (1978), eqs. (1), (2), lift parameter, (5):
     dp  = K_p K_R sqrt(p_v p_g) (M^2-1)^(1/8) h_e^(-3/4) l^(3/4) K_S                [Pa]
     dt  = K_t (3.42 / a_v) M (M^2-1)^(-3/8) h_e^(1/4) l^(3/4) K_S                    [s]
     K_L = sqrt(M^2-1) W cos(gamma) / (1.4 p_v M^2 l^2)                               (lift parameter)
   SI units; h_e = height above ground. K_R = 1.9 (SBPW3 practice; Carlson 2.0, flight tests 1.8-2.0).
   K_p, K_t: Carlson's ray-traced corrections, ~1.0-1.1 and ~0.85 in level cruise at M 1.5-2; v0 uses 1.0 and 0.85.
   K_S: shape factor read from Carlson Fig. 4; slender SST-class aircraft ~0.088 at K_L ~0.01 (Samples 1-2).
   Valid for steady level flight, standard atmosphere, no wind; not near cutoff (M_e > ~1.2).

2. Safe cutoff altitude (Haglund, NASA CR-2417, 1974; used in NASA FaINT, Cliatt et al. 2016):
     dZ_S = R^(1/3) L^(2/3),   R = -a / (dV_P/dz)  (ray radius of curvature at the caustic), L = signal length.
   FaINT: with the caustic at least one dZ_S above the ground, measured booms were 0.01-0.09 psf (<= 68 dB PLSEL),
   under the FAA's proposed 0.11 psf limit.

3. FaINT empirical loudness below the caustic (Cliatt et al. 2016, eq. 8):
     PLSEL [dB] = Z_CO[ft] (0.008923 e^(-104.4 d) + 0.01447 e^(-25.05 d)),   d = M_T - M > 0
"""
import math

PSF = 47.880258            # Pa per psf
G0 = 9.80665
K_R = 1.9


def carlson(M, h_e, p_v, p_g, a_v, length, K_S, K_p=1.0, K_t=0.85, K_R=K_R):
    """Primary-boom peak overpressure (Pa) and duration (s) on track."""
    b = math.sqrt(M * M - 1.0)
    dp = K_p * K_R * math.sqrt(p_v * p_g) * b ** 0.25 * h_e ** -0.75 * length ** 0.75 * K_S
    dt = K_t * (3.42 / a_v) * M / b ** 0.75 * h_e ** 0.25 * length ** 0.75 * K_S
    return dp, dt


def lift_parameter(M, weight_n, p_v, length, gamma_deg=0.0):
    return math.sqrt(M * M - 1.0) * weight_n * math.cos(math.radians(gamma_deg)) / (1.4 * p_v * M * M * length ** 2)


def safe_cutoff_height(a, dVp_dz, signal_length):
    """Haglund dZ_S (m): how far above the ground the caustic must sit. dVp_dz in 1/s (negative: V_P falls upward
    above the caustic... sign handled with abs)."""
    R = a / max(abs(dVp_dz), 1e-6)
    return R ** (1 / 3) * signal_length ** (2 / 3)


def faint_plsel(z_co_m, delta):
    """FaINT eq. 8: perceived level (dB PLSEL) on the ground for a caustic z_co_m above it, flying delta below M_T."""
    z_ft = z_co_m / 0.3048
    return z_ft * (0.008923 * math.exp(-104.4 * delta) + 0.01447 * math.exp(-25.05 * delta))


# ISA helpers (valid to 20 km) for the per-leg estimate
def isa(h):
    if h < 11000:
        T = 288.15 - 0.0065 * h
        p = 101325.0 * (T / 288.15) ** 5.25588
    else:
        T = 216.65
        p = 22632.1 * math.exp(-(h - 11000.0) / 6341.62)
    return T, p, math.sqrt(1.4 * 287.05 * T)


AIRCRAFT = {   # length (m), mid-cruise weight (kg), K_S; sources in docs/ECONOMICS_SOURCES.md and TP-1122
    "overture": (61.0, 0.85 * 188000, 0.088),
    "concorde": (61.66, 0.85 * 185000, 0.088),
    "as2": (51.8, 0.85 * 68000, 0.10),
    "nplus3": (61.0, 0.85 * 140000, 0.088),
}


def leg_psf(ac, M, fl, ground_m=0.0):
    """Primary-boom psf and duration for an aircraft at Mach M and flight level fl (hundreds of ft, standard atmosphere)."""
    length, mass, K_S = AIRCRAFT[ac]
    h = fl * 100 * 0.3048
    _, p_v, a_v = isa(h)
    _, p_g, _ = isa(ground_m)
    dp, dt = carlson(M, h - ground_m, p_v, p_g, a_v, length, K_S)
    return dp / PSF, dt
