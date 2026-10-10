"""
How useful is knowing the boomless Mach? Value-of-information study on a year of GFS hindcasts.

Data (study-data branch, built by engine/study.py in GitHub Actions): 53 weekly dates, Oct 2025 - Oct 2026,
00 UTC, boomless Mach for 36 directions at FL350/450/550 from the GFS analysis ("truth") and from the
24 h forecast issued the day before ("forecast"). Same physics as the live map (1 km buffer, lateral rays).

For each directed great-circle route, date and flight level, every 10 nm of track is flown under five
policies over regulated airspace (land + territorial sea + boom carpet); open water is always design Mach:
  BAN        subsonic (M0.95), today's rule
  FIXED(M)   one Mach everywhere over land, no weather information
  CLIM(q)    a static chart: the q-quantile of that spot's boomless Mach over the year (no daily info)
  FCST(m)    the day-before forecast minus a margin m
  ORACLE     the boomless Mach that actually existed (perfect knowledge, upper bound)
Outcome per flight: minutes saved against BAN, and boom exposure = share of overland distance where the
flown Mach exceeded what the real atmosphere allowed (the boom would have reached the ground).
"""
import glob, json, math, os, sys
import numpy as np

DATA = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/study_data"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "results")
os.makedirs(OUT, exist_ok=True)
KT, STEP, CLIMB = 1.94384, 10.0, 150.0
M_SUB, FLOOR = 0.95, 1.05

APT = {"KJFK": (40.64, -73.78), "KLAX": (33.94, -118.41), "KSFO": (37.62, -122.38), "KBOS": (42.36, -71.01),
       "KSEA": (47.45, -122.31), "KORD": (41.98, -87.90), "KATL": (33.64, -84.43), "KDFW": (32.90, -97.04),
       "KIAD": (38.95, -77.46), "KDEN": (39.86, -104.67), "KMIA": (25.79, -80.29), "CYYZ": (43.68, -79.63),
       "CYVR": (49.19, -123.18), "MMMX": (19.44, -99.07), "EGLL": (51.47, -0.45), "LFPG": (49.01, 2.55),
       "EDDF": (50.03, 8.57), "LEMD": (40.49, -3.57), "UUEE": (55.97, 37.41), "LTFM": (41.26, 28.74),
       "HECA": (30.12, 31.41), "OMDB": (25.25, 55.36), "VIDP": (28.57, 77.10), "ZBAA": (40.08, 116.58),
       "ZSPD": (31.14, 121.81), "SKBO": (4.70, -74.15), "SAEZ": (-34.82, -58.54), "SBGR": (-23.43, -46.47),
       "SCEL": (-33.39, -70.79), "FAOR": (-26.14, 28.24), "HKJK": (-1.32, 36.93), "DNMM": (6.58, 3.32),
       "GMMN": (33.37, -7.59)}
REGION = {"K": "North America", "C": "North America", "M": "North America", "E": "Europe & Middle East",
          "L": "Europe & Middle East", "U": "Asia", "H": "Africa", "O": "Europe & Middle East", "V": "Asia",
          "Z": "Asia", "S": "South America", "F": "Africa", "D": "Africa", "G": "Africa"}
PAIRS = [("KJFK", "KLAX"), ("KJFK", "KSFO"), ("KBOS", "KSEA"), ("KORD", "KLAX"), ("KATL", "KSEA"), ("KIAD", "KDEN"),
         ("KDFW", "KSEA"), ("KMIA", "KSEA"), ("CYYZ", "CYVR"), ("MMMX", "KORD"), ("EGLL", "OMDB"), ("EDDF", "VIDP"),
         ("LEMD", "UUEE"), ("UUEE", "ZBAA"), ("LTFM", "VIDP"), ("OMDB", "ZSPD"), ("VIDP", "ZBAA"), ("GMMN", "HECA"),
         ("FAOR", "HKJK"), ("DNMM", "HKJK"), ("SKBO", "SAEZ"), ("SBGR", "SCEL"), ("EGLL", "HECA"), ("LFPG", "LTFM")]
FLS = [350, 450, 550]

# --- Overture-like economics (site/aircraft.js) ---
E_PTS = [(0.85, 12.0), (0.95, 12.4), (1.05, 11.0), (1.15, 10.3), (1.3, 11.5), (1.5, 13.6), (1.7, 15.3)]
K_FUEL, NONFUEL, PAX, FUEL_USD = 19.2 * 15.3, 8700.0, 65 * 0.8, 1.47
DESIGN = 1.7
def eff(M): return float(np.interp(M, [p[0] for p in E_PTS], [p[1] for p in E_PTS]))

