"""
How far sound carries (issue #60): where the lowest 1.5 km of the forecast atmosphere bends sound from a source on
the ground back down to the ground, so a blast, a boom, fireworks or an engine run is heard much farther than usual.

Physics (geometric acoustics, as rays.py): sound travelling toward azimuth phi moves at the effective sound speed
    c_eff(z, phi) = c(z) + u(z) sin(phi) + v(z) cos(phi)
and a ray bends toward the slower air. When c_eff somewhere above the source is faster than at the ground (a
temperature inversion, wind blowing the way the sound goes, or both) every ray leaving the ground below the
critical elevation
    theta_c(phi) = arccos( c_eff(0, phi) / max_{0 < h <= 1.5 km} c_eff(h, phi) )
turns back to the ground instead of escaping upward: the sound is trapped in a duct along the ground and fades
slowly with distance. theta_c = 0 means the air bends sound upward (a sunny afternoon, upwind): beyond a shadow
zone a few hundred metres to a couple of km away it is much quieter. The larger theta_c, the more of the sound
is trapped. Standard references: Embleton (1996) J. Acoust. Soc. Am. 100, 31; Salomons, Computational Atmospheric
Acoustics (2001); ISO 9613-2 "favourable propagation" (downwind or moderate ground inversion).

Data: GFS 2 m temperature, 10 m and 80 m wind and 80 m temperature, then the pressure levels whose height above the
ground is 100-1500 m. 1-degree grid: a regional estimate; valleys, sea breezes and city heat are not resolved.

Output per forecast hour: carry_f{HHH}.png, a 6 x 2 atlas of 360 x 181 tiles (lon -180..179, lat 90..-90):
    tiles 0-7 : theta_c toward 0, 45, ..., 315 deg (the direction the sound travels), byte = theta_c / 0.1 deg
    tile 8    : the smallest over the 8 directions (all around the source)
    tile 9    : the largest (the best direction for the sound)
    tiles 10-11: the mean wind of the band (10 m, 80 m and the levels up to 1.5 km), east and north components,
                 byte = 128 + wind / 0.5 m/s (for the page's wind streaks; zero where unknown)
"""
import numpy as np

GAMMA_R = 1.4 * 287.05
H_TOP = 1500.0
DIRS = list(range(0, 360, 45))
STEP_DEG = 0.1
COLS, ROWS = 6, 2
WIND_STEP, WIND_ZERO = 0.5, 128
WANT = {("TMP", "2 m above ground"), ("UGRD", "10 m above ground"), ("VGRD", "10 m above ground"),
        ("TMP", "80 m above ground"), ("UGRD", "80 m above ground"), ("VGRD", "80 m above ground")}
# levels for the page, by theta_c: 2 deg ~ 0.2 m/s faster aloft, 5 deg ~ 1.3 m/s, 9 deg ~ 4.2 m/s (c (1 - cos theta))
LEVELS = [(0.0, "bends up: fades fast"), (2.0, "a little farther than usual"),
          (5.0, "carries far"), (9.0, "carries very far")]


def c_of(T):
    return np.sqrt(GAMMA_R * np.asarray(T, np.float64))


def theta_c(c_ground, u_ground, v_ground, layers, dirs=DIRS):
    """c_ground/u/v: arrays (...). layers: list of (c, u, v, valid) arrays at heights inside (0, H_TOP] (valid: bool
    mask of where that layer is inside the band). Returns (len(dirs), ...) critical angles in degrees."""
    out = []
    for phi in dirs:
        s, co = np.sin(np.radians(phi)), np.cos(np.radians(phi))
        e0 = c_ground + u_ground * s + v_ground * co
        best = np.array(e0, copy=True)
        for c, u, v, ok in layers:
            e = c + u * s + v * co
            best = np.where(ok & (e > best), e, best)
        with np.errstate(invalid="ignore"):
            th = np.degrees(np.arccos(np.clip(e0 / best, -1.0, 1.0)))
        out.append(np.where(best > e0, th, 0.0))
    return np.stack(out)


