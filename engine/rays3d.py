"""
3D ray tracing through the gridded forecast (issue #17): how wrong is the single-column assumption?

The map computes the cutoff Mach from the column under the aircraft, as if the atmosphere were the same all along
the ray (which travels 40-90 km before turning). Here the same Hamiltonian ray equations as rays.py are integrated
with horizontal gradients:
    dx/dt  = c k/|k| + w            dk/dt = -(grad c |k| + grad(u) k_x + grad(v) k_y)
through the live 2-degree profiles (sound speed, wind, height on 23 pressure levels; engine/build.py prof_f000.bin),
interpolated bilinearly in the horizontal and linearly in height, on a local tangent plane around the aircraft.

Study (main): random land columns within 60 degrees of latitude, 4 headings, FL550; the cutoff Mach (highest Mach
whose along-track ray turns above the floor = ground + 1 km) from the 3D field vs from the single column, by
bisection. Output: study/results/rays3d.json (difference distribution).
Usage: python rays3d.py [n_columns]
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "..", "site", "data")
R_E = 6371e3


class Field3D:
    """2-degree profile grid around (lat0, lon0), resampled once onto a uniform height grid (0-20 km, 200 m) with
    precomputed gradients; one trilinear interpolation returns (c, u, v) and their x, y, z gradients."""
    ZG = np.arange(0.0, 20001.0, 200.0)

    def __init__(self, prof, lat0, lon0, d=2.0, half=2):
        c, u, v, Z, g, lat_g, lon_g = prof
        j0 = int(round((lat_g[0] - lat0) / d)); i0 = int(round((lon0 - lon_g[0]) / d))
        js = [min(max(j0 + k, 0), c.shape[1] - 1) for k in range(half, -half - 1, -1)]      # south -> north
        is_ = [(i0 + k) % c.shape[2] for k in range(-half, half + 1)]
        self.y = np.array([(lat_g[j] - lat0) * math.pi / 180 * R_E for j in js])
        self.x = np.array([((((lon_g[i] - lon0) + 180) % 360) - 180) * math.pi / 180 * R_E * math.cos(math.radians(lat0)) for i in is_])
        nz, ny, nx = len(self.ZG), len(js), len(is_)
        G = np.empty((3, nz, ny, nx))
        for a, j in enumerate(js):
            for b, i in enumerate(is_):
                o = np.argsort(Z[:, j, i])
                for k, A in enumerate((c, u, v)):
                    G[k, :, a, b] = np.interp(self.ZG, Z[o, j, i], A[o, j, i])
        dz = self.ZG[1] - self.ZG[0]
        gz = np.gradient(G, dz, axis=1); gy = np.gradient(G, self.y, axis=2); gx = np.gradient(G, self.x, axis=3)
        # stack: c,u,v, dc/dx,du/dx,dv/dx, dc/dy,du/dy,dv/dy, dc/dz,du/dz,dv/dz
        self.S = np.concatenate([G, gx, gy, gz])
        self.ground = float(g[j0, i0 % c.shape[2]])

    def all(self, x, y, z):
        zg, xs, ys = self.ZG, self.x, self.y
        iz = min(max(int(z / (zg[1] - zg[0])), 0), len(zg) - 2); fz = (z - zg[iz]) / (zg[1] - zg[0])
        ix = min(max(int(np.searchsorted(xs, x)) - 1, 0), len(xs) - 2); fx = (x - xs[ix]) / (xs[ix + 1] - xs[ix])
        iy = min(max(int(np.searchsorted(ys, y)) - 1, 0), len(ys) - 2); fy = (y - ys[iy]) / (ys[iy + 1] - ys[iy])
        fz, fx, fy = min(max(fz, 0.0), 1.0), min(max(fx, 0.0), 1.0), min(max(fy, 0.0), 1.0)
        C = self.S[:, iz:iz + 2, iy:iy + 2, ix:ix + 2]
        w = np.array([1 - fz, fz])[:, None, None] * np.array([1 - fy, fy])[None, :, None] * np.array([1 - fx, fx])[None, None, :]
        return (C * w).sum(axis=(1, 2, 3))

    def at(self, x, y, z):
        r = self.all(x, y, z); return float(r[0]), float(r[1]), float(r[2])


def trace3d(F, z_a, M, psi_deg, z_floor, dt=0.5, t_max=900.0, column=False):
    """Along-track ray (alpha = 0) from the aircraft at (0, 0, z_a). column=True freezes the horizontal position used
    for the atmosphere at (0, 0): the single-column approximation. Returns True if the ray reaches z_floor."""
    c_a, u_a, v_a = F.at(0.0, 0.0, z_a)
    ex, ey = math.sin(math.radians(psi_deg)), math.cos(math.radians(psi_deg))
    cos_t = 1.0 / M; sin_t = math.sqrt(max(0.0, 1 - cos_t * cos_t))
    s = np.array([0.0, 0.0, z_a, cos_t * ex, cos_t * ey, -sin_t])
    def rhs(s):
        r = F.all(0.0, 0.0, s[2]) if column else F.all(s[0], s[1], s[2])
        c, u, v = r[0], r[1], r[2]
        gxc, gxu, gxv, gyc, gyu, gyv, gzc, gzu, gzv = r[3:]
        if column: gxc = gxu = gxv = gyc = gyu = gyv = 0.0
        K = math.sqrt(s[3] ** 2 + s[4] ** 2 + s[5] ** 2)
        return np.array([c * s[3] / K + u, c * s[4] / K + v, c * s[5] / K,
                         -(gxc * K + gxu * s[3] + gxv * s[4]), -(gyc * K + gyu * s[3] + gyv * s[4]), -(gzc * K + gzu * s[3] + gzv * s[4])])
    t = 0.0
    while t < t_max:
        k1 = rhs(s); k2 = rhs(s + 0.5 * dt * k1); k3 = rhs(s + 0.5 * dt * k2); k4 = rhs(s + dt * k3)
        s = s + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += dt
        if s[2] <= z_floor: return True
        if s[5] > 0 and s[2] >= z_a: return False
    return False


def cutoff(F, z_a, psi, z_floor, column):
    lo, hi = 1.0005, 1.6
    if trace3d(F, z_a, lo, psi, z_floor, column=column): return None
    for _ in range(14):
        m = 0.5 * (lo + hi)
        if trace3d(F, z_a, m, psi, z_floor, column=column): hi = m
        else: lo = m
    return 0.5 * (lo + hi)


def load_prof():
    man = json.load(open(os.path.join(D, "manifest.json"))); P = man["profiles"]; L = P["levels"]; ny, nx = P["ny"], P["nx"]
    a = np.fromfile(os.path.join(D, "prof_f000.bin"), "<i2").astype(np.float32).reshape(4 * L + 1, ny, nx)
    lat_g = P["lat0"] - P["d"] * np.arange(ny); lon_g = P["lon0"] + P["d"] * np.arange(nx)
    return (a[:L] / 10, a[L:2 * L] / 10, a[2 * L:3 * L] / 10, a[3 * L:4 * L], a[4 * L], lat_g, lon_g), man


def work(args):
    prof, lat, lon, za = args
    F = Field3D(prof, lat, lon); out = []
    for psi in (0, 90, 180, 270):
        zf = F.ground + 1000.0
        m3, m1 = cutoff(F, za, psi, zf, False), cutoff(F, za, psi, zf, True)
        if m3 and m1: out.append((lat, lon, psi, m1, m3))
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    prof, man = load_prof(); c, u, v, Z, g, lat_g, lon_g = prof
    rng = np.random.default_rng(5)
    cand = [(lat_g[j], lon_g[i]) for j in range(2, len(lat_g) - 2) for i in range(len(lon_g)) if abs(lat_g[j]) <= 60 and g[j, i] > 5]
    pick = [cand[k] for k in rng.choice(len(cand), n, replace=False)]
    from multiprocessing import Pool
    with Pool(2) as P_:
        parts = P_.map(work, [(prof, la, lo, 550 * 30.48) for la, lo in pick])
    rows = [r for p in parts for r in p]
    d = np.array([r[4] - r[3] for r in rows])
    out = dict(run=man["run"], cases=len(rows), fl=550, method="3D Hamiltonian rays through 2-degree profiles vs single column; floor ground + 1 km",
               diff_3d_minus_column=dict(mean=round(float(d.mean()), 4), sd=round(float(d.std()), 4), p5=round(float(np.quantile(d, .05)), 4),
                                         p95=round(float(np.quantile(d, .95)), 4), abs_p95=round(float(np.quantile(np.abs(d), .95)), 4)),
               share_3d_lower=round(float((d < 0).mean()), 3), rows=[[round(float(x), 4) for x in r] for r in rows])
    json.dump(out, open(os.path.join(HERE, "..", "study", "results", "rays3d.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    main()
