"""
Fireball booms (issue #61): where the sonic boom of a bright fireball (a bolide) reached the ground, how long after
the flash, and roughly how strong, for the events NASA JPL's Center for Near-Earth Object Studies (CNEOS) lists from
US Government sensors.

Physics: the same ray acoustics as rocket.py. A meteoroid at 12-70 km/s is at Mach 40-250, so its Mach cone is
almost a cylinder around the trajectory: the boom leaves nearly at right angles to the path (a line source). Each
down-pointing shock normal from the luminous path below Z_EMIT_MAX is traced (RK4, rocket.trace_many) through the US
Standard Atmosphere to the ground or until the atmosphere turns it back up. Without wind the carpet edge is set by
the temperature profile alone: an estimate of where the boom could be heard, not a forecast.

Strength (an order-of-magnitude estimate): ReVelle's (1976) weak-shock line-source theory, in the simplified form
used by Edwards et al. (2008) and Silber & Brown (2014),
    dp / p_z = (2 gamma / (gamma + 1)) * 0.4467 * x^(-3/4),     x = R / R0,     R0 = M d,
with R the distance along the ray, d the meteoroid diameter (from the impact energy, the speed and a stony density
of 3,300 kg/m3) and p_z the pressure at the emission height (Silber et al. 2018 review, Adv. Space Res.); the wave then gains sqrt(rho_ground c_ground /
(rho_z c_z)) as it descends (acoustic energy flux). Far from the path the shock becomes linear and decays more slowly
in steepness but loses its high frequencies; that and absorption are not modelled. Checked against Chelyabinsk 2013
(about 500 kt at 23 km: 1-4 kPa near the track) and against centimetre meteors from 56-103 km (0.012-0.65 Pa,
Edwards et al. 2008) in test_bolide.py; in between it is uncertain by a factor of about 3. It is NOT valid for blunt
spacecraft capsules (OSIRIS-REx: such a formula gave 21 Pa, 0.7 Pa was measured); capsules use reentry.py.

CNEOS API: https://ssd-api.jpl.nasa.gov/fireball.api (fields date, energy (1e10 J radiated), impact-e (kt), lat,
lat-dir, lon, lon-dir, alt (km, peak brightness), vel (km/s), and with vel-comp=true vx, vy, vz (km/s, Earth-centred
Earth-fixed, pre-impact)). Public US Government data.
"""
import argparse, datetime as dt, json, math, os
import numpy as np

import rocket
from secondary import std_T

GAMMA = 1.4
RHO_M = 3300.0                  # stony meteoroid, kg/m3
Z_EMIT_MAX = 60000.0            # above this the boom is too weak to be heard on the ground
KT = 4.184e12
API = "https://ssd-api.jpl.nasa.gov/fireball.api"
PA_PSF = 47.880258


def c_std(z):
    return math.sqrt(GAMMA * 287.05 * float(std_T(np.array([z]))[0]))


def diameter(impact_kt, v_kms):
    """Meteoroid diameter (m) from impact energy and speed: m = 2E/v^2, sphere of density RHO_M."""
    m = 2.0 * impact_kt * KT / (v_kms * 1000.0) ** 2
    return (6.0 * m / (math.pi * RHO_M)) ** (1.0 / 3.0)


def enu_dir(lat, lon, vx, vy, vz):
    """ECEF velocity -> (heading deg from north, flight-path angle deg, + up)."""
    la, lo = math.radians(lat), math.radians(lon)
    e = -math.sin(lo) * vx + math.cos(lo) * vy
    n = -math.sin(la) * math.cos(lo) * vx - math.sin(la) * math.sin(lo) * vy + math.cos(la) * vz
    u = math.cos(la) * math.cos(lo) * vx + math.cos(la) * math.sin(lo) * vy + math.sin(la) * vz
    sp = math.sqrt(e * e + n * n + u * u)
    return math.degrees(math.atan2(e, n)) % 360.0, math.degrees(math.asin(u / sp))


def dp_ground(R, R0, z, p_g=101325.0):
    """Peak overpressure (Pa) at the ground for a ray of length R (m) from emission height z (m)."""
    p_z = rocket.pressure(z)
    x = max(R / R0, 1.0)
    dp_z = p_z * (2 * GAMMA / (GAMMA + 1)) * 0.4467 * x ** -0.75
    rho = lambda p, T: p / (287.05 * T)
    Tz, Tg = float(std_T(np.array([z]))[0]), float(std_T(np.array([0.0]))[0])
    gain = math.sqrt(rho(p_g, Tg) * math.sqrt(GAMMA * 287.05 * Tg) / (rho(p_z, Tz) * math.sqrt(GAMMA * 287.05 * Tz)))
    return dp_z * gain


