# Mach Corridor — shared handoff (both Claude sessions read this)

Source of truth for code: this repo. Plan and status: `docs/ROADMAP.md` + GitHub issues/milestones (Phase 1–4); KPIs in `site/kpis.json`.
This file keeps the physics contract and the split of work between sessions. Issues labelled `owner:local` belong to the local session.

## Roles
| Session | Owns |
|---|---|
| Cloud (GitHub) | `engine/` (physics + GFS pipeline), `site/` (app), automation |
| Local (Fernando's computer) | `validation/`: sounding climatology, GFS forecast error, XB-1 / FaINT reproduction |

Rule: validation code imports `engine/physics.py` (`mmax_grid`); never re-implements the equation.

## Physics v2 (branch `v2`, after red team 2026-10-09)
- Turning point must be >= `h_buf` (default 1000 m) above the **max terrain** over the boom footprint (GFS 0.25 deg orography, max over +/-0.5 deg).
- 2 m / 10 m surface point no longer used; no M >= 1 floor (no corridor -> M < 1).
- Lateral rays: min over ray azimuth alpha in +/-45 deg (Snell invariant), crosswind-aware.
- Virtual temperature from RH. 36 directions (10 deg).
- Call: `mmax_grid(plev, T, U, V, Z, Zground, fl_ft, headings, RH=None, h_buf=1000)` -> dict with `M` (H,ny,nx).
  Works on single columns: pass arrays shaped (L,1,1) and Zground (1,1).

## Red-team register
See `docs/REDTEAM.md`. Kill shot K1 (v1 value = grazing/caustic Mach) is fixed in v2.

## v2 live results (GFS 2026-10-09 12Z, f000; land excl. Antarctica, area-weighted, worst direction, 1 km buffer, BEFORE margin)
| FL | Median | 10th pct | % land >= 1.05 | % land >= 1.08 (=1.05 after 0.03 margin) |
|---|---|---|---|---|
| 350 | 1.072 | 1.018 | 70% | 42% |
| 400 | 1.085 | 1.030 | 78% | 54% |
| 450 | 1.100 | 1.042 | 85% | 63% |
| 500 | 1.125 | 1.052 | 91% | 75% |
| 550 | 1.145 | 1.056 | 92% | 79% |
| 600 | 1.148 | 1.059 | 93% | 82% |
Reading: FL350–400 fails the kill line once a 0.03 margin is applied (median ~1.04–1.055); **FL500+ passes** (median ~1.10–1.12 after margin). Altitude is the lever. Validation must test this per FL.

## Open validation work (Local)
1. Climatology: 1 yr of 00Z/12Z soundings, ~6 stations, with physics v2 -> % of days above M 1.05 (+ margin) by season and heading. Kill criterion.
2. Forecast error: GFS f24/f48 vs observed soundings -> sigma_M. Replaces the provisional 0.03 margin.
3. Calibrate h_buf: NASA FaINT shadow-zone data; XB-1 flight days (Mojave, 28 Jan & 10 Feb 2025).

Local result already reported (7 Oct GFS, 2 deg, simple buffer, worst of 16 headings, area-weighted):
median 1.073 / 1.065 / 1.059 at FL350 for buffer 0 / 1 / 2 km; FL500 1.101 / 1.097 / 1.091.
With an extra 0.03 margin, FL350–400 median falls to ~1.04 (< 1.05 kill line) -> forecast error (item 2) decides.
