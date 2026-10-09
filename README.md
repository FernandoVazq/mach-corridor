# Mach Corridor

**Forecast map of where a supersonic aircraft can fly faster than sound without the sonic boom reaching the ground.**

Live map: https://fernandovazq.github.io/mach-corridor/ (updated every 6 hours from NOAA GFS)

![physics](https://img.shields.io/badge/physics-Mach%20cutoff-2a78d6) ![data](https://img.shields.io/badge/data-NOAA%20GFS%201%C2%B0-1baf7a)

## Idea

Sound travels faster in warm air. A boom created high up, in cold air, bends upward as it travels down into the warmer air below. If the aircraft is slow enough (but still supersonic), the boom turns around before it touches the ground. This is **Mach cutoff**. Boom Supersonic's XB-1 demonstrated it in 2025 (M 1.12–1.18 near 36,000 ft, no boom measured on the ground), and the FAA's July 2026 NPRM (docket FAA-2026-6935) would allow overland supersonic flight when ground overpressure stays below 0.11 psf.

The catch: the maximum boomless Mach depends on today's temperature and wind profile, on altitude, and on the **direction of flight**. This project forecasts it worldwide.

## Physics (v2, after the red-team review in `docs/REDTEAM.md`)

For each grid column, flight level, direction of travel and boom ray direction α:

```
M_α = ( max_{z_f ≤ z < z_a} [ c(z) + w(z)·e_α ] − w(z_a)·e_α ) / ( c(z_a) · cos α )
M   = min over attainable rays (|tan α| ≤ sqrt(M² − 1))

c   = sqrt(γ R T_v)        speed of sound (virtual temperature)
e_α = horizontal direction of the ray's wavefront normal, α off the track
z_f = max terrain under the boom footprint (GFS 0.25°, ±0.5°) + 1 km buffer
```

A boom ray turns upward where a layer below is "faster" than the aircraft. The turning point is a caustic (focused boom), so it must sit at least 1 km above the highest nearby terrain; the 2 m surface layer is not used. v1 published the grazing Mach (turning at the ground) — that was wrong (red-team finding K1).

**Sanity check (not validation):** ISA, no wind: M 1.152 at FL400 without buffer, 1.140 with the 1 km buffer — in the range Boom XB-1 flew boomless (M 1.12–1.18). Validation against soundings, forecast error and XB-1 flight days is in progress (`docs/HANDOFF.md`).

## Assumptions and limits

| Included | Not included (yet) |
|---|---|
| GFS temperature, humidity, wind on 23 levels; 1 km turning buffer over max terrain | Overpressure (psf), secondary booms — not a §91.817 compliance determination |
| Lateral rays with crosswind; 36 directions | Forecast uncertainty beyond a fixed margin (ensembles planned) |
| 0–48 h forecast every 6 h | Horizontal gradients along the ~40 km ray path; climb/descent angle (−3° ≈ −0.03 M) |
| Route winds, climb/descent, constant-Mach blocks | Aircraft-specific near field; turn/acceleration focusing |

Research prototype. **Not for flight planning.**

## Pipeline

```
NOAA GFS 1° (AWS Open Data, byte-range via .idx)
   └─ engine/build.py        → M_max for 6 FLs × 12 headings × 9 forecast hours
        └─ site/data/*.png   → 4×4 grayscale atlases (M = 1 + 0.002·value) + manifest.json
             └─ site/        → static web app (d3, Natural Earth), deployed to GitHub Pages
```

`.github/workflows/forecast.yml` runs at 04:20, 10:20, 16:20 and 22:20 UTC.

Atlas (6×7 tiles of 360×181): 0–35 = direction of travel 0°…350° · 36 worst · 37 best · 38 sound speed at cruise · 39 land fraction · 40/41 cruise wind u/v. `prof_fHHH.bin` holds 2° vertical profiles for the 3D column view.

## App
- **Map** (2D or 3D globe): boomless cruise Mach, red = no usable corridor (< M 1.05), green = corridor; forecast-error margin slider (default 0.03).
- **Click** a point: inspector + 3D column view with traced boom rays and a Mach slider. **Shift-click** a second point: optimised route.
- **Route optimiser:** Dijkstra on a 1° grid (16 directions) minimising time, operating cost, or cost + passenger time; land/coast legs fly the boomless Mach (≥300 nm constant-Mach blocks), open water flies design Mach, cruise winds applied, 150 nm subsonic climb and descent. Compared at all six flight levels.
- **Economics tab:** common routes × Concorde, Boom Overture, Aerion AS2, an NASA-N+3-goal concept, vs a 787-9; break-even value of time. Assumptions and sources: `site/aircraft.js`, `docs/ECONOMICS_SOURCES.md`.

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
