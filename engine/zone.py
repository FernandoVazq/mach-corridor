"""
Regulated zone raster (issue #2): great-circle distance from national territory, 0.1 degree.

Territory = Natural Earth 10 m land + minor islands + lakes (internal waters, e.g. the Great Lakes).
Distance is measured on the sphere to the nearest coastline vertex (Natural Earth 10 m, densified to
<= 0.01 deg), so the 12 nm territorial sea and the 24 nm boom-carpet half-width are true distance bands,
not a box dilation of a coarse grid.

Output site/geo/zone.png, 8-bit grayscale, 3600 x 1800, lon -180..180, lat 90..-90 (cell centres):
  0       territory (land, islands, lakes)
  1..64   distance to territory, nautical miles (rounded up)
  255     more than 64 nm
Usage: python zone.py <natural-earth geojson dir> [out.png]
"""
import json, math, os, sys, time
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
import shapely
from shapely.geometry import shape

NM_R = 3440.065
RES = 0.1
NX, NY = int(360 / RES), int(180 / RES)
CAP = 64


def polys(path):
    out = []
    for f in json.load(open(path))["features"]:
        g = shape(f["geometry"])
        out += list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    return out


def densify(coords, step=0.01):
    c = np.asarray(coords)[:, :2]
    seg = np.diff(c, axis=0)
    n = np.maximum(1, np.ceil(np.abs(seg).max(axis=1) / step)).astype(int)
    pts = [c[i] + seg[i] * (np.arange(n[i])[:, None] / n[i]) for i in range(len(seg))]
    return np.vstack(pts + [c[-1:]])


def xyz(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def main(src, out):
    t0 = time.time()
    land = polys(os.path.join(src, "ne_10m_land.geojson")) + polys(os.path.join(src, "ne_10m_minor_islands.geojson"))
    lakes = polys(os.path.join(src, "ne_10m_lakes.geojson"))
    lon = -180 + RES * (np.arange(NX) + 0.5)
    lat = 90 - RES * (np.arange(NY) + 0.5)
    terr = np.zeros((NY, NX), bool)
    for p in land + lakes:
        x0, y0, x1, y1 = p.bounds
        i0, i1 = np.searchsorted(lon, x0), np.searchsorted(lon, x1)
        j0, j1 = np.searchsorted(-lat, -y1), np.searchsorted(-lat, -y0)
        if i1 <= i0 or j1 <= j0:
            continue
        LO, LA = np.meshgrid(lon[i0:i1], lat[j0:j1])
        terr[j0:j1, i0:i1] |= shapely.contains_xy(p, LO, LA)
    print(f"territory raster {terr.mean() * 100:.1f}% of cells, {time.time() - t0:.0f}s", flush=True)

    coast = np.vstack([densify(r.coords) for p in land for r in [p.exterior, *p.interiors]])
    tree = cKDTree(xyz(coast[:, 0], coast[:, 1]))
    print(f"{len(coast):,} coastline points, {time.time() - t0:.0f}s", flush=True)

    LO, LA = np.meshgrid(lon, lat)
    sea = ~terr
    chord_cap = 2 * math.sin(CAP / NM_R / 2)
    d, _ = tree.query(xyz(LO[sea], LA[sea]), distance_upper_bound=chord_cap * 1.001, workers=-1)
    nm = np.where(np.isfinite(d), 2 * np.arcsin(np.minimum(d, 2) / 2) * NM_R, np.inf)
    v = np.full((NY, NX), 255, np.uint8)
    v[terr] = 0
    v[sea] = np.where(nm <= CAP, np.clip(np.ceil(nm), 1, CAP), 255).astype(np.uint8)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.fromarray(v, "L").save(out, optimize=True)
    zone = v <= 36
    print(f"wrote {out}: {os.path.getsize(out) / 1e3:.0f} kB; regulated (<= 36 nm) {zone.mean() * 100:.1f}% of cells; "
          f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "site", "geo", "zone.png"))
