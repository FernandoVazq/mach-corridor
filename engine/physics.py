"""
Mach cutoff physics on gridded atmospheric profiles  (v2, after red-team review 2026-10-09).

Intuition
---------
A sonic-boom ray launched downward keeps travelling down only while the aircraft is
"faster" than the local effective sound speed (sound speed + wind along the ray's
horizontal direction). If a layer below the aircraft is faster, the ray turns back up
(Mach cutoff). The turning point is a caustic (focused boom), so it must sit well ABOVE
the ground, not merely above it.

Ray invariant (stratified atmosphere, Snell): for a wavefront whose horizontal normal
points at angle alpha off the flight track, the ray turns where
        c(z) + w(z)·e(alpha)  >=  M c_a cos(alpha) + w_a·e(alpha)
so the largest Mach for which that ray never descends below the floor z_f is
        M_alpha = ( max_{z_f <= z < z_a} [c + w·e(alpha)] - w_a·e(alpha) ) / (c_a cos alpha)
alpha = 0 is the classic on-track ray. Rays leave the Mach cone with
|tan alpha| <= sqrt(M^2 - 1), so the boomless Mach is the largest M with
M <= M_alpha for every attainable alpha (solved greedily, |alpha| increasing).

v2 changes vs v1:
  * floor z_f = (highest terrain nearby) + h_buf  (v1: smoothed terrain, 0 buffer)
  * surface 2 m / 10 m point no longer counts as a refracting layer
  * no M >= 1 floor: if nothing below is faster, the result is < 1 (no corridor)
  * lateral rays with crosswind (alpha != 0)
  * virtual temperature (humidity) in the speed of sound
Flight levels are ISA pressure altitudes, interpolated in ln(p).
"""
import numpy as np

GAMMA = 1.4
R_AIR = 287.05
FT = 0.3048
H_BUF_DEFAULT = 1000.0                     # m above highest nearby terrain (placeholder; calibrate w/ NASA FaINT)
ALPHAS = (7.5, 15.0, 22.5, 30.0, 37.5, 45.0, 52.5, 60.0)   # lateral ray directions (deg), +/- each; |alpha| <= acos(1/M) is enforced below
DIR_STEP = 2.5                             # absolute-direction grid (deg)


def sound_speed(T):
    return np.sqrt(GAMMA * R_AIR * T)


def virtual_temperature(T, rh, p_hpa):
    """T (K), rh (%), p (hPa) -> Tv (K). Bolton saturation vapour pressure over water."""
    es = 6.112 * np.exp(17.67 * (T - 273.15) / (T - 29.65))
    e = np.clip(rh, 0, 100) / 100.0 * es
    q = 0.622 * e / np.maximum(p_hpa - 0.378 * e, 1.0)
    return T * (1.0 + 0.608 * q)


def isa_pressure_hpa(h_m):
    """ISA pressure (hPa) at pressure altitude h_m (valid to 20 km)."""
    h_m = np.asarray(h_m, dtype=float)
    tropo = 1013.25 * (1.0 - 2.25577e-5 * h_m) ** 5.25588
    strato = 226.32 * np.exp(-(h_m - 11000.0) / 6341.62)
    return np.where(h_m < 11000.0, tropo, strato)


def cruise_interp(plev, p_a):
    """(k, wk): X(p_a) = (1-wk) X[k] + wk X[k+1] in ln p; plev descending."""
    plev = np.asarray(plev, dtype=float)
    k = int(np.searchsorted(-plev, -p_a, side="right") - 1)
    k = min(max(k, 0), len(plev) - 2)
    wk = (np.log(plev[k]) - np.log(p_a)) / (np.log(plev[k]) - np.log(plev[k + 1]))
    return k, float(wk)


SIGNAL_M = 150.0         # boom signal length, SST-class (Carlson duration ~0.3-0.35 s x 340 m/s; aircraft_study.py)
G_MIN = 5e-4             # |dV_P/dz| floor (1/s): caps the safe height at ~1.3 km in near-neutral layers


def haglund_buffer(plev, T, U, V, Z, Zground, RH=None, L=SIGNAL_M, z0=500.0, z1=2000.0, per_direction=False):
    """Safe cutoff height (Haglund, NASA CR-2417; used in FaINT): dZ_S = R^(1/3) L^(2/3), R = c / |dV_P/dz|,
    V_P = c + w.e for ray direction e, gradient over [ground + z0, ground + z1] (where a caustic at the floor
    sits). Where V_P does not fall with height the caustic is aloft and the cap (G_MIN) applies.
    per_direction=True -> {direction deg: (ny, nx)}; else the worst direction per column (ny, nx), metres."""
    plev = np.asarray(plev, dtype=np.float32)
    if RH is not None:
        T = virtual_temperature(T, RH, plev[:, None, None])
    c = sound_speed(T).astype(np.float32)
    L_ = len(plev)
    take = lambda X, i: np.take_along_axis(X, i[None], axis=0)[0]

    def at(zq):
        idx = (Z <= zq[None]).sum(axis=0)
        hi, lo = np.clip(idx, 0, L_ - 1), np.clip(idx - 1, 0, L_ - 1)
        Zlo, Zhi = take(Z, lo), take(Z, hi)
        f = np.where(Zhi > Zlo, (zq - Zlo) / np.maximum(Zhi - Zlo, 1e-3), 0.0).clip(0, 1)
        return [(1 - f) * take(X, lo) + f * take(X, hi) for X in (c, U, V)]

    zg = np.asarray(Zground, np.float32)
    (c0, u0, v0), (c1, u1, v1) = at(zg + z0), at(zg + z1)
    out, gmin = {}, np.full(zg.shape, np.inf, np.float32)
    for d in np.arange(0, 360, DIR_STEP):
        s, co = np.sin(np.radians(d)), np.cos(np.radians(d))
        g = np.maximum(-((c1 + u1 * s + v1 * co) - (c0 + u0 * s + v0 * co)) / (z1 - z0), G_MIN)  # V_P falling -> -g > 0
        out[float(d)] = ((c0 / g) ** (1 / 3) * L ** (2 / 3)).astype(np.float32)
        gmin = np.minimum(gmin, g)
    return out if per_direction else (c0 / gmin) ** (1 / 3) * L ** (2 / 3)


