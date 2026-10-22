"""
Rocket sonic booms (issue #50): where the boom of a launch or a booster landing reaches the ground, and roughly how
loud, through the forecast atmosphere at launch time.

Physics: the same Hamiltonian ray acoustics as rays.py, generalised to a vehicle that climbs or falls. A vehicle at
air-relative Mach M with velocity direction v (heading psi, flight-path angle gamma, + up) radiates shock-front normals
on the cone  n . v = cos(theta_n) = 1/M.  Only normals that point down can reach the ground; a rocket climbing
steeper than theta_n = acos(1/M) sends nothing down, which is why ascent booms start late and land far downrange.
Each normal is traced (RK4, rays._rhs) through c(z), u(z), v(z) until it hits the ground or turns back up (refraction:
the atmosphere's version of Mach cutoff). The live atmosphere moves the edges of the boom carpet; that is the part a
fixed-atmosphere prediction cannot give.

Loudness (v0, an estimate): far-field N-wave scaling in the form of Carlson (NASA TP-1122),
    dp_ground = K_v sqrt(p_v p_g) (M^2 - 1)^(1/8) s^(-3/4),
with s the ray path length (slant distance, not height) and K_v one constant per vehicle and phase that absorbs body
length, shape factor and reflection. K_v is calibrated to published measurements (see CAL below and docs/METHOD.md);
the spread of those measurements, about a factor of 2, is the stated uncertainty. Focus booms (caustics from pitch-over
or deceleration) can be several times louder in a narrow strip and are flagged, not computed.

Trajectories are generic shapes of public flights (altitude, Mach and flight-path angle against time), not the
operator's plan for a given mission. The launch azimuth comes from the site and the orbit; the booster comes back
along the site's usual approach. Both are stated on the page.
"""
import argparse, datetime as dt, json, math, os, sys
import numpy as np

from rays import Profile, _rhs
from secondary import column_grid, std_T

PSF = 47.880258
R_E = 6371000.0
G_RAD = 287.05

# ---------------------------------------------------------------- sites (pad, landing zone, usual directions, towns)
SITES = {
    "cape": {
        "name": "Cape Canaveral and Kennedy, Florida", "short": "Cape Canaveral", "lat": 28.56, "lon": -80.58,
        "tz": "America/New_York", "lz": (28.49, -80.54), "booster_from_deg": 90.0,
        "ascent_az": {"default": 60.0, "SSO": 160.0, "Polar": 160.0, "GTO": 95.0, "GEO": 95.0, "MEO": 70.0, "LEO": 50.0},
        "towns": [("Cape Canaveral", 28.405, -80.605), ("Cocoa Beach", 28.320, -80.608), ("Merritt Island", 28.359, -80.682),
                  ("Titusville", 28.612, -80.808), ("Port St. John", 28.477, -80.789), ("Rockledge", 28.350, -80.725),
                  ("Cocoa", 28.386, -80.742), ("Satellite Beach", 28.176, -80.590), ("Melbourne", 28.084, -80.608),
                  ("Palm Bay", 28.034, -80.589), ("New Smyrna Beach", 29.026, -80.927), ("Daytona Beach", 29.211, -81.023),
                  ("Orlando", 28.538, -81.379), ("Sanford", 28.800, -81.273), ("Vero Beach", 27.638, -80.398)]},
    "vandenberg": {
        "name": "Vandenberg Space Force Base, California", "short": "Vandenberg", "lat": 34.632, "lon": -120.611,
        "tz": "America/Los_Angeles", "lz": (34.633, -120.615), "booster_from_deg": 235.0,
        "ascent_az": {"default": 190.0, "SSO": 195.0, "Polar": 185.0, "LEO": 160.0},
        "towns": [("Lompoc", 34.639, -120.458), ("Vandenberg Village", 34.708, -120.467), ("Santa Maria", 34.953, -120.436),
                  ("Orcutt", 34.865, -120.436), ("Guadalupe", 34.972, -120.572), ("Buellton", 34.614, -120.193),
                  ("Solvang", 34.596, -120.138), ("Santa Ynez", 34.612, -120.080), ("Goleta", 34.436, -119.827),
                  ("Santa Barbara", 34.420, -119.698), ("Carpinteria", 34.399, -119.518), ("Ventura", 34.275, -119.229),
                  ("Oxnard", 34.198, -119.177), ("Pismo Beach", 35.143, -120.641), ("San Luis Obispo", 35.283, -120.660)]},
    "starbase": {
        "name": "Starbase, Texas", "short": "Starbase", "lat": 25.997, "lon": -97.157,
        "tz": "America/Chicago", "lz": (25.997, -97.157), "booster_from_deg": 95.0,
        "ascent_az": {"default": 97.0},
        "towns": [("Starbase / Boca Chica", 25.990, -97.185), ("Port Isabel", 26.073, -97.208), ("South Padre Island", 26.111, -97.168),
                  ("Laguna Vista", 26.101, -97.290), ("Brownsville", 25.901, -97.497), ("Los Fresnos", 26.072, -97.476),
                  ("Matamoros", 25.869, -97.502), ("Harlingen", 26.190, -97.696), ("San Benito", 26.133, -97.631),
                  ("Port Mansfield", 26.554, -97.426)]},
}

