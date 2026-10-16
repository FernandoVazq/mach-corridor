/* Route physics + optimiser shared by the map and the economics page.

   Realism (all per 15 nm segment):
   - weather is time-dependent: the aircraft meets the forecast valid when it gets there
     (linear in time between the 6-hourly GFS frames);
   - wind enters twice: in the boomless Mach (physics atlas) and in the wind triangle
     (ground speed = sqrt(TAS² − crosswind²) + tailwind component);
   - land/coast legs fly the boomless Mach minus margin, or subsonic if below the M1.05 floor;
     open water flies design Mach;
   - 150 nm subsonic climb and descent, +0.06 M/min acceleration (35% extra fuel) and
     −0.10 M/min deceleration (so the aircraft slows before a coast), ≥300 nm constant-Mach blocks. */
(() => {
  "use strict";
  const NM = 3440.065, RAD = Math.PI / 180, KT = 1.943844;
  const CLIMB_NM = 150, DESC_NM = 150, BLOCK_EXTRA_H = 0.5, BLOCK_NM = 300;
  const ACC_MPM = 0.06, DEC_MPM = 0.10, ACC_FUEL = 1.35;
  const COAST = 0.12, CO2_PER_KG = 3.16;
  const MC = () => window.MC;

  const hav = (a, b) => d3.geoDistance(a, b) * NM;
  function bearing(a, b) {
    const [l1, p1] = a.map(d => d * RAD), [l2, p2] = b.map(d => d * RAD);
    const y = Math.sin(l2 - l1) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const nearestFL = fl => MC().S.man.flight_levels.reduce((b, f) => Math.abs(f - fl) < Math.abs(b - fl) ? f : b);

  // ---- time-dependent weather field at one flight level, departing at forecast index fi ----
  async function makeField(fl, fi, spanH = 14) {
    const man = MC().S.man, H = man.forecast_hours, t0 = H[fi];
    const ks = H.map((h, k) => k).filter(k => H[k] >= t0 - 6 && H[k] <= t0 + spanH + 6);
    const frames = await Promise.all(ks.map(async k => ({ h: H[k], a: await MC().loadAtlas(H[k], fl) })));
    if (MC().S.auto && MC().prepareGefs) await Promise.all(ks.map(k => MC().prepareGefs(fl, k)));   // ensemble spread at each leg's time
    if (MC().prepareSsb) await MC().prepareSsb();                                                    // secondary-boom tables
    return {
      fl, t0, frames,
      at(tHr) {
        const T = t0 + tHr, f = frames;
        if (T <= f[0].h) return [f[0].a, f[0].a, 0];
        for (let i = 1; i < f.length; i++) if (T <= f[i].h) return [f[i - 1].a, f[i].a, (T - f[i - 1].h) / (f[i].h - f[i - 1].h)];
        const l = f[f.length - 1].a; return [l, l, 0];
      },
    };
  }

  // E (optional) carries the objective: over land a corridor is flown only where it beats subsonic on that
  // objective ("time" always takes the corridor; "cost" and "gen" compare cost per nm both ways)
  function legState(field, tHr, ac, p, q, mode, margin, E) {
    const m = MC(), mid = d3.geoInterpolate(p, q)(0.5), lon = m.normLon(mid[0]), lat = mid[1];
    const brg = bearing(p, q), [a0, a1, w] = field.at(tHr), L = f => f(a0) * (1 - w) + f(a1) * w;
    const c = L(a => m.cAt(a, lon, lat));
    const u = L(a => m.windAt(a, lon, lat)[0]), v = L(a => m.windAt(a, lon, lat)[1]);
    // inside national territory + 12 nm territorial sea + boom-carpet buffer: boomless or subsonic only
    const rz = m.restrictedAt ? m.restrictedAt(lon, lat) : null;
    const landish = rz == null ? m.landAt(a0, lon, lat) > COAST : rz;
    const s = Math.sin(brg * RAD), co = Math.cos(brg * RAD), along = u * s + v * co, cross = u * co - v * s;
    let M, type, mcut = null, skipped = false, mg = null, hold = null, sb = null, ah = false;
    const leadH = field.t0 + tHr;                       // hours after the forecast run when the aircraft is here
    // E.sea === "boomless": no full-Mach cruise over the ocean either; open water is flown like land (boomless or subsonic)
    const asLand = landish || !!(E && E.sea === "boomless" && mode === "corr");
    if (!ac.supersonic) { M = ac.design; type = "sub"; }
    else if (asLand) {
      mg = typeof margin === "function" ? margin(lon, lat, field.fl, brg, Date.parse(m.S.man.run_time) + leadH * 3.6e6) : margin;
      mcut = (window.BOOM ? BOOM.bufferPenalty(ac, field.fl) : 0) + L(a => m.mHeadingSafe(a, brg, lon, lat)) - mg;
      // fail closed: no corridor on old data, past the end of the forecast, or without a margin
      hold = failClosed(field, tHr, mg);
      let use = mode === "corr" && !hold && mcut >= m.FLOOR;
      if (use && E && E.obj && E.obj !== "time") {
        const st0 = { c, along, cross }, per = Mx => {
          const { tas, gs } = groundSpeed(Mx, st0), op = ac.fuelPerNm(Mx) * tas / gs * E.fuel + ac.nonFuelPerBH / gs;
          return E.obj === "cost" ? op : op + E.vot * ac.seats * E.lf / gs;
        };
        if (per(Math.min(mcut, ac.design)) >= per(ac.sub)) { use = false; skipped = true; }
      }
      if (use) { M = Math.min(mcut, ac.design); type = "boomless"; }
      else { M = ac.sub; type = "sub"; }
    } else if (mode === "corr" && !window.__noSsb) {          // __noSsb: benchmark switch (tests/bench.mjs)
      // over open water: design Mach, unless its secondary booms (bent back by the stratosphere) would land on
      // regulated land; then fly that leg at the cutoff Mach, which also traps the secondaries (engine/secondary.py)
      sb = secondaries(field, tHr, ac.design, c, u, v, lon, lat, brg);
      ah = approachHit(field, lon, lat, brg);
      if (sb.hit || ah) {
        mg = typeof margin === "function" ? margin(lon, lat, field.fl, brg, Date.parse(m.S.man.run_time) + leadH * 3.6e6) : margin;
        mcut = (window.BOOM ? BOOM.bufferPenalty(ac, field.fl) : 0) + L(a => m.mHeadingSafe(a, brg, lon, lat)) - mg;
        hold = failClosed(field, tHr, mg);
        if (!hold && mcut >= m.FLOOR) { M = Math.min(mcut, ac.design); type = "boomless"; } else { M = ac.sub; type = "sub"; }
      } else { M = ac.design; type = "super"; }
    } else { M = ac.design; type = "super"; }
    return { M, type, c, along, cross, landish, mcut, brg, skipped, margin: mg, hold, leadH, lon, lat, ssb: sb, approach: ah };
  }

  // Forward reach (issue #44): just above its cutoff Mach a boom ray grazes down and lands far ahead of the
  // aircraft. A leg flown faster than the cutoff must have no regulated ground (territory + 12 nm) within
  // REACH_KM ahead along its track (±10°), so the slow-down to the cutoff Mach ends before that point.
  // REACH_KM = largest along-track landing distance of near-cutoff rays (+0.002 Mach: median 48, p99 86, max 90 km; study/results/forward_reach.json)
  const REACH_KM = 90;
  const TURN_DEG = 2, TURN_PEN = 0.004;
  // sigma inflation per level = mean of the two held-out fits (study/results/psf_eval.json, flight_probability)
  const P_INFL = { 350: 1.20, 450: 1.30, 550: 1.17 }, CHUNK_NM = 300;
  const pInfl = fl => { const ks = Object.keys(P_INFL).map(Number); const k = ks.reduce((b, x) => Math.abs(x - fl) < Math.abs(b - fl) ? x : b); return P_INFL[k]; };
  // standard normal CDF (Abramowitz & Stegun 7.1.26 erf, |error| < 1.5e-7)
  function normCdf(z) {
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }
  function approachHit(field, lon, lat, brg) {
    const m = MC();
    if (window.__noReach || !m.regulatedLand || (m.landDistKm && m.landDistKm(lon, lat) > REACH_KM + 111)) return false;
    const key = ((Math.round(lon * 4) + 1440) * 800 + Math.round(lat * 4) + 400) * 73 + Math.round((((brg % 360) + 360) % 360) / 5);
    field.reachCache = field.reachCache || new Map();
    if (field.reachCache.has(key)) return field.reachCache.get(key);
    let hit = false;
    for (const d of [-10, 0, 10]) for (let r = 10; r <= REACH_KM && !hit; r += 10) { const p = dest(lon, lat, brg + d, r); hit = !!m.regulatedLand(p[0], p[1]); }
    field.reachCache.set(key, hit); return hit;
  }

  // Secondary-boom landing check for a supersonic leg over water. Rays of the Mach cone at azimuth a travel along
  // e = brg + a with trace velocity Vt = M c cos(a) + w.e; the stratosphere returns them when V_lo < Vt < V_hi and
  // they land R1 (direct) or R2 (after a sea bounce) km away, +/- 25 km. Without tables: every direction, 125-420 km.
  function dest(lon, lat, brgDeg, km) {
    const d = km / 6371, b = brgDeg * RAD, p1 = lat * RAD, l1 = lon * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [((l2 / RAD + 540) % 360) - 180, p2 / RAD];
  }
  function secondaries(field, tHr, M, c, u, v, lon, lat, brg) {
    const m = MC(), validMs = Date.parse(m.S.man.run_time) + (field.t0 + tHr) * 3.6e6;
    // numeric key: 0.5° cell, 5° heading, 12 h bucket (M is fixed per aircraft)
    const key = ((((Math.round(lon * 2) + 720) * 400 + Math.round(lat * 2) + 200) * 73 + Math.round((((brg % 360) + 360) % 360) / 5)) * 64 + (Math.round(validMs / 4.32e7) & 63)) * 8 + Math.round(M * 4);
    field.ssbCache = field.ssbCache || new Map();
    if (field.ssbCache.has(key)) return field.ssbCache.get(key);
    if (m.landDistKm && m.landDistKm(lon, lat) > 450 + 111) { const o = { hit: false, nodata: !m.ssbReady, pts: [] }; field.ssbCache.set(key, o); return o; }
    const nodata = !m.ssbReady, amax = Math.acos(1 / M) / RAD, pts = [];
    let hit = false;
    for (let a = -amax + 1; a < amax && !hit; a += 8) {
      const e = brg + a, er = e * RAD, Vt = M * c * Math.cos(a * RAD) + u * Math.sin(er) + v * Math.cos(er);
      let bands = [];
      if (nodata) bands = [[125, 420]];
      else {
        const t = m.ssbAt(validMs, lon, lat, e);
        if (!t || !(Vt > t.vlo && Vt < t.vhi)) continue;
        const f = (Vt - t.vlo) / (t.vhi - t.vlo), at = r => r[0] && r[1] ? r[0] + (r[1] - r[0]) * f : (r[0] || r[1]);
        for (const R of [at(t.r1), at(t.r2)]) if (R) bands.push([Math.max(0, R - 25), R + 25]);
        if (!bands.length) bands = [[125, 420]];
      }
      for (const [r0, r1] of bands) for (let r = r0; r <= r1 + 1 && !hit; r += Math.max(25, (r1 - r0) / 6)) {
        const p = dest(lon, lat, e, r), on = !!m.regulatedLand(p[0], p[1]);
        hit = hit || on; pts.push([p[0], p[1], on]);
      }
    }
    const out = { hit, nodata, pts };
    field.ssbCache.set(key, out); return out;
  }
  // Fail-closed rules (docs/METHOD.md §6): a corridor is flown only when the weather behind it is current and
  // covers the time the aircraft is there. Anything else falls back to subsonic over land.
  const STALE_H = 18;                                   // GFS runs every 6 h and is built hourly: 18 h = two missed runs
  const dataAgeH = () => (Date.now() - Date.parse(MC().S.man.run_time)) / 3.6e6;
  function failClosed(field, tHr, mg) {
    const S = MC().S, H = S.man.forecast_hours;
    if (dataAgeH() > STALE_H && !S.allowStale) return "stale";
    if (field.t0 + tHr > H[H.length - 1]) return "beyond";
    if (!Number.isFinite(mg)) return "nomargin";
    return null;
  }
  function groundSpeed(M, st) {
    const tas = M * st.c * KT, xw = st.cross * KT;
    return { tas, gs: Math.max(150, Math.sqrt(Math.max(tas * tas - xw * xw, 0.04 * tas * tas)) + st.along * KT) };
  }
  function legCost(st, ac, d, E, obj) {
    const { tas, gs } = groundSpeed(st.M, st);
    const t = d / gs, fuel = ac.fuelPerNm(st.M) * d * tas / gs;
    const op = fuel * E.fuel + ac.nonFuelPerBH * t;
    return { t, c: obj === "time" ? t : obj === "cost" ? op : op + E.vot * ac.seats * E.lf * t };
  }

  // ---- full evaluation of a path (array of [lon,lat]) ----
  function evalPath(field, ac, path, mode, E) {
    const samples = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], d = hav(a, b), n = Math.max(1, Math.ceil(d / 15)), f = d3.geoInterpolate(a, b);
      for (let k = 0; k < n; k++) samples.push([f(k / n), f((k + 1) / n), d / n]);
    }
    const total = samples.reduce((s, x) => s + x[2], 0);
    const guessKt = (ac.supersonic ? 1.2 : ac.design) * 580;
    let times = [], cum = 0;
    for (const [, , d] of samples) { times.push(cum / guessKt); cum += d; }
    let segs;
    for (let pass = 0; pass < 2; pass++) {
      cum = 0;
      segs = samples.map(([p, q, d], i) => {
        const st = legState(field, times[i], ac, p, q, mode, E.margin, E);
        const s = { p, q, d, x0: cum, x1: cum + d, ...st };
        if (ac.supersonic && (cum < CLIMB_NM || cum + d > total - DESC_NM)) { s.M = Math.min(s.M, ac.sub); s.type = "climb"; }
        cum += d; return s;
      });
      // turns (issue #44): a turning aircraft focuses its rays; a 2x focus needs ~0.3 km more cushion below the
      // turning point (engine/caustic.py: 1.62 vs 1.32 km for an airliner) = 0.004 Mach off boomless legs in a turn
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]; if (s.type !== "boomless") continue;
        const d = j => j >= 0 && j < segs.length ? Math.abs(((segs[j].brg - s.brg + 540) % 360) - 180) : 0;
        if (window.__noTurn || Math.max(d(i - 1), d(i + 1)) <= TURN_DEG) continue;
        s.turn = true;
        const Mt = Math.min(s.M, (s.mcut != null ? s.mcut : s.M) - TURN_PEN);
        if (Mt >= MC().FLOOR) s.M = Mt; else { s.M = ac.sub; s.type = "sub"; }
      }
      const base = segs.map(s => s.M);
      for (let i = 0; i < segs.length; i++) if (segs[i].type === "boomless") {
        let m = base[i];
        for (let j = i - 1; j >= 0 && segs[i].x0 - segs[j].x1 < BLOCK_NM / 2 && segs[j].type === "boomless"; j--) m = Math.min(m, base[j]);
        for (let j = i + 1; j < segs.length && segs[j].x0 - segs[i].x1 < BLOCK_NM / 2 && segs[j].type === "boomless"; j++) m = Math.min(m, base[j]);
        segs[i].M = m;
      }
      if (ac.supersonic) {
        const dtMin = s => 60 * s.d / groundSpeed(s.M, s).gs;
        for (let i = 1; i < segs.length; i++) segs[i].M = Math.min(segs[i].M, segs[i - 1].M + ACC_MPM * dtMin(segs[i]));
        for (let i = segs.length - 2; i >= 0; i--) segs[i].M = Math.min(segs[i].M, segs[i + 1].M + DEC_MPM * dtMin(segs[i]));
        for (let i = 1; i < segs.length; i++) { segs[i].accel = segs[i].M > segs[i - 1].M + 1e-3; segs[i].decel = segs[i].M < segs[i - 1].M - 1e-3; }
      }
      let t = 0;
      times = segs.map(s => { const t0 = t; s.t = s.d / groundSpeed(s.M, s).gs; t += s.t; return t0; });
    }
    const dHold = {}; let dSsb = 0, dReach = 0, ssbNoData = false;
    let t = 0, fuel = 0, dLand = 0, dBoomless = 0, dSuper = 0, dSkip = 0, tAcc = 0, windSum = 0, worstHead = 0;
    for (const s of segs) {
      const { tas, gs } = groundSpeed(s.M, s);
      s.gs = gs; s.t = s.d / gs; s.fuel = ac.fuelPerNm(s.M) * s.d * tas / gs * (s.accel ? ACC_FUEL : 1);
      t += s.t; fuel += s.fuel; windSum += s.along * KT * s.d; worstHead = Math.min(worstHead, s.along * KT);
      if (s.landish) dLand += s.d;
      if (s.type === "boomless") dBoomless += s.d;
      if (s.skipped && s.type !== "climb") dSkip += s.d;
      if (s.hold && s.type !== "climb") dHold[s.hold] = (dHold[s.hold] || 0) + s.d;
      if (s.ssb && s.ssb.hit && s.type !== "climb") dSsb += s.d;
      if (s.approach && !(s.ssb && s.ssb.hit) && s.type !== "climb") dReach += s.d;
      if (s.ssb && s.ssb.nodata) ssbNoData = true;
      if (s.M > 1) dSuper += s.d;
      if (s.accel || s.decel) tAcc += s.t;
    }
    // take-off and climb (and the transonic push) burn more than the cruise-rate segments above account for:
    // a fixed allowance per flight (aircraft.js climbFuel; calibrated to Concorde, energy estimate for the others)
    if (ac.supersonic) fuel += ac.climbFuel || 0;   // every flight of a supersonic type takes off and climbs
    // chance of more than 0.11 psf on the ground (issue #20): per leg, the true limit falls below the flown Mach plus
    // the cushion; sigma = margin / k, inflated 1.17-1.30 by level (held-out calibration); legs within 300 nm share
    // one error draw (the real-world error field's correlation length), so the flight takes the worst leg per 300 nm
    let pFlight = 0;
    if (ac.supersonic && mode === "corr") {
      const kk = MC().kEffective ? MC().kEffective(field.fl) : 3.75, chunks = new Map();
      for (const s of segs) {
        if (s.type !== "boomless" || s.mcut == null || !(s.margin > 0)) { s.pExceed = 0; continue; }
        const sig = pInfl(field.fl) * s.margin / kk, z = (s.M + (s.turn ? TURN_PEN : 0) - s.mcut - s.margin) / sig;
        s.pExceed = normCdf(z);
        const c = Math.floor(s.x0 / CHUNK_NM); chunks.set(c, Math.max(chunks.get(c) || 0, s.pExceed));
      }
      pFlight = 1 - [...chunks.values()].reduce((a, p) => a * (1 - p), 1);
    }
    const block = t + BLOCK_EXTRA_H, nonFuel = ac.nonFuelPerBH * block, op = fuel * E.fuel + nonFuel;
    const pax = ac.seats * E.lf;
    return { path, segs, dist: total, air: t, block, fuel, fuelCost: fuel * E.fuel, nonFuel, op, perSeat: op / pax,
             fuelPerSeat: fuel / pax, co2PerSeat: fuel * CO2_PER_KG / pax, gen: op + E.vot * pax * block,
             dLand, dBoomless, dSuper, dSkip, dHold, dSsb, dReach, ssbNoData, pFlight, tAcc, windAvg: windSum / total, worstHead,
             inRange: total <= ac.rangeNm, mode, ac };
  }

  // ---- optimiser: time-dependent Dijkstra on a 1° grid (16 directions), then continuous refinement ----
  const MOVES = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
                 [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
  function optimise(field, ac, A, B, obj, E0, maxEvals = 1500) {
    const E = { ...E0, obj };
    const bLon = A[0] + (((B[0] - A[0]) % 360) + 540) % 360 - 180;
    const span = Math.max(Math.abs(bLon - A[0]), Math.abs(B[1] - A[1])), R = Math.max(8, 0.3 * span);
    const lat0 = Math.max(-80, Math.floor(Math.min(A[1], B[1]) - R)), lat1 = Math.min(80, Math.ceil(Math.max(A[1], B[1]) + R));
    const lon0 = Math.floor(Math.min(A[0], bLon) - R), lon1 = Math.ceil(Math.max(A[0], bLon) + R);
    const nx = lon1 - lon0 + 1, ny = lat1 - lat0 + 1, N = nx * ny;
    const id = (i, j) => j * nx + i, ll = n => [lon0 + (n % nx), lat0 + Math.floor(n / nx)];
    const s = id(Math.round(A[0]) - lon0, Math.round(A[1]) - lat0), g = id(Math.round(bLon) - lon0, Math.round(B[1]) - lat0);
    const dist = new Float64Array(N).fill(Infinity), tArr = new Float64Array(N), prev = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    dist[s] = 0; push(0, s);
    while (heap.length) {
      const [c, n] = pop();
      if (c > dist[n]) continue;
      if (n === g) break;
      const i = n % nx, j = Math.floor(n / nx), P = ll(n);
      for (const [dx, dy] of MOVES) {
        const ii = i + dx, jj = j + dy;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const m = id(ii, jj), Q = ll(m), lc = legCost(legState(field, tArr[n], ac, P, Q, "corr", E.margin, E), ac, hav(P, Q), E, obj);
        if (c + lc.c < dist[m]) { dist[m] = c + lc.c; tArr[m] = tArr[n] + lc.t; prev[m] = n; push(dist[m], m); }
      }
    }
    const nodes = [];
    for (let n = g; n >= 0; n = prev[n]) { nodes.push(ll(n)); if (n === s) break; }
    nodes.reverse();
    const grid = [A, ...nodes.slice(1, -1), [bLon, B[1]]];
    // E.maxDetour (fraction of the great circle): beyond it every extra nm costs ten times its own time or cost,
    // so the route does not run far out to sea just to fly full Mach over water
    const gcNm = hav(A, [bLon, B[1]]), cap = Number.isFinite(E.maxDetour) ? gcNm * (1 + E.maxDetour) : Infinity;
    const objOf = p => { const e = evalPath(field, ac, p, "corr", E), v = obj === "time" ? e.block : obj === "cost" ? e.op : e.gen;
      return e.dist > cap ? v * (1 + 10 * (e.dist - cap) / e.dist) : v; };
    const pulled = stringPull(grid, field, ac, obj, E);
    const densify = (p, k) => { const o = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const f = d3.geoInterpolate(p[i], p[i + 1]); for (let q = 1; q <= k; q++) o.push(q === k ? p[i + 1] : f(q / k)); } return o; };
    const r1 = refine(pulled.length <= 2 ? densify(pulled, 4) : pulled, objOf, maxEvals);
    const r2 = refine(densify([A, [bLon, B[1]]], 5), objOf, maxEvals / 2);
    const best = r1.v <= r2.v ? r1 : r2;
    best.p.info = { v: best.v, startsAgree: Math.abs(r1.v - r2.v) / best.v };
    return best.p;
  }
  function stringPull(path, field, ac, obj, E) {
    // local segment costs (time estimated from distance flown) — cheap; the refinement below uses the full model
    const guessKt = (ac.supersonic ? 1.2 : ac.design) * 580;
    const cumD = [0]; for (let i = 1; i < path.length; i++) cumD.push(cumD[i - 1] + hav(path[i - 1], path[i]));
    const seg = (p, q, d0) => { const d = hav(p, q), n = Math.max(1, Math.ceil(d / 30)), f = d3.geoInterpolate(p, q); let c = 0;
      for (let k = 0; k < n; k++) c += legCost(legState(field, (d0 + d * k / n) / guessKt, ac, f(k / n), f((k + 1) / n), "corr", E.margin, E), ac, d / n, E, obj).c; return c; };
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let best = i + 1;
      for (let j = Math.min(path.length - 1, i + 25); j > i + 1; j--) {
        let via = 0; for (let k = i; k < j; k++) via += seg(path[k], path[k + 1], cumD[k]);
        if (seg(path[i], path[j], cumD[i]) <= via * 1.0005) { best = j; break; }
      }
      out.push(path[best]); i = best;
    }
    return out;
  }
  function refine(path, f, maxEvals) {
    let p = path.map(q => q.slice()), v = f(p), step = 2.0, evals = 0;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (step >= 0.125 && evals < maxEvals) {
      let improved = false;
      for (let i = 1; i < p.length - 1 && evals < maxEvals; i++) {
        for (const [dx, dy] of D) {
          const c = p.map(q => q.slice());
          c[i] = [p[i][0] + dx * step / Math.max(0.3, Math.cos(p[i][1] * RAD)), Math.max(-85, Math.min(85, p[i][1] + dy * step))];
          const cv = f(c); evals++;
          if (cv < v - 1e-9) { p = c; v = cv; improved = true; }
        }
        if (p.length > 3) { const c = p.filter((_, k) => k !== i), cv = f(c); evals++; if (cv <= v) { p = c; v = cv; improved = true; i--; } }
      }
      if (!improved) step /= 2;
    }
    return { p, v };
  }

  // optimised corridor route, unless simply flying the great circle subsonic over land does better on the objective
  function bestRoute(field, ac, A, B, obj, E, maxEvals) {
    const Eo = { ...E, obj }, val = x => obj === "time" ? x.block : obj === "cost" ? x.op : x.gen;
    const o = evalPath(field, ac, optimise(field, ac, A, B, obj, E, maxEvals), "corr", Eo);
    const b = evalPath(field, ac, [A, B], "ban", Eo);
    if (val(b) < val(o)) { b.path.info = { ...(o.path.info || {}), subBetter: true }; return b; }
    return o;
  }
  window.ROUTE = { makeField, evalPath, optimise, bestRoute, hav, bearing, nearestFL, KT, CO2_PER_KG, STALE_H, dataAgeH, get REACH_KM() { return REACH_KM; } };
})();
