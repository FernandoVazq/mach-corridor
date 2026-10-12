"""
Hindcast scored in the rule's own unit (issue #37): flights whose boom puts more than 0.11 psf on the ground.

Same held-out set-up as robust_eval.py (53 weekly dates, 48 routes, k fitted on one half-year, tested on the
other, shared real-world error field L = 300 nm), with two changes:
  1. Event = ground overpressure > 0.11 psf (and > 0.05), not "any ray below the 1 km floor". On each regulated
     sample the true turning point sits H = 1 km + (true limit - flown Mach) / 1.28e-5 Mach/m above the terrain
     (the map's limit puts it at 1 km; DMDZ from the sensitivity study). Ground psf from the exact caustic model
     (engine/caustic.py, tabulated per level; x1.25 as a sensitivity); below 0.6 Haglund heights, where the
     linear model is unreliable, the full primary boom (Carlson) x2 for focusing.
  2. "Shipped" = the router as it flies today: the margin plus the aircraft's quiet-height cushion
     (bufferPenalty). "As calibrated" = margin only, as in robust_eval.
Aircraft: Boom Overture class (160 t, 61 m). Output: study/results/psf_eval.json
Usage: python psf_eval.py <study-data> <gefs-data>
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
import robust_eval as RE                                   # noqa: E402  (loads the hindcast)
from caustic import aircraft_wave, haglund, depth_for, ground_psf as model_psf, isa, PSF   # noqa: E402
from boom import carlson, lift_parameter                   # noqa: E402

W_T, L_AC, R_TYP, DMDZ = 160.0, 61.0, 89e3, 0.0064 / 500
LIMITS = (0.11, 0.05)


def aircraft_at(fl, M=1.15):
    h = fl * 100 * 0.3048
    dp, T = aircraft_wave(W_T, L_AC, M, h, 1500); sig = T * isa(1500)[2]; dzs = haglund(R_TYP, sig)
    q = depth_for(W_T, L_AC, M, h, R_TYP, 0.11)
    _, pv, av = isa(h); _, pg, _ = isa(0)
    KL = lift_parameter(M, W_T * 1000 * 9.80665, pv, L_AC); KS = max(0.06, 0.85 * math.sqrt(KL))
    full = carlson(M, h, pv, pg, av, L_AC, KS)[0] / PSF
    # exact caustic model tabulated once per level (r = height of the turning point in Haglund heights)
    rg = np.linspace(0.6, 4.0, 35)
    tab = np.array([model_psf(W_T, L_AC, M, h, x * dzs, R_TYP)[0] for x in rg])
    return dict(dp=dp / PSF, sig=sig, dzs=dzs, quiet=q, pen=min(0.0, (q - 1000) * -DMDZ), full=full, rg=rg, tab=tab)


SCALE = [1.0]          # 1.0 = exact model; 1.25 = the site's conservative display factor (sensitivity)


def ground_psf(H, ac):
    r = np.atleast_1d(H / ac["dzs"])
    lp = np.interp(r, ac["rg"], np.log(ac["tab"]), right=-30)
    return np.where(r < 0.6, 2 * ac["full"], SCALE[0] * np.exp(lp))


def run(fl, margin_of, dates_, E, ac, shipped):
    per = {}
    for d in dates_:
        rows = []
        for r in RE.routes:
            if r["reg"].sum() == 0: continue
            smp = RE.S[(r["name"], d, fl)]
            kb = (r["name"], d, fl)
            if kb not in RE.TB: RE.TB[kb] = RE.fly(r, smp, RE.M_SUB)[0]
            Mf = RE.MFS[kb] - margin_of(r, d) + (ac["pen"] if shipped else 0.0)
            M = np.where(Mf >= RE.FLOOR, np.minimum(Mf, RE.DESIGN), RE.M_SUB)
            t, _, Mfl = RE.fly(r, smp, M)
            truth = smp["Mt"] + E[d][r["name"]]
            sup = r["reg"] & (Mfl > 1.0)
            H = 1000.0 + (truth - Mfl) / DMDZ
            psf = np.zeros(len(H)); idx = np.where(sup & (H < 4 * ac["dzs"]))[0]
            if len(idx): psf[idx] = ground_psf(H[idx], ac)
            any_boom = (sup & (Mfl > truth + 1e-6)).any()
            pmax = float(psf.max()) if len(psf) else 0.0
            rows.append((pmax > LIMITS[0], pmax > LIMITS[1], any_boom, 60 * (RE.TB[kb] - t), pmax))
        per[d] = np.array(rows, float)
    return per


def boot(per, dates_, col, B=1000, seed=3):
    rng = np.random.default_rng(seed); v = []
    for _ in range(B):
        ds = rng.choice(dates_, len(dates_))
        v.append(100 * np.concatenate([per[d] for d in ds])[:, col].mean())
    return [round(float(np.quantile(v, 0.025)), 2), round(float(np.quantile(v, 0.975)), 2)]


def main():
    RJ = json.load(open(os.path.join(RE.OUT, "robust_eval.json")))["results"]
    E = RE.fields(300, seed=11)
    out = {"aircraft": "Boom Overture class (160 t, 61 m)", "results": {}}
    for fl in RE.FLE:
        ac = aircraft_at(fl); RE.FL_[0] = fl
        out.setdefault("cushion", {})[f"FL{fl}"] = dict(haglund_m=round(ac["dzs"]), quiet_m=round(ac["quiet"]), mach_penalty=round(ac["pen"], 4),
                                                       primary_psf=round(ac["full"], 2))
        for pol, scale in (("ensemble", 1.0), ("uniform", 1.0), ("ensemble", 1.25)):
            SCALE[0] = scale
            fits = RJ[f"L300_FL{fl}_any_{pol}"]
            for shipped in ((True, False) if scale == 1.0 else (True,)):
                res = []
                for f in fits:
                    par = f["par"]; td = RE.H2 if f["fit"] == "H1" else RE.H1
                    mk = (lambda r, d, par=par: par * np.sqrt(RE.SD[(r["name"], d, fl)] ** 2 + RE.S_EXTRA ** 2)) if pol == "ensemble" else (lambda r, d, par=par: par)
                    per = run(fl, mk, td, E, ac, shipped)
                    A = np.concatenate([per[d] for d in td])
                    ev = A[A[:, 0] > 0, 4]
                    res.append(dict(fit=f["fit"], par=par, gt011=round(100 * A[:, 0].mean(), 2), gt011_ci95=boot(per, td, 0),
                                    gt005=round(100 * A[:, 1].mean(), 2), any_boom=round(100 * A[:, 2].mean(), 2), saved_min=round(float(A[:, 3].mean()), 2),
                                    median_psf_when_over=round(float(np.median(ev)), 2) if len(ev) else None))
                key = f"FL{fl}_{pol}_{'shipped' if shipped else 'calibrated'}" + ("" if scale == 1.0 else "_psf_x1.25")
                out["results"][key] = res; print(key, res, flush=True)
    json.dump(out, open(os.path.join(RE.OUT, "psf_eval.json"), "w"), indent=1)
    print("wrote psf_eval.json")


if __name__ == "__main__":
    main()