# ---------------------------------------------------------------- generic trajectories
# ascent: (t s, altitude km, downrange km, Mach, flight-path angle deg up)
ASCENT = {
    "falcon9": [(60, 8.0, 1.5, 0.85, 75), (70, 11.0, 3.0, 1.05, 68), (85, 17.0, 7.0, 1.6, 60), (100, 24.0, 13.0, 2.3, 52),
                (120, 35.0, 25.0, 3.4, 45), (140, 48.0, 42.0, 4.8, 38), (155, 60.0, 60.0, 6.0, 33)],
    "superheavy": [(55, 7.0, 1.0, 0.8, 78), (68, 11.0, 2.5, 1.05, 70), (85, 18.0, 7.0, 1.7, 60), (105, 28.0, 16.0, 2.7, 50),
                   (130, 42.0, 34.0, 4.0, 40), (155, 60.0, 62.0, 5.2, 32)],
}
# booster return: (t s before touchdown, altitude km, distance to the landing zone km, Mach, flight-path angle deg, - down)
DESCENT = {
    "falcon9": [(130, 50.0, 30.0, 4.0, -60), (115, 40.0, 24.0, 3.6, -62), (100, 30.0, 18.0, 3.0, -65), (80, 20.0, 12.0, 2.3, -70),
                (60, 12.0, 7.0, 1.7, -75), (45, 7.0, 4.0, 1.2, -80), (35, 4.0, 2.0, 0.95, -85)],
    "superheavy": [(150, 50.0, 35.0, 3.8, -58), (130, 40.0, 28.0, 3.4, -60), (110, 30.0, 21.0, 2.8, -63), (85, 20.0, 13.0, 2.1, -68),
                   (62, 12.0, 7.0, 1.5, -74), (48, 7.0, 3.5, 1.1, -80), (38, 4.0, 1.5, 0.9, -85)],
}
LANDING_T = {"falcon9": 470.0, "superheavy": 410.0}   # touchdown / catch, seconds after liftoff (typical public flights)
Z_EMIT_MAX = 45000.0       # above this the air is too thin for an audible boom (p_v^1/2 < 0.1 of sea level)

