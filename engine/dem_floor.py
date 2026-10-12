"""
Terrain under the boom footprint from a real DEM (issue #42).

The map's floor is the highest GFS 0.25-degree terrain within +/-0.5 degree of each 1-degree node, plus 1 km. GFS
orography is smoothed (~28 km cells), so real peaks stand higher. This job takes, for every node whose GFS
footprint max exceeds 300 m, the highest elevation in a Terrarium DEM (AWS Open Data elevation-tiles-prod,
SRTM/GMTED/ETOPO blend; zoom 8, about 600 m pixels at the equator) over the same +/-0.5 degree footprint.

Outputs
  engine/data/dem_footprint_max.npy   int16 (181, 360), lat 90..-90, lon 0..359 (GFS order); 0 where not computed
  study/results/dem_floor.json        how much higher the DEM is than GFS, by band, and the Mach it costs
The forecast build takes floor terrain = max(GFS footprint, DEM footprint).
Usage: python dem_floor.py [--zoom 8] [--out-dir ..]
"""
import argparse, io, json, math, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import requests
from PIL import Image

import build
from physics import footprint_max

TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DMDZ = 0.0064 / 500


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    la = math.radians(max(-85.0, min(85.0, lat)))
    y = (1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n
    return x, y


def fetch_tile(z, x, y, S):
    for k in range(3):
        try:
            r = S.get(TILE.format(z=z, x=x, y=y), timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            a = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), np.float32)
            return (a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768).astype(np.float32)
        except Exception:
            time.sleep(2 * (k + 1))
    return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--zoom", type=int, default=8)
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    a = ap.parse_args(); z = a.zoom; n = 2 ** z
    run = build.latest_run()
    q = build.fetch(run, 0, {("HGT", "surface")}, res="0p25")[("HGT", "surface")]
    gfs = np.maximum(footprint_max(q, radius_cells=2), 0)                       # (181, 360)
    nodes = [(j, i) for j in range(181) for i in range(360) if gfs[j, i] > 300 and abs(90 - j) <= 75]
    print(run, "nodes", len(nodes), flush=True)
    # tiles each node's footprint touches
    need, foot = set(), {}
    for j, i in nodes:
        lat, lon = 90 - j, ((i + 180) % 360) - 180
        x0, y0 = tile_xy(lat + 0.5, lon - 0.5, z); x1, y1 = tile_xy(lat - 0.5, lon + 0.5, z)
        foot[(j, i)] = (x0, y0, x1, y1)
        for x in range(int(x0), int(x1) + 1):
            for y in range(int(y0), int(y1) + 1):
                need.add((x % n, y))
    print("tiles", len(need), flush=True)
    S = requests.Session(); tiles = {}
    t0 = time.time()
    with ThreadPoolExecutor(16) as ex:
        for k, (key, arr) in enumerate(zip(need, ex.map(lambda t: fetch_tile(z, t[0], t[1], S), need))):
            tiles[key] = None if arr is None else arr
            if k % 500 == 0: print(k, "tiles", round(time.time() - t0), "s", flush=True)
    dem = np.zeros((181, 360), np.float32)
    for (j, i), (x0, y0, x1, y1) in foot.items():
        best = -1e9
        for x in range(int(x0), int(x1) + 1):
            for y in range(int(y0), int(y1) + 1):
                t = tiles.get((x % n, y))
                if t is None: continue
                px0 = int(max(0, (x0 - x) * 256)); px1 = int(min(256, math.ceil((x1 - x) * 256)))
                py0 = int(max(0, (y0 - y) * 256)); py1 = int(min(256, math.ceil((y1 - y) * 256)))
                if px1 > px0 and py1 > py0:
                    best = max(best, float(t[py0:py1, px0:px1].max()))
        dem[j, i] = max(0.0, best)
    d = (dem - gfs)[[j for j, _ in nodes], [i for _, i in nodes]]
    g = gfs[[j for j, _ in nodes], [i for _, i in nodes]]
    w = np.cos(np.radians(90 - np.array([j for j, _ in nodes])))
    def q_(x, p): o = np.argsort(x); cw = np.cumsum(w[o]) / w.sum(); return float(x[o][np.searchsorted(cw, p)])
    bands = []
    for lo, hi in ((300, 1000), (1000, 2000), (2000, 3500), (3500, 9000)):
        m = (g >= lo) & (g < hi)
        if m.sum():
            x = d[m]; ww = w[m]; o = np.argsort(x); cw = np.cumsum(ww[o]) / ww.sum()
            bands.append(dict(gfs_footprint_m=f"{lo}-{hi}", nodes=int(m.sum()), dem_minus_gfs_median_m=round(float(x[o][np.searchsorted(cw, .5)])),
                              p90_m=round(float(x[o][np.searchsorted(cw, .9)])), max_m=round(float(x.max())),
                              mach_cost_median=round(float(x[o][np.searchsorted(cw, .5)]) * DMDZ, 4)))
    out = dict(run=run, zoom=z, nodes=len(nodes), tiles=len(need), missing_tiles=sum(v is None for v in tiles.values()),
               dem_minus_gfs=dict(median_m=round(q_(d, .5)), p90_m=round(q_(d, .9)), p99_m=round(q_(d, .99)), share_higher=round(float((w * (d > 0)).sum() / w.sum()), 3)),
               bands=bands, mach_per_m=DMDZ)
    print(json.dumps(out, indent=1))
    os.makedirs(os.path.join(a.out_dir, "engine", "data"), exist_ok=True); os.makedirs(os.path.join(a.out_dir, "study", "results"), exist_ok=True)
    np.save(os.path.join(a.out_dir, "engine", "data", "dem_footprint_max.npy"), np.round(dem).astype(np.int16))
    json.dump(out, open(os.path.join(a.out_dir, "study", "results", "dem_floor.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
