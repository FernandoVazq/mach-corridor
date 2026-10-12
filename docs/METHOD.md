# Mach Corridor — Method Document (draft 0.3, 11 Oct 2026)

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
  ΔZ_S = R^{1/3} L^{2/3}, R = c / |dV_P/dz| over 0.5–2 km above ground, L = 150 m (SST-class signal: Carlson
  duration × sound speed), capped at about 2.5 km where V_P hardly falls with height (NASA CR-2417; used in FaINT).

Evidence (`study/buffer_check.py`, one GFS run, SST signal 150 m): ΔZ_S median 1.2 km, 90th percentile 1.8 km; at
the exact limit the caustic is below ΔZ_S in 33% of land columns, with a 0.05 margin in none (the margin, not the
1 km, provides the clearance; see review finding 3). The router subtracts the aircraft's extra cushion,
(ΔZ_S − 1 km) × 1.3×10⁻⁵ Mach/m, never adding speed for short signals (`site/boom.js`, `bufferPenalty`).
An earlier version of this check used a 60 m signal and found 3%; that signal length was too short for an airliner.

### 3.3 Forecast-error margin
The flown Mach is the forecast boomless Mach minus a margin.
- **Auto, ensemble (default source):** k·√(s² + 0.012²) per point and direction. s is the member spread of
  the boomless Mach in the GEFS (daily 00Z run, 0–54 h, at least 20 of 31 members, published on a 2° grid in
  0.001 steps, `engine/gefs_live.py`); 0.012 is the
  real-world error no model run sees (validation against radiosondes: 0.015 total).
- **Auto, fallback:** k·σ(x), with σ² = σ_ana(x)² + 0.012², from 53 weekly hindcasts.
- k per level: ensemble FL350 4.0, FL450 4.25, FL550 3.75 (the larger of two half-year fits, see below);
  fallback FL350 3.79, FL450 4.10, FL550 3.74 (2-fold cross-validated over dates). Other levels use the
  neighbouring values. If GEFS has no hour within 3 h of a leg, that leg uses the fallback map.

**Time hold-out (`study/robust_eval.py`).** k fitted on Oct–Mar is tested on Apr–Oct and the reverse. The real-world
error is one spatial field per date shared by all routes (Gaussian covariance, L = 300 nm; 100 and 1000 nm as
sensitivity). Exposure = share of flights with any boom on the ground; 95% interval from a block bootstrap over dates.

| Level | Policy | Held-out exposure (any boom) | 95% upper | Minutes saved |
|---|---|---|---|---|
| FL550 | one margin (0.06) | 0.39 / 0.40% | 0.72% | 27.5 / 24.3 |
| FL550 | ensemble (k 3.75) | 0.39 / 0.48% | 0.88% | 29.1 / 26.1 |
| FL450 | one margin | 2.0% / 0% | 3.7% | 23.7 / 18.1 |
| FL450 | ensemble | 1.0% / 0.1% | 1.9% | 24.1 / 21.5 |

Reading: at FL550 the 0.5% target holds out of sample with every policy, and the ensemble saves 1.6–1.8 min
more. At FL350–450 a margin fitted on winter fails in summer (1–3%); the ensemble generalises best, and its k was
raised to the larger fit. The 95% upper bounds (0.7–1.9%) show that one year of weekly dates cannot yet
demonstrate the 0.5% target with confidence.

Evidence (`study/gefs_eval.py`, 53 weeks): the RMS error of the GFS forecast rises with the GEFS spread from
0.004 (lowest decile) to 0.013–0.016 (highest). Correlation of |error| with spread is 0.39–0.45. The GEFS mean
is no more accurate than GFS (RMSE 0.008–0.009 vs the analysis).

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

### 5.1 Fail-closed rules and evidence file
Over land a corridor is flown only when all of these hold; otherwise that leg is planned subsonic and the
reason is recorded (`site/route.js` `failClosed`):

| Rule | Limit |
|---|---|
| Forecast run age at planning time | ≤ 18 h (two missed 6-hourly runs) |
| Aircraft time inside the forecast | leg time ≤ last forecast hour |
| Forecast-error margin available | finite margin (ensemble spread, else the static error map) |

