# Mach Corridor — Method Document (draft 0.1, 11 Oct 2026)

Written for a reviewer who must decide whether this method can be part of an operator's means of compliance
under the proposed rule (FAA NPRM "Enabling Supersonic Overland Flight", docket FAA-2026-6935: sonic boom
overpressure at the surface ≤ 0.11 psf, primary and secondary booms). Status: **research prototype**. Every
claim below points to code, a test or a dataset in this repository; unvalidated items are marked **Open**.

## 1. What the method claims

For a supersonic aircraft at a given flight level, position, time and direction of travel, the method gives
the **highest Mach at which no primary-boom ray reaches the ground** (Mach cutoff), with a margin for forecast
error, and the **expected ground overpressure** of each leg. It does not yet compute secondary booms (Open, §8).

| Output | Where | Evidence |
|---|---|---|
| Boomless Mach, 36 directions × 7 levels, 0–48 h | `engine/physics.py`, `engine/build.py` | §6.1–6.3 |
| Margin for forecast error | `study/margin.py`, `site/geo/sigma.*` | §6.3 |
| Ground overpressure per leg (primary boom) | `engine/boom.py`, `site/boom.js` | §6.4 |
| Regulated zone (territory + 12 nm + 24 nm) | `engine/zone.py` | §4 |
| Route and Mach profile | `site/route.js` | §5 |

## 2. Inputs

| Input | Source | Resolution | Version control |
|---|---|---|---|
| Temperature, humidity, wind, height on 23 pressure levels (1000–50 hPa) | NOAA GFS, AWS Open Data (`noaa-gfs-bdp-pds`) | 1°, 0–48 h every 6 h | run id in `manifest.json` |
| Terrain under the boom footprint | GFS 0.25° orography, max over ±0.5° | 0.25° → 1° | same run |
| Ensemble spread (evaluation) | NOAA GEFS v12, 31 members, `noaa-gefs-pds` | 0.5° → 1° | `study-data-gefs` branch |
| Territory | Natural Earth 10 m land, minor islands, lakes | 0.1° raster | `site/geo/zone.png` |
| Aircraft | length, weight, shape factor, fuel curve | per type | `site/aircraft.js`, `engine/boom.py` |

Data freshness: an hourly job builds only when a newer complete GFS run exists (`engine/fresh.py`).

## 3. Physics

### 3.1 Mach cutoff
A boom ray launched from the Mach cone with horizontal wavefront direction e (angle α off the track) keeps
descending while the aircraft's trace velocity exceeds the local effective sound speed V_P = c + w·e. In a
horizontally stratified atmosphere the trace velocity is conserved (Snell), so the ray turns where
c(z) + w(z)·e ≥ M c_a cos α + w_a·e. The largest Mach for which the ray stays above the floor z_f is

  M_α = ( max_{z_f ≤ z < z_a} [ c + w·e_α ] − w_a·e_α ) / ( c_a cos α ),   M = min over attainable α (|tan α| ≤ √(M²−1))

- c = √(γ R T_v), virtual temperature from relative humidity (Bolton).
- Rays at α = 0, ±7.5° … ±45° (crosswind shear can make a lateral ray critical).
- The 2 m surface point is not used as a refracting layer.
- No corridor (M < 1) when no layer below is faster than the aircraft.

### 3.2 Floor (turning-point buffer)
The turning point is a caustic (focused boom). It must stay above the highest terrain under the footprint by a
buffer:
- **Default:** 1 km.
- **Computed (Open, under evaluation):** Haglund's safe cutoff height per ray direction,
  ΔZ_S = R^{1/3} L^{2/3}, R = c / |dV_P/dz| over 0.5–2 km above ground, L = 60 m (SST-class signal),
  capped at 1.35 km where V_P does not fall with height (NASA CR-2417; used in FaINT).

Evidence: on one GFS run, ΔZ_S has a median of 650 m and a 90th percentile of 1.0 km; at the exact limit 3% of
land columns fall below it, with a 0.05 margin none (`study/buffer_check.py`).

### 3.3 Forecast-error margin
The flown Mach is the forecast boomless Mach minus a margin.
- **Auto:** k·σ(x), with σ² = σ_ana(x)² + 0.012², where σ_ana is the RMS of (24 h forecast − analysis) over
  53 weekly hindcasts and 0.012 is the part of the real-world error the analysis does not see (validation
  against radiosondes: 0.015 total).
- k is calibrated per level so that ≤ 0.5% of hindcast flights put > 20 nm of boom on the ground:
  FL350 3.79, FL450 4.10, FL550 3.74.

### 3.4 Loudness (v0)
- **Primary boom, legs not in cutoff:** Carlson's simplified method (NASA TP-1122):
  Δp = K_p K_R √(p_v p_g) (M²−1)^{1/8} h^{−3/4} l^{3/4} K_S, with K_R = 1.9, K_p = 1.0 and K_S = 0.088
  (SST-class).
- **Cutoff legs:** bounded by the NASA FaINT measurements, 0.01–0.09 psf with the caustic at least one ΔZ_S
  above ground (Cliatt et al. 2016).

## 4. Regulated zone
Inside national territory, plus 12 nm of territorial sea, plus a 24 nm boom-carpet half-width (great-circle
distance on a 0.1° grid), flight must be boomless or subsonic. Beyond it, design Mach is allowed. Every
country is treated as restricted unless its rule says otherwise (`docs/RULES.md`).

