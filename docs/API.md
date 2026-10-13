# Mach Corridor data API

Everything the site shows is built from static files served by GitHub Pages under
`https://fernandovazq.github.io/mach-corridor/`. They are rebuilt within an hour of each NOAA GFS run. There is no
server and no key. A Python client that answers the map's questions from these files is in `engine/client.py`
(parity with the site checked in `tests/api.mjs`). **Research prototype: not for flight.**

```
python engine/client.py 39.5 -98 270 550        # lat lon heading flight-level [hours-after-run]
→ {"limit": 1.1875, "margin": 0.0549, "flyable": 1.1291, ...}
```

## Files

| Path | Content | Encoding |
|---|---|---|
| `data/manifest.json` | GFS run, `models` (IFS run, lag, how they are combined, IFS − GFS per level and hour), build time, `model_version`, `code_version`, forecast hours, flight levels, headings, atlas layout, encodings, physics notes, land statistics | JSON |
| `data/f{HHH}_FL{LLL}.png` | Boomless Mach limit per 1° node, 36 headings, one forecast hour and level | 8-bit grayscale atlas, 6 columns × 7 rows of 360×181 tiles (lon −180…179, lat 90…−90). Tile t = heading/10 for t < 36; 36 = worst heading, 37 = best, 38 = sound speed − 200 m/s, 39 = land × 255, 40/41 = u/v wind + 128 m/s. Mach = 1 + 0.0025 × byte; byte 0 = no corridor |
| `data/prof_f{HHH}.bin` | Column profiles on a 2° grid (for 3D views and offline ray tracing) | little-endian int16, shape (4L + 1, 91, 180): c×10, u×10, v×10, height, then ground (m) |
| `data/terrain.png` | Terrain used for relief | byte × 25 m |
| `data/ssb_f{HHH}_{a,b}.png` | Secondary-boom tables every 12 h (Method §4.1) | RGB, 6×6 tiles of 180×91, tile = ray direction/10. a = (V_lo, V_hi, R1 lo), b = (R1 hi, R2 lo, R2 hi); V = 250 + 0.75 × byte m/s; R = 2 × byte km, 0 = none |
| `data/gefs/gefs.json` | GEFS run, forecast hours, levels, k per level, real-world term | JSON |
| `data/gefs/g{HHH}_FL{LLL}.png` | Ensemble spread of the boomless Mach per 2° node and 36 headings | grayscale, 6×6 tiles of 180×91; spread = 0.001 × byte |
| `geo/zone.png` | Regulated zone | 0.1° grid; 0 = territory, 1–64 = distance to it in nm, 255 = farther |
| `geo/clim.png`, `geo/clim.json` | Seasonal climatology (Method §6.5) | grayscale, 5 periods × 3 levels of 360×181; share = byte / 250 |
| `geo/physics.json`, `geo/rules.json` | Study results and rules by country | JSON |

## How the site combines them

- **Limit** (model 2.9): the atlas already holds the mean of GFS and ECMWF IFS when `models.ifs` is set, GFS alone
  when it is null.
- **Limit** at a point and heading: bilinear in space, the lower of the two bracketing 10° headings; no corridor
  if any of the surrounding nodes has none.
- **Margin** (Auto): k × √(spread² + e² + 0.005²), with e = 0.012 (0.015 over terrain above 1.5 km, ramped from
  0.5 km) and 0.005 the air-data allowance; the GEFS hour nearest the time the aircraft is there.
- **Flown Mach** on a boomless leg: limit − margin − the aircraft's quiet-height cushion (about 0.0035 Mach for a
  61 m airliner at FL550), capped at design Mach, and constant over 300 nm blocks.
- Primary-boom psf, the caustic and secondary-boom models, the approach and turn rules and the fail-closed rules
  are in `site/boom.js` and `site/route.js` and described in `docs/METHOD.md`.

Data are public domain (NOAA GFS/GEFS), ECMWF IFS open data (CC BY 4.0, © ECMWF: credit it when you reuse the
atlases) or Natural Earth; the code is in this repository.
