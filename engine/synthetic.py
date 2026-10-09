"""Synthetic GFS-like fields for offline development/testing (no network).
Usage: python synthetic.py LAND_TOPOJSON OUT_DIR"""
import json, sys
import numpy as np
from matplotlib.path import Path
import build

lat = np.linspace(90, -90, 181)[:, None] * np.ones((1, 360))
lon = np.arange(0, 360)[None, :] * np.ones((181, 1))


def land_mask(topo_path):
    topo = json.load(open(topo_path))
    sc, tr = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for a in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(np.array(pts))
    def ring(ix):
        pts = [arcs[i] if i >= 0 else arcs[~i][::-1] for i in ix]
        return np.vstack(pts)
    L = np.where(lon > 180, lon - 360, lon)
    P = np.column_stack([L.ravel(), lat.ravel()])
    m = np.zeros(P.shape[0], bool)
    for g in topo["objects"]["land"]["geometries"]:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for k, r in enumerate(poly):
                inside = Path(ring(r)).contains_points(P)
                m = m ^ inside if k else m | inside
    return m.reshape(lat.shape).astype(np.float32)


def fields(fh, land):
    phi = np.radians(lat); lam = np.radians(lon)
    Tsfc = 300 - 45 * np.sin(phi) ** 2 + 6 * land * np.cos(2 * np.pi * fh / 24 + lam)
    ztp = 16500 - 6500 * np.sin(phi) ** 2
    Zs = land * 600 + land * 2500 * np.exp(-((lat - 33) ** 2 / 30 + ((lon - 85) % 360) ** 2 / 120))
    out = {}
    for p in build.PLEV:
        z = np.where(p > 226.32, (1 - (p / 1013.25) ** (1 / 5.25588)) / 2.25577e-5,
                     11000 - 6341.62 * np.log(p / 226.32)) * np.ones_like(lat)
        T = np.where(z < ztp, Tsfc - 6.5e-3 * z, Tsfc - 6.5e-3 * ztp + 1.5e-3 * (z - ztp))
        jet = np.exp(-((np.abs(lat) - 38 - 5 * np.sin(3 * lam + fh / 10)) / 9) ** 2) * np.exp(-((z - 11000) / 4000) ** 2)
        U = 45 * jet - 8 * np.exp(-(lat / 12) ** 2) * np.exp(-((z - 14000) / 3000) ** 2)
        V = 12 * jet * np.cos(3 * lam + fh / 10)
        out[("TMP", f"{p} mb")] = T; out[("UGRD", f"{p} mb")] = U
        out[("VGRD", f"{p} mb")] = V; out[("HGT", f"{p} mb")] = z
    out[("HGT", "surface")] = Zs; out[("TMP", "2 m above ground")] = Tsfc - 6.5e-3 * Zs
    out[("UGRD", "10 m above ground")] = 4 * np.ones_like(lat); out[("VGRD", "10 m above ground")] = 0 * lat
    out[("LAND", "surface")] = land
    return {k: v.astype(np.float32) for k, v in out.items()}


if __name__ == "__main__":
    land = land_mask(sys.argv[1])
    build.fetch_fields = lambda run, fh, grib_dir=None: fields(fh, land)
    build.build("2026100912", sys.argv[2])