def gc_points(a, b, step=STEP):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
    dist = d * 3440.065; n = max(2, int(dist / step))
    f = (np.arange(n) + 0.5) / n
    A, B = np.sin((1 - f) * d) / math.sin(d), np.sin(f * d) / math.sin(d)
    x = A * math.cos(la1) * math.cos(lo1) + B * math.cos(la2) * math.cos(lo2)
    y = A * math.cos(la1) * math.sin(lo1) + B * math.cos(la2) * math.sin(lo2)
    z = A * math.sin(la1) + B * math.sin(la2)
    lat, lon = np.degrees(np.arctan2(z, np.hypot(x, y))), np.degrees(np.arctan2(y, x))
    lat2, lon2 = np.radians(lat), np.radians(lon)
    # local bearing toward the next point (forward azimuth along the circle)
    nxt_lat, nxt_lon = np.append(lat2[1:], math.radians(b[0])), np.append(lon2[1:], math.radians(b[1]))
    brg = np.degrees(np.arctan2(np.sin(nxt_lon - lon2) * np.cos(nxt_lat), np.cos(lat2) * np.sin(nxt_lat) - np.sin(lat2) * np.cos(nxt_lat) * np.cos(nxt_lon - lon2))) % 360
    return lat, lon, brg, dist / n, dist

def bilin(F, lat, lon):
    """F[..., 181, 360] on lat 90..-90, lon 0..359"""
    fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
    i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
    di, dj, i1 = fi - np.floor(fi), fj - j0, (np.floor(fi).astype(int) + 1) % 360
    return (F[..., j0, i0] * (1 - di) + F[..., j0, i1] * di) * (1 - dj) + (F[..., j0 + 1, i0] * (1 - di) + F[..., j0 + 1, i1] * di) * dj

def m_heading(Menc, lat, lon, brg):
    """boomless Mach along a heading: conservative min of the two bracketing 10-degree tiles (as the app)"""
    fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
    i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
    di, dj, i1 = fi - np.floor(fi), fj - j0, (np.floor(fi).astype(int) + 1) % 360
    h = brg / 10.0; k0 = np.floor(h).astype(int) % 36; k1 = (k0 + 1) % 36
    def at(k):
        V = lambda j, i: (lambda E: np.where(E > 0, 1.0 + 0.0025 * E, 0.98))(Menc[k, j, i].astype(np.float32))
        return (V(j0, i0) * (1 - di) + V(j0, i1) * di) * (1 - dj) + (V(j0 + 1, i0) * (1 - di) + V(j0 + 1, i1) * di) * dj
    return np.minimum(at(k0), at(k1))

files = sorted(glob.glob(os.path.join(DATA, "study_*.npz")))
dates = [os.path.basename(f)[6:14] for f in files]
print(len(files), "dates", dates[0], "to", dates[-1])

# regulated airspace: land fraction > 0.5, grown by one 1-degree cell (territorial sea + boom carpet, ~36 nm)
land = np.load(files[0])["land"].astype(np.float32) / 255
reg = land > 0.5
g = reg.copy()
for dj in (-1, 0, 1):
    for di in (-1, 0, 1):
        g |= np.roll(np.roll(reg, dj, 0), di, 1)
REG = g

