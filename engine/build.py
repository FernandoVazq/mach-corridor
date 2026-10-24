"""
Download the latest NOAA GFS run (AWS Open Data, byte-range via .idx) and build
Mach-cutoff atlases + vertical profiles for the web app.   (v2)

Output (in --out, default site/data):
  manifest.json
  f{HHH}_FL{LLL}.png   grayscale atlas, 6 cols x 7 rows of 360x181 tiles (lon -180..179, lat 90..-90)
     tiles 0-35 : boomless Mach for direction of travel 0,10,...,350 deg true
     tile 36    : min over the 36 directions (works in any direction)
     tile 37    : max over the 36 directions (best direction)
     tile 38    : speed of sound at cruise, value = c - 200 (m/s)
     tile 39    : land fraction * 255
     tile 40/41 : cruise wind u / v, value = wind + 128 (m/s)
  M encoding: value 0 = no corridor (M <= 1); M = 1.0 + 0.0025 * value
  prof_f{HHH}.bin      int16 little-endian, shape (4L+1, 91, 180) on a 2-degree grid:
                       [c*10 (L), u*10 (L), v*10 (L), Z (L), ground (1)]   for the 3D column view
Usage:
  python build.py [--run YYYYMMDDHH] [--out DIR]
"""
import argparse, datetime as dt, json, os, sys, time
import numpy as np
import requests
import pygrib
from PIL import Image

from physics import isa_pressure_hpa, mmax_grid, footprint_max, virtual_temperature, sound_speed, H_BUF_DEFAULT
import secondary
import rocket
import ecmwf
import sound
import x59

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
PLEV = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
        450, 400, 350, 300, 250, 200, 150, 100, 70, 50]
FLS = [300, 350, 400, 450, 500, 550, 600]
# high altitude (issue #53): FL700-FL1000 (21-30 km), an ESTIMATE: GFS only (ECMWF open data stops at 50 hPa), the
# GFS stratosphere levels below, and no balloon validation yet; the app labels them and inflates the margin
FLS_HI = [700, 800, 900, 1000]
PLEV_HI = [40, 30, 20, 15, 10, 7, 5]
HEADINGS = list(range(0, 360, 10))
FHOURS = list(range(0, 49, 6))
M_STEP = 0.0025
MODEL_VERSION = "2.12"     # docs/CHANGELOG.md: bump when the map or the router can give a different answer
COLS, ROWS = 6, 7
NX, NY = 360, 181

WANT = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT", "RH") for p in PLEV}
WANT |= {("HGT", "surface"), ("LAND", "surface")}
OPTIONAL = {(v, k) for (v, k) in WANT if v == "RH"}

S = requests.Session()


def url(run, fh, res="1p00"):
    d, h = run[:8], run[8:]
    return f"{BASE}/gfs.{d}/{h}/atmos/gfs.t{h}z.pgrb2.{res}.f{fh:03d}"


def get(u, **kw):
    for attempt in range(5):
        try:
            r = S.get(u, timeout=90, **kw)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return None
        except requests.RequestException as e:
            print("  retry", attempt, e, file=sys.stderr)
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"failed: {u}")


def latest_run():
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 48, 6):
        t = now - dt.timedelta(hours=back)
        run = t.strftime("%Y%m%d") + f"{(t.hour // 6) * 6:02d}"
        if S.head(url(run, FHOURS[-1]) + ".idx", timeout=30).status_code == 200:
            return run
    raise RuntimeError("no complete GFS run found in last 48 h")


def fetch(run, fh, want, res="1p00", src=None):
    """Byte-range download of selected messages -> {(var, level): 2D array}. src: full GRIB URL (default GFS)."""
    src = src or url(run, fh, res)
    idx_r = get(src + ".idx")
    if idx_r is None:
        raise RuntimeError(f"no idx for {src}")
    idx = idx_r.text.strip().splitlines()
    rows, seen = [], set()
    for i, line in enumerate(idx):
        parts = line.split(":")
        key = (parts[3], parts[4])
        if key in want and key not in seen:
            seen.add(key)
            end = int(idx[i + 1].split(":")[1]) - 1 if i + 1 < len(idx) else None
            rows.append((int(parts[1]), end, key))
    blobs, cur = [], None
    for s, e, k in rows:
        if cur and cur[1] is not None and s == cur[1] + 1:
            cur = [cur[0], e, cur[2] + [k]]
        else:
            if cur: blobs.append(cur)
            cur = [s, e, [k]]
    blobs.append(cur)
    tmp = f"/tmp/grb_{abs(hash(src))}.grb2"
    with open(tmp, "wb") as f:
        for s, e, _ in blobs:
            f.write(get(src, headers={"Range": f"bytes={s}-{'' if e is None else e}"}).content)
    order = [k for _, _, ks in blobs for k in ks]
    out = {k: np.asarray(g.values, dtype=np.float32) for g, k in zip(pygrib.open(tmp), order)}
    os.remove(tmp)
    return out