# K_v: one constant per vehicle and phase (absorbs body/plume length, shape factor and ground reflection).
# Descent, fitted to MEASURED booms (standard atmosphere, median of rays within 3 km of the station):
#   Falcon 9 / Falcon Heavy side booster at LZ-1/2 (FAA Final EA, SpaceX Falcon program, appendices, Table 1):
#     1.59/1.71 psf at LC-40 (8.9 km), 1.40/1.44 psf at LC-39A (15.1 km); 5.19/5.54 psf at 0.45 km (near field)
#     -> K = 1.84 and 2.29 at the two far stations; 2.05 used.
#   Super Heavy, Flight 5 (Gee et al., JASA Express Letters 4, 113601, 2024): 7.1 psf at 10.5 km, "over 10 psf at
#     10 km"; FAA tiered EA: about 10 psf at Port Isabel, 4 psf in eastern Brownsville -> K about 11-13; 12 used.
# Ascent: no published psf measured on land for these vehicles. Falcon 9 set so the carpet sits near 2 psf, under the
# 3.0 psf peak the Vandenberg EA (2018) predicts on the Channel Islands and the 4.6 psf the FAA gives offshore at the
# Cape (those peaks include focus booms, not modelled here). Super Heavy ascent scaled by the descent ratio 12/2.05:
# UNVALIDATED, and its carpet is far out over the Gulf.
K_V = {("falcon9", "descent"): 2.05, ("superheavy", "descent"): 12.0,
       ("falcon9", "ascent"): 40.0, ("superheavy", "ascent"): 234.0}
# measured points the model must reproduce within a factor of 2 (test_rocket.py):
# (name, site, vehicle, phase, (lat, lon) of the station, measured psf, allowed factor)
CAL = [("Falcon Heavy side boosters at LC-40, 8.9 km", "cape", "falcon9", "descent", (28.5618, -80.5772), 1.65, 2.0),
       ("Falcon Heavy side boosters at LC-39A, 15.1 km", "cape", "falcon9", "descent", (28.6082, -80.6041), 1.42, 2.0),
       ("Super Heavy Flight 5, about 10 km north (Port Isabel)", "starbase", "superheavy", "descent", (26.073, -97.208), 8.0, 2.0)]


def interp_traj(rows, dt_s=2.0):
    a = np.array(rows, float)
    t = np.arange(a[0, 0], a[-1, 0] + 1e-9, dt_s) if a[0, 0] < a[-1, 0] else np.arange(a[0, 0], a[-1, 0] - 1e-9, -dt_s)
    order = np.argsort(a[:, 0])
    return t, [np.interp(t, a[order, 0], a[order, k]) for k in range(1, a.shape[1])]


def profile_from_column(col=None):
    """Column {'z','T','u','v'} (any order, m / K / m s-1) -> Profile to 70 km (standard-atmosphere shape above the top).
    None -> US Standard Atmosphere, no wind."""
    if col is None:
        z = np.array([0.0, 70000.0]); T = std_T(z); u = v = np.zeros(2)
        Z, Tt, U, V = z[:, None], T[:, None], u[:, None], v[:, None]
    else:
        Z = np.asarray(col["z"], float)[:, None]; Tt = np.asarray(col["T"], float)[:, None]
        U = np.asarray(col["u"], float)[:, None]; V = np.asarray(col["v"], float)[:, None]
    c, u, v = column_grid(Z, Tt, U, V)
    from secondary import ZG
    return Profile(ZG, c[:, 0], u[:, 0], v[:, 0])


_trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")


def pressure(z, prof_T=None):
    """Hydrostatic pressure (Pa) of the standard atmosphere (enough for the sqrt(p_v p_g) factor)."""
    zz = np.arange(0.0, max(z, 0.0) + 250.0, 250.0)
    T = std_T(zz)
    return float(101325.0 * math.exp(-_trapz(9.80665 / (G_RAD * T), zz)))


def cone_normals(M, psi_deg, gamma_deg, n_phi=72):
    """Unit shock-front normals on the Mach cone of a vehicle with heading psi (deg from north) and flight-path angle
    gamma (deg, + up). Returns (n_phi, 3) array (east, north, up) and a mask of those pointing down."""
    ps, gm = math.radians(psi_deg), math.radians(gamma_deg)
    v = np.array([math.sin(ps) * math.cos(gm), math.cos(ps) * math.cos(gm), math.sin(gm)])
    a = np.array([0.0, 0.0, 1.0]) if abs(v[2]) < 0.95 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(v, a); e1 /= np.linalg.norm(e1); e2 = np.cross(v, e1)
    ct = 1.0 / M; st = math.sqrt(max(0.0, 1.0 - ct * ct))
    phi = np.linspace(0.0, 2 * math.pi, n_phi, endpoint=False)
    n = ct * v[None, :] + st * (np.cos(phi)[:, None] * e1[None, :] + np.sin(phi)[:, None] * e2[None, :])
    return n, n[:, 2] < -1e-3


