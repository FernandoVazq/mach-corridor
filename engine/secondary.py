"""
Secondary sonic booms (issues #16, #38): where the upward half of the Mach cone, bent back down by the stratosphere,
lands on the ground.

Physics (same ray acoustics as rays.py; Rogers & Maglieri 2015, Liebhardt et al. DLR):
  A ray of the Mach cone leaving at azimuth alpha off the heading travels horizontally along e = heading + alpha with
  trace velocity  V_t = M c_a cos(alpha) + w_a.e  (constant along the ray). With c_eff(z) = c(z) + w(z).e it
  - turns back down at the first height above the aircraft where c_eff = V_t (stratosphere / stratopause, 20-60 km);
  - reaches the ground only if V_t > c_eff everywhere below (else it turns again: Mach cutoff also stops secondaries).
  Type I: up from the aircraft, turn, down to the ground. Type II: the primary boom reflects off the sea and does the
  same. Horizontal travel  dx/dz = (c cos(theta) + w.e) / (c sin(theta)),  cos(theta) = c / (V_t - w.e),
  plus cross-wind drift w_perp / (c sin(theta)); the turning-point singularity is integrated analytically.
  Thermospheric returns (100-160 km up) are ignored: about 0.1-0.3 Pa, below audibility.
  Loudness is not computed: Concorde secondaries were 1-10 Pa (0.02-0.2 psf) at 120-160 km from the track
  (Rogers & Maglieri, Acoustics Today 2015), so a secondary landing on regulated land is treated as a violation.

Atmosphere: GFS up to 1 hPa (about 48 km); above it, the US Standard Atmosphere 1976 shape to 70 km with the top
winds held to 55 km and tapered to zero at 70 km.

Study (main): 24 GFS analyses (1st and 15th of each month), coastal ocean columns within 600 km of land, 12
headings, Overture (M1.7) and Concorde (M2.0) at FL550 -> how often a secondary lands, how far away, how often on
land, and the standoff from the coast that keeps them off land. Output: study/results/secondary.json
"""
import argparse, datetime as dt, json, math, os, sys
import numpy as np

BANDS = [(0, 70), (70, 150), (150, 250), (250, 400), (400, 600)]
UPPER = [70, 50, 40, 30, 20, 15, 10, 7, 5, 3, 2, 1]                 # hPa, above the map's levels
Z_TOP = 70000.0
DZ = 250.0
ZG = np.arange(0.0, Z_TOP + DZ, DZ)                                 # integration grid (m)


def std_T(z):
    """US Standard Atmosphere 1976 temperature (K), 0-86 km (geometric ~ geopotential here)."""
    layers = [(0, 288.15, -6.5), (11000, 216.65, 0.0), (20000, 216.65, 1.0), (32000, 228.65, 2.8),
              (47000, 270.65, 0.0), (51000, 270.65, -2.8), (71000, 214.65, -2.0)]
    z = np.asarray(z, float); T = np.empty_like(z)
    for i, (zb, Tb, L) in enumerate(layers):
        top = layers[i + 1][0] if i + 1 < len(layers) else 1e9
        m = (z >= zb) & (z < top); T[m] = Tb + L * (z[m] - zb) / 1000
    return T


def column_grid(Z, T, U, V):
    """Level arrays (L, N), any order -> c, u, v on ZG (len(ZG), N), extended above the top with climatology."""
    o = np.argsort(Z[:, 0]); Z, T, U, V = Z[o], T[o], U[o], V[o]
    N = Z.shape[1]
    c = np.empty((len(ZG), N)); u = np.empty_like(c); v = np.empty_like(c)
    cs = np.sqrt(1.4 * 287.05 * std_T(ZG))
    for n in range(N):
        z = Z[:, n]; ztop = z[-1]
        cc = np.sqrt(1.4 * 287.05 * T[:, n])
        c[:, n] = np.interp(ZG, z, cc)
        u[:, n] = np.interp(ZG, z, U[:, n]); v[:, n] = np.interp(ZG, z, V[:, n])
        above = ZG > ztop
        if above.any():
            c[above, n] = cc[-1] + cs[above] - np.interp(ztop, ZG, cs)
            taper = np.where(ZG[above] <= 55000, 1.0, np.clip((70000 - ZG[above]) / 15000, 0, 1))
            u[above, n] = U[-1, n] * taper; v[above, n] = V[-1, n] * taper
    return c, u, v