def carry_grid(zg, Fs, plev, T, U, V, Z):
    """zg: ground height (ny, nx). Fs: near-surface fields {key: (ny, nx)} (WANT). plev/T/U/V/Z: pressure levels.
    Returns theta (8, ny, nx) degrees, or None if the near-surface fields are missing."""
    if any(k not in Fs for k in (("TMP", "2 m above ground"), ("UGRD", "10 m above ground"), ("VGRD", "10 m above ground"))):
        return None
    c0 = c_of(Fs[("TMP", "2 m above ground")])
    u0, v0 = Fs[("UGRD", "10 m above ground")], Fs[("VGRD", "10 m above ground")]
    layers = []
    if all(k in Fs for k in (("TMP", "80 m above ground"), ("UGRD", "80 m above ground"), ("VGRD", "80 m above ground"))):
        layers.append((c_of(Fs[("TMP", "80 m above ground")]), Fs[("UGRD", "80 m above ground")], Fs[("VGRD", "80 m above ground")],
                       np.ones_like(c0, bool)))
    for k in range(len(plev)):
        h = Z[k] - zg
        ok = (h > 100.0) & (h <= H_TOP)
        if ok.any():
            layers.append((c_of(T[k]), U[k], V[k], ok))
    return theta_c(c0, u0, v0, layers)


def band_wind(zg, Fs, plev, U, V, Z):
    """Mean wind (u, v) in m/s over the near-surface band: 10 m, 80 m and the pressure levels 100-1500 m above the
    ground, each counted once. None if the 10 m wind is missing."""
    if ("UGRD", "10 m above ground") not in Fs or ("VGRD", "10 m above ground") not in Fs:
        return None
    su = np.array(Fs[("UGRD", "10 m above ground")], np.float64); sv = np.array(Fs[("VGRD", "10 m above ground")], np.float64)
    n = np.ones_like(su)
    if ("UGRD", "80 m above ground") in Fs and ("VGRD", "80 m above ground") in Fs:
        su += Fs[("UGRD", "80 m above ground")]; sv += Fs[("VGRD", "80 m above ground")]; n += 1
    for k in range(len(plev)):
        ok = (Z[k] - zg > 100.0) & (Z[k] - zg <= H_TOP)
        su += np.where(ok, U[k], 0.0); sv += np.where(ok, V[k], 0.0); n += ok
    return su / n, sv / n


def encode_wind(w):
    return np.clip(np.round(np.asarray(w) / WIND_STEP) + WIND_ZERO, 0, 255).astype(np.uint8)


def encode(theta):
    return np.clip(np.round(theta / STEP_DEG), 0, 255).astype(np.uint8)


def atlas(theta, to_display, wind=None):
    """theta (8, ny, nx) -> uint8 atlas (ROWS*ny, COLS*nx), display longitude order. wind: (u, v) or None (calm)."""
    ny, nx = theta.shape[1:]
    tiles = [encode(to_display(t)) for t in theta] + [encode(to_display(theta.min(0))), encode(to_display(theta.max(0)))]
    calm = np.zeros((ny, nx))
    tiles += [encode_wind(to_display(w)) for w in (wind if wind is not None else (calm, calm))]
    a = np.zeros((ROWS * ny, COLS * nx), np.uint8)
    for i, t in enumerate(tiles):
        r, c = divmod(i, COLS)
        a[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = t
    return a


def summary(theta, land, lat):
    """Share of land (60S-75N) by level, all-around and best direction, for the page's summary strip."""
    m = (land > 0.5) & (lat > -60) & (lat < 75)
    w = np.cos(np.radians(lat))[m]
    out = {}
    for name, t in (("all_around", theta.min(0)), ("best_dir", theta.max(0))):
        v = t[m]
        out[name] = {"median": round(float(np.median(v)), 2), "p90": round(float(np.quantile(v, 0.9)), 2),
                     "share_ge": {str(lo): round(float(w[v >= lo].sum() / w.sum()), 4) for lo, _ in LEVELS[1:]}}
    return out