def trace_normal(prof, z0, n, dt=0.5, t_max=900.0, z_floor=0.0):
    """One ray (kept for tests): see trace_many."""
    r = trace_many(prof, z0, np.asarray(n, float)[None, :], dt, t_max, z_floor)
    return bool(r[0][0]), float(r[1][0]), float(r[2][0]), float(r[3][0]), float(r[4][0])


def _tables(prof):
    if getattr(prof, "_tab", None) is None:
        z = prof.z
        prof._tab = (z, prof.c, prof.u, prof.v, np.gradient(prof.c, z), np.gradient(prof.u, z), np.gradient(prof.v, z))
    return prof._tab


def trace_many(prof, z0, N, dt=0.5, t_max=900.0, z_floor=0.0):
    """All rays from height z0 with wavenumber directions N (n, 3) at once (RK4, same equations as rays._rhs, with
    piecewise-linear profiles). A ray stops at the floor (hit) or once it has turned and climbed back to z0.
    Returns (hit, x, y, t, path_length) arrays."""
    z, cT, uT, vT, dcT, duT, dvT = _tables(prof)

    def rhs(S):
        zz = S[:, 2]
        c = np.interp(zz, z, cT); u = np.interp(zz, z, uT); v = np.interp(zz, z, vT)
        i = np.clip(np.searchsorted(z, zz) - 1, 0, len(z) - 2)
        dc = (cT[i + 1] - cT[i]) / (z[i + 1] - z[i]); du = (uT[i + 1] - uT[i]) / (z[i + 1] - z[i]); dv = (vT[i + 1] - vT[i]) / (z[i + 1] - z[i])
        kx, ky, kz = S[:, 3], S[:, 4], S[:, 5]
        K = np.sqrt(kx * kx + ky * ky + kz * kz)
        return np.stack([c * kx / K + u, c * ky / K + v, c * kz / K, 0 * K, 0 * K, -(dc * K + du * kx + dv * ky)], 1)

    m = len(N)
    S = np.zeros((m, 6)); S[:, 2] = z0; S[:, 3:] = N
    hit = np.zeros(m, bool); done = np.zeros(m, bool)
    T = np.zeros(m); L = np.zeros(m); X = np.zeros(m); Y = np.zeros(m)
    t = 0.0
    while t < t_max and not done.all():
        a = ~done
        s = S[a]
        k1 = rhs(s); k2 = rhs(s + 0.5 * dt * k1); k3 = rhs(s + 0.5 * dt * k2); k4 = rhs(s + dt * k3)
        nx = s + dt / 6.0 * (k1 + 2 * k2 + 2 * k3 + k4)
        step = np.linalg.norm(nx[:, :3] - s[:, :3], axis=1)
        ground = nx[:, 2] <= z_floor
        f = np.where(ground, (s[:, 2] - z_floor) / np.maximum(s[:, 2] - nx[:, 2], 1e-9), 1.0)
        nx = np.where(ground[:, None], s + f[:, None] * (nx - s), nx)
        idx = np.where(a)[0]
        L[idx] += step * f; T[idx] = t + f * dt
        S[idx] = nx
        up = (nx[:, 5] > 0) & (nx[:, 2] >= z0)
        hit[idx[ground]] = True
        done[idx[ground | up]] = True
        t += dt
    return hit, S[:, 0], S[:, 1], T, L


def offset_ll(lat0, lon0, x, y):
    return lat0 + y / 111320.0, lon0 + x / (111320.0 * math.cos(math.radians(lat0)))