def leg_integral(ce, we, wp, Vt, k0, k1):
    """Horizontal travel (along, cross) of a ray between grid indices k0 < k1 where it does not turn. Arrays (Z, N)
    sliced inside; Vt (N,). Returns (along, cross) in m; NaN if the ray turns inside the interval."""
    c = ce[k0:k1 + 1] - we[k0:k1 + 1]
    cos = c / (Vt - we[k0:k1 + 1])
    q = 1 - cos ** 2
    ok = (q > 0).all(axis=0)
    s = np.sqrt(np.maximum(q, 1e-12))
    fa = (c * cos + we[k0:k1 + 1]) / (c * s); fc = wp[k0:k1 + 1] / (c * s)
    a = DZ * (fa[1:] + fa[:-1]).sum(0) / 2; x = DZ * (fc[1:] + fc[:-1]).sum(0) / 2
    return np.where(ok, a, np.nan), np.where(ok, x, np.nan)


def ray_ranges(c, u, v, z_a, e_deg, Vt):
    """For columns (Z, N) and per-column direction e (deg) and trace velocity Vt (N,): type I and II landing offsets
    from the aircraft (along e, across e; km) and turning height (m); NaN where no secondary lands."""
    e = np.radians(e_deg)
    ex, ey = np.sin(e), np.cos(e)
    we = u * ex + v * ey; wp = u * ey - v * ex                       # along e, and to its right
    ce = c + we
    N = c.shape[1]; ka = int(round(z_a / DZ))
    # lowest level above the aircraft where c_eff >= Vt
    above = (ce[ka:] >= Vt) ; has = above.any(0)
    kt = np.where(has, ka + np.argmax(above, 0), -1)
    below_ok = (ce[:ka + 1] < Vt).all(0)                             # reaches the ground on the way down
    out = dict(I_along=np.full(N, np.nan), I_cross=np.full(N, np.nan), II_along=np.full(N, np.nan), II_cross=np.full(N, np.nan), z_turn=np.full(N, np.nan))
    for n in np.where(has & below_ok & (kt > ka + 1))[0]:
        k = kt[n] - 1                                                 # last full cell below the turn
        sl = lambda X: X[:, n:n + 1]
        cn, wen, wpn, V = sl(ce), sl(we), sl(wp), np.array([Vt[n]])
        up_a, up_x = leg_integral(cn, wen, wpn, V, ka, k)
        dn_a, dn_x = leg_integral(cn, wen, wpn, V, 0, k)
        pr_a, pr_x = leg_integral(cn, wen, wpn, V, 0, ka)
        # analytic end cell: q falls linearly to 0 over the partial cell -> integral of 1/sqrt(q) = 2 h / sqrt(q_k)
        ck = cn[k, 0] - wen[k, 0]; cosk = ck / (V[0] - wen[k, 0]); qk = max(1 - cosk ** 2, 1e-9)
        q1 = 1 - ((cn[k + 1, 0] - wen[k + 1, 0]) / (V[0] - wen[k + 1, 0])) ** 2
        h = DZ * qk / max(qk - q1, 1e-9)
        end_a = 2 * h / math.sqrt(qk) * (ck * cosk + wen[k, 0]) / ck; end_x = 2 * h / math.sqrt(qk) * wpn[k, 0] / ck
        ua, ux = up_a[0] + end_a, up_x[0] + end_x
        da, dx = dn_a[0] + end_a, dn_x[0] + end_x
        out["I_along"][n] = (ua + da) / 1000; out["I_cross"][n] = (ux + dx) / 1000
        out["II_along"][n] = (pr_a[0] + 2 * da) / 1000; out["II_cross"][n] = (pr_x[0] + 2 * dx) / 1000
        out["z_turn"][n] = ZG[k] + h
    return out


