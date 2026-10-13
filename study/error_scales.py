"""
Deep study 3 (Oct 2026): how far apart do forecast errors stop moving together?

The router's flight probability treats legs within 300 nm as one draw (route.js CHUNK_NM), and the hindcast's
real-world error field uses a 300 nm correlation. Here: the 24 h GFS forecast error of the boomless Mach
(f24 - analysis, 53 weekly dates, study-data) at land nodes, FL350/450/550, direction 270 and the worst direction;
correlation of errors between node pairs binned by great-circle distance (50 000 random pairs per date), and the
e-folding distance (correlation 1/e) from a fitted exp(-d/L).

Output: study/results/error_scales.json. Usage: python error_scales.py [study data dir]
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/study_data"
STEP = 0.0025
BINS = np.array([0, 100, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000])     # nm


def decode(a):
    a = a.astype(np.float32)
    return np.where(a > 0, 1 + STEP * a, np.nan)


def main():
    files = sorted(f for f in os.listdir(DATA) if f.startswith("study_") and f.endswith(".npz"))
    rng = np.random.default_rng(7)
    lat = np.linspace(90, -90, 181); lon = np.arange(360.0)
    out = {}
    for fl in (350, 450, 550):
        for mode in ("h270", "worst"):
            sums = np.zeros(len(BINS) - 1); cnt = np.zeros(len(BINS) - 1); pairs = {i: [] for i in range(len(BINS) - 1)}
            for f in files:
                z = np.load(os.path.join(DATA, f))
                land = z["land"] > 127
                if mode == "h270":
                    e = decode(z[f"f24_{fl}_M"][27]) - decode(z[f"ana_{fl}_M"][27])
                else:
                    e = np.nanmin(decode(z[f"f24_{fl}_M"]), 0) - np.nanmin(decode(z[f"ana_{fl}_M"]), 0)
                J, I = np.where(land & np.isfinite(e) & (np.abs(lat)[:, None] <= 70))
                if len(J) < 100:
                    continue
                ev = e[J, I]; ev = ev - ev.mean()
                a = rng.integers(0, len(J), 50000); b = rng.integers(0, len(J), 50000)
                p1, l1, p2, l2 = np.radians(lat[J[a]]), np.radians(lon[I[a]]), np.radians(lat[J[b]]), np.radians(lon[I[b]])
                d = 3440.065 * np.arccos(np.clip(np.sin(p1) * np.sin(p2) + np.cos(p1) * np.cos(p2) * np.cos(l1 - l2), -1, 1))
                k = np.digitize(d, BINS) - 1
                for i in range(len(BINS) - 1):
                    m = k == i
                    if m.sum() > 10:
                        pairs[i].append(np.stack([ev[a[m]], ev[b[m]]]))
            corr = []
            for i in range(len(BINS) - 1):
                if pairs[i]:
                    x = np.concatenate(pairs[i], axis=1)
                    corr.append(round(float(np.corrcoef(x[0], x[1])[0, 1]), 3))
                else:
                    corr.append(None)
            mids = 0.5 * (BINS[1:] + BINS[:-1])
            ok = [(m, c) for m, c in zip(mids, corr) if c is not None and c > 0.02]
            Ls = np.array([m for m, _ in ok]); Cs = np.array([c for _, c in ok])
            L = float(-np.sum(Ls * Ls) / np.sum(Ls * np.log(Cs))) if len(ok) > 2 else None   # LSQ of ln c = -d/L through 0
            out[f"FL{fl}_{mode}"] = dict(bin_nm=[f"{lo}-{hi}" for lo, hi in zip(BINS[:-1], BINS[1:])], corr=corr,
                                         efold_nm=round(L) if L else None)
            print(fl, mode, corr, round(L) if L else None, flush=True)
    json.dump(dict(source="study-data: 53 weekly GFS f24 vs analysis, Oct 2025 - Oct 2026, land nodes within 70 deg",
                   method="correlation of de-meaned errors between random node pairs by great-circle distance; "
                          "e-folding from ln(corr) = -d/L (bins with corr > 0.02)", **out),
              open(os.path.join(HERE, "results", "error_scales.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
