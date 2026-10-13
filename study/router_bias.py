"""
Does choosing the route on the forecast pick the forecast's mistakes? (issue #40, review finding 8)

The hindcasts fly great circles. The router instead picks, among many paths, the one the forecast says is fastest,
and a path can look fast because the forecast over-states its boomless Mach there ("winner's curse"). Here, for
every directed route and weekly date at FL550, seven paths are flown: the great circle and six one-waypoint detours
whose waypoint sits 150 / 300 / 450 km either side of the midpoint. Each is flown as the router would (ensemble
margin k = 3.75 + the airliner cushion, design Mach over open water, subsonic climb/descent) on the day-before
forecast; the fastest is "chosen". Truth = the analysis plus a shared real-world error field (0.012, 300 nm), the
same construction as robust_eval.py. Each flight is scored in psf with the caustic model (psf_eval.py).

Output: study/results/router_bias.json - exposure (> 0.11 psf) and minutes for great-circle-only vs chosen paths,
and how much the chosen path's forecast over-states its truth compared with the great circle.
Usage: python router_bias.py <study-data> <gefs-data>
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = sys.argv[:3]
import psf_eval as PE                              # noqa: E402  (loads robust_eval and the hindcast)
RE = PE.RE
from common import gc_points, zone_at, m_heading, bilin, APT, CLIMB, KT, E_PTS, K_FUEL   # noqa: E402

FL, K = 550, float(os.environ.get("K_ENS", "3.75"))
OFFS = (-450, -300, -150, 0, 150, 300, 450)          # km, perpendicular to the great circle at its midpoint


def dest(lat, lon, brg, km):
    d, b, p1, l1 = km / 6371.0, math.radians(brg), math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def path(o, d, off):
    A, B = APT[o], APT[d]
    if off == 0:
        lat, lon, brg, seg, dist = gc_points(A, B); segs = np.full(len(lat), seg)
    else:
        la, lo, br, sg, ds = gc_points(A, B)
        k = len(la) // 2; W = dest(la[k], lo[k], br[k] + 90, off)
        a, b = gc_points(A, W), gc_points(W, B)
        lat, lon, brg = np.r_[a[0], b[0]], np.r_[a[1], b[1]], np.r_[a[2], b[2]]
        segs = np.r_[np.full(len(a[0]), a[3]), np.full(len(b[0]), b[3])]; dist = a[4] + b[4]
    pos = np.cumsum(segs) - segs / 2
    cruise = (pos > CLIMB) & (pos < dist - CLIMB)
    reg = zone_at(lat, lon)
    xyz = np.stack([np.cos(np.radians(lat)) * np.cos(np.radians(lon)), np.cos(np.radians(lat)) * np.sin(np.radians(lon)), np.sin(np.radians(lat))], -1)
    return dict(lat=lat, lon=lon, brg=brg, seg=segs, dist=dist, reg=reg & cruise, water=(~reg) & cruise, xyz=xyz)


def error_modes(seed=11, nmodes=400, L_nm=300):
    rng = np.random.default_rng(seed); l = L_nm / 3440.065; out = {}
    for d in RE.D:
        out[d] = (rng.normal(0, 1 / l, (nmodes, 3)), rng.uniform(0, 2 * np.pi, nmodes))
    return out


def fly(p, c, along, cross, M):
    Mx = np.where(p["reg"], M, np.where(p["water"], RE.DESIGN, RE.M_SUB))
    tas = Mx * c * KT; xw = cross * KT
    gs = np.sqrt(np.maximum(tas ** 2 - xw ** 2, 0.04 * tas ** 2)) + along * KT
    return float((p["seg"] / np.maximum(gs, 150)).sum()), Mx


def main():
    ac = PE.aircraft_at(FL); PE.SCALE[0] = 1.0
    modes = error_modes()
    pairs = sorted({(r["o"], r["d"]) for r in RE.routes if r["reg"].sum()})
    P = {(o, d, off): path(o, d, off) for o, d in pairs for off in OFFS}
    rows = []
    for dd in RE.D:
        z = np.load(os.path.join(RE.DATA, f"study_{dd}.npz")); g = np.load(RE.gf[dd])
        Mf_enc, Ma_enc, sdg = z[f"f24_{FL}_M"], z[f"ana_{FL}_M"], g[f"gefs_{FL}_sd"]
        cg, ug, vg = (z[f"ana_{FL}_{k}"].astype(np.float32) for k in "cuv")
        kv, ph = modes[dd]
        for o, d in pairs:
            res = []
            for off in OFFS:
                p = P[(o, d, off)]
                lat, lon, brg = p["lat"], p["lon"], p["brg"]
                Mmap = RE.safe_heading(Mf_enc, lat, lon, brg)
                fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
                i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
                di, dj, i1 = fi - np.floor(fi), fj - j0, (np.floor(fi).astype(int) + 1) % 360
                h = brg / 10.0; k0 = np.floor(h).astype(int) % 36; k1 = (k0 + 1) % 36
                at = lambda k: ((sdg[k, j0, i0] * (1 - di) + sdg[k, j0, i1] * di) * (1 - dj) + (sdg[k, j0 + 1, i0] * (1 - di) + sdg[k, j0 + 1, i1] * di) * dj) * 0.0005
                sd = np.maximum(at(k0), at(k1))
                Mf = Mmap - K * np.sqrt(sd ** 2 + RE.S_EXTRA ** 2) + ac["pen"]
                M = np.where(Mf >= RE.FLOOR, np.minimum(Mf, RE.DESIGN), RE.M_SUB)
                u, v, c = bilin(ug, lat, lon), bilin(vg, lat, lon), bilin(cg, lat, lon)
                s, co = np.sin(np.radians(brg)), np.cos(np.radians(brg))
                t, Mfl = fly(p, c, u * s + v * co, u * co - v * s, M)
                tb, _ = fly(p, c, u * s + v * co, u * co - v * s, np.full(len(lat), RE.M_SUB)) if off == 0 else (None, None)
                E = RE.S_EXTRA * math.sqrt(2 / len(ph)) * np.cos(p["xyz"] @ kv.T + ph).sum(-1)
                truth = m_heading(Ma_enc, lat, lon, brg) + E
                sup = p["reg"] & (Mfl > 1.0)
                H = 1000.0 + (truth - Mfl) / PE.DMDZ
                psf = np.zeros(len(H)); idx = np.where(sup & (H < 4 * ac["dzs"]))[0]
                if len(idx): psf[idx] = PE.ground_psf(H[idx], ac)
                opt = float((Mmap - truth)[sup].mean()) if sup.any() else np.nan     # forecast over-statement on flown legs
                res.append(dict(off=off, t=t, tb=tb, over=bool(psf.max() > 0.11) if len(psf) else False, opt=opt, land=float(p["reg"].sum())))
            gc = next(x for x in res if x["off"] == 0); best = min(res, key=lambda x: x["t"])
            rows.append(dict(date=dd, route=f"{o}-{d}", gc_over=gc["over"], best_over=best["over"], gc_saved=60 * (gc["tb"] - gc["t"]),
                             best_saved=60 * (gc["tb"] - best["t"]), best_off=best["off"], gc_opt=gc["opt"], best_opt=best["opt"]))
        print(dd, flush=True)
    A = lambda k: np.array([r[k] for r in rows], float)
    def boot(k, B=1000):
        rng = np.random.default_rng(3); ds = sorted({r["date"] for r in rows}); by = {d: [r for r in rows if r["date"] == d] for d in ds}; v = []
        for _ in range(B):
            pick = rng.choice(ds, len(ds)); v.append(100 * np.mean([r[k] for d in pick for r in by[d]]))
        return [round(float(np.quantile(v, .025)), 2), round(float(np.quantile(v, .975)), 2)]
    moved = A("best_off") != 0
    out = dict(fl=FL, k=K, flights=len(rows), dates=len(RE.D), offsets_km=list(OFFS),
               great_circle=dict(over_011_pct=round(100 * A("gc_over").mean(), 2), ci95=boot("gc_over"), saved_min=round(float(A("gc_saved").mean()), 2)),
               chosen=dict(over_011_pct=round(100 * A("best_over").mean(), 2), ci95=boot("best_over"), saved_min=round(float(A("best_saved").mean()), 2),
                           share_not_great_circle=round(float(moved.mean()), 3)),
               forecast_overstatement=dict(great_circle=round(float(np.nanmean(A("gc_opt"))), 4), chosen=round(float(np.nanmean(A("best_opt"))), 4),
                                           chosen_when_detoured=round(float(np.nanmean(A("best_opt")[moved])), 4) if moved.any() else None,
                                           same_flights_great_circle=round(float(np.nanmean(A("gc_opt")[moved])), 4) if moved.any() else None))
    name = "router_bias.json" if K == 3.75 else f"router_bias_k{K}.json"
    json.dump(out, open(os.path.join(RE.OUT, name), "w"), indent=1); print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
