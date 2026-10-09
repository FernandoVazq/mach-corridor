"""
Mach cutoff physics on gridded atmospheric profiles.

Intuition
---------
A sonic-boom ray launched downward keeps travelling down only while the aircraft's
ground speed along track is faster than the local *effective* sound speed
(sound speed + wind component along track). If any layer between the aircraft and
the ground is "faster" than that, the ray turns back up before reaching the ground:
that is Mach cutoff.

    V_ground = M * c(z_a) + w(z_a)
    cutoff   <=>  max_{ground <= z < z_a} [ c(z) + w(z) ] >= V_ground
    M_max    =   ( max_{ground <= z <= z_a}[ c(z) + w(z) ] - w(z_a) ) / c(z_a)

c = sqrt(gamma R T); w = wind component along the direction of travel (+ = tailwind).
Including the cruise point itself makes M_max >= 1 by construction (at exactly Mach 1
the ray is grazing). Ray acoustics, horizontally uniform layers, no humidity term
(< 0.5 % on c), no diffraction.

Flight levels are pressure altitudes (ISA), so the cruise pressure is a single scalar
for the whole globe and interpolation is done in ln(p).
"""
import numpy as np

GAMMA = 1.4
R_AIR = 287.05
FT = 0.3048


def sound_speed(T):
    return np.sqrt(GAMMA * R_AIR * T)


def isa_pressure_hpa(h_m):
    """ISA pressure (hPa) at pressure altitude h_m (valid to 20 km)."""
    h_m = np.asarray(h_m, dtype=float)
    tropo = 1013.25 * (1.0 - 2.25577e-5 * h_m) ** 5.25588
    strato = 226.32 * np.exp(-(h_m - 11000.0) / 6341.62)
    return np.where(h_m < 11000.0, tropo, strato)


def cruise_interp(plev, p_a):
    """Return (k, wk) so that X(p_a) = (1-wk)*X[k] + wk*X[k+1] in ln p.
    plev is descending (1000 -> 50 hPa); requires plev[k] >= p_a >= plev[k+1]."""
    plev = np.asarray(plev, dtype=float)
    k = int(np.searchsorted(-plev, -p_a, side="right") - 1)
    k = min(max(k, 0), len(plev) - 2)
    wk = (np.log(plev[k]) - np.log(p_a)) / (np.log(plev[k]) - np.log(plev[k + 1]))
    return k, float(wk)


def mmax_grid(plev, T, U, V, Z, Zs, Ts, Us, Vs, fl_ft, headings_deg):
    """
    plev: (L,) hPa descending. T,U,V,Z: (L, ny, nx) on pressure levels (Z = geopotential height, m).
    Zs, Ts, Us, Vs: (ny, nx) surface height, 2 m temperature, 10 m wind.
    Returns M (H, ny, nx) for each heading, and c_a (ny, nx) sound speed at cruise.
    Levels below the terrain (Z <= Zs) are ignored, which accounts for mountains.
    """
    p_a = float(isa_pressure_hpa(fl_ft * 100 * FT))
    k, wk = cruise_interp(plev, p_a)
    Ta = (1 - wk) * T[k] + wk * T[k + 1]
    Ua = (1 - wk) * U[k] + wk * U[k + 1]
    Va = (1 - wk) * V[k] + wk * V[k + 1]
    ca = sound_speed(Ta)

    below = np.asarray(plev) > p_a                      # levels under the aircraft
    Tb, Ub, Vb, Zb = T[below], U[below], V[below], Z[below]
    valid = Zb > Zs[None]                               # above ground
    cb = sound_speed(Tb)
    cs = sound_speed(Ts)

    out = np.empty((len(headings_deg),) + Ta.shape, dtype=np.float32)
    for i, hd in enumerate(headings_deg):
        s, co = np.sin(np.radians(hd)), np.cos(np.radians(hd))
        wb = Ub * s + Vb * co
        ceff_b = np.where(valid, cb + wb, -np.inf).max(axis=0)
        ceff_s = cs + (Us * s + Vs * co)
        wa = Ua * s + Va * co
        ceff_max = np.maximum(np.maximum(ceff_b, ceff_s), ca + wa)
        out[i] = (ceff_max - wa) / ca
    return out, ca
