# Mach Corridor

**Forecast map of where a supersonic aircraft can fly faster than sound without the sonic boom reaching the ground.**

Live map: https://fernandovazq.github.io/mach-corridor/ (updated every 6 hours from NOAA GFS)

![physics](https://img.shields.io/badge/physics-Mach%20cutoff-2a78d6) ![data](https://img.shields.io/badge/data-NOAA%20GFS%201%C2%B0-1baf7a)

## Idea

Sound travels faster in warm air. A boom created high up, in cold air, bends upward as it travels down into the warmer air below. If the aircraft is slow enough (but still supersonic), the boom turns around before it touches the ground. This is **Mach cutoff**. Boom Supersonic's XB-1 demonstrated it in 2025 (M 1.12–1.18 near 36,000 ft, no boom measured on the ground), and the FAA's July 2026 NPRM (docket FAA-2026-6935) would allow overland supersonic flight when ground overpressure stays below 0.11 psf.

The catch: the maximum boomless Mach depends on today's temperature and wind profile, on altitude, and on the **direction of flight**. This project forecasts it worldwide.

## Physics

For each grid column, flight level and direction of travel:

```
M_max = ( max_{ground ≤ z ≤ z_a} [ c(z) + w(z) ] − w(z_a) ) / c(z_a)

c = sqrt(γ R T)                         speed of sound
w = u·sin(θ) + v·cos(θ)                 wind along the direction of travel θ (+ = tailwind)
```

A downward boom ray keeps descending while the aircraft's ground speed `M·c(z_a) + w(z_a)` exceeds the effective sound speed `c + w` of every layer below. Any faster layer refracts it back up.

- Flight levels are ISA pressure altitudes, so values are interpolated in ln(p) between GFS pressure levels.
- Pressure levels below the terrain are discarded, so high plateaus (Tibet, Andes, Rockies) lose the warm low layers and get less margin.
- The surface point (2 m temperature, 10 m wind) is included.

**Validation:** in the ISA standard atmosphere with no wind, the engine gives M 1.147 at FL360 and M 1.153 at FL400. That sits inside XB-1's demonstrated M 1.12–1.18 (`engine/test_physics.py`).

## Assumptions and limits

| Included | Not included (yet) |
|---|---|
| Full GFS temperature + wind profile, 23 levels + surface | Forecast uncertainty: use the safety-margin slider |
| Terrain height | Horizontal gradients along the ray path |
| Direction dependence (12 headings) | Aircraft-specific near-field signature, focusing in turns/accelerations |
| 0–48 h forecast every 6 h | Humidity (< 0.5 % on c), atmospheric turbulence |

Research prototype. **Not for flight planning.**

## Pipeline

```
NOAA GFS 1° (AWS Open Data, byte-range via .idx)
   └─ engine/build.py        → M_max for 6 FLs × 12 headings × 9 forecast hours
        └─ site/data/*.png   → 4×4 grayscale atlases (M = 1 + 0.002·value) + manifest.json
             └─ site/        → static web app (d3, Natural Earth), deployed to GitHub Pages
```

`.github/workflows/forecast.yml` runs at 04:20, 10:20, 16:20 and 22:20 UTC.

Atlas tiles: 0–11 = direction of travel 0°, 30°, …, 330° true · 12 = worst direction · 13 = best direction · 14 = speed of sound at cruise (value + 200 m/s) · 15 = land fraction.

## Run locally

```bash
pip install -r engine/requirements.txt
cd engine && python test_physics.py && python build.py --out ../site/data
cd ../site && python -m http.server 8000      # open http://localhost:8000
```

Offline (synthetic atmosphere, no download): `python engine/synthetic.py <land-110m.json> site/data` (needs matplotlib).

## Route planner

Pick two airports (or click two points). The route is sampled every ~15 nm along the great circle, and each sample uses the boomless Mach for its local track direction. Three scenarios are compared:

1. Airliner at M 0.85.
2. Supersonic with today's overland ban: M 0.94 over land, M 1.7 over water.
3. Supersonic with Mach-cutoff corridors: boomless M over land, M 1.7 over water.

Winds are not added to ground speed in the time estimate.

## Sources

- Boom Supersonic, *Boomless Cruise* announcement (Feb 2025)
- DLR / aeroreport, *Supersonic flight without the boom* (2025): practical range M 1.1–1.2, max ~1.3
- FAA NPRM *Enabling Supersonic Overland Flight*, Federal Register 2026-13440 (Jul 2026)
- NOAA GFS on AWS Open Data: `noaa-gfs-bdp-pds`

Author: Fernando J. Vazquez