def cone_rays(c, u, v, z_a, M, heading, d_alpha=3.0):
    """All secondary arrivals for an aircraft at Mach M on a heading over each column: list of dicts per alpha."""
    ka = int(round(z_a / DZ)); ca = c[ka]
    amax = math.degrees(math.acos(1 / M)); res = []
    for al in np.arange(-amax + 0.5, amax, d_alpha):
        e = (heading + al) % 360
        er = math.radians(e); wa = u[ka] * math.sin(er) + v[ka] * math.cos(er)
        Vt = M * ca * math.cos(math.radians(al)) + wa
        r = ray_ranges(c, u, v, z_a, np.full(c.shape[1], e), Vt)
        res.append((al, e, r))
    return res


# ---------------------------------------------------------------- study
def offset(lat, lon, along_km, cross_km, e_deg):
    """Point reached by moving along_km along bearing e and cross_km to its right (flat-earth, fine to ~500 km)."""
    e = math.radians(e_deg)
    dn = along_km * math.cos(e) - cross_km * math.sin(e); de = along_km * math.sin(e) + cross_km * math.cos(e)
    return lat + dn / 111.2, lon + de / (111.2 * max(math.cos(math.radians(lat)), 0.2))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--start", default="2025-10-01"); ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "study", "results", "secondary.json"))
    ap.add_argument("--stride", type=int, default=2, help="grid stride (deg)")
    ap.add_argument("--rows", default="", help="write raw arrivals here instead of summarising (sharded runs)")
    ap.add_argument("--summarise", nargs="*", help="merge raw-arrival files and summarise")
    a = ap.parse_args()
    if a.summarise:
        rows = [tuple(r) for f in a.summarise for r in json.load(open(f))]
        summarise(rows, a.out); return
    import build
    from scipy.ndimage import distance_transform_edt
    d0 = dt.date.fromisoformat(a.start)
    dates = []
    for m in range(a.months):
        y, mo = d0.year + (d0.month - 1 + m) // 12, (d0.month - 1 + m) % 12 + 1
        dates += [dt.date(y, mo, 1), dt.date(y, mo, 15)]
    levels = sorted(set(build.PLEV) | set(UPPER), reverse=True)
    want = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT") for p in levels} | {("LAND", "surface")}
    AC = {"Overture M1.7": 1.7, "Concorde M2.0": 2.0}
    z_a = 550 * 100 * 0.3048
    rows = []
    for d in dates:
        run = d.strftime("%Y%m%d") + "00"
        try:
            F = build.fetch(run, 0, want, res="1p00")
        except Exception as ex:
            print(run, "failed", ex, file=sys.stderr, flush=True); continue
        lv = [p for p in levels if ("TMP", f"{p} mb") in F]
        land = F[("LAND", "surface")] > 0.5
        # distance to land (km), 1-deg grid, latitude-scaled
        dist = distance_transform_edt(~land, sampling=(111.2, 111.2 * 0.75))
        J, I = np.where((~land) & (dist < 600))
        lat_all = 90 - J; keep = (np.abs(lat_all) <= 60) & (J % a.stride == 0) & (I % a.stride == 0)
        J, I = J[keep], I[keep]
        st = lambda var: np.stack([F[(var, f"{p} mb")][J, I] for p in lv])
        c, u, v = column_grid(st("HGT"), st("TMP"), st("UGRD"), st("VGRD"))
        print(run, "levels", len(lv), "top", min(lv), "hPa, columns", len(J), flush=True)
        for name, M in AC.items():
            for hd in range(0, 360, 30):
                for al, e, r in cone_rays(c, u, v, z_a, M, hd):
                    for typ in ("I", "II"):
                        A, X = r[f"{typ}_along"], r[f"{typ}_cross"]
                        for n in np.where(np.isfinite(A))[0]:
                            la, lo = offset(90 - J[n], I[n], A[n], X[n], e)
                            jj, ii = int(round(90 - la)), int(round(lo)) % 360
                            on_land = bool(0 <= jj <= 180 and land[jj, ii])
                            rows.append((d.month, name, typ, round(float(math.hypot(A[n], X[n])), 1), on_land, round(float(dist[J[n], I[n]]), 1),
                                         round(float(r["z_turn"][n]) / 1000, 1), (int(J[n]), int(I[n]), d.isoformat()), hd))
                # denominator: columns x headings evaluated
            for b0, b1 in BANDS:
                rows.append((d.month, name, "N", int(((dist[J, I] >= b0) & (dist[J, I] < b1)).sum()) * 12, False, b0, 0, 0, 0))
    if a.rows:
        json.dump(rows, open(a.rows, "w")); print("rows", len(rows)); return
    summarise(rows, a.out)


