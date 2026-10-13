"""
Deep study 4 (Oct 2026): is one flight level enough, or should a boomless flight change level along the way?

For the 24 directed study routes over regulated land (common.PAIRS, both directions), 53 weekly analyses
(study-data, Oct 2025 - Oct 2026), the boomless Mach on each overland great-circle point at FL350, FL450, FL550
(truth = analysis, before margin; the level is chosen on the 24 h forecast). Policies per 300 nm block: fixed FL550; best of FL450/FL550; best of all three.
A level change costs a climb or descent; a descent at -3 deg lowers the limit by ~0.03 Mach while it lasts
(results/flight_path_angle.json), modelled as a 0.03 Mach penalty on 40 nm after each descent (FL550->450 at
~2,000 ft/min). Output: results/fl_choice.json (mean boomless Mach over land and share of blocks where a lower level
is faster). Usage: python fl_choice.py [study data dir]
"""
import json, os, sys
import numpy as np
sys.argv = sys.argv[:2]
from common import DATA, PAIRS, APT, gc_points, zone_at, m_heading      # noqa: E402

BLOCK = 300.0


def main():
    files = sorted(f for f in os.listdir(DATA) if f.startswith("study_") and f.endswith(".npz"))
    pts = {}
    for a, b in PAIRS:
        for o, d in ((a, b), (b, a)):
            lat, lon, brg, seg, dist = gc_points(APT[o], APT[d])
            reg = zone_at(lat, lon)
            pos = np.cumsum(np.full(len(lat), seg))
            m = reg & (pos > 150) & (pos < dist - 150)
            if m.sum() > 3:
                pts[(o, d)] = (lat[m], lon[m], brg[m], pos[m], seg)
    rows = []
    for f in files:
        z = np.load(os.path.join(DATA, f))
        for (o, d), (lat, lon, brg, pos, seg) in pts.items():
            M = {fl: m_heading(z[f"ana_{fl}_M"], lat, lon, brg) for fl in (350, 450, 550)}       # truth
            Mf = {fl: m_heading(z[f"f24_{fl}_M"], lat, lon, brg) for fl in (350, 450, 550)}      # what the planner sees
            blk = (pos // BLOCK).astype(int)
            res = {}
            for pol, levels in (("fixed_550", (550,)), ("best_450_550", (450, 550)), ("best_350_450_550", (350, 450, 550))):
                Mb, chosen, prev = [], [], None
                for k in np.unique(blk):
                    mk = blk == k
                    best = max(levels, key=lambda fl: np.nanmin(Mf[fl][mk]) if np.isfinite(Mf[fl][mk]).all() else 0)
                    v = M[best][mk].copy()
                    if prev is not None and best < prev:
                        n_pen = int(np.ceil(40 / seg)); v[:n_pen] -= 0.03
                    Mb.append(np.minimum(v, 1.7)); chosen.append(best); prev = best
                Mv = np.concatenate(Mb)
                res[pol] = (float(np.nanmean(np.where(np.isfinite(Mv), Mv, 1.0))), chosen)
            rows.append(dict(date=f[6:14], route=f"{o}-{d}", m550=res["fixed_550"][0], m2=res["best_450_550"][0], m3=res["best_350_450_550"][0],
                             lower_blocks=sum(c < 550 for c in res["best_450_550"][1]), blocks=len(res["best_450_550"][1])))
    g = lambda k: np.array([r[k] for r in rows])
    out = dict(routes=len(pts), dates=len(files), flights=len(rows),
               mean_boomless_mach_fixed550=round(float(g("m550").mean()), 4),
               gain_best_of_450_550=round(float((g("m2") - g("m550")).mean()), 4),
               gain_best_of_three=round(float((g("m3") - g("m550")).mean()), 4),
               share_blocks_lower_level=round(float(g("lower_blocks").sum() / g("blocks").sum()), 4),
               share_flights_gain_over_0_01=round(float(((g("m2") - g("m550")) > 0.01).mean()), 4),
               p95_gain=round(float(np.quantile(g("m2") - g("m550"), 0.95)), 4))
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "fl_choice.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