def fetch_fields(run, fh):
    F = fetch(run, fh, WANT)
    missing = (WANT - OPTIONAL) - set(F)
    if missing:
        raise RuntimeError(f"f{fh:03d} missing {sorted(missing)[:5]}")
    return F


TERRAIN = {}   # raw orography for the app's relief/topography layer


def fetch_orog(run, F0):
    """Max terrain over the boom footprint (+/-0.5 deg) from GFS 0.25-deg orography."""
    try:
        q = fetch(run, 0, {("HGT", "surface")}, res="0p25")[("HGT", "surface")]
        TERRAIN["z"] = q
        fp, note = footprint_max(q, radius_cells=2), "GFS 0.25 deg orography, max over +/-0.5 deg"
        # real peaks stand above the smoothed GFS orography (engine/dem_floor.py, issue #42): use the higher
        dem = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "dem_footprint_max.npy")
        if os.path.exists(dem):
            d = np.load(dem).astype(np.float32)
            if d.shape == fp.shape:
                fp = np.maximum(fp, d); note += "; raised to the DEM maximum (Terrarium z8, 3x3 median) where higher"
        return fp, note
    except Exception as e:  # fall back to 1-deg max over neighbours
        print("0.25 orography failed, using 1-deg:", e, file=sys.stderr)
        z = F0[("HGT", "surface")]
        TERRAIN["z"] = z
        m = z.copy()
        for dj in (-1, 1):
            m = np.maximum(m, np.roll(z, dj, axis=1))
        m = np.maximum(m, np.vstack([m[1:], m[-1:]]))
        m = np.maximum(m, np.vstack([m[:1], m[:-1]]))
        return m, "GFS 1 deg orography, max over neighbours (fallback)"


def combine(Mg, Mi):
    """Two-model boomless Mach (model 2.9): the mean of GFS and ECMWF IFS per node and direction; no corridor where
    either model has none. Validated in METHOD 6.2 (study/results/validation_ifs.json)."""
    return 0.5 * (Mg + Mi)                      # NaN in either -> NaN


DIS_STEP = 0.0005


def encode_disagreement(Mg, Mi):
    """Where the two models disagree (issue #9), one 360x181 tile per hour and level, lon -180..179: the largest
    |IFS - GFS| over the 36 directions. byte 0 = no corridor in either model, 1-253 = 1 + |d| / 0.0005 (cap 0.126),
    254 = corridor in one model only (the mean then has none). In the validation year columns whose worst-direction
    disagreement reached 0.02 had an unsafe-side error 40-55% above the rest (Method 6.2); the map hatches them."""
    fg, fi = np.isfinite(Mg), np.isfinite(Mi)
    d = np.where(fg & fi, np.abs(Mi - Mg), np.nan)
    with np.errstate(all="ignore"):
        dmax = np.nanmax(np.where(np.isnan(d), -1.0, d), axis=0)
    one = (fg ^ fi).any(axis=0)
    out = np.where(dmax >= 0, 1 + np.minimum(np.round(dmax / DIS_STEP), 252), 0)
    out = np.where(one, 254, out)
    return to_display(out.astype(np.uint8))