def bearing_xy(brg_deg, d_m):
    b = math.radians(brg_deg)
    return d_m * math.sin(b), d_m * math.cos(b)


def scenario(site_key, vehicle, phase, prof, azimuth=None, n_phi=72, dt_emit=2.0, p_g=101325.0):
    """Trace one launch ascent or booster return. Returns dict with ground hits [(lat, lon, psf, t_s)], the emission
    track and parameters. t_s: seconds after liftoff (descent: typical touchdown time minus time before touchdown)."""
    S = SITES[site_key]
    hits, track = [], []
    if phase == "ascent":
        az = S["ascent_az"]["default"] if azimuth is None else azimuth
        t, (alt, dr, M, gam) = interp_traj(ASCENT[vehicle], dt_emit)
        lat0, lon0 = S["lat"], S["lon"]
        for i in range(len(t)):
            x, y = bearing_xy(az, dr[i] * 1000.0)
            track.append((t[i], alt[i] * 1000.0, x, y, M[i], az, gam[i]))
    else:
        az = S["booster_from_deg"] if azimuth is None else azimuth            # bearing from the LZ to the booster
        t, (alt, dist, M, gam) = interp_traj(DESCENT[vehicle], dt_emit)
        lat0, lon0 = S["lz"]
        for i in range(len(t)):
            x, y = bearing_xy(az, dist[i] * 1000.0)
            track.append((LANDING_T[vehicle] - t[i], alt[i] * 1000.0, x, y, M[i], (az + 180.0) % 360.0, gam[i]))
    K = K_V[(vehicle, phase)]
    for (te, z, x0, y0, M, psi, gam) in track:
        if M <= 1.02 or z > Z_EMIT_MAX or z < 500.0:
            continue
        c, u, v = prof(z)[:3]
        Ma = M                                   # trajectories give Mach relative to the air
        n, down = cone_normals(Ma, psi, gam, n_phi)
        p_v = pressure(z)
        hit, xs, ys, trs, Ls = trace_many(prof, z, n[down])
        for x, y, tr, L in zip(xs[hit], ys[hit], trs[hit], Ls[hit]):
            dp = K * math.sqrt(p_v * p_g) * (Ma * Ma - 1.0) ** 0.125 * L ** -0.75
            la, lo = offset_ll(lat0, lon0, x0 + x, y0 + y)
            hits.append((round(la, 4), round(lo, 4), round(dp / PSF, 3), round(te + tr, 1)))
    return {"site": site_key, "vehicle": vehicle, "phase": phase, "azimuth_deg": az, "hits": hits,
            "track": [(round(offset_ll(lat0, lon0, x, y)[0], 4), round(offset_ll(lat0, lon0, x, y)[1], 4), round(z), round(M, 2))
                      for (te, z, x, y, M, psi, gam) in track]}


def town_verdicts(site_key, hits, r_km=4.0, near_km=12.0):
    """Per town: the loudest boom within r_km, or 'possible' if the carpet edge passes within near_km."""
    out = []
    H = np.array([(h[0], h[1], h[2], h[3]) for h in hits]) if hits else np.zeros((0, 4))
    for name, la, lo in SITES[site_key]["towns"]:
        if len(H):
            dy = (H[:, 0] - la) * 111.32; dx = (H[:, 1] - lo) * 111.32 * math.cos(math.radians(la))
            d = np.hypot(dx, dy)
            m = d <= r_km
            psf = float(H[m, 2].max()) if m.any() else 0.0
            t_s = float(np.median(H[m, 3])) if m.any() else None
            dmin = float(d.min())
        else:
            psf, t_s, dmin = 0.0, None, 1e9
        if psf >= 1.0: level = "loud"
        elif psf >= 0.3: level = "clear"
        elif psf > 0: level = "faint"
        elif dmin <= near_km: level = "possible"
        else: level = "none"
        out.append({"town": name, "lat": la, "lon": lo, "level": level, "psf": round(psf, 2),
                    "t_s": None if t_s is None else round(t_s), "carpet_km": round(dmin, 1) if dmin < 1e8 else None})
    return out


