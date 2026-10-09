/* Route drawer on the map: shift-click or airport codes → optimised route, KPIs, charts, every flight level. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let MC, ACS, RT, R = null, seq = 0;

  const E = () => ({ fuel: +$("fuelPrice").value || 1.47, vot: +$("vot").value || 85, lf: +$("lf").value || 0.8, margin: MC.S.margin });
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const fmtMin = h => { const m = Math.round(h * 60), a = Math.abs(m), sg = m > 0 ? "+" : m < 0 ? "−" : "";
    return a >= 90 ? `${sg}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${sg}${a} min`; };
  const money = x => "$" + Math.round(Math.abs(x)).toLocaleString();
  const dMoney = x => (x > 0 ? "+" : x < 0 ? "−" : "") + money(x);
  const ptName = p => { const a = Object.values(MC.APT).find(a => Math.abs(a[2] - p[1]) < 0.05 && Math.abs(a[3] - p[0]) < 0.05); return a ? a[0] : `${MC.fmtLat(p[1])} ${MC.fmtLon(p[0])}`; };
  const colors = () => ({ boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub") });

  function drawOverlay(ctx, toScreen, worldW) {
    if (!R) return;
    const col = colors();
    const line = (segs, w, dash, color) => {
      for (const pass of [0, 1]) for (const s of segs) {
        const [ax, ay] = toScreen(MC.normLon(s.p[0]), s.p[1]), [bx, by] = toScreen(MC.normLon(s.q[0]), s.q[1]);
        if (Math.abs(bx - ax) > worldW / 2) continue;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineCap = "round";
        if (!pass) { ctx.setLineDash([]); ctx.strokeStyle = "rgba(3,11,38,.85)"; ctx.lineWidth = w + 3; }
        else { ctx.setLineDash(dash || []); ctx.strokeStyle = color || col[s.type]; ctx.lineWidth = w; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    if (R.gc) line(R.gc.segs, 1.4, [5, 5], "rgba(226,235,252,.75)");
    if (R.opt) line(R.opt.segs, 3);
    for (const [p, name] of [[R.A, R.names[0]], [R.B, R.names[1]]]) {
      const [sx, sy] = toScreen(p[0], p[1]);
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#061029"; ctx.stroke();
      ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "#061029";
      ctx.strokeText(name, sx + 9, sy - 7); ctx.fillStyle = "#fff"; ctx.fillText(name, sx + 9, sy - 7);
    }
  }

  async function planRoute(A, B, names) {
    const my = ++seq, ac = ACS.find(a => a.id === $("acSel").value), obj = $("objSel").value, e = E();
    $("routeOut").hidden = false; $("routeSummary").innerHTML = "<span class='muted'>Finding the best route…</span>"; $("routeKpis").innerHTML = "";
    await new Promise(r => setTimeout(r, 15));
    const base = ACS.find(a => a.id === "b789");
    const [field, fieldB] = await Promise.all([RT.makeField(MC.S.fl, MC.S.fi), RT.makeField(RT.nearestFL(base.fl), MC.S.fi)]);
    if (my !== seq) return;
    const gc = [A, B];
    const r = { A, B, names, ac, obj, fl: MC.S.fl, fi: MC.S.fi,
      base: RT.evalPath(fieldB, base, gc, "ban", e), ban: RT.evalPath(field, ac, gc, "ban", e), gc: RT.evalPath(field, ac, gc, "corr", e) };
    r.opt = ac.supersonic ? RT.evalPath(field, ac, RT.optimise(field, ac, A, B, obj, e), "corr", e) : r.gc;
    R = r; MC.fit && MC.fit([...r.opt.path, ...r.gc.path]); MC.schedule(); render(r); window.dispatchEvent(new Event("mc-route"));
    MC.hashExtra.r = [A, B].map((p, i) => MC.APT[names[i]] ? names[i] : `${p[1].toFixed(2)},${p[0].toFixed(2)}`).join("-");
    MC.hashExtra.ac = ac.id; MC.writeHash();
    const rows = [];
    for (const fl of MC.S.man.flight_levels) {
      const f = await RT.makeField(fl, MC.S.fi);
      if (my !== seq) return;
      rows.push({ fl, o: ac.supersonic ? RT.evalPath(f, ac, RT.optimise(f, ac, A, B, obj, e, 500), "corr", e) : RT.evalPath(f, ac, gc, "corr", e), b: RT.evalPath(f, ac, gc, "ban", e) });
      renderFl(rows);
      await new Promise(res => setTimeout(res, 0));
    }
  }

  function render(r) {
    const o = r.opt, sup = r.ac.supersonic;
    const dBan = { t: o.block - r.ban.block, s: o.perSeat - r.ban.perSeat };
    const good = dBan.t < 0;
    $("routeSummary").innerHTML = `<b>${r.names[0]} to ${r.names[1]}</b>, ${r.ac.name}, FL${MC.S.fl}.
      ${Math.round(o.dist).toLocaleString()} nm (${o.dist >= r.gc.dist ? "+" : ""}${Math.round(o.dist - r.gc.dist)} nm vs great circle), ${Math.round(100 * o.dLand / o.dist)}% over land or coast.
      ${!o.inRange ? `<br><span class="warn">Longer than the ${r.ac.rangeNm.toLocaleString()} nm range: needs a fuel stop.</span>` : ""}
      ${sup ? `<div class="verdict ${good ? "" : "neg"}">${good ? `Boomless corridors save <b>${fmtMin(-dBan.t).replace("+", "")}</b> against today's overland ban and change the cost per seat by <b>${dMoney(dBan.s)}</b>.` : "Boomless corridors add nothing on this route at this altitude and time."}</div>` : ""}`;
    const k = (v, l, cls = "") => `<div><div class="kv ${cls}">${v}</div><div class="kl">${l}</div></div>`;
    const tv = o.block - r.base.block, sv = o.perSeat - r.base.perSeat;
    $("routeKpis").innerHTML = [
      k(fmtT(o.block), "Block time"),
      k(fmtMin(tv), "Versus 787-9", tv < 0 ? "pos" : "neg"),
      k(dMoney(sv), "Cost per seat vs 787-9", sv <= 0 ? "pos" : "neg"),
      k(`${Math.round(Math.abs(o.windAvg))} kt`, o.windAvg >= 0 ? "Average tailwind" : "Average headwind", o.windAvg >= 0 ? "pos" : "neg"),
      k(o.dLand ? Math.round(100 * o.dBoomless / o.dLand) + "%" : "–", "Land legs flown boomless"),
      k(`${Math.round(o.tAcc * 60)} min`, "Spent accelerating or slowing"),
    ].join("");
    drawLadder(r); drawProfile(o);
    $("flTable").innerHTML = "<tr><td class='muted'>Computing the other altitudes…</td></tr>";
    const inf = o.path.info;
    $("optNote").textContent = sup && inf ? `Route search: time-dependent grid search, then continuous refinement from two starting routes${inf.startsAgree < 0.002 ? ", which agree" : ` (they differ by ${(100 * inf.startsAgree).toFixed(1)}%; the better is shown)`}. Best for this forecast and cost model; not a proof of the global optimum. Weather is taken at the time the aircraft reaches each point.` : "";
  }

  function drawLadder(r) {
    const rows = [["787-9 today", r.base, MC.css("--ink-3")]];
    if (r.ac.supersonic) rows.push(["Overland ban, direct", r.ban, MC.css("--route-sub")], ["Corridors, direct", r.gc, MC.css("--route-super")], ["Corridors, optimised", r.opt, MC.css("--route-boomless")]);
    const svg = d3.select("#rLadder").attr("viewBox", `0 0 340 ${rows.length * 28 + 6}`); svg.selectAll("*").remove();
    const x = d3.scaleLinear([0, d3.max(rows, d => d[1].block)], [128, 290]);
    rows.forEach(([lbl, e, c], i) => {
      const y = i * 28 + 4;
      svg.append("text").attr("x", 0).attr("y", y + 13).text(lbl).style("font-size", "11px");
      svg.append("rect").attr("x", 128).attr("y", y + 3).attr("height", 14).attr("rx", 3).attr("width", x(e.block) - 128).attr("fill", c);
      svg.append("text").attr("x", x(e.block) + 6).attr("y", y + 14).text(fmtT(e.block)).style("font-size", "11px").style("fill", "var(--ink)");
    });
  }

  function drawProfile(e) {
    const svg = d3.select("#rprof"); svg.selectAll("*").remove();
    const m = { l: 34, r: 8 }, w = 340 - m.l - m.r, h1 = 110, h2 = 50, gap = 14;
    const x = d3.scaleLinear([0, e.dist], [0, w]);
    const g = svg.append("g").attr("transform", `translate(${m.l},6)`);
    const yMax = Math.max(e.ac.design, 1.3) + 0.05, y = d3.scaleLinear([0.7, yMax], [h1, 0]);
    g.append("g").selectAll("rect").data(e.segs.filter(s => s.landish)).join("rect")
      .attr("x", s => x(s.x0)).attr("width", s => Math.max(0.5, x(s.x1) - x(s.x0) + 0.3)).attr("y", 0).attr("height", h1).attr("fill", "var(--surface-2)");
    g.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(5).tickFormat(d3.format(".1f"))).call(s => s.select(".domain").remove());
    g.append("text").attr("x", 0).attr("y", -1).text("Mach (shaded: over land or coast)");
    const mc = e.segs.filter(s => s.landish && s.mcut != null);
    g.append("g").selectAll("line").data(mc).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", s => y(Math.max(0.7, Math.min(s.mcut, yMax)))).attr("y2", s => y(Math.max(0.7, Math.min(s.mcut, yMax))))
      .attr("stroke", "var(--ink-3)").attr("stroke-width", 1).attr("stroke-dasharray", "2 2");
    const col = colors();
    g.append("g").selectAll("line").data(e.segs).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", (s, i) => y(i ? e.segs[i - 1].M : s.M)).attr("y2", s => y(s.M)).attr("stroke", s => col[s.type]).attr("stroke-width", 2.4).attr("stroke-linecap", "round");
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", "var(--ink-3)").attr("stroke-width", .8);
    // wind panel: tailwind positive (good), headwind negative (bad)
    const g2 = svg.append("g").attr("transform", `translate(${m.l},${6 + h1 + gap})`);
    const wv = e.segs.map(s => ({ x: (s.x0 + s.x1) / 2, w: s.along * RT.KT }));
    const wm = Math.max(40, d3.max(wv, d => Math.abs(d.w)));
    const yw = d3.scaleLinear([-wm, wm], [h2, 0]);
    g2.append("path").datum(wv).attr("fill", "var(--good)").attr("opacity", .35).attr("d", d3.area().x(d => x(d.x)).y0(yw(0)).y1(d => yw(Math.max(0, d.w))));
    g2.append("path").datum(wv).attr("fill", "var(--bad)").attr("opacity", .35).attr("d", d3.area().x(d => x(d.x)).y0(yw(0)).y1(d => yw(Math.min(0, d.w))));
    g2.append("line").attr("x1", 0).attr("x2", w).attr("y1", yw(0)).attr("y2", yw(0)).attr("stroke", "var(--ink-3)").attr("stroke-width", .8);
    g2.append("g").attr("class", "axis").call(d3.axisLeft(yw).ticks(3).tickSize(0).tickPadding(5)).call(s => s.select(".domain").remove());
    g2.append("text").attr("x", 0).attr("y", -3).text("Wind along track, kt (green tailwind, red headwind)");
    g2.append("g").attr("class", "axis").attr("transform", `translate(0,${h2})`).call(d3.axisBottom(x).ticks(5).tickSize(3).tickFormat(d => d3.format(",")(d) + (d === 0 ? " nm" : ""))).call(s => s.select(".domain").attr("stroke", "var(--rule)"));
    svg.attr("viewBox", `0 0 340 ${6 + h1 + gap + h2 + 22}`);
    svg.on("click", ev => { const [px] = d3.pointer(ev, g.node()); window.MC3D?.openRoute(Math.max(0, Math.min(e.dist, x.invert(px)))); });
  }

  function renderFl(rows) {
    const best = rows.reduce((b, x) => (x.o.gen < b.o.gen ? x : b), rows[0]);
    $("flTable").innerHTML = `<tr><th>Altitude</th><th>Block</th><th>vs ban</th><th>Boomless</th><th>Fuel</th><th>$/seat</th></tr>` +
      rows.map(x => `<tr class="${x === best ? "hl" : ""} ${x.fl === MC.S.fl ? "cur" : ""}"><td>FL${x.fl}${x === best ? " (best)" : ""}</td><td>${fmtT(x.o.block)}</td>
        <td class="${x.o.block < x.b.block ? "pos" : ""}">${fmtMin(x.o.block - x.b.block)}</td><td>${x.o.dLand ? Math.round(100 * x.o.dBoomless / x.o.dLand) + "%" : "–"}</td>
        <td>${(x.o.fuel / 1000).toFixed(1)} t</td><td>${money(x.o.perSeat)}</td></tr>`).join("");
  }

  window.addEventListener("mc-ready", ev => {
    MC = window.MC; ACS = window.AIRCRAFT; RT = window.ROUTE;
    MC.overlays.push(drawOverlay);
    $("acSel").innerHTML = ACS.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
    $("acSel").value = "concorde";
    const p = ev.detail;
    if (p.get("ac") && ACS.some(a => a.id === p.get("ac"))) $("acSel").value = p.get("ac");
    const go = () => {
      const a = MC.APT[$("fromIn").value.trim().toUpperCase()], b = MC.APT[$("toIn").value.trim().toUpperCase()];
      if (!a || !b) { $("routeOut").hidden = false; $("routeSummary").textContent = "Use airport codes from the list, or click a point and shift-click a second one."; return; }
      planRoute([a[3], a[2]], [b[3], b[2]], [a[0], b[0]]);
    };
    $("routeGo").onclick = go;
    $("fly3d").onclick = () => window.MC3D?.openRoute(0);
    $("routeHd").onclick = () => {
      if (!R) return;
      const segs = R.opt.segs.filter(s => s.landish).length ? R.opt.segs.filter(s => s.landish) : R.opt.segs;
      const sx = segs.reduce((a, s) => a + Math.sin(s.brg * Math.PI / 180) * s.d, 0), cy = segs.reduce((a, s) => a + Math.cos(s.brg * Math.PI / 180) * s.d, 0);
      const brg = ((Math.round(Math.atan2(sx, cy) * 180 / Math.PI / 10) * 10) % 360 + 360) % 360;
      document.querySelector('#hdSeg [data-v="hd"]').click();
      const sl = $("hdSlider"); sl.value = brg; sl.dispatchEvent(new Event("input"));
    };
    for (const id of ["fromIn", "toIn"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    for (const id of ["acSel", "objSel"]) $(id).onchange = () => { if (R) planRoute(R.A, R.B, R.names); };
    // tap-friendly routing: start here / end here (works without a keyboard)
    let pendingStart = null;
    $("routeFromHere").onclick = () => {
      pendingStart = MC.S.sel.slice(); $("pickHint").hidden = false;
      $("pickHint").textContent = "Now tap the destination on the map";
      document.getElementById("mapWrap").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("routeToHere").onclick = () => {
      const start = pendingStart || (R ? R.A : null);
      if (!start) { pendingStart = null; $("pickHint").hidden = false; $("pickHint").textContent = "Pick a start first: tap a point, then Start route here"; setTimeout(() => $("pickHint").hidden = true, 2500); return; }
      const b = MC.S.sel.slice(); pendingStart = null; $("pickHint").hidden = true;
      const names = [ptName(start), ptName(b)]; planRoute(start, b, names);
      document.getElementById("routePanel").scrollIntoView({ behavior: "smooth" });
    };
    MC.on("select", p => {
      if (!pendingStart) return;
      const a = pendingStart; pendingStart = null; $("pickHint").hidden = true;
      const names = [ptName(a), ptName(p)];
      $("fromIn").value = MC.APT[names[0]] ? names[0] : ""; $("toIn").value = MC.APT[names[1]] ? names[1] : "";
      planRoute(a, p.slice(), names);
    });
    MC.on("shiftSelect", (a, b) => {
      const names = [ptName(a), ptName(b)];
      $("fromIn").value = MC.APT[names[0]] ? names[0] : ""; $("toIn").value = MC.APT[names[1]] ? names[1] : "";
      planRoute(a, b, names);
    });
    MC.on("refresh", () => { if (R) planRoute(R.A, R.B, R.names); });
    const r = p.get("r");
    if (r) {
      const pts = r.split("-").map(s => MC.APT[s] ? [[MC.APT[s][3], MC.APT[s][2]], s] : (([la, lo]) => [[+lo, +la], `${la},${lo}`])(s.split(",")));
      if (pts.length === 2) { if (MC.APT[pts[0][1]]) $("fromIn").value = pts[0][1]; if (MC.APT[pts[1][1]]) $("toIn").value = pts[1][1]; planRoute(pts[0][0], pts[1][0], [pts[0][1], pts[1][1]]); }
    }
  });
  window.MCPLAN = { planRoute, getRoute: () => R };
})();
