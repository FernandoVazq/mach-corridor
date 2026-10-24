"""
X-59 thump footprint (issue #64): how wide the strip of ground under NASA's X-59 is where its shaped sonic boom (the
"thump") reaches the ground, through the forecast atmosphere over NASA Armstrong / Edwards, where the first community
response test is planned.

X-59 design cruise: Mach 1.4 at 55,000 ft (NASA Quesst), target loudness about 75 PLdB or less on the ground. This
module does not compute loudness (the X-59's shaped signature needs its own near-field data); it computes where the
boom reaches the ground at all: the boom carpet. Shock normals on the Mach cone of a level aircraft are traced (RK4,
rocket.trace_many) through the GFS column at the site for each forecast hour and eight directions of flight; the
carpet edge on each side is where the rays turn back up before the ground (lateral cutoff). Wind and temperature move
those edges: the day-to-day change is what a community test plan needs.

Output: data/x59.json.
"""
import json, math, os, argparse, datetime as dt
import numpy as np

import rocket

SITES = {"edwards": {"name": "NASA Armstrong / Edwards AFB, California", "short": "Edwards", "lat": 34.95, "lon": -117.88,
                     "tz": "America/Los_Angeles",
                     "towns": [("Lancaster", 34.698, -118.137), ("Palmdale", 34.579, -118.117), ("Rosamond", 34.864, -118.163),
                               ("Mojave", 35.053, -118.174), ("California City", 35.126, -117.986), ("Boron", 35.000, -117.650),
                               ("Tehachapi", 35.132, -118.449), ("Ridgecrest", 35.623, -117.671), ("Barstow", 34.896, -117.022),
                               ("Victorville", 34.536, -117.291), ("Hesperia", 34.426, -117.301), ("Bakersfield", 35.373, -119.019)]}}
MACH, ALT_FT = 1.4, 55000.0
HEADINGS = list(range(0, 360, 45))


def carpet(prof, heading, mach=MACH, alt_m=ALT_FT * 0.3048, n_phi=180):
    """Level flight: (left km, right km, n_hits, t_min s, t_max s) across the track; left/right of the direction of
    flight. None widths = no boom on the ground on that side (cutoff)."""
    n, down = rocket.cone_normals(mach, heading, 0.0, n_phi)
    hit, xs, ys, ts, Ls = rocket.trace_many(prof, alt_m, n[down], dt=0.5, t_max=900.0)
    if not hit.any():
        return None, None, 0, None, None
    h = math.radians(heading)
    along = np.array([math.sin(h), math.cos(h)]); right = np.array([math.cos(h), -math.sin(h)])
    P = np.stack([xs[hit], ys[hit]], 1)
    cross = P @ right / 1000.0
    L = float(-cross[cross < 0].min()) if (cross < 0).any() else 0.0
    R = float(cross[cross > 0].max()) if (cross > 0).any() else 0.0
    return round(L, 1), round(R, 1), int(hit.sum()), round(float(ts[hit].min())), round(float(ts[hit].max()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../site/data")
    a = ap.parse_args()
    cols, valid = None, []
    try:
        cols = json.load(open(os.path.join(a.data, "columns.json"))); valid = cols.get("valid_times", [])
    except Exception as ex:
        print("no forecast columns:", ex)
    out = {"generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
           "model": "x59 carpet v0 (issue #64)", "mach": MACH, "alt_ft": ALT_FT, "headings": HEADINGS, "sites": {}}
    for k, S in SITES.items():
        std = rocket.profile_from_column(None)
        rec = {"name": S["name"], "short": S["short"], "lat": S["lat"], "lon": S["lon"], "tz": S["tz"],
               "towns": [{"town": t, "lat": la, "lon": lo} for t, la, lo in S["towns"]],
               "standard": [carpet(std, h) for h in HEADINGS], "times": [], "by_time": []}
        for vt in valid:
            col = (cols or {}).get("sites", {}).get(k, {}).get("by_time", {}).get(vt)
            if not col:
                continue
            prof = rocket.profile_from_column(col)
            rec["times"].append(vt)
            rec["by_time"].append([carpet(prof, h) for h in HEADINGS])
        out["sites"][k] = rec
        print(k, len(rec["times"]), "times; standard:", rec["standard"][:2])
    with open(os.path.join(a.data, "x59.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print(f"::warning title=x59.py::{ex}")
        raise