def thin(hits, max_n=2500):
    if len(hits) <= max_n:
        return hits
    idx = np.linspace(0, len(hits) - 1, max_n).astype(int)
    return [hits[i] for i in idx]


# ---------------------------------------------------------------- upcoming launches (Launch Library 2)
LL2 = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=detailed&hide_recent_previous=true"


def site_of(lat, lon):
    for k, S in SITES.items():
        if abs(lat - S["lat"]) < 0.4 and abs(lon - S["lon"]) < 0.4:
            return k
    return None


def classify(rocket_name):
    n = (rocket_name or "").lower()
    if "starship" in n or "super heavy" in n:
        return "superheavy"
    if "falcon" in n:
        return "falcon9"
    return None


SEEN = []                  # every LL2 result, compact, written to rockets.json for diagnosis (CI logs are not always readable)


def parse_ll2(js):
    """Launch Library 2 'detailed' results -> our launch records (only the three sites and the vehicles we model)."""
    out = []
    for L in js.get("results", []):
        _p = L.get("pad") or {}
        SEEN.append([L.get("net"), (L.get("name") or "")[:60], (_p.get("name") or "")[:40], _p.get("latitude"), _p.get("longitude")])
        pad = L.get("pad") or {}
        try:
            lat, lon = float(pad.get("latitude")), float(pad.get("longitude"))
        except (TypeError, ValueError):
            continue
        site = site_of(lat, lon)
        rk = ((L.get("rocket") or {}).get("configuration") or {})
        veh = classify(rk.get("full_name") or rk.get("name"))
        if not site or not veh:
            continue
        orbit = (((L.get("mission") or {}).get("orbit") or {}).get("abbrev")) or "default"
        landings = []
        for st in (L.get("rocket") or {}).get("launcher_stage") or []:
            ld = st.get("landing") or {}
            typ = ((ld.get("type") or {}).get("abbrev") or "").upper()
            loc = ((ld.get("landing_location") or ld.get("location") or {}).get("abbrev") or "")
            landings.append({"type": typ, "where": loc})
        rtls = any(l["type"] in ("RTLS", "CATCH", "TOWER") or l["where"].upper().startswith(("LZ", "OLP", "TOWER"))
                   for l in landings) or (veh == "superheavy")
        n_rtls = sum(1 for l in landings if l["type"] == "RTLS" or l["where"].upper().startswith("LZ")) or (1 if rtls else 0)
        out.append({"id": L.get("id"), "name": L.get("name"), "net": L.get("net"), "window_start": L.get("window_start"),
                    "status": ((L.get("status") or {}).get("abbrev")), "site": site, "pad": pad.get("name"),
                    "vehicle": veh, "rocket": rk.get("full_name") or rk.get("name"), "orbit": orbit,
                    "landings": landings, "rtls": bool(rtls), "n_rtls": int(n_rtls),
                    "url": L.get("url"), "image": (L.get("image") or {}).get("thumbnail_url") if isinstance(L.get("image"), dict) else None})
    return out


def fetch_launches(timeout=30):
    import requests
    r = requests.get(LL2, timeout=timeout, headers={"User-Agent": "mach-corridor (https://machcorridor.com)"})
    r.raise_for_status()
    return parse_ll2(r.json())


# ---------------------------------------------------------------- the forecast product
def pick_column(cols, site_key, when, valid_times):
    """Nearest forecast hour within the forecast range; None outside it (standard atmosphere, labelled)."""
    if not cols or site_key not in cols.get("sites", {}):
        return None, None
    best, bdt = None, None
    for vt in valid_times:
        d = abs((dt.datetime.fromisoformat(vt.replace("Z", "+00:00")) - when).total_seconds()) / 3600.0
        if bdt is None or d < bdt:
            best, bdt = vt, d
    if bdt is None or bdt > 3.1:
        return None, None
    return cols["sites"][site_key]["by_time"].get(best), best