def mmax_grid(plev, T, U, V, Z, Zground, fl_ft, headings_deg, RH=None,
              h_buf=H_BUF_DEFAULT, alphas=ALPHAS, lateral=True):
    """
    plev (L,) hPa descending; T,U,V,Z[,RH] (L,ny,nx) on pressure levels (Z geopotential m).
    Zground (ny,nx): terrain height to protect (use the max over the boom footprint).
    h_buf: metres above Zground the turning point must stay (number or (ny,nx) array), or "haglund"
    for the computed safe cutoff height per column (haglund_buffer).
    Returns dict: M (H,ny,nx) boomless Mach per direction of travel (NaN = no layer
    available between floor and cruise), c_a, U_a, V_a, z_floor, z_cruise, h_buf.
    """
    per_dir = None
    if isinstance(h_buf, str) and h_buf == "haglund":
        per_dir = haglund_buffer(plev, T, U, V, Z, Zground, RH=RH, per_direction=True)
        h_buf = np.median(np.stack(list(per_dir.values())), axis=0)         # reported only
    plev = np.asarray(plev, dtype=np.float32)
    L = len(plev)
    if RH is not None:
        T = virtual_temperature(T, RH, plev[:, None, None])
    c = sound_speed(T).astype(np.float32)

    p_a = float(isa_pressure_hpa(fl_ft * 100 * FT))
    k, wk = cruise_interp(plev, p_a)
    lerp = lambda X: (1 - wk) * X[k] + wk * X[k + 1]
    ca, Ua, Va, za = lerp(c), lerp(U), lerp(V), lerp(Z)

    below = (plev > p_a)[:, None, None]
    take = lambda X, i: np.take_along_axis(X, i[None], axis=0)[0]

    def floor_at(zf):
        """levels strictly between floor and cruise, and c, U, V at the floor itself (linear in z)"""
        valid = below & (Z > zf[None])
        idx = (Z <= zf[None]).sum(axis=0)                   # first level above floor
        hi, lo = np.clip(idx, 0, L - 1), np.clip(idx - 1, 0, L - 1)
        Zlo, Zhi = take(Z, lo), take(Z, hi)
        f = np.where(Zhi > Zlo, (zf - Zlo) / np.maximum(Zhi - Zlo, 1e-3), 0.0).clip(0, 1)
        flo = lambda X: (1 - f) * take(X, lo) + f * take(X, hi)
        return valid, flo(c), flo(U), flo(V), zf < za

    zf = (Zground + h_buf).astype(np.float32)
    fixed = None if per_dir else floor_at(zf)

    # effective sound speed maxima for every absolute direction on a DIR_STEP grid
    dirs = np.arange(0, 360, DIR_STEP)
    F = {}
    Wa = {}
    for d in dirs:
        s, co = np.float32(np.sin(np.radians(d))), np.float32(np.cos(np.radians(d)))
        valid, cf, Uf, Vf, floor_ok = fixed or floor_at((Zground + per_dir[float(d)]).astype(np.float32))
        ce = np.where(valid, c + U * s + V * co, -np.inf).max(axis=0)
        ce = np.maximum(ce, np.where(floor_ok, cf + Uf * s + Vf * co, -np.inf))
        F[d] = ce
        Wa[d] = Ua * s + Va * co
    key = lambda a: float(np.round(((a % 360) / DIR_STEP)) * DIR_STEP % 360)

    out = np.empty((len(headings_deg),) + ca.shape, dtype=np.float32)
    for i, hd in enumerate(headings_deg):
        d0 = key(hd)
        M = (F[d0] - Wa[d0]) / ca
        if lateral:
            for a in alphas:
                ta = np.tan(np.radians(a))
                ok = ta <= np.sqrt(np.maximum(M * M - 1.0, 0.0))
                for sgn in (1, -1):
                    d = key(hd + sgn * a)
                    Ma = (F[d] - Wa[d]) / (ca * np.cos(np.radians(a)))
                    M = np.where(ok, np.minimum(M, Ma), M)
        M = np.where(np.isfinite(M), M, np.nan)
        out[i] = M
    return {"M": out, "c_a": ca, "U_a": Ua, "V_a": Va, "z_floor": zf, "z_cruise": za, "h_buf": h_buf}


def footprint_max(orog_q, radius_cells=2):
    """Max of a 0.25-deg field over +/- radius_cells, then sampled at 1-deg points.
    orog_q: (721,1440) lat 90..-90, lon 0..359.75 -> (181,360)."""
    m = orog_q.copy()
    for di in range(-radius_cells, radius_cells + 1):
        for dj in range(-radius_cells, radius_cells + 1):
            if di == 0 and dj == 0:
                continue
            sh = np.roll(orog_q, dj, axis=1)
            if di > 0:
                sh = np.vstack([sh[di:], np.repeat(sh[-1:], di, axis=0)])
            elif di < 0:
                sh = np.vstack([np.repeat(sh[:1], -di, axis=0), sh[:di]])
            m = np.maximum(m, sh)
    return m[::4, ::4]
