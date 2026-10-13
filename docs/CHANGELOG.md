# Model changelog

The **model version** (`manifest.json` → `model_version`, and every evidence file) changes whenever the map or
the router can give a different answer for the same weather. The **code version** (`code_version`, the build
commit) changes with every build. A compliance case should cite both. Issues refer to
[FernandoVazq/mach-corridor](https://github.com/FernandoVazq/mach-corridor/issues).

| Model | Date | What changed in the answer | Issues |
|---|---|---|---|
| 2.8 | 2026-10-13 | FL550 margin k 3.75 → 4.0: choosing the fastest of several paths raised > 0.11 psf flights 0.43% → 0.59%; with k 4.0 the chosen paths give 0.28% (95% upper 0.47%) for 0.7 min. Boomless legs reported at the larger of the caustic model and FaINT's 0.10 psf envelope | #40, #19 |
| 2.7 | 2026-10-13 | Auto margin includes an air-data and Mach-hold allowance (1σ 0.005, in quadrature): about +0.004 Mach at a typical margin | #43 |
| 2.6 | 2026-10-13 | Chance of > 0.11 psf per leg and per flight (Gaussian, held-out σ inflation 1.17–1.30, 300 nm blocks); secondary-boom loudness estimate in plans; climatology atlas | #20, #16, #30 |
| 2.5 | 2026-10-12 | Floor = higher of GFS and a 600 m DEM over the footprint; margin's real-world term 0.015 over mountains; over-water legs with regulated ground within 90 km ahead fly at the cutoff Mach; boomless legs in a turn 0.004 Mach slower | #42, #44 |
| 2.4 | 2026-10-12 | Loudness below the turning point (Airy caustic model) and per-aircraft quiet-height cushion; secondary-boom landing check on over-water legs; fail-closed rules (stale forecast, past forecast end, no margin) | #39, #38, #43 |
| 2.3 | 2026-10-11 | Lateral rays to 60° within the cone; router never interpolates across a no-corridor column; GEFS hour matched to each leg; ensemble k raised to the larger held-out fit (FL350 4.0, FL450 4.25, FL550 3.75); airliner cushion penalty (150 m signal) | #36, review findings 4–8 |
| 2.2 | 2026-10-11 | Auto margin from the live 31-member GEFS spread, per point and direction | Sprint 2 |
| 2.1 | 2026-10-10 | Auto margin from the static error map; exact regulated zone (territory + 12 nm + 24 nm); primary-boom psf per leg (Carlson) | #1–#5, #12 |
| 2.0 | 2026-10-09 | Physics v2: turning point ≥ 1 km above the highest GFS 0.25° terrain under the footprint; lateral rays with crosswind; virtual temperature; no surface layer | — |
| 1.0 | 2026-10-07 | First global map: single-column Mach cutoff on GFS 1° | — |

Validation datasets (`validation-data-*`), hindcast data (`study-data*`) and study results (`study/results/*.json`)
are tied to the model version current when they were produced; rerunning them on a new model version is part of
the change.
