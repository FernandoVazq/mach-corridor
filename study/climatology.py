"""
Climatology atlas for network planners (issue #30).

From the 53 weekly GFS analyses (Oct 2025 - Oct 2026, study-data), per 1-degree cell, flight level and season:
the share of (days x 36 directions of travel) whose boomless Mach is at least 1.15 at the map's floor, i.e. a
corridor of at least M1.10 after a typical 0.05 margin. Read it as "the chance that a given heading has a usable
corridor here on a given day". Also the median boomless Mach over days and directions.

Seasons: annual, DJF, MAM, JJA, SON (12-14 weekly dates each). Weekly dates at 00 UTC only.
Outputs: site/geo/clim.png (grayscale atlas, 5 columns = periods, 3 rows = FL350/450/550, tiles 360 x 181,
lon -180..179, lat 90..-90, value = share x 250; 255 = no data) and site/geo/clim.json (meta + regional summary).
Usage: python climatology.py <study-data>
"""
import glob, json, os, sys
import numpy as np
from PIL import Image

DATA = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/study_data"
HERE = os.path.dirname(os.path.abspath(__file__))
FLS = (350, 450, 550)
PERIODS = {"Year": range(1, 13), "Dec-Feb": (12, 1, 2), "Mar-May": (3, 4, 5), "Jun-Aug": (6, 7, 8), "Sep-Nov": (9, 10, 11)}
M_STEP, THRESH = 0.0025, 1.15
REGIONS = {  # lon0, lon1, lat0, lat1
    "Contiguous US": (-125, -67, 25, 49), "Europe": (-10, 30, 36, 60), "China": (100, 122, 22, 42),
    "Australia": (115, 153, -38, -18), "Brazil": (-60, -35, -30, -3), "Middle East": (35, 60, 15, 35),
}


def main():
    files = sorted(glob.glob(os.path.join(DATA, "study_*.npz")))
    months = np.array([int(os.path.basename(f)[10:12]) for f in files])
    print(len(files), "dates")
    land = np.load(files[0])["land"] > 0
    ok_sum = {(fl, p): np.zeros((181, 360)) for fl in FLS for p in PERIODS}
    n = {(fl, p): 0 for fl in FLS for p in PERIODS}
    vals = {fl: [] for fl in FLS}
    for f, mo in zip(files, months):
        z = np.load(f)
        for fl in FLS:
            e = z[f"ana_{fl}_M"].astype(np.float32)                  # (36, 181, 360), 0 = no corridor
            M = np.where(e > 0, 1.0 + e * M_STEP, 0.98)
            share = (M >= THRESH).mean(0)                              # over directions
            vals[fl].append(np.median(M, axis=0))
            for p, ms in PERIODS.items():
                if mo in ms:
                    ok_sum[(fl, p)] += share; n[(fl, p)] += 1
    atlas = np.full((181 * len(FLS), 360 * len(PERIODS)), 255, np.uint8)
    summary = {}
    lat = 90 - np.arange(181); lon = ((np.arange(360) + 180) % 360) - 180
    for r, fl in enumerate(FLS):
        for c, p in enumerate(PERIODS):
            sh = ok_sum[(fl, p)] / max(n[(fl, p)], 1)                   # GFS order: lon 0..359
            tile = np.roll(np.round(sh * 250).astype(np.uint8), 180, axis=1)   # -> lon -180..179
            atlas[r * 181:(r + 1) * 181, c * 360:(c + 1) * 360] = tile
            for name, (l0, l1, a0, a1) in REGIONS.items():
                jm = (lat >= a0) & (lat <= a1); im = (lon >= l0) & (lon <= l1)
                m = land[np.ix_(jm, im)]
                w = np.cos(np.radians(lat[jm]))[:, None] * np.ones((1, im.sum()))
                v = sh[np.ix_(jm, im)]
                summary.setdefault(name, {}).setdefault(f"FL{fl}", {})[p] = round(float((v * w * m).sum() / max((w * m).sum(), 1e-9)), 3)
    Image.fromarray(atlas, "L").save(os.path.join(HERE, "..", "site", "geo", "clim.png"), optimize=True)
    land_share = {f"FL{fl}": {p: round(float((ok_sum[(fl, p)] / max(n[(fl, p)], 1))[land].mean()), 3) for p in PERIODS} for fl in FLS}
    meta = dict(source="53 weekly GFS analyses, 00 UTC, Oct 2025 - Oct 2026 (study-data)", threshold=THRESH,
                meaning="share of days x 36 directions with boomless Mach >= 1.15 at the floor (>= M1.10 after a 0.05 margin)",
                periods=list(PERIODS), dates_per_period={p: n[(FLS[0], p)] for p in PERIODS}, fls=list(FLS), tile=[360, 181],
                encoding="value / 250 = share; 255 = no data", lon0=-180, lat0=90, regions=summary, all_land=land_share)
    json.dump(meta, open(os.path.join(HERE, "..", "site", "geo", "clim.json"), "w"), indent=1)
    print(json.dumps(dict(all_land=land_share, regions=summary), indent=1))


if __name__ == "__main__":
    main()
