// Value of Mach: how much block time, fuel and money each +0.1 Mach buys, using the site's own router
// (forecast winds, regulated land, corridors, climb/descent, accel/decel, secondary-boom and approach rules).
//
// Experiments, on a seeded random sample of city pairs (both directions) and several departure times:
//   E1 cruise Mach sweep: each supersonic design flown with design Mach 1.0, 1.1, ... up to its own design Mach
//      (over open water it flies the design Mach; over land min(corridor Mach, design)); corridors on.
//   E2 corridor Mach shift: the boomless Mach over land raised or lowered by delta (the margin moved by -delta),
//      design Mach fixed; this is the value of a faster/more precise corridor.
//   E3 references per flight: today's rules (subsonic over land) and the 787-9.
// Usage: node study/mach_value.mjs <base url> <out.json> [n_pairs] [chromium path]
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import fs from 'fs';
const [, , base = 'http://localhost:8766/', out = 'study/results/mach_value_raw.json', nPairs = '90', exe] = process.argv;
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'log' && /^\[mv\]/.test(m.text())) console.log(m.text()); });
await p.goto(base + '#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.ROUTE && window.AIRCRAFT && MC.S.man && MC.sigmaReady && MC.gefsMeta, null, { timeout: 180000 });
const res = await p.evaluate(async (nPairs) => {
  const RT = window.ROUTE, MC = window.MC; MC.S.allowStale = true;           // study on a saved run: switch off the age rule
  const E0 = { fuel: 1.47, vot: 85, lf: 0.8, obj: "time" };
  // same as route.js (sigma inflation per level, nearest of 350/450/550; A&S 7.1.26 normal CDF)
  const P_INFL = { 350: 1.20, 450: 1.30, 550: 1.17 };
  const pInfl = fl => { const ks = Object.keys(P_INFL).map(Number); return P_INFL[ks.reduce((b, x) => Math.abs(x - fl) < Math.abs(b - fl) ? x : b)]; };
  const normCdf = z => { const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf); };
  // seeded RNG (mulberry32)
  let s = 20261016; const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const A = MC.AIRPORTS, pairs = [];
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
    const d = RT.hav([A[i][3], A[i][2]], [A[j][3], A[j][2]]);
    if (d >= 800 && d <= 4100) pairs.push([A[i][0], A[j][0], d]);
  }
  // stratified by distance: equal numbers from four distance bands
  const bands = [[800, 1600], [1600, 2400], [2400, 3200], [3200, 4100]], pick = [];
  for (const [lo, hi] of bands) {
    const pool = pairs.filter(x => x[2] >= lo && x[2] < hi);
    for (let k = 0; k < Math.round(nPairs / 4) && pool.length; k++) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  const ACS = window.AIRCRAFT.filter(a => a.supersonic), b789 = window.AIRCRAFT.find(a => a.id === "b789");
  const variant = (ac, Md) => Object.assign(Object.create(Object.getPrototypeOf(ac)), ac, { design: Md });
  const pt = c => [MC.APT[c][3], MC.APT[c][2]];
  const DEPS = [0, 2, 4];                                                    // forecast index: +0, +12, +24 h
  const DELTAS = [-0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08, 0.10];
  const keep = r => ({ block: r.block, air: r.air, fuel: r.fuel, op: r.op, perSeat: r.perSeat, dist: r.dist, dLand: r.dLand, dBoomless: r.dBoomless, dSuper: r.dSuper, inRange: r.inRange, pFlight: r.pFlight });
  const rows = [];
  const fields = new Map(); const field = async (fl, fi) => { const k = fl + ":" + fi; if (!fields.has(k)) fields.set(k, await RT.makeField(fl, fi)); return fields.get(k); };
  let n = 0;
  for (const fi of DEPS) {
    MC.S.fi = fi;
    for (const [a0, b0] of pick) for (const [a, bb] of [[a0, b0], [b0, a0]]) {
      const P = [pt(a), pt(bb)], e = { ...E0, margin: MC.marginAt };
      const f400 = await field(RT.nearestFL(b789.fl), fi);
      const row = { from: a, to: bb, fi, gc: RT.hav(P[0], P[1]), b789: keep(RT.evalPath(f400, b789, P, "ban", e)), ac: {} };
      for (const ac of ACS) {
        const f = await field(RT.nearestFL(ac.fl), fi), o = { sweep: [], shift: [] };
        o.ban = keep(RT.evalPath(f, ac, P, "ban", e));
        for (let Md = 1.0; Md <= ac.design + 1e-9; Md = Math.round((Md + 0.1) * 10) / 10)
          o.sweep.push({ M: Md, ...keep(RT.evalPath(f, variant(ac, Md), P, "corr", e)) });
        for (const dl of DELTAS) {
          const mg = (...args) => MC.marginAt(...args) - dl;
          const r = RT.evalPath(f, ac, P, "corr", { ...e, margin: mg });
          // the router's chance uses sigma = margin/k, which assumes the margin it is given is the calibrated one; with
          // the margin moved by delta and the forecast unchanged, the error sigma stays that of the original margin
          const kk = MC.kEffective(f.fl), infl = pInfl(f.fl), chunks = new Map();
          for (const sg of r.segs) {
            if (sg.type !== "boomless" || sg.mcut == null || !Number.isFinite(sg.margin)) continue;
            const m0 = sg.margin + dl; if (!(m0 > 0)) continue;
            const z = (sg.M - sg.mcut - sg.margin) / (infl * m0 / kk), pe = normCdf(z), c = Math.floor(sg.x0 / 300);
            chunks.set(c, Math.max(chunks.get(c) || 0, pe));
          }
          const pTrue = 1 - [...chunks.values()].reduce((a, q) => a * (1 - q), 1);
          o.shift.push({ delta: dl, pTrue, ...keep(r) });
        }
        row.ac[ac.id] = o;
      }
      rows.push(row); n++;
      if (n % 20 === 0) { console.log(`[mv] ${n} flights`); await new Promise(r => setTimeout(r, 0)); }
    }
  }
  return { run: MC.S.man.run, model: MC.S.man.model_version, E0, deps: DEPS.map(i => MC.S.man.forecast_hours[i]), deltas: DELTAS,
           aircraft: ACS.map(a => ({ id: a.id, name: a.name, design: a.design, sub: a.sub, seats: a.seats, fl: a.fl, nonFuelPerBH: a.nonFuelPerBH, rangeNm: a.rangeNm,
             fuelPerNm: [0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0].map(M => [M, a.fuelPerNm(M)]) })),
           b789: { seats: b789.seats, nonFuelPerBH: b789.nonFuelPerBH }, rows };
}, +nPairs);
await b.close();
fs.writeFileSync(out, JSON.stringify(res));
console.log('flights', res.rows.length, 'errors', errs.length, errs.slice(0, 3).join(' | '));