routes = []
for a, b in PAIRS:
    for o, d in ((a, b), (b, a)):
        lat, lon, brg, seg, dist = gc_points(APT[o], APT[d])
        pos = (np.arange(len(lat)) + 0.5) * seg
        regm = REG[np.clip(np.round(90 - lat).astype(int), 0, 180), np.round(np.mod(lon, 360)).astype(int) % 360]
        cruise = (pos > CLIMB) & (pos < dist - CLIMB)
        east = ((brg[len(brg) // 2] % 360) < 180)
        routes.append(dict(name=f"{o}-{d}", o=o, d=d, lat=lat, lon=lon, brg=brg, seg=seg, dist=dist, reg=regm & cruise,
                           water=(~regm) & cruise, climb=~cruise, east=east, region=REGION[o[0]] if REGION[o[0]] == REGION[d[0]] else "Intercontinental"))
print(len(routes), "directed routes")

# --- sample every route on every date and level ---
S = {}   # (route, date, fl) -> dict(Mt, Mf, c, along)
for fi, f in enumerate(files):
    z = np.load(f)
    for fl in FLS:
        Ma, Mf = z[f"ana_{fl}_M"], z[f"f24_{fl}_M"]
        c, u, v = (z[f"ana_{fl}_{k}"].astype(np.float32) for k in "cuv")
        for r in routes:
            lat, lon, brg = r["lat"], r["lon"], r["brg"]
            s, co = np.sin(np.radians(brg)), np.cos(np.radians(brg))
            uu, vv = bilin(u, lat, lon), bilin(v, lat, lon)
            S[(r["name"], dates[fi], fl)] = dict(Mt=m_heading(Ma, lat, lon, brg), Mf=m_heading(Mf, lat, lon, brg),
                                                  c=bilin(c, lat, lon), along=uu * s + vv * co, cross=uu * co - vv * s)
    print("loaded", dates[fi], flush=True)

def fly(r, smp, Mland):
    """time (h) and fuel (kg) along the route with Mland on regulated cruise samples"""
    M = np.where(r["reg"], Mland, np.where(r["water"], DESIGN, M_SUB))
    tas = M * smp["c"] * KT; xw = smp["cross"] * KT
    gs = np.sqrt(np.maximum(tas ** 2 - xw ** 2, 0.04 * tas ** 2)) + smp["along"] * KT
    t = r["seg"] / np.maximum(gs, 150)
    fuel = K_FUEL / np.interp(M, [p[0] for p in E_PTS], [p[1] for p in E_PTS]) * r["seg"] * tas / np.maximum(gs, 150)
    return t.sum(), fuel.sum(), M

def boom(r, smp, M):
    over = r["reg"] & (M > 1.0) & (M > smp["Mt"] + 1e-6)
    land_nm = r["reg"].sum() * r["seg"]
    return (over.sum() * r["seg"]) / max(land_nm, 1e-9), over.sum() * r["seg"]

# climatology chart: per route sample, the q-quantile of the truth over the year (per level)
CLIM = {}
for r in routes:
    for fl in FLS:
        st = np.stack([S[(r["name"], d, fl)]["Mt"] for d in dates])
        CLIM[(r["name"], fl)] = {q: np.quantile(st, q, axis=0) for q in (0.02, 0.05, 0.1, 0.2, 0.3, 0.5)}

def policy_M(kind, par, r, smp, fl):
    if kind == "ban": return np.full_like(smp["Mt"], M_SUB)
    if kind == "oracle": m = smp["Mt"]
    elif kind == "fcst": m = smp["Mf"] - par
    elif kind == "fixed": m = np.full_like(smp["Mt"], par)
    elif kind == "clim": m = CLIM[(r["name"], fl)][par]
    return np.where(m >= FLOOR, np.minimum(m, DESIGN), M_SUB)

POLICIES = [("ban", 0)] + [("oracle", 0)] + [("fcst", m) for m in (-0.01, 0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07)] + \
           [("fixed", round(1.02 + 0.01 * i, 2)) for i in range(24)] + [("clim", q) for q in (0.02, 0.05, 0.1, 0.2, 0.3, 0.5)]
rows = []
for r in routes:
    for d in dates:
        for fl in FLS:
            smp = S[(r["name"], d, fl)]
            tb, fb, _ = fly(r, smp, M_SUB)
            for kind, par in POLICIES:
                if kind == "ban": continue
                M = policy_M(kind, par, r, smp, fl)
                t, fu, Mfl = fly(r, smp, M)
                share, nm = boom(r, smp, Mfl)
                rows.append(dict(route=r["name"], region=r["region"], east=bool(r["east"]), date=d, fl=fl, policy=kind, par=par,
                                 land_nm=float(r["reg"].sum() * r["seg"]), dist=float(r["dist"]), saved_min=float(60 * (tb - t)),
                                 dfuel_kg=float(fu - fb), boom_share=float(share), boom_nm=float(nm),
                                 avail=float((r["reg"] & (smp["Mt"] >= FLOOR)).sum() / max(r["reg"].sum(), 1)),
                                 ban_h=float(tb)))
print(len(rows), "flight-policy rows")
with open(os.path.join(OUT, "rows.json"), "w") as f:
    json.dump(rows, f)
# per route-date route-mean Mach (truth vs forecast) for the variability / skill charts
mm = []
for r in routes:
    if r["reg"].sum() == 0: continue
    for d in dates:
        for fl in FLS:
            smp = S[(r["name"], d, fl)]
            mm.append(dict(route=r["name"], date=d, fl=fl, Mt=float(smp["Mt"][r["reg"]].mean()), Mf=float(smp["Mf"][r["reg"]].mean()),
                           Mt_min=float(smp["Mt"][r["reg"]].min()), err=float((smp["Mf"] - smp["Mt"])[r["reg"]].mean())))
with open(os.path.join(OUT, "route_mach.json"), "w") as f:
    json.dump(mm, f)
print("done")