## 5. Routing
- Time-dependent shortest path on a 1° grid (16 directions), then continuous refinement.
- The aircraft meets the forecast valid when it arrives. Ground speed comes from the wind triangle.
- Subsonic climb and descent (150 nm). Acceleration at +0.06 M/min and deceleration at −0.10 M/min.
- Constant-Mach blocks of at least 300 nm.
- Objectives: time, cost, or cost plus passenger time. Over land a corridor is flown only where it beats
  subsonic on the objective.

## 6. Verification and validation

### 6.1 Verification (code does what the equations say; runs in CI before every build)
| Test | Criterion | Result |
|---|---|---|
| Isothermal still air → textbook Mach cone | sin μ = 1/M to 1e-6 | pass |
| Linear sound-speed gradient → circular-arc rays | turning height, range, time to 1e-5 | pass |
| Ray invariant along integrated rays | ω conserved to 1e-6 | pass |
| Ray tracer vs `mmax_grid` | same cutoff within 0.0015 Mach | pass |
| ISA sanity | M 1.153 (no buffer) FL400 | pass |
| Terrain, lateral rays, no-corridor cases | `test_physics.py` | pass |
| Carlson sample problem 1 | 74.6 Pa vs 74 printed | pass |
| Concorde M2 FL520 | 2.04 vs 1.94 psf measured (NASA FS-016) | pass (±15%) |
| FaINT eq. 8 | 71 / 86 dB reproduced | pass |

### 6.2 Validation against the atmosphere
| Question | Data | Result |
|---|---|---|
| Day-ahead forecast error of boomless Mach | 1,044 GFS forecasts vs radiosondes, 6 US stations, Sep–Oct 2026 | σ ≈ 0.015 |
| How often is a corridor usable? | 4,283 soundings, Oct 2025 – Sep 2026 | FL350 38%, FL500 85%, FL550 93% (margin 0.03) |
| Winter error | Dec–Feb soundings | **Open** (#10) |

### 6.3 Operational value and safety in hindcast
53 weekly GFS analyses and 24 h forecasts, 48 directed routes, real-world error added (σ 0.012, 300 nm correlation).

| Policy (FL550, Overture-class) | Minutes saved vs ban | Flights with > 20 nm boom |
|---|---|---|
| Single margin 0.05 | 27.9 | 1.2% |
| Auto margin (k·σ) | 27.0 | 0.48% |
| Perfect knowledge | 36.4 | 0% |
| Fixed M1.05, no weather | 18.9 | boom on 1.1% of distance |

### 6.4 Loudness
Validated only against the published cases in §6.1. **Open:** sBOOM reference cases (#14), X-59 and XB-1
measurements (#21), secondary booms (#16).

## 7. Known limitations
| Limitation | Effect | Bound or plan |
|---|---|---|
| Single-column atmosphere (no horizontal gradients along the ~40 km ray) | unknown sign | 3D ray tracing (#17) |
| 1° GFS | analysis-time error 0.009–0.016 | GFS 0.25° (#6) |
| Level flight | a −3° descent costs about 0.03 Mach | descent subsonic in the route model |
| Manoeuvre focusing | superbooms in turns and acceleration | flagged later (#18) |
| Turbulence | spikier or rounder booms | psf distribution (#19) |
| Buffer not calibrated on flight data | the caustic may be closer than safe | margin keeps it above ΔZ_S in the hindcast; XB-1 data (#21) |

## 8. Change control and reproducibility
- Physics and data changes go through the CI test suite (`.github/workflows/forecast.yml`) before a build ships.
- Every map carries the GFS run id; hindcast data live on versioned branches (`study-data`,
  `study-data-gefs`, `study-data-haglund`).
- Datasets are rebuilt from code (`study/datasets.py`).
- Phase 4 adds a model version number on every evidence file and a frozen regression set of 1,000 soundings.
- Software assurance: ground planning tool, so DO-178C does not apply directly. The plan follows its spirit
  (requirements → code → test traceability, this document) and DO-200B for the data chain.

## 9. Traceability
| Requirement | Implementation | Test / evidence |
|---|---|---|
| No primary-boom ray below the floor | `physics.mmax_grid` | §6.1 rays, tracer agreement |
| Floor above the highest terrain under the footprint | `build.fetch_orog`, `footprint_max` | `test_terrain` |
| Margin covers forecast error at ≤ 0.5% of flights | `study/margin.py`, `ship_margin.py` | `results/margin_eval.json` |
| Primary-boom psf per leg | `boom.py`, `boom.js` | `test_boom.py` |
| Restricted zone exact to 0.1° | `zone.py` | visual check, `study/common.zone_at` |
| Data fresh within 1 h | `fresh.py` | workflow history |

## 10. References
- Carlson, H. W., *Simplified Sonic-Boom Prediction*, NASA TP-1122, 1978.
- Cliatt, Hill, Haering, *Mach Cutoff Analysis and Results from NASA's Farfield Investigation of No-Boom Thresholds*, NTRS 20160007348, 2016.
- Haglund, G. T., NASA CR-2417, 1974 (safe cutoff altitude).
- NASA DFRC Fact Sheet FS-016 (sonic boom overpressures).
- FAA NPRM *Enabling Supersonic Overland Flight*, 91 FR 40470, 2 July 2026, docket FAA-2026-6935.
- NOAA GFS and GEFS v12 documentation (NCEP).