Old data can be used on purpose as a **study** (switch in the route panel); the evidence file then records
`study_mode_off: false`. "Download evidence" exports every leg (position, time, lead time, Mach, boomless
limit after margin, margin, fail-closed reason, wind, ground psf), the GFS and GEFS runs, the code version
(`code_version` = commit of the build) and six pass/fail checks, as JSON plus a CSV of the legs.

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
| How often is a corridor usable? | 4,283 soundings, Oct 2025 – Sep 2026 | FL350 38%, FL500 85%, FL550 93% at margin 0.03; lower at the shipped margins (about 0.05), to be re-reported |
| Day-ahead error, full year | 4,004 IGRA2 launches, 6 US stations, Oct 2025 – Sep 2026, 00/12 UTC (`engine/validate.py`, monthly in CI) | σ 0.0131 (FL350 0.0129, FL450 0.0141, FL550 0.0122); analysis 0.0103; winter 0.0130 vs 0.0131; 0.25° 0.0134 (no gain); bias −0.003 (forecast slower than allowed) |

### 6.3 Operational value and safety in hindcast
53 weekly GFS analyses and 24 h forecasts, 48 directed routes, real-world error added (σ 0.012, 300 nm correlation).

| Policy (FL550, Overture-class) | Minutes saved vs ban | Flights with > 20 nm boom |
|---|---|---|
| Single margin 0.05 | 27.9 | 1.2% |
| Auto margin, static σ map | 27.0 | 0.5% |
| Auto margin, GEFS spread | 27.7 (in sample); 26.1–29.1 held out | 0.4–0.5% held out, 95% upper 0.9% |
| Perfect knowledge | 36.4 | 0% |
| Fixed M1.05, no weather | 18.9 | boom on 1.1% of distance |
| Single margin 0.05, computed buffer (60 m signal; superseded) | 28.9 | 1.6% |

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
- Every evidence file carries the code version (build commit) and data runs (§5.1). Phase 4 adds a frozen
  regression set of 1,000 soundings.
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
| No corridor on stale or missing data | `route.js failClosed` | evidence file `checks`, `tests/evid.mjs` |

## 10. References
- Carlson, H. W., *Simplified Sonic-Boom Prediction*, NASA TP-1122, 1978.
- Cliatt, Hill, Haering, *Mach Cutoff Analysis and Results from NASA's Farfield Investigation of No-Boom Thresholds*, NTRS 20160007348, 2016.
- Haglund, G. T., NASA CR-2417, 1974 (safe cutoff altitude).
- NASA DFRC Fact Sheet FS-016 (sonic boom overpressures).
- FAA NPRM *Enabling Supersonic Overland Flight*, 91 FR 40470, 2 July 2026, docket FAA-2026-6935.
- NOAA GFS and GEFS v12 documentation (NCEP).

## 11. Independent review (11 Oct 2026)
A reviewer who had not seen the work (FAA noise-certification, propagation physics, statistics) found:

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | blocker | The calibrated event (> 20 nm of boom) is not the rule's quantity (any surface psf > 0.11) | #37; any-boom rate now reported (§3.3) |
| 2 | blocker | Secondary booms from over-water legs can land inland | #38 (with #16) |
| 3 | blocker | FaINT bound (F-18) and buffer used outside tested conditions; 1.35 km cap non-conservative | #39 |
| 4 | major | In-sample calibration; independent noise for overlapping routes | fixed: time hold-out, shared field, bootstrap (§3.3) |
| 5 | major | 0.012 real-world term rests on 2 months at 6 stations | full-year balloon validation (§6.2) |
| 6 | major | Hindcast truth is the same model; interpolation across no-corridor columns | router no longer interpolates across them; #41 for independent truth |
| 7 | major | Terrain smoothing and ray reach beyond ±0.5° | #42 |
| 8 | major | Hindcast flies great circles, the router chases high forecasts; wrong-hour spread fallback | fallback fixed; #40 |
| 9 | major | Acceleration, turns, deceleration from M1.7 near the zone | #44 |
| 10 | major | Operational assurance items (air-data allowance, monitoring, stale data, integrity) | stale data, forecast coverage and evidence file done (§5.1); air-data allowance and monitoring open (#43) |
| 11 | minor | Lateral rays stopped at 45° | fixed: up to 60° within the Mach cone |
| 12–14 | minor | Availability at 0.03 margin; k reconciliation; 00 UTC only | §6.2 note; §3.3 reconciled; balloon validation uses 00 and 12 UTC |

**Consequence:** no compliance claim is made until findings 1–3 are closed. They are Phase 2 gate items.
