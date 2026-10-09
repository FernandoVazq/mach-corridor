/* Mach Corridor — route optimiser + economics (v2).
   Cost of a leg depends on: land/coast (needs a boomless corridor) vs open water (design Mach),
   boomless Mach for the local track (conservative between 10° tiles), cruise wind on ground speed,
   aircraft fuel-per-nm curve E(M), non-fuel cost per block hour and passenger value of time. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const NM = 3440.065, RAD = Math.PI / 180;
  const CLIMB_NM = 150, DESC_NM = 150, BLOCK_EXTRA_H = 0.5, BLOCK_NM = 300;
  // speed changes are not instant: Mach per minute while accelerating / decelerating (estimates;
  // Concorde took roughly 15–20 min from M0.95 to M2 while climbing), extra fuel while accelerating
  const ACC_MPM = 0.06, DEC_MPM = 0.10, ACC_FUEL = 1.35;
  const COAST = 0.12;   // land fraction above which a cell counts as land/coastal (approx. 30 nm buffer at 1°)
  let MC, ACS;

  const hav = (a, b) => d3.geoDistance(a, b) * NM;
  function bearing(a, b) {
    const [l1, p1] = a.map(d => d * RAD), [l2, p2] = b.map(d => d * RAD);
    const y = Math.sin(l2 - l1) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const econ = () => ({ fuel: +$("fuelPrice").value || 1.42, vot: +$("vot").value || 85, lf: +$("lf").value || 0.8 });
  const nearestFL = fl => MC.S.man.flight_levels.reduce((b, f) => Math.abs(f - fl) < Math.abs(b - fl) ? f : b);

  // ---- one leg at its midpoint ----
  function legState(atl, ac, p, q, mode) {
    const mid = d3.geoInterpolate(p, q)(0.5), lon = MC.normLon(mid[0]), lat = mid[1];
    const brg = bearing(p, q), c = MC.cAt(atl, lon, lat), [u, v] = MC.windAt(atl, lon, lat);
    const landish = MC.landAt(atl, lon, lat) > COAST;
    let M, type, mcut = null;
    if (!ac.supersonic) { M = ac.design; type = "sub"; }
    else if (landish) {
      mcut = MC.mHeading(atl, brg, lon, lat) - MC.S.margin;
      if (mode === "corr" && mcut >= MC.FLOOR) { M = Math.min(mcut, ac.design); type = "boomless"; }
      else { M = ac.sub; type = "sub"; }
    } else { M = ac.design; type = "super"; }
    const along = u * Math.sin(brg * RAD) + v * Math.cos(brg * RAD);
    return { M, type, c, along, landish, mcut, brg };
  }
  function legCost(st, ac, d, E, obj) {
    const tas = st.M * st.c * MC.KT, gs = Math.max(150, tas + st.along * MC.KT);
    const t = d / gs, fuel = ac.fuelPerNm(st.M) * d * tas / gs;
    if (obj === "time") return t;
    const op = fuel * E.fuel + ac.nonFuelPerBH * t;
    return obj === "cost" ? op : op + E.vot * ac.seats * E.lf * t;
  }

  // ---- full evaluation of a path (list of [lon,lat]) ----
  function evalPath(atl, ac, path, mode) {
    const E = econ(), samples = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], d = hav(a, b), n = Math.max(1, Math.ceil(d / 15)), f = d3.geoInterpolate(a, b);
      for (let k = 0; k < n; k++) samples.push([f(k / n), f((k + 1) / n), d / n]);
    }
    const total = samples.reduce((s, x) => s + x[2], 0);
    let cum = 0;
    const segs = samples.map(([p, q, d]) => {
      const st = legState(atl, ac, p, q, mode);
      const s = { p, q, d, x0: cum, x1: cum + d, ...st };
      if (ac.supersonic && (cum < CLIMB_NM || cum + d > total - DESC_NM)) { s.M = Math.min(s.M, ac.sub); s.type = "climb"; }
      cum += d; return s;
    });
    // constant-Mach blocks: a boomless leg flies the lowest boomless Mach within +/- BLOCK_NM/2
    const bl = segs.map((s, i) => s.type === "boomless" ? i : -1).filter(i => i >= 0);
    const base = segs.map(s => s.M);
    for (const i of bl) {
      let m = base[i];
      for (let j = i - 1; j >= 0 && segs[i].x0 - segs[j].x1 < BLOCK_NM / 2 && segs[j].type === "boomless"; j--) m = Math.min(m, base[j]);
      for (let j = i + 1; j < segs.length && segs[j].x0 - segs[i].x1 < BLOCK_NM / 2 && segs[j].type === "boomless"; j++) m = Math.min(m, base[j]);
      segs[i].M = m;
    }
    // acceleration / deceleration limits: forward pass caps speed-ups, backward pass makes the
    // aircraft slow down BEFORE a slower leg (e.g. decelerate over water before a coast)
    if (ac.supersonic) {
      const dtMin = s => 60 * s.d / Math.max(150, s.M * s.c * MC.KT);
      for (let i = 1; i < segs.length; i++) segs[i].M = Math.min(segs[i].M, segs[i - 1].M + ACC_MPM * dtMin(segs[i]));
      for (let i = segs.length - 2; i >= 0; i--) segs[i].M = Math.min(segs[i].M, segs[i + 1].M + DEC_MPM * dtMin(segs[i]));
      for (let i = 1; i < segs.length; i++) { segs[i].accel = segs[i].M > segs[i - 1].M + 1e-3; segs[i].decel = segs[i].M < segs[i - 1].M - 1e-3; }
    }
    let t = 0, fuel = 0, dLand = 0, dBoomless = 0, dSuper = 0, tAcc = 0;
    for (const s of segs) {
      const tas = s.M * s.c * MC.KT, gs = Math.max(150, tas + s.along * MC.KT);
      s.t = s.d / gs; s.fuel = ac.fuelPerNm(s.M) * s.d * tas / gs * (s.accel ? ACC_FUEL : 1);
      if (s.accel || s.decel) tAcc += s.t;
      t += s.t; fuel += s.fuel;
      if (s.landish) dLand += s.d;
      if (s.type === "boomless") dBoomless += s.d;
      if (s.M > 1) dSuper += s.d;
    }
    const block = t + BLOCK_EXTRA_H, op = fuel * E.fuel + ac.nonFuelPerBH * block;
    const pax = ac.seats * E.lf;
    return { path, segs, dist: total, air: t, block, fuel, op, perSeat: op / pax, gen: op + E.vot * pax * block, tAcc,
             dLand, dBoomless, dSuper, inRange: total <= ac.rangeNm, mode, ac };
  }

  // ---- grid optimiser (Dijkstra on 1° lat/lon, 16 move directions, unwrapped longitude) ----
  const MOVES = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
                 [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
  function optimise(atl, ac, A, B, obj) {
    const E = econ();
    const bLon = A[0] + (((B[0] - A[0]) % 360) + 540) % 360 - 180;     // unwrap
    const span = Math.max(Math.abs(bLon - A[0]), Math.abs(B[1] - A[1]));
    const R = Math.max(8, 0.3 * span);
    const lat0 = Math.max(-80, Math.floor(Math.min(A[1], B[1]) - R)), lat1 = Math.min(80, Math.ceil(Math.max(A[1], B[1]) + R));
    const lon0 = Math.floor(Math.min(A[0], bLon) - R), lon1 = Math.ceil(Math.max(A[0], bLon) + R);
    const nx = lon1 - lon0 + 1, ny = lat1 - lat0 + 1, N = nx * ny;
    const id = (i, j) => j * nx + i, ll = n => [lon0 + (n % nx), lat0 + Math.floor(n / nx)];
    const s = id(Math.round(A[0]) - lon0, Math.round(A[1]) - lat0), g = id(Math.round(bLon) - lon0, Math.round(B[1]) - lat0);
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = []; // [cost, node]
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
        const m = id(ii, jj), Q = ll(m), d = hav(P, Q);
        const nc = c + legCost(legState(atl, ac, P, Q, "corr"), ac, d, E, obj);
        if (nc < dist[m]) { dist[m] = nc; prev[m] = n; push(nc, m); }
      }
    }
    const nodes = [];
    for (let n = g; n >= 0; n = prev[n]) { nodes.push(ll(n)); if (n === s) break; }
    nodes.reverse();
    let path = [A, ...nodes.slice(1, -1), [bLon, B[1]]];
    // string pulling: replace runs of nodes with a direct leg when it is not worse
    const segCost = (p, q) => { const d = hav(p, q), n = Math.max(1, Math.ceil(d / 30)), f = d3.geoInterpolate(p, q); let c = 0; for (let k = 0; k < n; k++) c += legCost(legState(atl, ac, f(k / n), f((k + 1) / n), "corr"), ac, d / n, E, obj); return c; };
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let best = i + 1;
      for (let j = Math.min(path.length - 1, i + 25); j > i + 1; j--) {
        let via = 0; for (let k = i; k < j; k++) via += segCost(path[k], path[k + 1]);
        if (segCost(path[i], path[j]) <= via * 1.0005) { best = j; break; }
      }
      out.push(path[best]); i = best;
    }
    // continuous refinement on the FULL cost model (accel/decel, climb, constant-Mach blocks),
    // from two independent starts: the grid optimum and the great circle. Keep the better one.
    const objOf = p => { const e = evalPath(atl, ac, p, "corr"); return obj === "time" ? e.block : obj === "cost" ? e.op : e.gen; };
    const densify = (p, k) => { const o = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const f = d3.geoInterpolate(p[i], p[i + 1]); for (let j = 1; j <= k; j++) o.push(j === k ? p[i + 1] : f(j / k)); } return o; };
    const gridStart = out.length <= 2 ? densify(out, 4) : out;
    const r1 = refine(gridStart, objOf), r2 = refine(densify([A, [bLon, B[1]]], 5), objOf);
    const best = r1.v <= r2.v ? r1 : r2;
    best.p.info = { gridV: objOf(out), v: best.v, otherV: Math.max(r1.v, r2.v), obj, startsAgree: Math.abs(r1.v - r2.v) / best.v };
    return best.p;
  }
  function refine(path, f) {
    let p = path.map(q => q.slice()), v = f(p), step = 2.0;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let evals = 0;
    while (step >= 0.125 && evals < 2500) {
      let improved = false;
      for (let i = 1; i < p.length - 1; i++) {
        for (const [dx, dy] of D) {
          const c = p.map(q => q.slice());
          c[i] = [p[i][0] + dx * step / Math.max(0.3, Math.cos(p[i][1] * RAD)), Math.max(-85, Math.min(85, p[i][1] + dy * step))];
          const cv = f(c); evals++;
          if (cv < v - 1e-9) { p = c; v = cv; improved = true; }
        }
        if (p.length > 3) {             // try dropping the waypoint
          const c = p.filter((_, k) => k !== i), cv = f(c); evals++;
          if (cv <= v) { p = c; v = cv; improved = true; i--; }
        }
      }
      if (!improved) step /= 2;
    }
    return { p, v };
  }

  // ---- route panel ----
  let R = null; // {A,B,names, results}
  const colors = () => ({ boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub"), gc: MC.css("--text-2") });
  function drawOverlay(ctx, toScreen, worldW) {
    if (!R) return;
    const col = colors();
    const line = (segs, style) => {
      for (const pass of ["casing", "color"]) for (const s of segs) {
        let [ax, ay] = toScreen(MC.normLon(s.p[0]), s.p[1]), [bx, by] = toScreen(MC.normLon(s.q[0]), s.q[1]);
        if (Math.abs(bx - ax) > worldW / 2) continue;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineCap = "round";
        if (pass === "casing") { ctx.setLineDash([]); ctx.strokeStyle = MC.css("--casing"); ctx.lineWidth = style.w + 2.5; ctx.globalAlpha = 0.9; }
        else { ctx.setLineDash(style.dash || []); ctx.strokeStyle = style.color || col[s.type]; ctx.lineWidth = style.w; ctx.globalAlpha = 1; }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    if (R.gc) line(R.gc.segs, { w: 1.5, dash: [5, 4], color: col.gc });
    if (R.opt) line(R.opt.segs, { w: 3 });
    for (const [p, name] of [[R.A, R.names[0]], [R.B, R.names[1]]]) {
      const [sx, sy] = toScreen(p[0], p[1]);
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI); ctx.fillStyle = MC.css("--text"); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = MC.css("--casing"); ctx.stroke();
      ctx.font = "600 12px system-ui, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = MC.css("--casing");
      ctx.strokeText(name, sx + 8, sy - 6); ctx.fillStyle = MC.css("--text"); ctx.fillText(name, sx + 8, sy - 6);
    }
  }
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const fmtDT = h => { const m = Math.round(h * 60); return (m <= 0 ? "−" : "+") + fmtT(Math.abs(h)).replace(/^0h /, ""); };
  const k$ = x => "$" + (Math.abs(x) >= 1e5 ? Math.round(x / 1000).toLocaleString() + "k" : Math.round(x).toLocaleString());
  const sgn$ = x => (x < 0 ? "−" : "+") + k$(Math.abs(x));
  const ptName = p => { const a = Object.values(MC.APT).find(a => Math.abs(a[2] - p[1]) < 0.05 && Math.abs(a[3] - p[0]) < 0.05); return a ? a[0] : `${MC.fmtLat(p[1])} ${MC.fmtLon(p[0])}`; };

  async function planRoute(A, B, names) {
    const ac = ACS.find(a => a.id === $("acSel").value), obj = $("objSel").value;
    const fh = MC.S.man.forecast_hours[MC.S.fi];
    $("routeOut").hidden = false; $("routeSummary").innerHTML = "<span class='muted'>Optimising…</span>";
    await new Promise(r => setTimeout(r, 10));
    const atl = await MC.loadAtlas(fh, MC.S.fl);
    const base = ACS.find(a => a.id === "b789");
    const atlBase = await MC.loadAtlas(fh, nearestFL(base.fl));
    const gcPath = [A, B];
    const r = {
      A, B, names, ac, obj,
      base: evalPath(atlBase, base, gcPath, "ban"),
      ban: evalPath(atl, ac, gcPath, "ban"),
      gc: evalPath(atl, ac, gcPath, "corr"),
    };
    r.opt = ac.supersonic ? evalPath(atl, ac, optimise(atl, ac, A, B, obj), "corr") : r.gc;
    R = r; MC.schedule(); renderRoute(); window.dispatchEvent(new Event("mc-route"));
    MC.hashExtra.r = [A, B].map((p, i) => MC.APT[names[i]] ? names[i] : `${p[1].toFixed(2)},${p[0].toFixed(2)}`).join("-");
    MC.hashExtra.ac = ac.id; MC.writeHash();
    // every flight level, same aircraft & objective
    const rows = [];
    for (const fl of MC.S.man.flight_levels) {
      const a = await MC.loadAtlas(fh, fl);
      const o = ac.supersonic ? evalPath(a, ac, optimise(a, ac, A, B, obj), "corr") : evalPath(a, ac, gcPath, "corr");
      const b = evalPath(a, ac, gcPath, "ban");
      rows.push({ fl, o, b });
      await new Promise(r => setTimeout(r, 0));
    }
    if (R === r) renderFlTable(rows);
  }

  function renderRoute() {
    const r = R, pax = r.ac.seats * econ().lf;
    const vsBan = { t: r.opt.block - r.ban.block, c: r.opt.op - r.ban.op };
    const vsGc = { t: r.opt.block - r.gc.block, c: r.opt.op - r.gc.op };
    $("routeSummary").innerHTML = `<b>${r.names[0]} → ${r.names[1]}</b> · ${r.ac.name} · FL${MC.S.fl}<br>
      Great circle ${Math.round(r.gc.dist).toLocaleString()} nm · optimised ${Math.round(r.opt.dist).toLocaleString()} nm
      (${r.opt.dist >= r.gc.dist ? "+" : ""}${Math.round(r.opt.dist - r.gc.dist)} nm) · ${Math.round(100 * r.opt.dLand / r.opt.dist)}% over land/coast,
      ${r.opt.dLand ? Math.round(100 * r.opt.dBoomless / r.opt.dLand) : 0}% of that boomless.
      · ${Math.round(r.opt.tAcc * 60)} min spent changing speed.
      ${!r.opt.inRange ? `<br><b class="warn">Beyond ${r.ac.name.split(" (")[0]} range (${r.ac.rangeNm.toLocaleString()} nm) — would need a fuel stop.</b>` : ""}
      <div class="verdict">${vsBan.t < 0 ? `Using corridors saves <b>${fmtT(-vsBan.t)}</b>` : `No time saved`} vs today's rules
      (${vsBan.c <= 0 ? "and " + k$(-vsBan.c) + " less" : "for " + k$(vsBan.c) + " more"} operating cost, ${sgn$(vsBan.c / pax)}/seat).
      The alternate route vs the direct corridor great circle: ${fmtDT(vsGc.t)}, ${sgn$(vsGc.c)}.</div>
      ${r.opt.path.info ? `<div class="muted small">Optimiser: global search on a 1° grid, then continuous refinement of the waypoints on the full cost model from two independent starts (grid optimum and great circle); the two starts ${r.opt.path.info.startsAgree < 0.002 ? "converged to the same answer" : "differ by " + (100 * r.opt.path.info.startsAgree).toFixed(1) + "% — the better one is shown"}. Optimal for this forecast snapshot and cost model, not a proof of the global optimum.</div>` : ""}`;
    const row = (lbl, e, hl) => `<tr${hl ? " class='hl'" : ""}><td>${lbl}</td><td>${Math.round(e.dist).toLocaleString()}</td><td>${fmtT(e.block)}</td><td>${(e.fuel / 1000).toFixed(1)}</td><td>${k$(e.op)}</td><td>${k$(e.perSeat)}</td></tr>`;
    $("routeTable").innerHTML = `<tr><th>Flight</th><th>nm</th><th>Block</th><th>Fuel t</th><th>Op cost</th><th>$/seat</th></tr>
      ${row("787-9 today (subsonic)", r.base)}
      ${r.ac.supersonic ? row("Great circle, overland ban", r.ban) + row("Great circle + corridors", r.gc) : ""}
      ${row(r.ac.supersonic ? "Optimised corridor route" : r.ac.name, r.opt, true)}
      <tr><td colspan="6" class="muted small">vs 787-9: ${fmtDT(r.opt.block - r.base.block)} block · ${sgn$(r.opt.perSeat - r.base.perSeat)}/seat ·
      break-even value of time ${r.opt.block < r.base.block ? k$((r.opt.perSeat - r.base.perSeat) / (r.base.block - r.opt.block)) + "/h per passenger" : "n/a"}</td></tr>`;
    drawProfile(r.opt);
    $("flTable").innerHTML = "<tr><td class='muted'>Computing other flight levels…</td></tr>";
  }

  function renderFlTable(rows) {
    const best = rows.reduce((b, x) => (x.o.gen < b.o.gen ? x : b), rows[0]);
    $("flTable").innerHTML = `<tr><th>FL</th><th>Block</th><th>vs ban</th><th>Boomless</th><th>Fuel t</th><th>Op cost</th></tr>` +
      rows.map(x => `<tr${x === best ? " class='hl'" : ""}${x.fl === MC.S.fl ? " style='outline:1px solid var(--line)'" : ""}><td>FL${x.fl}${x === best ? " ★" : ""}</td><td>${fmtT(x.o.block)}</td><td>${fmtDT(x.o.block - x.b.block)}</td>
        <td>${x.o.dLand ? Math.round(100 * x.o.dBoomless / x.o.dLand) + "%" : "—"}</td><td>${(x.o.fuel / 1000).toFixed(1)}</td><td>${k$(x.o.op)}</td></tr>`).join("") +
      `<tr><td colspan="6" class="muted small">★ lowest cost + passenger time. Fuel curve assumes the aircraft can cruise at every level (not checked against its ceiling).</td></tr>`;
  }

  function drawProfile(e) {
    const svg = d3.select("#rprof"); svg.selectAll("*").remove();
    const m = { l: 30, r: 6, t: 8, b: 22 }, w = 320 - m.l - m.r, h = 150 - m.t - m.b;
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleLinear([0, e.dist], [0, w]);
    const yMax = Math.max(e.ac.design, 1.3) + 0.05, y = d3.scaleLinear([0.7, yMax], [h, 0]);
    g.append("g").selectAll("rect").data(e.segs.filter(s => s.landish)).join("rect")
      .attr("x", s => x(s.x0)).attr("width", s => Math.max(0.5, x(s.x1) - x(s.x0) + 0.3)).attr("y", 0).attr("height", h).attr("fill", "var(--surface-2)");
    g.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(4).tickFormat(d3.format(".1f"))).call(s => s.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickSize(3).tickFormat(d3.format(","))).call(s => s.select(".domain").attr("stroke", "var(--line)"));
    g.append("text").attr("x", w).attr("y", -1).attr("text-anchor", "end").text("nm along route · shaded = land/coast");
    const mc = e.segs.filter(s => s.landish && s.mcut != null);
    g.append("g").selectAll("line").data(mc).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", s => y(Math.max(0.7, Math.min(s.mcut, yMax)))).attr("y2", s => y(Math.max(0.7, Math.min(s.mcut, yMax))))
      .attr("stroke", "var(--text-2)").attr("stroke-width", 1).attr("stroke-dasharray", "2 2");
    const col = colors();
    g.append("g").selectAll("line").data(e.segs).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", (s, i) => y(i ? e.segs[i - 1].M : s.M)).attr("y2", s => y(s.M))
      .attr("stroke", s => col[s.type]).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", "var(--text-2)").attr("stroke-width", 0.8);
    g.append("text").attr("x", 2).attr("y", y(1) - 3).text("Mach 1 · dashed = boomless limit");
  }

  // ---- economics tab ----
  const ROUTES = [["EGLL", "KJFK"], ["LFPG", "KJFK"], ["KJFK", "KLAX"], ["KMIA", "SBGR"], ["KJFK", "TJSJ"], ["KLAX", "PHNL"], ["EGLL", "OMDB"], ["KSFO", "RJTT"]];
  async function runEcon() {
    const fh = MC.S.man.forecast_hours[MC.S.fi], E = econ(), out = $("econOut"), prog = $("econProgress");
    out.innerHTML = ""; $("econRun").disabled = true;
    const base = ACS.find(a => a.id === "b789"), sst = ACS.filter(a => a.supersonic);
    let n = 0; const total = ROUTES.length * (sst.length + 1);
    const summary = [];
    for (const [ra, rb] of ROUTES) {
      const A = [MC.APT[ra][3], MC.APT[ra][2]], B = [MC.APT[rb][3], MC.APT[rb][2]];
      const atlB = await MC.loadAtlas(fh, nearestFL(base.fl));
      const b = evalPath(atlB, base, [A, B], "ban"); n++;
      const rows = [];
      for (const ac of sst) {
        prog.textContent = `Computing ${ra}–${rb} · ${ac.name} (${++n}/${total})…`;
        await new Promise(r => setTimeout(r, 0));
        const atl = await MC.loadAtlas(fh, nearestFL(ac.fl));
        const ban = evalPath(atl, ac, [A, B], "ban"), gc = evalPath(atl, ac, [A, B], "corr");
        const opt = evalPath(atl, ac, optimise(atl, ac, A, B, "gen"), "corr");
        rows.push({ ac, ban, gc, opt });
      }
      summary.push({ ra, rb, b, rows });
      renderEcon(summary, E);
    }
    prog.textContent = `Done · forecast valid ${d3.utcFormat("%a %d %b %HZ")(new Date(MC.S.man.valid_times[MC.S.fi]))} · margin ${MC.S.margin.toFixed(3)} · each aircraft at its cruise level`;
    $("econRun").disabled = false;
  }
  function renderEcon(summary, E) {
    $("econOut").innerHTML = summary.map(({ ra, rb, b, rows }) => `
      <section class="ecard"><h3>${ra} → ${rb} <span class="muted">· great circle ${Math.round(b.dist).toLocaleString()} nm · 787-9 ${fmtT(b.block)}, ${k$(b.perSeat)}/seat</span></h3>
      <div class="tscroll"><table class="rt">
      <tr><th>Aircraft</th><th>Ban, direct</th><th>Corridors, direct</th><th>Corridors, optimised</th><th>Alt. route vs direct</th><th>Saved by corridors</th><th>$/seat</th><th>vs 787-9</th><th>Break-even VOT</th></tr>
      ${rows.map(({ ac, ban, gc, opt }) => {
        const bevot = opt.block < b.block ? (opt.perSeat - b.perSeat) / (b.block - opt.block) : null;
        return `<tr${!opt.inRange ? " class='dim'" : ""}><td>${ac.name}${!opt.inRange ? " <span class='warn'>range</span>" : ""}</td>
          <td>${fmtT(ban.block)}</td><td>${fmtT(gc.block)}</td><td><b>${fmtT(opt.block)}</b> <span class="muted">+${Math.round(opt.dist - gc.dist)} nm</span></td>
          <td>${fmtDT(opt.block - gc.block)} · ${sgn$(opt.op - gc.op)}</td>
          <td>${fmtDT(opt.block - ban.block)} · ${sgn$(opt.op - ban.op)}</td>
          <td>${k$(opt.perSeat)}</td><td>${fmtDT(opt.block - b.block)} · ${sgn$(opt.perSeat - b.perSeat)}</td>
          <td>${bevot != null ? k$(bevot) + "/h" : "—"}</td></tr>`;
      }).join("")}
      </table></div></section>`).join("") +
      `<p class="muted small">Break-even VOT = extra fare-cost per seat ÷ hours saved vs the 787-9. A traveller who values an hour above it comes out ahead (at cost, before margins). Your input: ${k$(E.vot)}/h. Block = airborne + 30 min; 150 nm climb and descent subsonic; speed changes limited to +0.06 M/min accelerating (35% extra fuel) and −0.10 M/min decelerating, so the aircraft slows before reaching a coast; boomless legs flown in ≥300 nm constant-Mach blocks; winds at cruise applied.</p>`;
  }
  function renderAcTable() {
    $("acTable").innerHTML = `<div class="tscroll"><table class="rt"><tr><th>Aircraft</th><th>Seats</th><th>Design M</th><th>Range nm</th><th>Fuel kg/nm @M0.95 · 1.15 · design</th><th>Non-fuel $/bh</th><th>Notes</th></tr>` +
      ACS.map(a => `<tr><td>${a.name}</td><td>${a.seats}</td><td>${a.design}</td><td>${a.rangeNm.toLocaleString()}</td>
        <td>${a.supersonic ? [0.95, 1.15, a.design].map(m => a.fuelPerNm(m).toFixed(1)).join(" · ") : a.fuelPerNm(a.design).toFixed(1)}</td>
        <td>${a.nonFuelPerBH.toLocaleString()}</td><td class="small">${a.note}</td></tr>`).join("") + `</table></div>`;
  }

  window.addEventListener("mc-ready", e => {
    MC = window.MC; ACS = window.AIRCRAFT;
    MC.overlays.push(drawOverlay);
    $("acSel").innerHTML = ACS.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
    const p = e.detail;
    if (p.get("ac") && ACS.some(a => a.id === p.get("ac"))) $("acSel").value = p.get("ac");
    const go = () => {
      const a = MC.APT[$("fromIn").value.trim().toUpperCase()], b = MC.APT[$("toIn").value.trim().toUpperCase()];
      if (!a || !b) { $("routeOut").hidden = false; $("routeSummary").textContent = "Unknown airport code — pick from the list, or click a point then shift-click a second one."; return; }
      planRoute([a[3], a[2]], [b[3], b[2]], [a[0], b[0]]);
    };
    $("routeGo").onclick = go;
    for (const id of ["fromIn", "toIn"]) $(id).addEventListener("keydown", ev => { if (ev.key === "Enter") go(); });
    for (const id of ["acSel", "objSel"]) $(id).onchange = () => { if (R) planRoute(R.A, R.B, R.names); };
    MC.on("shiftSelect", (a, b) => {
      const names = [ptName(a), ptName(b)];
      $("fromIn").value = MC.APT[names[0]] ? names[0] : ""; $("toIn").value = MC.APT[names[1]] ? names[1] : "";
      planRoute(a, b, names);
    });
    MC.on("refresh", () => { if (R) planRoute(R.A, R.B, R.names); });
    $("econRun").onclick = runEcon;
    renderAcTable();
    const r = p.get("r");
    if (r) {
      const pts = r.split("-").map(s => MC.APT[s] ? [[MC.APT[s][3], MC.APT[s][2]], s] : (([la, lo]) => [[+lo, +la], `${la},${lo}`])(s.split(",")));
      if (pts.length === 2) { if (MC.APT[pts[0][1]]) $("fromIn").value = pts[0][1]; if (MC.APT[pts[1][1]]) $("toIn").value = pts[1][1]; planRoute(pts[0][0], pts[1][0], [pts[0][1], pts[1][1]]); }
    }
  });
  window.MCPLAN = { evalPath, optimise, ROUTES, getRoute: () => R };
})();
