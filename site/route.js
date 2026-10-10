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
    let M, type, mcut = null, skipped = false;
    if (!ac.supersonic) { M = ac.design; type = "sub"; }
    else if (landish) {
      mcut = L(a => m.mHeading(a, brg, lon, lat)) - margin;
      let use = mode === "corr" && mcut >= m.FLOOR;
      if (use && E && E.obj && E.obj !== "time") {
        const st0 = { c, along, cross }, per = Mx => {
          const { tas, gs } = groundSpeed(Mx, st0), op = ac.fuelPerNm(Mx) * tas / gs * E.fuel + ac.nonFuelPerBH / gs;
          return E.obj === "cost" ? op : op + E.vot * ac.seats * E.lf / gs;
        };
        if (per(Math.min(mcut, ac.design)) >= per(ac.sub)) { use = false; skipped = true; }
      }
      if (use) { M = Math.min(mcut, ac.design); type = "boomless"; }
      else { M = ac.sub; type = "sub"; }
    } else { M = ac.design; type = "super"; }
    return { M, type, c, along, cross, landish, mcut, brg, skipped };
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
    let t = 0, fuel = 0, dLand = 0, dBoomless = 0, dSuper = 0, dSkip = 0, tAcc = 0, windSum = 0, worstHead = 0;
    for (const s of segs) {
      const { tas, gs } = groundSpeed(s.M, s);
      s.gs = gs; s.t = s.d / gs; s.fuel = ac.fuelPerNm(s.M) * s.d * tas / gs * (s.accel ? ACC_FUEL : 1);
      t += s.t; fuel += s.fuel; windSum += s.along * KT * s.d; worstHead = Math.min(worstHead, s.along * KT);
      if (s.landish) dLand += s.d;
      if (s.type === "boomless") dBoomless += s.d;
      if (s.skipped && s.type !== "climb") dSkip += s.d;
      if (s.M > 1) dSuper += s.d;
      if (s.accel || s.decel) tAcc += s.t;
    }
    // take-off and climb (and the transonic push) burn more than the cruise-rate segments above account for:
    // a fixed allowance per flight (aircraft.js climbFuel; calibrated to Concorde, energy estimate for the others)
    if (ac.supersonic) fuel += ac.climbFuel || 0;   // every flight of a supersonic type takes off and climbs
    const block = t + BLOCK_EXTRA_H, nonFuel = ac.nonFuelPerBH * block, op = fuel * E.fuel + nonFuel;
    const pax = ac.seats * E.lf;
    return { path, segs, dist: total, air: t, block, fuel, fuelCost: fuel * E.fuel, nonFuel, op, perSeat: op / pax,
             fuelPerSeat: fuel / pax, co2PerSeat: fuel * CO2_PER_KG / pax, gen: op + E.vot * pax * block,
             dLand, dBoomless, dSuper, dSkip, tAcc, windAvg: windSum / total, worstHead,
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
    const objOf = p => { const e = evalPath(field, ac, p, "corr", E); return obj === "time" ? e.block : obj === "cost" ? e.op : e.gen; };
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
  window.ROUTE = { makeField, evalPath, optimise, bestRoute, hav, bearing, nearestFL, KT, CO2_PER_KG };
})();
