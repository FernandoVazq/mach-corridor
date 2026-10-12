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
| Minutes saved per overland flight | 28.2 min | 27.7 min | — | 30 min |
| Share of perfect-knowledge saving | 77 % | 76 % | — | 90 % |
| Day-ahead boomless-Mach error | 0.015 Mach | 0.015 Mach | 0.01 Mach | 0.008 Mach |
| Legs with loudness in psf | 0 % | 100 % | — | 100 % |
| New GFS data to updated map | 5 h | 1 h | — | 1 h |
| 3D playback, mid-range laptop | — | — | — | 60 fps |
| WCAG 2.2 AA checks passed | — | 100 % | — | 100 % |


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

### Sprint 2 · 11 Oct 2026
| Issue | Result |
|---|---|
| #7 GEFS spread | 53 weeks × 31 members: forecast error 3–4× larger in the most uncertain tenth of points; ensemble margin at the 0.5% gate saves 27.7 min at FL550 (+1.1 vs one margin), 23.5 at FL450 (+2.4). Live: daily GEFS 00Z, 0–54 h, per level and direction, feeds Auto. |
| #35 Computed buffer | Haglund safe height per ray direction: median 720 m; +1.0 min per flight at FL550. Kept off the map until FaINT/XB-1 calibration. |
| #28 Accessibility | axe-core WCAG 2.2 AA: 0 violations on every tab, light/dark/phone; enforced in CI. |
| #34 Rules by country | Sourced table; only the US proposal, Germany and New Zealand test the boom at the ground. |
| #31 Method document | Draft 0.2 with V&V evidence and traceability. |
| CI | Site smoke test before every code deploy (errors, route with psf, accessibility). |

**Sprint 3:** GFS 0.25° over the US (#6), ensemble margin per leg time (#36), computed buffer calibration (#35, needs #21), manual accessibility pass (#28), method doc review (#31); local: winter validation (#10); Fernando: XB-1 / FaINT data request (#21).

### Sprint 3 · 11 Oct 2026
| Item | Result |
|---|---|
| Map default | Opens on Auto (ensemble margin) |
| #36 Leg-time spread | Router uses the GEFS hour when the aircraft reaches each leg; falls back to the static map, never another hour |
| #10, #6, #11 Balloon validation | 4,004 launches, full year: day-ahead σ 0.0131; winter no worse; 0.25° no better; monthly run scheduled in CI |
| Method red team | 3 blockers, 7 majors filed (#37–#44); fixed: no interpolation across no-corridor columns, wrong-hour fallback, rays to 60°, time hold-out calibration with shared error fields and bootstrap CIs |
| Honest calibration | Held out: 0.39–0.48% of flights with any boom at FL550 (95% upper 0.9%); FL350/450 margins fitted on winter fail in summer → ensemble k raised to 4.0/4.25 |
| Correction | Airliner boom signal ~150 m → safe cushion ~1.25 km; router subtracts the per-aircraft penalty; earlier '+1 min' buffer claim withdrawn |
| Factor trade study | Wind difference low vs cruise and climb angle dominate; uniform wind does nothing; five drivers explain 92–96% of day-to-day variation |
| Aircraft study + builder | Cutoff speed is set by the air (aircraft enters via altitude, climb angle, signal length); loudness 8–19× the limit for every conventional design; custom aircraft fly in the planner |
| UI | Physics tab, keyboard map control, 'When to leave' table |
| #21 | Data requests sent to Boom and NASA (11 Oct) |

### Sprint 4 · 12 Oct 2026
| Item | Result |
|---|---|
| Error by forecast age | 0 / 6 / 12 / 24 h: RMS 0.0104 / 0.0113 / 0.0119 / 0.0132 (2,006 launches). Re-planning 6 h out cuts it 14%. RMS gate 0.010 not met even by the analysis (1° column vs one balloon). Unsafe-side error 0.0088 at 6 h, 0.0108 at 24 h: **metric change proposed, owner's decision** |
| #43 Fail-closed + evidence | Old forecast (> 18 h), past forecast end or no margin → subsonic over land, reason recorded; study switch; per-flight evidence file (JSON + CSV, build commit, six checks) |
| #39 Loudness below the turning point | Linear Airy caustic model, checked against FaINT (1–2 ΔZ_S: model 0.01–0.12 vs measured 0.03–0.09 psf). Quiet height for 0.11 psf ≈ 1.05–1.16 ΔZ_S (≈ 1.3 km for a 61 m airliner); router cushion and per-leg psf use it |
| #38/#16 Secondary booms | Year study: on regulated land for 12% of headings flown 70–150 km offshore, 2.5% at 250–400 km. Live stratosphere tables every 12 h; router slows any over-water leg whose secondaries would land on land; map dots; fallback 125–420 km |
| Fix | 3D playback NaN (first frame stepped backwards); CI smoke test failing after #39 (quiet height recomputed on every leg) → memoised |

## Outside dates

- SAM Act (House): noise standard by 1 April 2027.
- Executive order: final noise certification standards by June 2027.
- FAA NPRM (2 July 2026): ≤ 0.11 psf at the surface, primary and secondary booms; advisory circular to follow.