def summarise(rows, out_path):
    import collections
    out = {"note": "Secondary booms from GFS analyses, coastal ocean columns, FL550; see engine/secondary.py", "aircraft": {}}
    for name in sorted({r[1] for r in rows}):
        R = [r for r in rows if r[1] == name and r[2] != "N"]
        Nev = sum(r[3] for r in rows if r[1] == name and r[2] == "N")
        nb = collections.Counter(); [nb.update({r[5]: r[3]}) for r in rows if r[1] == name and r[2] == "N"]
        res = {"column_headings": Nev}
        for typ in ("I", "II"):
            d = np.array([r[3] for r in R if r[2] == typ]) if any(r[2] == typ for r in R) else np.array([])
            if not len(d):
                res[typ] = None; continue
            res[typ] = dict(arrivals=int(len(d)), range_km=dict(p5=round(float(np.quantile(d, .05))), p50=round(float(np.median(d))), p95=round(float(np.quantile(d, .95))), p99=round(float(np.quantile(d, .99))), max=round(float(d.max()))),
                            turn_km_median=round(float(np.median([r[6] for r in R if r[2] == typ])), 1))
        # share of column-headings with any secondary, and with one on land, by distance of the aircraft from land
        key = lambda r: (tuple(r[7]) if isinstance(r[7], (list, tuple)) else r[7], r[8])
        bands = BANDS
        by = collections.defaultdict(lambda: [set(), set(), set()])
        for r in R:
            for b in bands:
                if b[0] <= r[5] < b[1]:
                    by[b][0].add(key(r))
                    if r[4]: by[b][1].add(key(r))
        res["by_distance_from_land_km"] = [dict(band=f"{b[0]}-{b[1]}", column_headings=nb[b[0]], with_secondary=len(by[b][0]), with_secondary_on_land=len(by[b][1]),
                                                pct_on_land=round(100 * len(by[b][1]) / max(nb[b[0]], 1), 2)) for b in bands]
        months = collections.Counter(r[0] for r in R if r[4]); res["on_land_by_month"] = {str(m): months.get(m, 0) for m in range(1, 13)}
        land_d = np.array([r[5] for r in R if r[4]])
        res["standoff_km_keeping_99pct_off_land"] = round(float(np.quantile(land_d, .99))) if len(land_d) else 0
        res["standoff_km_keeping_all_off_land"] = round(float(land_d.max())) if len(land_d) else 0
        out["aircraft"][name] = res
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(out, open(out_path, "w"), indent=1); print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------- live tables (built with every forecast)
SSB_FH = [0, 12, 24, 36, 48]
Z_LOW = 9100.0                                   # FL300: the lowest cruise level on the map
V0, V_STEP, R_STEP = 250.0, 0.75, 2.0            # encoding: V = V0 + byte*V_STEP (m/s); R = byte*R_STEP (km), 0 = none