def carpet(ev, prof=None, n_phi=48, dz=2000.0):
    """Ground hits of the boom of one event: [(lat, lon, Pa, t_s after the emission point's time)], plus summary."""
    prof = prof or rocket.profile_from_column(None)
    psi, gam = ev["heading"], ev["gamma"]
    if gam > -5.0:                                    # grazing or upward: path geometry too uncertain
        return [], {"heard": False, "reason": "grazing"}
    v = ev["vel"] * 1000.0
    d = diameter(ev["impact_kt"], ev["vel"])
    z_end = max(ev["alt"] * 1000.0 - 2000.0, 15000.0)  # the fireball ends a little below peak brightness
    z_top = min(Z_EMIT_MAX, ev["alt"] * 1000.0 + 25000.0)
    tan_g = math.tan(math.radians(-gam))
    hits = []
    for z in np.arange(z_end, z_top + 1, dz):
        back = (z - ev["alt"] * 1000.0) / tan_g        # horizontal distance up-track from the peak point (m)
        x0, y0 = rocket.bearing_xy((psi + 180.0) % 360.0, back)
        t_em = -(z - ev["alt"] * 1000.0) / (v * math.sin(math.radians(-gam)))
        M = v / c_std(z)
        n, down = rocket.cone_normals(M, psi, gam, n_phi)
        hit, xs, ys, ts, Ls = rocket.trace_many(prof, z, n[down], dt=1.0, t_max=1200.0)
        R0 = M * d
        for x, y, t, L in zip(xs[hit], ys[hit], ts[hit], Ls[hit]):
            la, lo = rocket.offset_ll(ev["lat"], ev["lon"], x0 + x, y0 + y)
            hits.append((round(la, 3), round(lo, 3), round(dp_ground(L, R0, z), 2), round(t_em + t, 1)))
    if not hits:
        return [], {"heard": False}
    H = np.array(hits)
    dy = (H[:, 0] - ev["lat"]) * 111.32; dx = (H[:, 1] - ev["lon"]) * 111.32 * math.cos(math.radians(ev["lat"]))
    r = np.hypot(dx, dy)
    return hits, {"heard": True, "radius_km": round(float(r.max()), 0), "t_min_s": round(float(H[:, 3].min())),
                  "t_max_s": round(float(H[:, 3].max())), "pa_max": round(float(H[:, 2].max()), 1),
                  "pa_median": round(float(np.median(H[:, 2])), 2), "diameter_m": round(d, 2)}


def parse(js):
    """CNEOS JSON -> event dicts with position, energy, altitude and direction (events without them are kept,
    flagged, but not traced)."""
    f = js.get("fields", [])
    out = []
    for row in js.get("data", []):
        r = dict(zip(f, row))
        try:
            lat = float(r["lat"]) * (1 if r.get("lat-dir") == "N" else -1)
            lon = float(r["lon"]) * (1 if r.get("lon-dir") == "E" else -1)
        except (TypeError, ValueError, KeyError):
            continue
        num = lambda k: None if r.get(k) in (None, "") else float(r[k])
        ev = {"date": r["date"].replace(" ", "T") + "Z", "lat": lat, "lon": lon, "energy_e10j": num("energy"),
              "impact_kt": num("impact-e"), "alt": num("alt"), "vel": num("vel")}
        if all(num(k) is not None for k in ("vx", "vy", "vz")) and ev["vel"]:
            ev["heading"], ev["gamma"] = enu_dir(lat, lon, num("vx"), num("vy"), num("vz"))
            ev["heading"], ev["gamma"] = round(ev["heading"], 1), round(ev["gamma"], 1)
        out.append(ev)
    return out


def fetch(days=730, timeout=30):
    import requests
    since = (dt.datetime.utcnow() - dt.timedelta(days=days)).strftime("%Y-%m-%d")
    r = requests.get(API, params={"date-min": since, "req-loc": "true", "vel-comp": "true"}, timeout=timeout,
                     headers={"User-Agent": "mach-corridor (https://machcorridor.com)"})
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../site/data")
    ap.add_argument("--file", help="CNEOS JSON file instead of the live API (tests)")
    ap.add_argument("--days", type=int, default=730)
    a = ap.parse_args()
    err = None
    try:
        js = json.load(open(a.file)) if a.file else fetch(a.days)
        events = parse(js)
    except Exception as ex:
        events, err = [], f"CNEOS list unavailable: {ex}"[:200]
        print(err)
    prof = rocket.profile_from_column(None)
    traced = 0
    for ev in events:
        ev["carpet"], ev["boom"] = [], None
        if ev.get("gamma") is not None and ev.get("alt") and ev.get("impact_kt"):
            hits, summ = carpet(ev, prof)
            ev["carpet"], ev["boom"] = rocket.thin(hits, 900), summ
            traced += 1
    events.sort(key=lambda e: e["date"], reverse=True)
    res = {"generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
           "model": "bolide v0 (issue #61)", "source": "NASA JPL CNEOS fireball API (US Government sensors)", "error": err,
           "atmosphere": "US Standard Atmosphere, no wind", "n": len(events), "traced": traced, "events": events}
    with open(os.path.join(a.data, "fireballs.json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
    print(f"wrote fireballs.json: {len(events)} events, {traced} traced")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print(f"::warning title=bolide.py::{ex}")
        raise
