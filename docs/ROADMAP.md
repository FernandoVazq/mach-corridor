# Mach Corridor — Program

Narrative roadmap (physics, compliance, design, risks): [Roadmap doc](https://claude.ai/code/artifact/9caa4fcf-3d04-4447-90af-6ae9986fbead).
This file is the working plan: phases, gates, KPIs and the issue for every deliverable. Status lives in the issues.

## How work runs

- **One issue per deliverable**, labelled by hat (`hat:design`, `hat:physics`, `hat:math`, `hat:engineering`, `hat:aerospace`) and milestone = phase.
- **Sprints of about two weeks**, labelled `sprint-N`. A sprint ends with KPIs re-measured and `site/kpis.json` updated.
- **Gates**: a phase's claims go on the map only after its gate passes. No physics or data change ships without the test suite.
- **Owners**: cloud session = `engine/`, `site/`, automation; local session (`owner:local`) = `validation/` against soundings and flight data.

## KPIs

| KPI | Start | Today | Phase gate | Target |
|---|---|---|---|---|
| Flights with a boom on the ground | 1.2 % | 0.48 % | 0.5 % | 0.1 % |
| Minutes saved per overland flight | 28.2 min | 27.0 min | — | 30 min |
| Share of perfect-knowledge saving | 77 % | 74 % | — | 90 % |
| Day-ahead boomless-Mach error | 0.015 Mach | 0.015 Mach | 0.01 Mach | 0.008 Mach |
| Legs with loudness in psf | 0 % | 100 % | — | 100 % |
| New GFS data to updated map | 5 h | 1 h | — | 1 h |
| 3D playback, mid-range laptop | — | — | — | 60 fps |
| WCAG 2.2 AA checks passed | — | — | — | 100 % |


## Phase 1 · Precise — due 2026-12-31

**Gate:** Day-ahead error <= 0.010 vs balloons; boom exposure <= 0.5% of flights at the default margin

| # | Deliverable | Hats | Done when |
|---|---|---|---|
| [#1](https://github.com/FernandoVazq/mach-corridor/issues/1) | Per-point margin v0 from the hindcast forecast error **(sprint 1)** | math | Hindcast with real-world error: lower boom exposure than the uniform margin at equal minutes saved. |
| [#2](https://github.com/FernandoVazq/mach-corridor/issues/2) | Exact regulated zone: coastline + 12 nm + 24 nm carpet **(sprint 1)** | engineering | Zone raster ≤ 0.1° shipped; app, router and study use it. |
| [#3](https://github.com/FernandoVazq/mach-corridor/issues/3) | Hourly freshness: build as soon as a new GFS run is on AWS **(sprint 1)** | engineering | Map updated ≤ 1 h after the run's last file is on AWS. |
| [#4](https://github.com/FernandoVazq/mach-corridor/issues/4) | Math test suite: ray tracer and analytic cases **(sprint 1)** | physics, math | All run in CI before every build. |
| [#5](https://github.com/FernandoVazq/mach-corridor/issues/5) | KPI board on the Method page **(sprint 1)** | design | Every roadmap KPI visible with its source. |
| [#6](https://github.com/FernandoVazq/mach-corridor/issues/6) | GFS 0.25° with pgrb2b levels | engineering | Analysis-time error vs balloons drops measurably vs 1°; map tiles load < 2 s on 4G. |
| [#7](https://github.com/FernandoVazq/mach-corridor/issues/7) | GEFS ensemble spread as margin per point and hour | math | Hindcast exposure ≤ 0.5% at the default margin. |
| [#8](https://github.com/FernandoVazq/mach-corridor/issues/8) | 30 m terrain under the boom footprint | engineering | Floor height uses DEM maxima; difference vs GFS orography reported. |
| [#9](https://github.com/FernandoVazq/mach-corridor/issues/9) | ECMWF open data (IFS 0.25°) as a second model | engineering, math | Disagreement map shipped; correlation with error vs balloons measured. |
| [#10](https://github.com/FernandoVazq/mach-corridor/issues/10) | Winter validation (Dec–Feb) vs radiosondes *(local)* | math | σ by season on the Method page; margin updated if winter is worse. |
| [#11](https://github.com/FernandoVazq/mach-corridor/issues/11) | Monthly forecast-error tracking | math, design | Dashboard updates monthly without manual work. |

## Phase 2 · Loudness — due 2027-03-31

**Gate:** Reproduces sBOOM reference cases within 5%; FaINT caustic data within its scatter

| # | Deliverable | Hats | Done when |
|---|---|---|---|
| [#12](https://github.com/FernandoVazq/mach-corridor/issues/12) | Loudness v0: psf per leg (Carlson simplified method) **(sprint 1)** | aerospace | Matches published Concorde and SR-71 ground overpressures within 15%; every route leg shows psf. |
| [#13](https://github.com/FernandoVazq/mach-corridor/issues/13) | Near-field signature library (Whitham F-function) | aerospace, physics | Overpressure at 3 body lengths within 10% of published Concorde / X-59 signatures. |
| [#14](https://github.com/FernandoVazq/mach-corridor/issues/14) | Augmented Burgers propagation along rays | physics | sBOOM reference cases within 5% in peak overpressure and PLdB. |
| [#15](https://github.com/FernandoVazq/mach-corridor/issues/15) | Caustic decay below the turning point; computed buffer | physics | FaINT measurements reproduced within their scatter. |
| [#16](https://github.com/FernandoVazq/mach-corridor/issues/16) | Secondary booms | physics | Secondary carpet drawn on the map with psf. |
| [#17](https://github.com/FernandoVazq/mach-corridor/issues/17) | 3D ray tracing through the gridded field | physics, engineering | Difference vs single-column quantified on 1,000 cases. |
| [#18](https://github.com/FernandoVazq/mach-corridor/issues/18) | Manoeuvre focusing (turns, acceleration, climbs) | physics, math | Plans that would focus a boom are flagged and smoothed. |
| [#19](https://github.com/FernandoVazq/mach-corridor/issues/19) | Turbulence: psf as a distribution | physics | psf reported as median and 99th percentile. |
| [#20](https://github.com/FernandoVazq/mach-corridor/issues/20) | Uncertainty: probability of exceeding 0.11 psf per leg | math | Every leg carries P(psf > 0.11). |
| [#21](https://github.com/FernandoVazq/mach-corridor/issues/21) | Flight-test data: XB-1 tracks and FaINT microphones *(local)* | aerospace | Data in hand or a documented refusal. |

## Phase 3 · Operational — due 2027-06-30

**Gate:** One operator or manufacturer runs a 3-month shadow trial

| # | Deliverable | Hats | Done when |
|---|---|---|---|
| [#22](https://github.com/FernandoVazq/mach-corridor/issues/22) | Public REST API | engineering | Documented, versioned, monitored. |
| [#23](https://github.com/FernandoVazq/mach-corridor/issues/23) | Flight-plan export (ARINC 633) | engineering, aerospace | Round-trips through one commercial planner. |
| [#24](https://github.com/FernandoVazq/mach-corridor/issues/24) | EFB view: next 300 nm of boomless Mach | design, engineering | Usable on a tablet in a cockpit-light theme. |
| [#25](https://github.com/FernandoVazq/mach-corridor/issues/25) | Per-flight evidence file (signed) | engineering | Exportable, signed, reproducible from the archive. |
| [#26](https://github.com/FernandoVazq/mach-corridor/issues/26) | Monitoring: freshness, error drift, front-end errors | engineering | Dashboard + alert channel live. |
| [#27](https://github.com/FernandoVazq/mach-corridor/issues/27) | Router: step climbs, continuous speed, departure-time advice | math | Optimality gap bounded and reported. |
| [#28](https://github.com/FernandoVazq/mach-corridor/issues/28) | Accessibility audit (WCAG 2.2 AA) | design | Audit passes. |
| [#29](https://github.com/FernandoVazq/mach-corridor/issues/29) | Performance budget in CI (60 fps, < 2 s first map) | engineering, design | Budget enforced on every push. |
| [#30](https://github.com/FernandoVazq/mach-corridor/issues/30) | Climatology atlas for network planners | design, math | Atlas view shipped. |

## Phase 4 · Compliant — due 2027-12-31

**Gate:** FAA accepts the method as part of an operator's means of compliance

| # | Deliverable | Hats | Done when |
|---|---|---|---|
| [#31](https://github.com/FernandoVazq/mach-corridor/issues/31) | Method document for an FAA reviewer | aerospace, physics | Reviewed by an independent expert. |
| [#32](https://github.com/FernandoVazq/mach-corridor/issues/32) | Change control and versioned model | engineering | Release process documented and enforced in CI. |
| [#33](https://github.com/FernandoVazq/mach-corridor/issues/33) | Comment-ready summary for the FAA advisory circular | aerospace | Ready when the AC opens. |
| [#34](https://github.com/FernandoVazq/mach-corridor/issues/34) | Country-by-country rule table | aerospace | Table in the app's data, sourced. |

## Sprint log

### Sprint 1 · 10 Oct 2026
| Issue | Result |
|---|---|
| #4 Math test suite | Hamiltonian ray tracer; isothermal cone, circular-arc and invariant checks exact to 1e-5–1e-6; agrees with `mmax_grid` within 0.0015 Mach. In CI. |
| #1 Margin per point | σ map from 53 weekly hindcasts + 0.012 real-world term; k per level (3.7–4.1) calibrated to the gate. FL550: flights with a boom 1.2% → 0.48% at 27.0 min saved (a single margin needs 0.057 and saves 26.5 min for the same exposure). Gain is modest because the real-world term dominates σ; flow-dependent spread (GEFS, #7) is the next lever. |
| #2 Exact zone | Great-circle distance to Natural Earth 10 m territory at 0.1°; app, router and study use it. Study headline moves 28.2 → 27.9 min. |
| #3 Freshness | Hourly check; builds only when a newer complete run is on AWS. |
| #12 Loudness v0 | Carlson TP-1122 reproduces Sample 1 (74.6 vs 74 Pa) and Concorde (2.04 vs 1.94 psf). Overture M1.7 FL550 ≈ 1.7 psf = 15× the 0.11 limit. Cutoff legs bounded by FaINT (≤ 0.09 psf with the caustic ≥ Haglund safe height). |
| #15 (first look) | Haglund safe height on one run: median 650 m, p90 1.0 km; at the exact limit 3% of land columns fall short of it, with a 0.05 margin none. |
| #5 KPI board | Method page renders `site/kpis.json`. |

## Outside dates

- SAM Act (House): noise standard by 1 April 2027.
- Executive order: final noise certification standards by June 2027.
- FAA NPRM (2 July 2026): ≤ 0.11 psf at the surface, primary and secondary booms; advisory circular to follow.