def ranges_vec(c, u, v, ka, e_deg, Vt):
    """Vectorised type I and II landing distance along e (km) for columns (Z, N) with trace velocities Vt (N,).
    NaN where no secondary lands. Same physics as ray_ranges (checked in test_secondary.py)."""
    e = math.radians(e_deg); we = u * math.sin(e) + v * math.cos(e); cc = c
    with np.errstate(invalid="ignore", divide="ignore"):
        cos = cc / (Vt[None] - we); q = 1 - cos ** 2
        s = np.sqrt(np.maximum(q, 1e-12)); f = np.where(q > 0, (cc * cos + we) / (cc * s), 0.0)
    F = np.concatenate([np.zeros((1, f.shape[1])), np.cumsum(DZ * (f[1:] + f[:-1]) / 2, axis=0)])   # F[k] = integral 0..k
    turn = q[ka:] <= 0; has = turn.any(0); kt = ka + np.argmax(turn, 0)
    below_ok = (q[:ka + 1] > 0).all(0)
    ok = has & below_ok & (kt > ka + 1)
    k = np.clip(kt - 1, 0, len(ZG) - 2); n = np.arange(f.shape[1])
    qk = np.maximum(q[k, n], 1e-9); q1 = q[k + 1, n]
    h = DZ * qk / np.maximum(qk - q1, 1e-9)
    end = 2 * h / np.sqrt(qk) * f[k, n] * np.sqrt(qk)        # f carries 1/s; 2h/sqrt(qk) * (c cos + we)/c
    up = F[k, n] - F[ka] + end; dn = F[k, n] + end; pr = F[ka]
    R1 = np.where(ok, (up + dn) / 1000, np.nan); R2 = np.where(ok, (pr + 2 * dn) / 1000, np.nan)
    return R1, R2


def ssb_table(Z, T, U, V, z_a=550 * 100 * 0.3048):
    """Columns (L, N) -> (36, 6, N): V_lo, V_hi (m/s), type I range at V_lo / V_hi, type II at V_lo / V_hi (km).
    V_lo = max c_eff from the ground to FL300 (conservative: rays slower than that may still be trapped lower),
    V_hi = max c_eff from FL300 to 70 km."""
    c, u, v = column_grid(Z, T, U, V)
    ka = int(round(z_a / DZ)); klow = int(round(Z_LOW / DZ))
    out = np.full((36, 6, c.shape[1]), np.nan)
    for i, e in enumerate(range(0, 360, 10)):
        er = math.radians(e); ce = c + u * math.sin(er) + v * math.cos(er)
        vlo, vhi = ce[:klow + 1].max(0), ce[klow:].max(0)
        out[i, 0], out[i, 1] = vlo, vhi
        win = vhi > vlo + 1.0
        R1a, R2a = ranges_vec(c, u, v, ka, e, vlo + 0.5)
        R1b, R2b = ranges_vec(c, u, v, ka, e, vhi - 0.5)
        out[i, 2] = np.where(win, R1a, np.nan); out[i, 3] = np.where(win, R1b, np.nan)
        out[i, 4] = np.where(win, R2a, np.nan); out[i, 5] = np.where(win, R2b, np.nan)
    return out


def ssb_encode(tab, ny, nx):
    """(36, 6, ny*nx) -> two RGB atlases of 6x6 tiles (no alpha: browsers premultiply it):
    A = (V_lo, V_hi, type I range at V_lo), B = (type I range at V_hi, type II at V_lo, type II at V_hi)."""
    def byte(x, off, step):
        return np.clip(np.round((np.nan_to_num(x, nan=off) - off) / step), 0, 255).astype(np.uint8)
    A = np.zeros((6 * ny, 6 * nx, 3), np.uint8); B = np.zeros_like(A)
    for i in range(36):
        r, cc = divmod(i, 6); sl = (slice(r * ny, (r + 1) * ny), slice(cc * nx, (cc + 1) * nx))
        g = lambda k: tab[i, k].reshape(ny, nx)
        A[sl] = np.stack([byte(g(0), V0, V_STEP), byte(g(1), V0, V_STEP), byte(g(2), 0, R_STEP)], -1)
        B[sl] = np.stack([byte(g(3), 0, R_STEP), byte(g(4), 0, R_STEP), byte(g(5), 0, R_STEP)], -1)
    return A, B
