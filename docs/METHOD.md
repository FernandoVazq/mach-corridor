# Mach Corridor — Method Document (draft 0.4, 12 Oct 2026)

Written for a reviewer who must decide whether this method can be part of an operator's means of compliance
under the proposed rule (FAA NPRM "Enabling Supersonic Overland Flight", docket FAA-2026-6935: sonic boom
overpressure at the surface ≤ 0.11 psf, primary and secondary booms). Status: **research prototype**. Every
claim below points to code, a test or a dataset in this repository; unvalidated items are marked **Open**.

## 1. What the method claims

For a supersonic aircraft at a given flight level, position, time and direction of travel, the method gives
the **highest Mach at which no primary-boom ray reaches the ground** (Mach cutoff), with a margin for forecast
error, the **expected ground overpressure** of each leg (primary boom, and below the turning point on cutoff legs),
and whether a leg's **secondary booms** would land on regulated land (§4.1; their loudness is not computed).

| Output | Where | Evidence |
|---|---|---|
| Boomless Mach, 36 directions × 7 levels, 0–48 h | `engine/physics.py`, `engine/build.py` | §6.1–6.3 |
| Margin for forecast error | `study/margin.py`, `site/geo/sigma.*` | §6.3 |
| Ground overpressure per leg (primary boom; below the turning point on cutoff legs) | `engine/boom.py`, `engine/caustic.py`, `site/boom.js` | §3.4, §6.4 |
| Secondary-boom landing check | `engine/secondary.py`, `site/route.js` | §4.1 |
| Regulated zone (territory + 12 nm + 24 nm) | `engine/zone.py` | §4 |
| Route and Mach profile | `site/route.js` | §5 |

## 2. Inputs

