"""
Forward reach of near-cutoff boom rays (issue #44): how far ahead of the aircraft the along-track ray lands when
the aircraft flies a little above its cutoff Mach (as it does while slowing down towards a coast).
60 random ocean columns of the live GFS run (2-degree profiles), 4 headings, FL550; cutoff Mach by bisection with
the ray tracer (floor = sea level), then rays at +0.002 ... +0.55. Output: study/results/forward_reach.json
Usage: python forward_reach.py  (reads site/data/prof_f000.bin and manifest.json)
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))
from rays import Profile, trace
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'data') + '/'
man = json.load(open(D + 'manifest.json')); P = man['profiles']; L = P['levels']; ny, nx = P['ny'], P['nx']
a = np.fromfile(D + 'prof_f000.bin', '<i2').astype(np.float32).reshape(4 * L + 1, ny, nx)
c, u, v, Z, g = a[:L] / 10, a[L:2*L] / 10, a[2*L:3*L] / 10, a[3*L:4*L], a[4*L]
rng = np.random.default_rng(1); za = 550 * 30.48
cols = [(j, i) for j in range(ny) for i in range(nx) if abs(90 - 2 * j) <= 60 and g[j, i] <= 5]
pick = [cols[k] for k in rng.choice(len(cols), 60, replace=False)]
DS = (0.002, 0.005, 0.01, 0.03, 0.1, 0.3, 0.55)
def work(ji):
    j, i = ji; res = {d: [] for d in DS}
    zz = Z[:, j, i]; o = np.argsort(zz)
    pr = Profile(zz[o], c[o, j, i], u[o, j, i], v[o, j, i])
    for hd in (0, 90, 180, 270):
        def hits(M): return trace(pr, za, M, hd, 0.0, z_floor=0.0, dt=0.5, t_max=900)['ground']
        lo, hi = 1.0005, 2.0
        if hits(lo): continue
        for _ in range(16):
            m = (lo + hi) / 2
            if hits(m): hi = m
            else: lo = m
        Mc = hi
        for d in DS:
            r = trace(pr, za, Mc + d, hd, 0.0, z_floor=0.0, dt=0.5, t_max=900)
            if r['ground']: res[d].append(math.hypot(r['x'][-1], r['y'][-1]) / 1000)
    return res
from multiprocessing import Pool
with Pool(2) as P_:
    parts = P_.map(work, pick)
out = {d: sum((p[d] for p in parts), []) for d in DS}
res = {str(d): dict(n=len(x), p50=round(float(np.median(x))), p90=round(float(np.quantile(x, .9))), p99=round(float(np.quantile(x, .99))), max=round(float(np.max(x)))) for d, x in out.items() if x}
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results', 'forward_reach.json'), 'w'), indent=1)
