"""
ECMWF IFS open data (issue #9): a second forecast model next to GFS.

Source: AWS Open Data bucket `ecmwf-forecasts` (eu-central-1, no account), path
  <yyyymmdd>/<HH>z/ifs/0p25/oper/<yyyymmdd><HH>0000-<step>h-oper-fc.grib2   (index: same name ending -fc.index, JSON lines)
06/18 UTC runs before IFS cycle 50r1 sit under stream `scda`; both are tried. Steps: 00/12 UTC 0-144 h by 3 h,
06/18 UTC 0-90 h by 3 h. Fields are byte-range downloaded from the index (param + levelist), like build.fetch.

fetch(run, step, params) -> ({(VAR, "<p> mb"): 2-D array lat 90..-90, lon 0..359.75}, levels hPa descending)
with the GFS short names used elsewhere: t->TMP, u->UGRD, v->VGRD, gh->HGT, r->RH.
pick_run(gfs_run, last_step) chooses the IFS run the live build averages with GFS (model 2.9, engine/build.py).
"""
import json, os, random, tempfile, time
import numpy as np
import requests
import pygrib

BASE = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
NAMES = {"t": "TMP", "u": "UGRD", "v": "VGRD", "gh": "HGT", "r": "RH"}
S = requests.Session()


def url(run, step, stream):
    d, h = run[:8], run[8:10]
    return f"{BASE}/{d}/{h}z/ifs/0p25/{stream}/{d}{h}0000-{step}h-{stream}-fc.grib2"


def fetch(run, step, params=("t", "u", "v", "gh", "r")):
    """run 'YYYYMMDDHH'. Returns ({(NAME, 'p mb'): 2-D float32 (721, 1440) lat 90..-90, lon 0..359.75}, levels)."""
    last = None
    for stream in ("oper", "scda"):
        u = url(run, step, stream)
        iu = u[:-len("grib2")] + "index"                 # the index replaces the extension: ...-fc.index
        r = None
        for k in range(3):
            r = S.get(iu, timeout=60)
            if r.status_code != 503: break               # S3 "slow down": back off and retry
            time.sleep(3 * (k + 1))
        if r.status_code != 200:
            last = f"{r.status_code} {iu}"; continue
        rows = [json.loads(l) for l in r.text.splitlines() if l.strip()]
        want = [x for x in rows if x.get("levtype") == "pl" and x.get("param") in params]
        if not want:
            last = f"no pressure-level fields in {u}"; continue
        want.sort(key=lambda x: int(x["_offset"]))
        # merge byte ranges less than 8 MB apart: S3 throttles many small requests ("503 Slow Down"); the extra
        # messages in the gaps are whole GRIB messages and are filtered out below
        blobs = []
        for x in want:
            s, e = int(x["_offset"]), int(x["_offset"]) + int(x["_length"]) - 1
            if blobs and s - blobs[-1][1] <= 8_000_000: blobs[-1][1] = max(blobs[-1][1], e)
            else: blobs.append([s, e])
        fd, tmp = tempfile.mkstemp(suffix=".grb2")
        with os.fdopen(fd, "wb") as f:
            for s, e in blobs:
                for k in range(6):
                    rr = S.get(u, headers={"Range": f"bytes={s}-{e}"}, timeout=300)
                    if rr.status_code != 503: break
                    time.sleep(2 ** k + random.random())     # exponential back-off on throttling
                rr.raise_for_status(); f.write(rr.content)
        out, levels = {}, set()
        for g in pygrib.open(tmp):
            name = NAMES.get(g.shortName)
            if name is None or g.typeOfLevel != "isobaricInhPa":
                continue
            lats, lons = g.latlons()
            a = np.asarray(g.values, np.float32)
            if lats[0, 0] < lats[-1, 0]:                 # make lat descend 90..-90
                a = a[::-1]; lons = lons[::-1]
            lon0 = lons[0]
            a = np.roll(a, -int(np.argmin(np.mod(lon0, 360.0))), axis=1)   # start at lon 0
            if name == "HGT" and g.shortName == "z":
                a = a / 9.80665
            out[(name, f"{int(g.level)} mb")] = a; levels.add(int(g.level))
        os.remove(tmp)
        return out, sorted(levels, reverse=True)
    raise RuntimeError(f"IFS {run} +{step}h not found ({last})")


def available(run, step):
    """True if the index for run +step h is published (either stream)."""
    for stream in ("oper", "scda"):
        u = url(run, step, stream)
        try:
            if S.head(u[:-len("grib2")] + "index", timeout=30).status_code == 200:
                return True
        except requests.RequestException:
            pass
    return False


def pick_run(gfs_run, last_step, max_lag_h=12):
    """Latest IFS run at most max_lag_h older than the GFS run 'YYYYMMDDHH' whose step last_step + lag is
    published. Returns (run, lag_h) or (None, reason). Validation (study/results/validation_ifs.json, METHOD 6.2):
    the two-model mean beats GFS alone when IFS lags by 6 h at the analysis and by 18 h at 6 h, but not by 24 h at the
    analysis, hence the 12 h cap."""
    import datetime as dt
    t = dt.datetime.strptime(gfs_run, "%Y%m%d%H")
    for lag in range(0, max_lag_h + 1, 6):
        r = (t - dt.timedelta(hours=lag)).strftime("%Y%m%d%H")
        top = 144 if r[8:10] in ("00", "12") else 90
        if last_step + lag > top:
            continue
        if available(r, last_step + lag) and available(r, lag):
            return r, lag
    return None, f"no IFS run within {max_lag_h} h of GFS {gfs_run} published to +{last_step} h"


def fetch_1deg(run, step, params=("t", "u", "v", "gh", "r")):
    """fetch() thinned to the GFS 1-degree grid (181 x 360, lat 90..-90, lon 0..359) to keep memory small."""
    F, lv = fetch(run, step, params)
    return {k: np.ascontiguousarray(a[::4, ::4]) for k, a in F.items()}, lv