def run_launch(L, cols, valid_times):
    when = dt.datetime.fromisoformat(L["net"].replace("Z", "+00:00"))
    col, vt = pick_column(cols, L["site"], when, valid_times)
    prof = profile_from_column(col)
    S = SITES[L["site"]]
    az = S["ascent_az"].get(L["orbit"], S["ascent_az"]["default"])
    parts = [scenario(L["site"], L["vehicle"], "ascent", prof, azimuth=az)]
    if L["rtls"]:
        parts.append(scenario(L["site"], L["vehicle"], "descent", prof))
    hits = [h for p in parts for h in p["hits"]]
    if L["rtls"] and L.get("n_rtls", 1) >= 2:            # Falcon Heavy: two side boosters land side by side, about 2x the dp
        hits = [(a, b, round(c * 1.0, 3), d) for (a, b, c, d) in hits]
    return {**L, "atmosphere": vt or "standard", "atmosphere_note": None if vt else
            "outside the 48 h forecast range: US Standard Atmosphere, no wind (updates as the launch gets closer)",
            "ascent_az_deg": az, "towns": town_verdicts(L["site"], hits),
            "parts": [{"phase": p["phase"], "track": p["track"], "hits": thin(p["hits"])} for p in parts]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../site/data")
    ap.add_argument("--launches", help="LL2 JSON file instead of the live API (tests)")
    ap.add_argument("--days", type=float, default=10.0)
    a = ap.parse_args()
    cols, valid = None, []
    try:
        cols = json.load(open(os.path.join(a.data, "columns.json")))
        valid = cols.get("valid_times", [])
    except Exception as ex:
        print("no forecast columns:", ex)
    now = dt.datetime.now(dt.timezone.utc)
    err = None
    try:
        launches = parse_ll2(json.load(open(a.launches))) if a.launches else fetch_launches()
    except Exception as ex:
        launches, err = [], f"launch list unavailable: {ex}"[:200]
        print(err)
    out = []
    for L in launches:
        try:
            when = dt.datetime.fromisoformat(L["net"].replace("Z", "+00:00"))
        except Exception:
            continue
        if not (now - dt.timedelta(hours=2) <= when <= now + dt.timedelta(days=a.days)):
            continue
        out.append(run_launch(L, cols, valid))
        print(f"{L['name']}: {L['site']} {L['vehicle']} rtls={L['rtls']} towns hit:",
              [t["town"] for t in out[-1]["towns"] if t["level"] in ("loud", "clear", "faint")], flush=True)
    # what-if for each site with today's atmosphere (analysis time), so the page is useful between launches
    examples = {}
    for k in SITES:
        col = (cols or {}).get("sites", {}).get(k, {}).get("by_time", {}).get(valid[0]) if valid else None
        prof = profile_from_column(col)
        veh = "superheavy" if k == "starbase" else "falcon9"
        parts = [scenario(k, veh, "ascent", prof), scenario(k, veh, "descent", prof)]
        hits = [h for p in parts for h in p["hits"]]
        examples[k] = {"vehicle": veh, "atmosphere": valid[0] if col else "standard", "towns": town_verdicts(k, hits),
                       "parts": [{"phase": p["phase"], "track": p["track"], "hits": thin(p["hits"])} for p in parts]}
    res = {"generated": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"), "model": "rocket v0 (issue #50)",
           "gfs_run": (cols or {}).get("run"), "error": err, "k_v": {f"{v}/{p}": K for (v, p), K in K_V.items()},
           "sites": {k: {kk: S[kk] for kk in ("name", "short", "lat", "lon", "tz", "lz")} for k, S in SITES.items()},
           "launches": out, "examples": examples, "ll2_seen": SEEN[:60]}
    with open(os.path.join(a.data, "rockets.json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
    print("wrote rockets.json:", len(out), "launches")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print(f"::warning title=rocket.py::{ex}")
        raise