def load_ifs(run):
    """Prefetch ECMWF IFS for every forecast hour, thinned to 1 degree. All or nothing: any failure -> GFS only, so
    every hour of a build uses the same models. Returns (dict fh -> (F, levels), ifs_run, lag_h, note)."""
    if os.environ.get("MC_NO_IFS"):
        return None, None, None, "disabled (MC_NO_IFS)"
    t0 = time.time()
    tried, notes = [], []
    from concurrent.futures import ThreadPoolExecutor
    for _ in range(3):                          # a run that fails mid-download is skipped for the next older one
        try:
            r, lag = ecmwf.pick_run(run, FHOURS, skip=tried)
            if r is None:
                notes.append(lag); break
            tried.append(r)
            with ThreadPoolExecutor(3) as ex:
                got = dict(zip(FHOURS, ex.map(lambda fh: ecmwf.fetch_1deg(r, fh + lag), FHOURS)))
            bad = None
            for fh, (F, lv) in got.items():
                need = {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT") for p in lv}
                if len(lv) < 10 or need - set(F) or min(lv) > 70:
                    bad = f"IFS {r} +{fh + lag} h incomplete ({len(lv)} levels)"; break
            if bad:
                notes.append(bad); continue
            print(f"IFS {r} (lag {lag} h) fetched in {time.time() - t0:.0f}s", flush=True)
            return got, r, lag, ("; ".join(notes) or None)
        except Exception as e:
            print("IFS run failed:", e, flush=True)
            notes.append(f"fetch failed: {str(e)[:160]}")
    print("IFS unavailable, GFS only:", notes, flush=True)
    return None, None, None, "; ".join(notes)[:400]


def to_display(a):
    return np.roll(a, 180, axis=-1)


def encode_M(M):
    v = np.round((np.nan_to_num(M, nan=0.0) - 1.0) / M_STEP)
    return np.clip(v, 0, 255).astype(np.uint8)


def weighted_cdf(values, weights, thresholds):
    w = weights / weights.sum()
    return [round(float(w[values >= t].sum()), 4) for t in thresholds]


def weighted_quantile(values, weights, q):
    o = np.argsort(values)
    cw = np.cumsum(weights[o]) / weights.sum()
    return float(values[o][np.searchsorted(cw, q)])


def build(run, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    lat = np.linspace(90, -90, NY)[:, None] * np.ones((1, NX))
    area = np.cos(np.radians(lat))
    thresholds = [round(1.0 + 0.01 * i, 2) for i in range(41)]
    stats, orog_note, have_rh = {}, None, True
    zground = None
    ssb_done, ssb_top = [], None
    IFS, ifs_run, ifs_lag, ifs_note = load_ifs(run)
    ifs_diff = {}
    rocket_cols = {}
    hi_missing = set()
    carry_meta = {"fhs": [], "summary": {}, "errors": []}
    for fh in FHOURS:
        t0 = time.time()
        F = fetch_fields(run, fh)
        if zground is None:
            zground, orog_note = fetch_orog(run, F)
            zground = np.maximum(zground, 0.0)
        st = lambda v: np.stack([F[(v, f"{p} mb")] for p in PLEV])
        T, U, V, Z = st("TMP"), st("UGRD"), st("VGRD"), st("HGT")
        RH = None
        if all(("RH", f"{p} mb") in F for p in PLEV):
            RH = st("RH")
        else:
            have_rh = False
        land = F[("LAND", "surface")]
        stat_mask = (land > 0.5) & (lat > -60)

        # 2-degree profiles for the 3D column view (virtual-temperature sound speed)
        Tv = virtual_temperature(T, RH, np.array(PLEV, np.float32)[:, None, None]) if RH is not None else T
        c = sound_speed(Tv)
        sub = lambda X: np.roll(X[..., ::2, ::2], 90, axis=-1)  # 91 x 180, lon -180..178
        prof = np.concatenate([np.round(sub(c) * 10), np.round(sub(U) * 10), np.round(sub(V) * 10),
                               np.round(sub(Z)), np.round(sub(zground))[None]]).astype("<i2")
        prof.tofile(os.path.join(out_dir, f"prof_f{fh:03d}.bin"))

        # secondary booms (engine/secondary.py): stratosphere to 1 hPa, every 12 h; failure leaves the router fail-closed
        if fh in secondary.SSB_FH:
            try:
                ups = [p for p in secondary.UPPER if p not in PLEV]
                Fu = fetch(run, fh, {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT") for p in ups})
                lv = PLEV + [p for p in ups if ("TMP", f"{p} mb") in Fu]
                G = lambda v: np.stack([(F if p in PLEV else Fu)[(v, f"{p} mb")] for p in lv])
                s2 = lambda X: np.roll(X[:, ::2, ::2], 90, axis=-1).reshape(X.shape[0], -1)
                tab = secondary.ssb_table(s2(G("HGT")), s2(G("TMP")), s2(G("UGRD")), s2(G("VGRD")))
                A_, B_ = secondary.ssb_encode(tab, 91, 180)
                Image.fromarray(A_, "RGB").save(os.path.join(out_dir, f"ssb_f{fh:03d}_a.png"), optimize=True)
                Image.fromarray(B_, "RGB").save(os.path.join(out_dir, f"ssb_f{fh:03d}_b.png"), optimize=True)
                ssb_done.append(fh); ssb_top = min(lv)
            except Exception as ex:
                print(f"secondary booms f{fh:03d} failed: {ex}", flush=True)

        if IFS:
            Fi, lvi = IFS[fh]
            sti = lambda v: np.stack([Fi[(v, f"{p} mb")] for p in lvi])
            RHi = sti("RH") if all(("RH", f"{p} mb") in Fi for p in lvi) else None
            Xi = (np.array(lvi, float), sti("TMP"), sti("UGRD"), sti("VGRD"), sti("HGT"))
        # high-altitude levels: the stratosphere above 50 hPa, every forecast hour; dry (RH 0) above the map's levels
        hi = None
        try:
            Fu = fetch(run, fh, {(v, f"{p} mb") for v in ("TMP", "UGRD", "VGRD", "HGT") for p in PLEV_HI})
            lvh = PLEV + [p for p in PLEV_HI if all((v, f"{p} mb") in Fu for v in ("TMP", "UGRD", "VGRD", "HGT"))]
            Gh = lambda v: np.stack([(F if p in PLEV else Fu)[(v, f"{p} mb")] for p in lvh])
            RHh = np.concatenate([RH, np.zeros((len(lvh) - len(PLEV),) + RH.shape[1:], np.float32)]) if RH is not None else None
            hi = (np.array(lvh, float), Gh("TMP"), Gh("UGRD"), Gh("VGRD"), Gh("HGT"), RHh)
        except Exception as ex:
            print(f"high-altitude levels f{fh:03d} failed: {ex}", flush=True)

        # how far sound carries (engine/sound.py, issue #60): near-surface fields; failure never blocks the map
        try:
            Fs = fetch(run, fh, sound.WANT)
            th = sound.carry_grid(F[("HGT", "surface")], Fs, PLEV, T, U, V, Z)   # model ground, not the boom footprint max
            if th is not None:
                Image.fromarray(sound.atlas(th, to_display), "L").save(os.path.join(out_dir, f"carry_f{fh:03d}.png"), optimize=True)
                carry_meta["fhs"].append(fh); carry_meta["summary"][str(fh)] = sound.summary(th, land, lat)
            else:
                carry_meta["errors"].append(f"f{fh:03d}: near-surface fields missing ({sorted(k[1] for k in Fs)})")
        except Exception as ex:
            carry_meta["errors"].append(f"f{fh:03d}: {str(ex)[:160]}")
            print(f"sound carry f{fh:03d} failed: {ex}", flush=True)

        # rocket sites (engine/rocket.py, issue #50): one column per launch site and forecast hour, to the data top
        try:
            src = hi if hi is not None else (np.array(PLEV, float), T, U, V, Z, RH)
            lv_, T_, U_, V_, Z_, RH_ = src
            vt_ = (dt.datetime.strptime(run, "%Y%m%d%H") + dt.timedelta(hours=fh)).strftime("%Y-%m-%dT%H:%M:%SZ")
            for k_, s_ in {**rocket.SITES, **x59.SITES}.items():   # launch sites, capsule returns, X-59 test area
                i_, j_ = int(round(90 - s_["lat"])), int(round(s_["lon"] % 360)) % 360
                Tc = T_[:, i_, j_]
                if RH_ is not None:
                    Tc = virtual_temperature(Tc, RH_[:, i_, j_], lv_)
                rocket_cols.setdefault(k_, {})[vt_] = {"p": [float(x) for x in lv_], "z": [round(float(x), 1) for x in Z_[:, i_, j_]],
                                                       "T": [round(float(x), 2) for x in Tc], "u": [round(float(x), 2) for x in U_[:, i_, j_]],
                                                       "v": [round(float(x), 2) for x in V_[:, i_, j_]]}
        except Exception as ex:
            print(f"rocket columns f{fh:03d} failed: {ex}", flush=True)

        for fl in FLS + FLS_HI:
            high = fl in FLS_HI
            if high:
                p_fl = float(isa_pressure_hpa(fl * 100 * 0.3048))
                if hi is not None and hi[0].min() < p_fl:
                    r = mmax_grid(hi[0], hi[1], hi[2], hi[3], hi[4], zground, fl, HEADINGS, RH=hi[5])
                else:                                  # no data above the level: no corridor shown (fail-closed)
                    z0 = np.zeros_like(zground, dtype=np.float32)
                    r = {"M": np.full((len(HEADINGS),) + zground.shape, np.nan, np.float32), "c_a": z0, "U_a": z0, "V_a": z0}
                    hi_missing.add(fl)
            else:
                r = mmax_grid(np.array(PLEV, float), T, U, V, Z, zground, fl, HEADINGS, RH=RH)
            M = r["M"]
            if IFS and not high:
                Mi = mmax_grid(*Xi, zground, fl, HEADINGS, RH=RHi)["M"]
                lm = stat_mask[None] & np.isfinite(M)
                both = lm & np.isfinite(Mi)
                d = (Mi - M)[both]
                ifs_diff.setdefault(str(fl), []).append({"fh": fh, "mean_ifs_minus_gfs": round(float(d.mean()), 4) if d.size else None,
                                                        "sd": round(float(d.std()), 4) if d.size else None,
                                                        "gfs_corridor_removed_share": round(float(1 - both.sum() / max(lm.sum(), 1)), 4)})
                Image.fromarray(encode_disagreement(M, Mi), "L").save(os.path.join(out_dir, f"dis_f{fh:03d}_FL{fl}.png"), optimize=True)
                M = combine(M, Mi)
            if fh == 0 and fl == 550:                     # route pages (engine/pages.py) read today's FL550 field
                try:
                    np.savez_compressed(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache_fl550_f000.npz"),
                                        M=M.astype(np.float16), land=land.astype(np.uint8), run=run)
                except Exception as ex:
                    print("route-page cache failed:", ex, flush=True)
            Mmin = np.nanmin(np.where(np.isnan(M), 0.0, M), axis=0)
            Mmax = np.nanmax(np.where(np.isnan(M), 0.0, M), axis=0)
            tiles = [encode_M(to_display(m)) for m in M]
            tiles += [encode_M(to_display(Mmin)), encode_M(to_display(Mmax)),
                      np.clip(np.round(to_display(r["c_a"]) - 200), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(land) * 255), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(r["U_a"]) + 128), 0, 255).astype(np.uint8),
                      np.clip(np.round(to_display(r["V_a"]) + 128), 0, 255).astype(np.uint8)]
            atlas = np.zeros((ROWS * NY, COLS * NX), np.uint8)
            for i, t in enumerate(tiles):
                rr, cc = divmod(i, COLS)
                atlas[rr * NY:(rr + 1) * NY, cc * NX:(cc + 1) * NX] = t
            Image.fromarray(atlas, "L").save(os.path.join(out_dir, f"f{fh:03d}_FL{fl}.png"), optimize=True)
            vals, w = Mmin[stat_mask], area[stat_mask]
            stats.setdefault(str(fl), []).append({
                "fh": fh,
                "land_any_median": round(weighted_quantile(vals, w, 0.5), 4),
                "land_any_p10": round(weighted_quantile(vals, w, 0.1), 4),
                "land_any_cdf": weighted_cdf(vals, w, thresholds),
                "land_best_p90": round(weighted_quantile(Mmax[stat_mask], w, 0.9), 4),
                "max_value_clipped": bool(np.nanmax(M) > 1.0 + 255 * M_STEP),
            })
        print(f"f{fh:03d} done in {time.time() - t0:.1f}s", flush=True)

    terrain_meta = None
    if "z" in TERRAIN:
        z = np.maximum(TERRAIN["z"], 0)
        zt = np.roll(z, z.shape[1] // 2, axis=1)          # lon -180 .. +180
        Image.fromarray(np.clip(np.round(zt / 25.0), 0, 255).astype(np.uint8), "L").save(
            os.path.join(out_dir, "terrain.png"), optimize=True)
        terrain_meta = {"file": "terrain.png", "nx": int(zt.shape[1]), "ny": int(zt.shape[0]), "step_m": 25,
                        "lon0": -180, "lat0": 90, "source": "GFS surface geopotential height (smoothed orography)"}
    run_t = dt.datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    iso = lambda t: t.isoformat().replace("+00:00", "Z")
    manifest = {
        "version": 2,
        "run": run,
        "run_time": iso(run_t),
        "generated": iso(dt.datetime.now(dt.timezone.utc).replace(microsecond=0)),
        "code_version": os.environ.get("GITHUB_SHA", "local")[:7],
        "model_version": MODEL_VERSION,
        "source": "NOAA GFS 1.0 deg pressure levels + 0.25 deg orography (AWS Open Data noaa-gfs-bdp-pds)"
                  + (f"; mean with ECMWF IFS open data {ifs_run} (CC-BY-4.0, AWS ecmwf-forecasts), thinned to 1 deg" if IFS else ""),
        "models": {"gfs": run, "ifs": ifs_run, "ifs_lag_h": ifs_lag, "ifs_note": ifs_note,
                   "combine": "boomless Mach = mean of GFS and IFS per node and direction; no corridor if either has none" if IFS else "GFS only",
                   "ifs_vs_gfs": ifs_diff or None,
                   "disagreement": {"pattern": "dis_f{fh:03d}_FL{fl}.png", "nx": NX, "ny": NY, "lon0": -180, "lat0": 90, "step": DIS_STEP,
                                    "encoding": "0 no corridor in either; 1 + |IFS - GFS| / step, worst direction; 254 corridor in one model only"} if IFS else None},
        "physics": {"h_buf_m": H_BUF_DEFAULT, "terrain": orog_note, "lateral_rays": True,
                    "virtual_temperature": have_rh, "surface_layer_used": False},
        "forecast_hours": FHOURS,
        "valid_times": [iso(run_t + dt.timedelta(hours=h)) for h in FHOURS],
        "flight_levels": FLS + FLS_HI,
        "high_altitude": {"fls": FLS_HI, "levels_hpa": PLEV_HI, "estimate": True, "models": "GFS only",
                          "note": "FL700-FL1000: GFS stratosphere levels to 5 hPa, dry above 50 hPa; no second model and no balloon validation yet",
                          "missing": sorted(hi_missing)},
        "headings": HEADINGS,
        "plev": PLEV,
        "grid": {"nx": NX, "ny": NY, "lon0": -180, "lat0": 90, "dlon": 1, "dlat": -1},
        "atlas": {"cols": COLS, "rows": ROWS, "tile_min": 36, "tile_max": 37, "tile_c": 38,
                  "tile_land": 39, "tile_u": 40, "tile_v": 41},
        "encoding": {"M0": 1.0, "M_step": M_STEP, "c_offset": 200, "wind_offset": 128},
        "profiles": {"pattern": "prof_f{fh:03d}.bin", "nx": 180, "ny": 91, "lon0": -180, "lat0": 90, "d": 2,
                     "fields": ["c*10", "u*10", "v*10", "z"], "levels": len(PLEV), "extra": "ground_m"},
        "terrain": terrain_meta,
        "ssb": {"fhs": ssb_done, "pattern": "ssb_f{fh:03d}_{ab}.png", "nx": 180, "ny": 91, "lon0": -180, "lat0": 90, "d": 2,
                "tiles": "6x6, direction of travel of the ray 0..350 step 10", "V0": secondary.V0, "V_step": secondary.V_STEP,
                "R_step_km": secondary.R_STEP, "a": ["V_lo", "V_hi", "R1_lo"], "b": ["R1_hi", "R2_lo", "R2_hi"],
                "z_aircraft_m": round(550 * 30.48), "z_low_m": secondary.Z_LOW, "top_hpa": ssb_top} if ssb_done else None,
        "carry": {"fhs": carry_meta["fhs"], "pattern": "carry_f{fh:03d}.png", "cols": sound.COLS, "rows": sound.ROWS,
                  "nx": NX, "ny": NY, "lon0": -180, "lat0": 90, "dirs": sound.DIRS, "tile_min": 8, "tile_max": 9,
                  "step_deg": sound.STEP_DEG, "h_top_m": sound.H_TOP, "levels": sound.LEVELS,
                  "summary": carry_meta["summary"], "errors": carry_meta["errors"][:9]} if carry_meta["fhs"] or carry_meta["errors"] else None,
        "stats_thresholds": thresholds,
        "file_pattern": "f{fh:03d}_FL{fl}.png",
        "stats": stats,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(out_dir, "columns.json"), "w") as f:
        json.dump({"run": run, "valid_times": manifest["valid_times"],
                   "sites": {k: {"by_time": v} for k, v in rocket_cols.items()}}, f, separators=(",", ":"))
    print("wrote", out_dir)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--run")
    ap.add_argument("--out", default="site/data")
    a = ap.parse_args()
    run = a.run or latest_run()
    print("GFS run", run, flush=True)
    build(run, a.out)
