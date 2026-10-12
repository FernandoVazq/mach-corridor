"""
Honest calibration of the margin (answers the method red team, findings 1, 4, 5, 6).

Changes from margin.py / gefs_eval.py:
  * time hold-out: k is fitted on one half of the year and tested on the other (both ways)
  * the "real-world" error is one spatial field per date shared by every route (no independent noise for
    overlapping or reversed routes), Gaussian covariance, correlation length L (sensitivity 100/300/1000 nm)
  * two exposure events: any boom on the ground (> 0 nm) and > 20 nm
  * forecast Mach is never interpolated across a no-corridor column (as the shipped router)
  * 95% intervals from a block bootstrap over dates (the date is the independent unit)
Usage: python robust_eval.py <study-data> <gefs-data>
"""
import glob, json, math, os, sys
import numpy as np
from scipy.ndimage import gaussian_filter

GEFS = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/study_data_gefs"
sys.argv = sys.argv[:2]
from common import *                     # noqa: E402

S_EXTRA, GATE = 0.012, 0.5
FLE = (350, 450, 550)
gf = {os.path.basename(f)[11:19]: f for f in glob.glob(os.path.join(GEFS, "study_gefs_*.npz"))}
D = [d for d in dates if d in gf]
H1, H2 = D[:len(D) // 2], D[len(D) // 2:]
print(len(D), "dates;", H1[0], "-", H1[-1], "|", H2[0], "-", H2[-1])


def safe_heading(Menc, lat, lon, brg):
    """forecast Mach along a heading, 0.98 if any of the 4 nodes of either bracketing direction has no corridor"""
    fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
    i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
    i1 = (i0 + 1) % 360
    h = brg / 10.0; k0 = np.floor(h).astype(int) % 36; k1 = (k0 + 1) % 36
    zero = np.zeros(len(lat), bool)
    for k in (k0, k1):
        for jj, ii in ((j0, i0), (j0, i1), (j0 + 1, i0), (j0 + 1, i1)):
            zero |= Menc[k, jj, ii] == 0
    return np.where(zero, 0.98, m_heading(Menc, lat, lon, brg))


# ---------- per (route, date, fl): safe forecast, ensemble spread ----------
MFS, SD = {}, {}
for d in D:
    z, g = np.load(os.path.join(DATA, f"study_{d}.npz")), np.load(gf[d])
    for fl in FLE:
        Mf, sdg = z[f"f24_{fl}_M"], g[f"gefs_{fl}_sd"]
        for r in routes:
            if r["reg"].sum() == 0: continue
            MFS[(r["name"], d, fl)] = safe_heading(Mf, r["lat"], r["lon"], r["brg"])
            lat, lon, brg = r["lat"], r["lon"], r["brg"]
            fi, fj = np.mod(lon, 360.0), np.clip(90.0 - lat, 0, 180)
            i0, j0 = np.floor(fi).astype(int) % 360, np.minimum(np.floor(fj).astype(int), 179)
            di, dj, i1 = fi - np.floor(fi), fj - j0, (np.floor(fi).astype(int) + 1) % 360
            h = brg / 10.0; k0 = np.floor(h).astype(int) % 36; k1 = (k0 + 1) % 36
            at = lambda k: ((sdg[k, j0, i0] * (1 - di) + sdg[k, j0, i1] * di) * (1 - dj) + (sdg[k, j0 + 1, i0] * (1 - di) + sdg[k, j0 + 1, i1] * di) * dj) * 0.0005
            SD[(r["name"], d, fl)] = np.maximum(at(k0), at(k1))
print("sampled", flush=True)


# ---------- static sigma map fitted on a set of dates ----------
def sigma_route(fit_dates):
    out = {}
    for fl in FLE:
        s2 = np.zeros((181, 360)); n = np.zeros((181, 360))
        for d in fit_dates:
            z = np.load(os.path.join(DATA, f"study_{d}.npz"))
            a, b = z[f"ana_{fl}_M"].astype(np.int16), z[f"f24_{fl}_M"].astype(np.int16)
            ok = (a > 0) & (a < 255) & (b > 0) & (b < 255)
            e = np.where(ok, (b - a) * 0.0025, 0.0)
            s2 += (e * e).sum(0); n += ok.sum(0)
        w = gaussian_filter(n, 1.5, mode="wrap")
        rms = np.sqrt(gaussian_filter(s2, 1.5, mode="wrap") / np.maximum(w, 1))
        rms = np.where(w < 30, math.sqrt(s2.sum() / n.sum()), rms)
        sg = np.sqrt(rms ** 2 + S_EXTRA ** 2)
        for r in routes:
            if r["reg"].sum(): out[(r["name"], fl)] = bilin(sg, r["lat"], r["lon"])
    return out


SIG = {"H1": sigma_route(H1), "H2": sigma_route(H2)}
print("sigma maps", flush=True)

# ---------- shared spatial error field per date ----------
XYZ = {r["name"]: np.stack([np.cos(np.radians(r["lat"])) * np.cos(np.radians(r["lon"])),
                            np.cos(np.radians(r["lat"])) * np.sin(np.radians(r["lon"])), np.sin(np.radians(r["lat"]))], -1)
       for r in routes}


def fields(L_nm, seed, nmodes=400):
    """{date: {route: error array}}; Gaussian covariance exp(-chord^2 / 2 l^2), l = L_nm / 3440 rad"""
    rng = np.random.default_rng(seed); out = {}
    l = L_nm / 3440.065
    for d in D:
        k = rng.normal(0, 1 / l, (nmodes, 3)); ph = rng.uniform(0, 2 * np.pi, nmodes)
        out[d] = {n: S_EXTRA * math.sqrt(2 / nmodes) * np.cos(x @ k.T + ph).sum(-1) for n, x in XYZ.items()}
    return out


TB = {}


def run(fl, margin_of, dates_, E):
    """per-date lists of (any boom, >20 nm, saved min) over routes"""
    per = {}
    for d in dates_:
        rows = []
        for r in routes:
            if r["reg"].sum() == 0: continue
            smp = S[(r["name"], d, fl)]
            kb = (r["name"], d, fl)
            if kb not in TB: TB[kb] = fly(r, smp, M_SUB)[0]
            tb = TB[kb]
            Mf = MFS[(r["name"], d, fl)] - margin_of(r, d)
            M = np.where(Mf >= FLOOR, np.minimum(Mf, DESIGN), M_SUB)
            t, _, Mfl = fly(r, smp, M)
            truth = smp["Mt"] + E[d][r["name"]]
            over = r["reg"] & (Mfl > 1.0) & (Mfl > truth + 1e-6)
            nm = over.sum() * r["seg"]
            rows.append((nm > 0, nm > 20, 60 * (tb - t)))
        per[d] = np.array(rows, float)
    return per


def summ(per, dates_):
    A = np.concatenate([per[d] for d in dates_])
    return 100 * A[:, 0].mean(), 100 * A[:, 1].mean(), A[:, 2].mean()


def boot_ci(per, dates_, col, B=1000, seed=3):
    rng = np.random.default_rng(seed); v = []
    for _ in range(B):
        ds = rng.choice(dates_, len(dates_))
        v.append(100 * np.concatenate([per[d] for d in ds])[:, col].mean())
    return float(np.quantile(v, 0.025)), float(np.quantile(v, 0.975))


FL_ = [550]


def main():
    POL = {
        "uniform": (np.round(np.arange(0.04, 0.10, 0.005), 3), lambda par, fit: (lambda r, d: par)),
        "static": (np.round(np.arange(3.0, 7.01, 0.25), 2), lambda par, fit: (lambda r, d: par * SIG[fit][(r["name"], FL_[0])])),
        "ensemble": (np.round(np.arange(3.0, 7.01, 0.25), 2), lambda par, fit: (lambda r, d: par * np.sqrt(SD[(r["name"], d, FL_[0])] ** 2 + S_EXTRA ** 2))),
    }
    results = {}
    for L in (300, 100, 1000):
        E = fields(L, seed=11)
        for fl in (FLE if L == 300 else (550,)):
            FL_[0] = fl
            for event, col in (("any", 0), (">20nm", 1)):
                for pol, (pars, mk) in POL.items():
                    res = []
                    for fit, test in (("H1", "H2"), ("H2", "H1")):
                        fd, td = (H1, H2) if fit == "H1" else (H2, H1)
                        curve = []
                        for par in pars:
                            per_fit = run(fl, mk(par, fit), fd, E)
                            s3 = summ(per_fit, fd); ev, sv = s3[col], s3[2]
                            curve.append((par, ev, sv))
                            if ev <= GATE: break                       # pars increase -> exposure falls; first that meets the gate
                        par = curve[-1][0]
                        per_test = run(fl, mk(par, fit), td, E)
                        a_any, a_20, sv = summ(per_test, td)
                        lo, hi = boot_ci(per_test, td, col)
                        res.append(dict(fit=fit, par=float(par), test_any=round(a_any, 2), test_gt20=round(a_20, 2), test_saved=round(sv, 2),
                                        ci95=[round(lo, 2), round(hi, 2)], fit_event=round(curve[-1][1], 2)))
                    key = f"L{L}_FL{fl}_{event}_{pol}"
                    results[key] = res
                    print(key, res, flush=True)
    json.dump(dict(dates=len(D), halves=[[H1[0], H1[-1]], [H2[0], H2[-1]]], gate=GATE, results=results),
              open(os.path.join(OUT, "robust_eval.json"), "w"), indent=1)
    print("done")


if __name__ == "__main__":
    main()
