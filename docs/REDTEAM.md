# Red Team Review — Mach Corridor v1 (2026-10-09)

Panel: A boom-propagation physicist · N NWP meteorologist · O supersonic dispatcher · Q scientific-software QA · R FAA noise-certification specialist. Each reviewed independently.

**Verdict:** the idea survives; v1's headline number does not. v1 published the Mach at which the boom ray *grazes* the ground (a caustic / focused-boom boundary), not a boomless speed. Found independently by A, N and R.

| ID | Sev | Summary | Fix | Status |
|---|---|---|---|---|
| K1 | KILL | Map value = grazing/caustic Mach, zero margin; daytime max of c+w at the 2 m point | Turning ≥ 1 km above max terrain; drop surface point | v2 |
| F1 | MAJOR | 1° smoothed terrain 1–2 km below peaks (+0.015–0.03 unsafe) | GFS 0.25° orography, max over ±0.5° | v2 |
| F2 | MAJOR | Only on-track ray; crosswind shear → lateral ray critical (up to −0.025) | Min over ray azimuth (Snell invariant) | v2 |
| F3 | MAJOR | 12 headings miss V-shaped minima (up to −0.03) | 36 headings | v2 |
| F4 | MAJOR | No forecast-error budget (σ_M ≈ 0.012–0.019, from memory) | Default margin 0.03; GEFS spread later; validation step 2 | partial |
| F5 | MAJOR | Route: no climb/descent/accel; Mach changes every 15 nm | Profile + ≥300 nm constant-Mach blocks | v2 |
| F6 | MAJOR | Route ignores wind on ground speed | Cruise u,v tiles | v2 |
| F7 | MAJOR | No coastal buffer for M1.7; 1° land mask | Natural Earth land + 30 nm offshore buffer | v2 |
| F8 | MAJOR | Land stats unweighted by area (median low by up to 0.046) | cos(lat) weights, exclude < 60°S | v2 |
| F9 | MAJOR | Descent −3° costs −0.032 | Documented; level cruise assumed | v2 doc |
| F10 | MAJOR | Jet core between 250/200 hPa; 1° smoothing weakens tailwinds | pgrb2b levels, GFS 0.25° | v3 |
| F11 | MAJOR | Labels imply regulatory compliance; NPRM is US-only, psf-based | Relabel + limitations | v2 |
| F12 | MAJOR | Exact-looking numbers without uncertainty | Margins/ranges | v2 |
| F13 | MINOR | Dry T (conservative 0.005–0.007) | Virtual temperature | v2 |
| F14 | MINOR | Map not wrapped at antimeridian | Extra copies | v2 |
| F15 | MINOR | Outlier KPI; inconsistent floors | Replace KPI; single floor 1.05 | v2 |
| F16 | MINOR | Horizontal gradients; heading vs track crab | Neighbour min; crab | v3 |
| F17 | OPEN | Required turning-height buffer vs 0.11 psf | NASA FaINT, XB-1 flight-day soundings | validation |
| F18 | OPEN | ISA match is a sanity check, not validation | XB-1 flight-day reproduction | validation |

Own errors (cloud session): mislabeled grazing Mach as "no boom"; used the 2 m point as a refracting layer; called the ISA match "validation"; unweighted land median.