| Input | Source | Resolution | Version control |
|---|---|---|---|
| Temperature, humidity, wind, height on 23 pressure levels (1000–50 hPa) | NOAA GFS, AWS Open Data (`noaa-gfs-bdp-pds`) | 1°, 0–48 h every 6 h | run id in `manifest.json` |
| Terrain under the boom footprint | GFS 0.25° orography, max over ±0.5°, raised to a DEM maximum where higher (Terrarium z8 ≈ 600 m, 3×3 median; `engine/dem_floor.py`) | 0.25° / 600 m → 1° | run id; `engine/data/dem_footprint_max.npy` |
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
(quiet height − 1 km) × 1.3×10⁻⁵ Mach/m, where the quiet height is the turning-point height that gives 0.11 psf on the
ground (§3.4, about 1.05–1.08 ΔZ_S for airliners and bizjets); it never adds speed for short signals (`site/boom.js`, `bufferPenalty`).
**Terrain (issue #42).** GFS orography is smoothed, so the highest real terrain under the footprint sits higher.
Against a DEM maximum over the same ±0.5° (Terrarium z8 tiles, 13,196 nodes above 300 m, `study/results/dem_floor.json`):
higher at 93% of nodes; median +149 m where GFS shows 0.3–1 km, +415 m at 1–2 km, +574 m at 2–3.5 km, +813 m
above 3.5 km (p90 +1.6 km), i.e. the map over-stated the boomless Mach by about 0.002–0.010 there. The floor
now uses the higher of the two.

An earlier version of this check used a 60 m signal and found 3%; that signal length was too short for an airliner.

### 3.3 Forecast-error margin
The flown Mach is the forecast boomless Mach minus a margin.
- **Auto, ensemble (default source):** k·√(s² + 0.012²) per point and direction. s is the member spread of
  the boomless Mach in the GEFS (daily 00Z run, 0–54 h, at least 20 of 31 members, published on a 2° grid in
  0.001 steps, `engine/gefs_live.py`); 0.012 is the
  real-world error no model run sees (validation against radiosondes: 0.015 total), raised to 0.015 over mountains
  (ramp from 0.5 to 1.5 km of terrain; mountain balloon stations show ~20% more unsafe-side error, §6.2).
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
raised to the larger fit. The 95% upper bounds (0.9–1.9% for the ensemble margin by level; up to 3.7% for one margin at FL450) show that one year of weekly dates cannot yet
demonstrate the 0.5% target with confidence.

**Scored in psf (`study/psf_eval.py`, issue #37).** The same held-out runs, with each flight scored by its
highest ground overpressure: on every regulated sample the true turning point is 1 km + (true limit − flown
Mach)/1.28×10⁻⁵ per m above the terrain, and its ground psf comes from the caustic model (§3.4; full primary
boom ×2 below 0.6 ΔZ_S). Boom Overture class.

| Level | Policy (as the router flies it: margin + quiet-height cushion) | Flights > 0.11 psf | 95% upper | Minutes saved |
|---|---|---|---|---|
| FL550 | ensemble (k 3.75) | 0.39 / 0.48% | 0.88% | 28.3 / 25.2 |
| FL550 | ensemble, **without** the cushion | 1.39 / 1.28% | 2.32% | 29.1 / 26.1 |
| FL550 | one margin 0.06 | 0.39 / 0.40% | 0.72% | 26.6 / 23.4 |
| FL450 | ensemble | 1.0 / 0.08% | 1.85% | 23.7 / 21.2 |
| FL350 | ensemble | 0.69 / 0% | 1.39% | 17.8 / 18.0 |

Fitting k directly on the psf event (`psf_eval.py --fit`, first k whose fit-half rate is ≤ 0.5%) gives the same
values as shipped: FL550 3.75 both halves, FL450 4.0 / 4.25, FL350 3.75 / 4.0.

Reading: in the rule's unit the FL550 point estimates meet 0.5%, and the per-aircraft cushion is what does it
(it cuts violations about three times for under a minute). With the site's ×1.25 psf factor FL550 is 0.56–0.69%.

**Chance per flight (issue #20).** Each boomless leg exceeds 0.11 psf if the true limit falls below the flown
Mach plus the cushion: p = Φ((M + turn − M_cut − margin)/(f·margin/k)). Legs within 300 nm share one error draw,
so P(flight) = 1 − Π over 300 nm blocks of (1 − worst leg). The inflation f (errors heavier-tailed than Gaussian) is
fitted on one half-year so the mean predicted rate equals the observed one, and tested on the other
(`psf_eval.py --prob`): FL550 f = 1.15 / 1.19, predicted 0.54 / 0.34% vs observed 0.39 / 0.48%; FL450 1.25 / 1.35;
FL350 1.11 / 1.29. Calibrated on average; with about five events per half-year, whether it ranks flights correctly
is not yet shown. The site uses f = 1.17 (FL550), 1.30 (FL450), 1.20 (FL350) and shows the chance per flight;
the evidence file carries it per leg.

Evidence (`study/gefs_eval.py`, 53 weeks): the RMS error of the GFS forecast rises with the GEFS spread from
0.004 (lowest decile) to 0.013–0.016 (highest). Correlation of |error| with spread is 0.39–0.45. The GEFS mean
is no more accurate than GFS (RMSE 0.008–0.009 vs the analysis).

### 3.4 Loudness
- **Primary boom, legs not in cutoff:** Carlson's simplified method (NASA TP-1122):
  Δp = K_p K_R √(p_v p_g) (M²−1)^{1/8} h^{−3/4} l^{3/4} K_S, with K_R = 1.9, K_p = 1.0 and K_S = 0.088
  (SST-class).
- **Cutoff legs (v1, `engine/caustic.py`):** linear fold-caustic theory. Each frequency of Carlson's incident
  N-wave is matched through the turning point with an Airy function, β = (2k²/R)^{1/3}, and meets a rigid ground
  D below the caustic: p(D,ω) = P_inc(ω)·2√π(β z_ref)^{1/4} e^{−iπ/4}·[Ai(βD) − Ai′/Bi′·Bi]. High frequencies decay
  first, so the ground boom falls fast with D.
  - **Check against FaINT** (F-18, M1.15, 37,000 ft, Cliatt et al. 2016 Table 2): caustic 1–2 ΔZ_S up, model
    0.01–0.12 psf vs measured 0.03–0.09; above 2 ΔZ_S model ≤ 0.011 vs measured 0.01–0.10 (noise floor).
    Within 1 ΔZ_S the model over-predicts (0.1–1.9 vs 0.03–0.33): linear theory without nonlinear focusing
    limits, conservative.
  - **Quiet height** (caustic height giving 0.11 psf): 1.05–1.08 ΔZ_S for airliners and bizjets, about 1.0 for
    small aircraft: about 1.3 km for a 61 m airliner at FL550, 0.8 km for a bizjet, 0.43 km for XB-1, all at M1.15
    (`study/results/caustic.json`).
  - **Site:** closed forms fitted to the model (quiet height within 0.04 ΔZ_S; psf −19%/+26% near the limit,
    scaled ×1.25 so never below the model). The router's cushion is the quiet height; each boomless leg reports
    its psf at caustic height 1 km + (map limit − flown Mach)/0.0128 per km.

## 4. Regulated zone
Inside national territory, plus 12 nm of territorial sea, plus a 24 nm boom-carpet half-width (great-circle
distance on a 0.1° grid), flight must be boomless or subsonic. Beyond it, design Mach is allowed. Every
country is treated as restricted unless its rule says otherwise (`docs/RULES.md`).

### 4.1 Secondary booms (`engine/secondary.py`)
The proposed rule's 0.11 psf applies to primary, secondary direct and secondary indirect booms. Rays of the upper
half of the Mach cone travel along e = heading + α with trace velocity V_t = M c_a cos α + w·e; the stratosphere
(20–60 km) bends them back when V_lo < V_t < V_hi (V_lo: highest c + w·e from the ground to FL300, V_hi: highest
above FL300, to 70 km), and they land R₁ (direct) or R₂ (after a sea bounce) away. A Mach-cutoff leg cannot
make one: its rays are trapped by the same V_lo. Concorde's secondaries were 1–10 Pa (0.02–0.2 psf) at
120–160 km (Rogers & Maglieri 2015), so a secondary landing on regulated land (territory + 12 nm) is treated as
a violation; loudness is not computed. Atmosphere: GFS to 1 hPa (about 48 km), US Standard Atmosphere 1976 shape
above, winds tapered to zero at 70 km. Thermospheric returns (0.1–0.3 Pa) are ignored.

- **Year study** (24 GFS analyses, Oct 2025 – Sep 2026, 2,408 coastal ocean columns, 12 headings, FL550):
  a secondary lands somewhere for about a quarter of column-headings; range 125 / 173 / 312 km (5th / 50th /
  99th percentile, direct), 179 / 246 / 423 km after a sea bounce; turning height about 41 km. It lands on
  regulated land for 12% of headings flown 70–150 km off the coast, 7.5% at 150–250 km, 2.5% at 250–400 km,
  0.1% beyond 400 km; most often in Dec–Jan and Jul. Overture (M1.7) and Concorde (M2.0) are alike. A fixed
  standoff keeping 99% off land would be about 335 km.
- **Live:** the forecast build tabulates V_lo, V_hi, R₁ and R₂ per 2° cell and 36 ray directions every 12 h
  (`ssb_f{fh}_{a,b}.png`). The router checks every supersonic leg over water within about 560 km of regulated
  land: rays every 8° across the cone, landing band ±25 km. If any lands on regulated land the leg is flown at
  the cutoff Mach (or subsonic). Without tables it assumes 125–420 km in every direction (fail-closed). The
  route map shows the landing points (red on land).
- **Loudness estimate:** Concorde's measured 1–10 Pa (typical ~3 Pa = 0.066 psf, upper 0.2 psf) scaled by the
  aircraft's primary boom relative to Concorde at M2, FL550: Overture typical 0.06, upper 0.19 psf; AS2 0.08 / 0.26;
  N+3 0.07 / 0.22; even an XB-1-size aircraft at FL360 reaches 0.19 upper. Every upper value is above 0.11 psf, so
  the conservative rule (no secondary on regulated land) stays; the estimate is shown in the plan and evidence file.
- **Check:** the vectorised tables match the ray-by-ray integration to 2% (`test_secondary.py`); synthetic
  stratospheric jets land at 150–270 km, inside the Concorde observations' order of magnitude.

## 5. Routing
- Time-dependent shortest path on a 1° grid (16 directions), then continuous refinement.
- The aircraft meets the forecast valid when it arrives. Ground speed comes from the wind triangle.
- Subsonic climb and descent (150 nm). Acceleration at +0.06 M/min and deceleration at −0.10 M/min.
- Constant-Mach blocks of at least 300 nm.
- Objectives: time, cost, or cost plus passenger time. Over land a corridor is flown only where it beats
  subsonic on the objective.

- **Approach (issue #44).** Just above its cutoff Mach a boom ray grazes down and lands far ahead: along-track
  landing distance at +0.002 Mach median 48 km, 99th percentile 86 km, max 90 km (+0.01: 68 km p99; at M1.7,
  16 km), from 60 ocean columns × 4 headings of a live GFS run (`study/forward_reach.py`). Slowing down at the
  36 nm zone edge left only about 44 km to the 12 nm line, so most last near-cutoff booms of an approach would
  have landed inside. The router now flies at the cutoff Mach any over-water leg with regulated ground
  (territory + 12 nm) within 90 km ahead (±10°); the deceleration to it ends before that point. Accelerating
  away from a coast puts those rays seaward.
- **Turns (issue #44).** A turning aircraft focuses its rays. A 2× focus needs about 0.3 km more cushion below
  the turning point (1.62 vs 1.32 km for an airliner, caustic model; 1.5×: +0.17 km; 3×: +0.5 km), so boomless
  legs whose heading changes by more than 2° per 15 nm fly 0.004 Mach slower. Cost in tests: 0–1 min per route.

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
| Airy matching above the caustic → GO amplitude | 5% | pass (`test_caustic.py`) |
| Rigid ground in deep shadow → 2 Ai | asymptotic | pass |
| F-18 shadow-zone psf vs FaINT bins (1–2 ΔZ_S, > 2 ΔZ_S) | inside measured range | pass |

### 6.2 Validation against the atmosphere
| Question | Data | Result |
|---|---|---|
| Day-ahead forecast error of boomless Mach | 1,044 GFS forecasts vs radiosondes, 6 US stations, Sep–Oct 2026 | σ ≈ 0.015 |
| How often is a corridor usable? | 4,283 soundings, Oct 2025 – Sep 2026 | FL350 38%, FL500 85%, FL550 93% at margin 0.03; lower at the shipped margins (about 0.05), to be re-reported |
| Error by forecast age | 2,006 launches, same stations and year, every 2nd day, GFS 1° (`study/results/validation_leads.json`) | RMS 0.0104 analysis, 0.0113 at 6 h, 0.0119 at 12 h, 0.0132 at 24 h; bias −0.003 at every age. **Unsafe side** (model allows more than the balloon; semi-RMS √(2·mean(max(e,0)²))): 0.0079, 0.0088, 0.0095, 0.0108. 99th percentile of the error 0.021, 0.024, 0.025, 0.029 (`unsafe_semi_rms`, `p99`) |
| Mountain, Alaska and Europe | 1,494 launches at Albuquerque, Grand Junction, Salt Lake City, Anchorage, Lindenberg, Camborne, every 2nd day, Oct 2025 – Sep 2026 (`study/results/validation_stations.json`) | 24 h RMS: mountain 0.0138–0.0141, Anchorage 0.0127, Europe 0.0109–0.0110. Unsafe side at 6 h: mountain 0.0108–0.0114, Anchorage 0.0105, Europe 0.0070–0.0076. Mountains about 20% worse → real-world term 0.015 there (§3.3); Denver has no IGRA2 launches in the period |
| Day-ahead error, full year | 4,004 IGRA2 launches, 6 US stations, Oct 2025 – Sep 2026, 00/12 UTC (`engine/validate.py`, monthly in CI) | σ 0.0131 (FL350 0.0129, FL450 0.0141, FL550 0.0122); analysis 0.0103; winter 0.0130 vs 0.0131; 0.25° 0.0134 (no gain); bias −0.003 (forecast slower than allowed) |

**Phase 1 error gate (0.010).** The RMS gate is not met at any forecast age, including the analysis
(0.0104): what is left is the difference between a 1° grid column and one balloon, not forecast skill. Two
findings matter for operations: (1) re-planning with the run issued about 6 h before departure cuts the error
14% and the unsafe tail by 0.005 Mach; (2) the bias is on the safe side. **Proposed** (owner's decision, not yet
adopted): measure the gate on the unsafe side only, where 6 h and 12 h re-planning pass (0.0088, 0.0095) and
24 h does not (0.0108); and require plans to use a run at most 12 h old at departure.

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
Primary boom: the published cases in §6.1. Below the caustic: FaINT (§3.4). **Open:** sBOOM reference cases
(#14), X-59 and XB-1 measurements (#21), secondary booms (#16).

### 6.5 Climatology for network planners (`study/climatology.py`, issue #30)
Share of days × 36 directions with boomless Mach ≥ 1.15 at the floor (≥ M1.10 after a 0.05 margin), from the 53
weekly 00 UTC analyses, by season; shown on the Physics tab. FL550, land: contiguous US 65% of the year (50% Dec–Feb,
83% Jun–Aug), Europe 43% (27% Mar–May, 56% Jun–Aug), China 75%, Australia 87%, Middle East 88%, Brazil 97%; all land
40% (FL450 32%, FL350 20%). Weekly 00 UTC dates only (12–14 per season), so the seasonal maps are indicative.

## 7. Known limitations
| Limitation | Effect | Bound or plan |
|---|---|---|
| Single-column atmosphere (no horizontal gradients along the ~40 km ray) | unknown sign | 3D ray tracing (#17) |
| 1° GFS | analysis-time error 0.009–0.016 | GFS 0.25° (#6) |
| Level flight | a −3° descent costs about 0.03 Mach | descent subsonic in the route model |
| Secondary-boom loudness not computed; footprint ±25 km | conservative (any landing on land counts); lateral drift ignored | PCBoom secondary cases (#16) |
| Manoeuvre focusing | superbooms in turns and acceleration | flagged later (#18) |
| Turbulence | spikier or rounder booms | psf distribution (#19) |
| Buffer not calibrated on flight data | the caustic may be closer than safe | margin keeps it above ΔZ_S in the hindcast; XB-1 data (#21) |

## 8. Change control and reproducibility
- Physics and data changes go through the CI test suite (`.github/workflows/forecast.yml`) before a build ships.
- Every map carries the GFS run id; hindcast data live on versioned branches (`study-data`,
  `study-data-gefs`, `study-data-haglund`).
- Datasets are rebuilt from code (`study/datasets.py`).
- Every evidence file carries the model version (`docs/CHANGELOG.md`), the code version (build commit), the data
  runs (§5.1) and a SHA-256 of its own content, recomputed in CI (`tests/evid.mjs`). Phase 4 adds a frozen
  regression set of 1,000 soundings.
- Monthly validation in CI covers all 12 balloon stations, GFS and ECMWF IFS, at 0, 6 and 24 h.
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
| 1 | blocker | The calibrated event (> 20 nm of boom) is not the rule's quantity (any surface psf > 0.11) | hindcast scored in psf (§3.3): FL550 0.39–0.48% of flights > 0.11 psf, 95% upper 0.88%; k refitted on the psf event = shipped k. Open: a tighter 95% bound needs more dates (#37) |
| 2 | blocker | Secondary booms from over-water legs can land inland | year study and live router check in place (§4.1); loudness of secondaries not computed, landing on land treated as a violation (#38) |
| 3 | blocker | FaINT bound (F-18) and buffer used outside tested conditions; 1.35 km cap non-conservative | model in place (§3.4): physics-based, FaINT-checked loudness below the caustic for any aircraft; open until checked on an airliner-size boom (#21) |
| 4 | major | In-sample calibration; independent noise for overlapping routes | fixed: time hold-out, shared field, bootstrap (§3.3) |
| 5 | major | 0.012 real-world term rests on 2 months at 6 stations | full-year balloon validation (§6.2) |
| 6 | major | Hindcast truth is the same model; interpolation across no-corridor columns | router no longer interpolates across them; #41 for independent truth |
| 7 | major | Terrain smoothing and ray reach beyond ±0.5° | DEM floor shipped: real terrain is above the GFS footprint max at 93% of nodes (median +258 m; +813 m over 3.5 km terrain = 0.010 Mach); reach beyond ±0.5° open (#42) |
| 8 | major | Hindcast flies great circles, the router chases high forecasts; wrong-hour spread fallback | fallback fixed; #40 |
| 9 | major | Acceleration, turns, deceleration from M1.7 near the zone | approach reach (90 km) and turn focusing (0.004 Mach) in the router (§5); manoeuvre-rate limits for the flight crew open (#44) |
| 10 | major | Operational assurance items (air-data allowance, monitoring, stale data, integrity) | stale data, forecast coverage and evidence file done (§5.1); air-data allowance and monitoring open (#43) |
| 11 | minor | Lateral rays stopped at 45° | fixed: up to 60° within the Mach cone |
| 12–14 | minor | Availability at 0.03 margin; k reconciliation; 00 UTC only | §6.2 note; §3.3 reconciled; balloon validation uses 00 and 12 UTC |

**Consequence:** no compliance claim is made until findings 1–3 are closed. They are Phase 2 gate items.
