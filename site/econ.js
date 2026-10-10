/* Economics page: 8 routes × both directions × 4 supersonic designs vs a 787-9, with forecast winds. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ROUTES = [["EGLL", "KJFK"], ["LFPG", "KJFK"], ["KJFK", "KLAX"], ["KMIA", "SBGR"], ["KJFK", "TJSJ"], ["KLAX", "PHNL"], ["EGLL", "OMDB"], ["KSFO", "RJTT"]];
  const AC_COLOR = { overture: "#2a78d6", concorde: "#eb6834", as2: "#1baf7a", nplus3: "#c98500", b789: "#7d8797", a321lr: "#a3abb8" };
  let MC, ACS, RT, focus = "overture", selRoute = 0, data = [], running = false, lastE = null;

  const E = () => ({ fuel: +$("fuelPrice").value || 1.47, vot: +$("vot").value || 85, lf: +$("lf").value || 0.8, margin: MC.S.margin });
  const sst = () => ACS.filter(a => a.supersonic);
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const mins = h => Math.round(h * 60);
  const money = x => "$" + Math.round(Math.abs(x)).toLocaleString();
  const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const pt = code => [MC.APT[code][3], MC.APT[code][2]];

  // ---------- compute ----------
  async function run() {
    if (running) return; running = true; $("econRun").disabled = true;
    const e = { ...E(), obj: "gen" }; lastE = e; data = [];
    const fields = new Map(), field = async fl => { if (!fields.has(fl)) fields.set(fl, await RT.makeField(fl, MC.S.fi)); return fields.get(fl); };
    const base = ACS.find(a => a.id === "b789"), list = sst();
    const jobs = ROUTES.length * 2 * (list.length + 1); let n = 0;
    $("econBody").hidden = false;
    for (const [ra, rb] of ROUTES) {
      const row = { ra, rb, dirs: [] };
      for (const [a, b] of [[ra, rb], [rb, ra]]) {
        const A = pt(a), B = pt(b), d = { from: a, to: b, base: RT.evalPath(await field(RT.nearestFL(base.fl)), base, [A, B], "ban", e), ac: {} };
        n++;
        for (const ac of list) {
          progress(n / jobs, `${a} to ${b}, ${ac.name}`);
          await new Promise(r => setTimeout(r, 0));
          const f = await field(RT.nearestFL(ac.fl));
          d.ac[ac.id] = { ban: RT.evalPath(f, ac, [A, B], "ban", e), gc: RT.evalPath(f, ac, [A, B], "corr", e),
                          opt: RT.bestRoute(f, ac, A, B, "gen", e, 350) };
          n++;
        }
        row.dirs.push(d);
      }
      data.push(row); renderAll();
    }
    const vt = new Date(MC.S.man.valid_times[MC.S.fi]);
    progress(1, `Computed with the forecast for ${d3.utcFormat("%a %d %b, %H:%M UTC")(vt)}, margin ${MC.S.margin.toFixed(3)}, each aircraft at its cruise altitude.`);
    running = false; $("econRun").disabled = false;
  }
  function progress(f, text) { $("pbarFill").style.width = Math.round(100 * f) + "%"; $("econProgText").textContent = text; }

  // ---------- derived numbers ----------
  const rec = (row, id) => row.dirs.map(d => ({ d, x: d.ac[id] })).filter(o => o.x);
  function stats(id) {
    const r = [];
    for (const row of data) for (const { d, x } of rec(row, id)) {
      if (!x.opt.inRange) continue;
      const dt = d.base.block - x.opt.block, ds = x.opt.perSeat - d.base.perSeat;
      r.push({ corr: x.ban.block - x.opt.block, vs787: dt, extra: ds, be: dt > 0 ? ds / dt : NaN, fuelX: x.opt.fuelPerSeat / d.base.fuelPerSeat,
               altT: x.gc.block - x.opt.block, altC: x.gc.op - x.opt.op });
    }
    return r;
  }

  // ---------- render ----------
  function renderAll() { renderChips(); renderPlain(); renderKpis(); chWorth(); chCorr(); chWind(); chCost(); chCo2(); chTornado(); renderCards(); renderAcTable(); }
  function renderChips() {
    $("acChips").innerHTML = sst().map(a => `<button role="radio" aria-checked="${a.id === focus}" class="${a.id === focus ? "on" : ""}" data-id="${a.id}"><i style="background:${AC_COLOR[a.id]}"></i>${a.name}</button>`).join("");
    $("acChips").querySelectorAll("button").forEach(b => b.onclick = () => { focus = b.dataset.id; if (data.length) renderAll(); else renderChips(); });
  }
  // the whole page in five sentences, for the focus aircraft
  function renderPlain() {
    const s = stats(focus), e = lastE || E(), ac = ACS.find(a => a.id === focus);
    if (!s.length) { $("econPlain").innerHTML = ""; return; }
    let ex = null;
    for (const row of data) for (const { d, x } of rec(row, focus)) if (!ex && d.from === "EGLL" && d.to === "KJFK" && x.opt.inRange) ex = { d, x };
    if (!ex) for (const row of data) for (const { d, x } of rec(row, focus)) if (!ex && x.opt.inRange) ex = { d, x };
    const be = med(s.map(x => x.be)), extra = med(s.map(x => x.extra)), corr = mins(med(s.map(x => x.corr))), fx = med(s.map(x => x.fuelX));
    const nm = id => (MC.APT[id] ? MC.APT[id][1] : id).replace(/ (Heathrow|JFK|CDG|Intl.*)$/, "");
    const worth = be <= e.vot;
    $("econPlain").innerHTML = `<h3>In plain words: ${ac.name.split(" (")[0]}, at today's fuel price</h3><ol>
      <li><b>It's fast.</b> ${nm(ex.d.from)} to ${nm(ex.d.to)} takes <b>${fmtT(ex.x.opt.block)}</b> instead of ${fmtT(ex.d.base.block)} on a 787, about ${fmtT(ex.d.base.block - ex.x.opt.block)} saved.</li>
      <li><b>Corridors help a bit.</b> Flying over land without a boom, instead of slowing down as today's rules require, saves about <b>${corr} more minutes</b> per flight.</li>
      <li><b>It's expensive.</b> Each seat costs about <b>${money(extra)} more</b> than a 787 seat. Put another way, you pay about <b>${money(be)} for every hour saved</b>.</li>
      <li><b>${worth ? "Worth it" : "Not worth it"} for most people.</b> It only pays off if an hour of your time is worth more than ${money(be)}. You set ${money(e.vot)}/h.</li>
      <li><b>It burns a lot more fuel.</b> About <b>${fx.toFixed(0)}× the fuel</b> per passenger of a 787, so ${fx.toFixed(0)}× the CO₂. Fuel is the main reason it's expensive.</li></ol>`;
  }
  function renderKpis() {
    const s = stats(focus), e = lastE || E(), inRange = data.reduce((n, row) => n + rec(row, focus).filter(o => o.x.opt.inRange).length, 0), total = data.length * 2;
    const be = med(s.map(x => x.be)), k = (label, value, note, cls = "") => `<div class="kpi"><div class="kl">${label}</div><div class="kv ${cls}">${value}</div><div class="kd">${note}</div></div>`;
    $("econKpis").innerHTML = [
      k("Saved by corridors", `${mins(med(s.map(x => x.corr)))} min`, "Median against today's overland ban", "pos"),
      k("Saved against a 787-9", fmtT(med(s.map(x => x.vs787))), "Median block time saved", "pos"),
      k("Extra cost per seat", money(med(s.map(x => x.extra))), "Median, at cost before margins", "neg"),
      k("Break-even value of time", `${money(be)}/h`, be <= e.vot ? `Below your ${money(e.vot)}/h: worth it` : `Above your ${money(e.vot)}/h: not worth it`, be <= e.vot ? "pos" : "neg"),
      k("Fuel per seat", `${med(s.map(x => x.fuelX)).toFixed(1)}×`, "Multiple of the 787-9", "neg"),
      k("Optimised vs direct", `${mins(med(s.map(x => x.altT)))} min`, `${money(med(s.map(x => x.altC)))} per flight saved by the alternate route`, med(s.map(x => x.altT)) > 0 ? "pos" : ""),
      k("Routes in range", `${inRange} of ${total}`, "Without a fuel stop"),
    ].join("");
  }
  const axisStyle = s => s.call(g => g.select(".domain").remove()).call(g => g.selectAll(".tick line").attr("stroke", "var(--rule)"));

  function chWorth() {
    const svg = d3.select("#chWorth"); svg.selectAll("*").remove();
    const m = { l: 56, r: 16, t: 22, b: 36 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b, e = lastE || E();
    const pts = [];
    for (const row of data) for (const ac of sst()) for (const { d, x } of rec(row, ac.id))
      pts.push({ ac, r: `${d.from}–${d.to}`, x: d.base.block - x.opt.block, y: x.opt.perSeat - d.base.perSeat, ok: x.opt.inRange });
    if (!pts.length) return;
    const x = d3.scaleLinear([0, d3.max(pts, p => p.x) * 1.08], [0, W]).nice(), y = d3.scaleLinear([0, d3.max(pts, p => p.y) * 1.08], [H, 0]).nice();
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const xm = x.domain()[1], ym = y.domain()[1];
    const xe0 = Math.min(xm, ym / e.vot);
    const below = xe0 < xm ? [[0, 0], [xe0, ym], [xm, ym], [xm, 0]] : [[0, 0], [xm, e.vot * xm], [xm, 0]];
    g.append("path").attr("d", d3.line()(below.map(([a, b]) => [x(a), y(b)])) + "Z").attr("fill", "var(--good)").attr("opacity", .08);
    g.append("rect").attr("width", W).attr("height", H).attr("fill", "var(--bad)").attr("opacity", .04).lower();
    g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d + " h")).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).ticks(6).tickSize(-W).tickFormat(d => "$" + d3.format(",")(d))).call(axisStyle);
    g.append("text").attr("x", W).attr("y", H + 30).attr("text-anchor", "end").text("Hours saved against a 787-9");
    g.append("text").attr("x", -m.l + 4).attr("y", -12).text("Extra cost per seat");
    for (const [v, lbl, dash] of [[e.vot, `your ${money(e.vot)}/h`, null], [250, "$250/h", "4 4"], [600, "$600/h", "4 4"], [1500, "$1,500/h", "4 4"]]) {
      const xe = Math.min(xm, ym / v);
      g.append("line").attr("x1", 0).attr("y1", H).attr("x2", x(xe)).attr("y2", y(v * xe)).attr("stroke", dash ? "var(--ink-3)" : "var(--good)").attr("stroke-width", dash ? 1 : 2).attr("stroke-dasharray", dash);
      g.append("text").attr("x", x(xe) - 4).attr("y", y(v * xe) + (xe === xm ? -5 : 12)).attr("text-anchor", "end").text(lbl).style("fill", dash ? "var(--ink-3)" : "var(--good)");
    }
    g.append("g").selectAll("circle").data(pts.sort((a, b) => (a.ac.id === focus) - (b.ac.id === focus))).join("circle")
      .attr("cx", p => x(p.x)).attr("cy", p => y(p.y)).attr("r", p => p.ac.id === focus ? 6 : 4.5)
      .attr("fill", p => AC_COLOR[p.ac.id]).attr("opacity", p => (p.ac.id === focus ? 1 : .35) * (p.ok ? 1 : .4))
      .attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .append("title").text(p => `${p.ac.name}, ${p.r}: ${fmtT(p.x)} saved, +${money(p.y)} per seat${p.ok ? "" : " (beyond range)"}`);
  }

  function chCorr() {
    const svg = d3.select("#chCorr"); svg.selectAll("*").remove();
    const rows = data.map(row => { const r = rec(row, focus); return { name: `${row.ra}–${row.rb}`, opt: avg(r.map(o => o.x.ban.block - o.x.opt.block)) * 60, gc: avg(r.map(o => o.x.ban.block - o.x.gc.block)) * 60 }; });
    if (!rows.length) return;
    const m = { l: 92, r: 50, t: 8, b: 28 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b;
    const y = d3.scaleBand(rows.map(r => r.name), [0, H]).padding(.28), x = d3.scaleLinear([0, Math.max(10, d3.max(rows, r => Math.max(r.opt, r.gc)))], [0, W]).nice();
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(5).tickSize(-H).tickFormat(d => d + " min")).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).call(axisStyle);
    const bh = y.bandwidth() / 2;
    g.selectAll(".gc").data(rows).join("rect").attr("x", 0).attr("y", r => y(r.name)).attr("height", bh - 1).attr("width", r => x(Math.max(0, r.gc))).attr("rx", 2).attr("fill", "var(--route-super)").attr("opacity", .55);
    g.selectAll(".op").data(rows).join("rect").attr("x", 0).attr("y", r => y(r.name) + bh).attr("height", bh - 1).attr("width", r => x(Math.max(0, r.opt))).attr("rx", 2).attr("fill", "var(--route-boomless)");
    g.selectAll(".lb").data(rows).join("text").attr("x", r => x(Math.max(0, r.opt)) + 5).attr("y", r => y(r.name) + bh * 1.75).text(r => `${Math.round(r.opt)} min`).style("fill", "var(--ink)");
    const lg = g.append("g").attr("transform", `translate(${W - 190},${H - 34})`);
    [["Direct great circle", "var(--route-super)", .55], ["Optimised route", "var(--route-boomless)", 1]].forEach(([t, c, o], i) => {
      lg.append("rect").attr("y", i * 14).attr("width", 10).attr("height", 8).attr("fill", c).attr("opacity", o); lg.append("text").attr("x", 14).attr("y", i * 14 + 8).text(t);
    });
  }

  function chWind() {
    const svg = d3.select("#chWind"); svg.selectAll("*").remove();
    const rows = data.map(row => ({ name: `${row.ra}–${row.rb}`, out: row.dirs[0], back: row.dirs[1] }));
    if (!rows.length) return;
    const m = { l: 92, r: 16, t: 22, b: 28 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b;
    const vals = rows.flatMap(r => [r.out.ac[focus].opt.block, r.back.ac[focus].opt.block, r.out.base.block, r.back.base.block]);
    const y = d3.scaleBand(rows.map(r => r.name), [0, H]).padding(.35), x = d3.scaleLinear([0, d3.max(vals)], [0, W]).nice();
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(6).tickSize(-H).tickFormat(d => d + " h")).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).call(axisStyle);
    const C1 = AC_COLOR[focus];
    rows.forEach(r => {
      const yc = y(r.name) + y.bandwidth() / 2;
      for (const [o, b, op] of [[r.out.ac[focus].opt.block, r.back.ac[focus].opt.block, 1], [r.out.base.block, r.back.base.block, .45]]) {
        g.append("line").attr("x1", x(Math.min(o, b))).attr("x2", x(Math.max(o, b))).attr("y1", yc).attr("y2", yc).attr("stroke", op < 1 ? "var(--ink-3)" : C1).attr("stroke-width", 2).attr("opacity", op);
        g.append("circle").attr("cx", x(o)).attr("cy", yc).attr("r", 4.5).attr("fill", op < 1 ? "var(--ink-3)" : C1).attr("opacity", op).append("title").text(`${r.name}: ${fmtT(o)}`);
        g.append("circle").attr("cx", x(b)).attr("cy", yc).attr("r", 4.5).attr("fill", "var(--surface)").attr("stroke", op < 1 ? "var(--ink-3)" : C1).attr("stroke-width", 2).attr("opacity", op).append("title").text(`${r.name.split("–").reverse().join("–")}: ${fmtT(b)}`);
      }
    });
    const lg = g.append("g").attr("transform", "translate(0,-14)");
    [["Listed direction", true], ["Return", false]].forEach(([t, filled], i) => {
      lg.append("circle").attr("cx", i * 120 + 5).attr("cy", 0).attr("r", 4.5).attr("fill", filled ? C1 : "var(--surface)").attr("stroke", C1).attr("stroke-width", 2);
      lg.append("text").attr("x", i * 120 + 14).attr("y", 4).text(t);
    });
    lg.append("text").attr("x", 240).attr("y", 4).text("Grey: 787-9");
  }

  function chCost() {
    const svg = d3.select("#chCost"); svg.selectAll("*").remove();
    const row = data[selRoute]; if (!row) return;
    const items = [{ id: "b789", name: "787-9", f: avg(row.dirs.map(d => d.base.fuelCost / (d.base.ac.seats * lastE.lf))), n: avg(row.dirs.map(d => d.base.nonFuel / (d.base.ac.seats * lastE.lf))) }]
      .concat(sst().map(a => ({ id: a.id, name: a.name.split(" (")[0], f: avg(row.dirs.map(d => d.ac[a.id].opt.fuelCost / (a.seats * lastE.lf))), n: avg(row.dirs.map(d => d.ac[a.id].opt.nonFuel / (a.seats * lastE.lf))), ok: row.dirs.every(d => d.ac[a.id].opt.inRange) })));
    const m = { l: 110, r: 70, t: 22, b: 28 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b;
    const y = d3.scaleBand(items.map(i => i.name), [0, H]).padding(.3), x = d3.scaleLinear([0, d3.max(items, i => i.f + i.n)], [0, W]).nice();
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.append("text").attr("x", -m.l + 4).attr("y", -8).text(`${row.ra}–${row.rb}, average of both directions`).style("fill", "var(--ink)");
    g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(5).tickSize(-H).tickFormat(d => "$" + d3.format(",")(d))).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).call(axisStyle);
    items.forEach(i => {
      const c = AC_COLOR[i.id], yy = y(i.name), bh = y.bandwidth();
      g.append("rect").attr("x", 0).attr("y", yy).attr("height", bh).attr("width", x(i.f)).attr("fill", c).attr("rx", 2).attr("opacity", i.ok === false ? .4 : 1);
      g.append("rect").attr("x", x(i.f) + 1).attr("y", yy).attr("height", bh).attr("width", Math.max(0, x(i.f + i.n) - x(i.f) - 1)).attr("fill", c).attr("opacity", i.ok === false ? .15 : .35).attr("rx", 2);
      g.append("text").attr("x", x(i.f + i.n) + 6).attr("y", yy + bh / 2 + 4).text(money(i.f + i.n) + (i.ok === false ? " (range)" : "")).style("fill", "var(--ink)");
    });
    const lg = g.append("g").attr("transform", `translate(${W - 150},${H - 30})`);
    [["Fuel", 1], ["Crew, maintenance, ownership", .35]].forEach(([t, o], k) => { lg.append("rect").attr("y", k * 14).attr("width", 10).attr("height", 8).attr("fill", "var(--ink-2)").attr("opacity", o); lg.append("text").attr("x", 14).attr("y", k * 14 + 8).text(t); });
  }

  function chCo2() {
    const svg = d3.select("#chCo2"); svg.selectAll("*").remove();
    if (!data.length) return;
    const items = sst().map(a => ({ a, v: med(stats(a.id).map(s => s.fuelX)), kg: med(data.flatMap(row => rec(row, a.id).filter(o => o.x.opt.inRange).map(o => o.x.opt.co2PerSeat))) })).filter(i => Number.isFinite(i.v));
    const baseKg = med(data.flatMap(row => row.dirs.map(d => d.base.co2PerSeat)));
    const m = { l: 110, r: 80, t: 14, b: 28 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b;
    const y = d3.scaleBand(["787-9", ...items.map(i => i.a.name.split(" (")[0])], [0, H]).padding(.35), x = d3.scaleLinear([0, Math.max(2, d3.max(items, i => i.v))], [0, W]).nice();
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(5).tickSize(-H).tickFormat(d => d + "×")).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).call(axisStyle);
    g.append("rect").attr("y", y("787-9")).attr("height", y.bandwidth()).attr("width", x(1)).attr("fill", AC_COLOR.b789).attr("rx", 2);
    g.append("text").attr("x", x(1) + 6).attr("y", y("787-9") + y.bandwidth() / 2 + 4).text(`1.0×, ${Math.round(baseKg)} kg CO₂`).style("fill", "var(--ink)");
    items.forEach(i => {
      const k = i.a.name.split(" (")[0];
      g.append("rect").attr("y", y(k)).attr("height", y.bandwidth()).attr("width", x(i.v)).attr("fill", AC_COLOR[i.a.id]).attr("rx", 2);
      g.append("text").attr("x", x(i.v) + 6).attr("y", y(k) + y.bandwidth() / 2 + 4).text(`${i.v.toFixed(1)}×, ${Math.round(i.kg)} kg`).style("fill", "var(--ink)");
    });
    g.append("line").attr("x1", x(1)).attr("x2", x(1)).attr("y1", 0).attr("y2", H).attr("stroke", "var(--ink-3)").attr("stroke-dasharray", "3 3");
  }

  function chTornado() {
    const svg = d3.select("#chTornado"); svg.selectAll("*").remove();
    const row = data[selRoute]; if (!row) return;
    const ac = ACS.find(a => a.id === focus), base = ACS.find(a => a.id === "b789"), e0 = lastE;
    const fieldCache = {};
    const be = (eo, mult = 1) => {
      const e = { ...e0, ...eo }, acM = { ...ac, nonFuelPerBH: ac.nonFuelPerBH * mult, fuelPerNm: ac.fuelPerNm, eff: ac.eff }, bM = { ...base, nonFuelPerBH: base.nonFuelPerBH * mult };
      const r = row.dirs.map(d => {
        const o = d.ac[focus].opt, f = { at: () => [MC.current, MC.current, 0] };
        const so = reEval(o, acM, e), sb = reEval(d.base, bM, e);
        return (so.perSeat - sb.perSeat) / Math.max(1e-6, sb.block - so.block);
      });
      return avg(r);
    };
    // re-cost an evaluated route with new economics (path, speeds and times unchanged; margin changes need the map)
    const reEval = (ev, a, e) => { const op = ev.fuel * e.fuel + a.nonFuelPerBH * ev.block; return { perSeat: op / (a.seats * e.lf), block: ev.block }; };
    const b0 = be({});
    const cases = [
      ["Fuel price ±50%", be({ fuel: e0.fuel * 0.5 }), be({ fuel: e0.fuel * 1.5 })],
      ["Load factor 0.95 / 0.60", be({ lf: 0.95 }), be({ lf: 0.6 })],
      ["Crew & maintenance ±30%", be({}, 0.7), be({}, 1.3)],
    ];
    const m = { l: 150, r: 24, t: 28, b: 28 }, W = 520 - m.l - m.r, H = 330 - m.t - m.b;
    const all = cases.flatMap(c => [c[1], c[2]]).concat(b0).filter(Number.isFinite);
    if (!all.length) return;
    const x = d3.scaleLinear([Math.min(0, d3.min(all)), d3.max(all) * 1.1], [0, W]).nice(), y = d3.scaleBand(cases.map(c => c[0]), [0, H * 0.7]).padding(.35);
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.append("text").attr("x", -m.l + 4).attr("y", -12).text(`${ac.name.split(" (")[0]}, ${row.ra}–${row.rb}: base ${money(b0)}/h`).style("fill", "var(--ink)");
    g.append("g").attr("transform", `translate(0,${H * 0.7})`).call(d3.axisBottom(x).ticks(5).tickSize(-H * 0.7).tickFormat(d => "$" + d3.format(",")(d) + "/h")).call(axisStyle);
    g.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(8)).call(axisStyle);
    cases.forEach(([lbl, lo, hi]) => {
      const yy = y(lbl), bh = y.bandwidth();
      for (const v of [lo, hi]) {
        const better = v < b0;
        g.append("rect").attr("x", x(Math.min(v, b0))).attr("width", Math.abs(x(v) - x(b0))).attr("y", yy).attr("height", bh).attr("rx", 2).attr("fill", better ? "var(--good)" : "var(--bad)").attr("opacity", .8);
        g.append("text").attr("x", x(v) + (better ? -4 : 4)).attr("y", yy + bh / 2 + 4).attr("text-anchor", better ? "end" : "start").text(money(v)).style("fill", "var(--ink)");
      }
    });
    g.append("line").attr("x1", x(b0)).attr("x2", x(b0)).attr("y1", -4).attr("y2", H * 0.7).attr("stroke", "var(--ink)");
    g.append("text").attr("x", 0).attr("y", H * 0.7 + 44).text("Green lowers the break-even (better for supersonic); red raises it.").style("fill", "var(--ink-3)");
  }

  function renderCards() {
    const land = MC.landGeo;
    $("routeCards").innerHTML = "";
    data.forEach((row, i) => {
      const d = row.dirs[0], x = d.ac[focus], back = row.dirs[1].ac[focus];
      const card = document.createElement("div"); card.className = "rcard" + (i === selRoute ? " on" : ""); card.tabIndex = 0;
      const W = 300, H = 130;
      const A0 = x.gc.path[0], B0 = x.gc.path[1], mid = d3.geoInterpolate(A0, B0)(0.5);
      const feat = { type: "MultiPoint", coordinates: [...x.opt.path, ...x.gc.path] };
      const proj = d3.geoMercator().rotate([-mid[0], 0]).fitExtent([[14, 14], [W - 14, H - 14]], feat), path = d3.geoPath(proj);
      const col = { boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub") };
      const segs = x.opt.segs.map(s => `<path d="${path({ type: "LineString", coordinates: [s.p, s.q] })}" stroke="${col[s.type]}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`).join("");
      const ends = [x.opt.path[0], x.opt.path[x.opt.path.length - 1]].map(p => { const [cx, cy] = proj(p); return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff"/>`; }).join("");
      const corr = ((x.ban.block - x.opt.block) + (back.ban.block - back.opt.block)) / 2;
      card.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><path d="${path(land)}" fill="#14254a" stroke="rgba(226,235,252,.35)" stroke-width=".6"/>
          <path d="${path({ type: "LineString", coordinates: x.gc.path })}" stroke="rgba(226,235,252,.6)" stroke-dasharray="4 4" fill="none"/>${segs}${ends}</svg>
        <div class="rb"><div class="rt"><b>${row.ra} – ${row.rb}</b><span>${Math.round(d.base.dist).toLocaleString()} nm${x.opt.inRange ? "" : ", beyond range"}</span></div>
          <div class="rn"><div><b>${fmtT(avg([d.base.block, row.dirs[1].base.block]))}</b>787-9</div>
          <div><b>${fmtT(avg([x.opt.block, back.opt.block]))}</b>${ACS.find(a => a.id === focus).name.split(" (")[0]}</div>
          <div><b class="${corr > 0 ? "pos" : ""}">${Math.round(corr * 60)} min</b>from corridors</div></div>
          <button class="open">Open on the map</button></div>`;
      card.onclick = ev => {
        if (ev.target.classList.contains("open")) { openOnMap(row); return; }
        selRoute = i; renderCards(); chCost(); chTornado();
      };
      $("routeCards").appendChild(card);
    });
  }
  function openOnMap(row) {
    MC.setTab("map"); $("fromIn").value = row.ra; $("toIn").value = row.rb; $("acSel").value = focus;
    window.MCPLAN.planRoute(pt(row.ra), pt(row.rb), [row.ra, row.rb]);
  }
  function renderAcTable() {
    $("acTable").innerHTML = `<tr><th>Aircraft</th><th>Seats</th><th>Design Mach</th><th>Range</th><th>Fuel kg/nm at M0.95, 1.15, design</th><th>Non-fuel $/h</th><th>Notes</th></tr>` +
      ACS.map(a => `<tr><td><span class="sw" style="background:${AC_COLOR[a.id]};height:8px;width:8px;border-radius:50%"></span>${a.name}</td><td>${a.seats}</td><td>${a.design}</td><td>${a.rangeNm.toLocaleString()} nm</td>
        <td>${a.supersonic ? [0.95, 1.15, a.design].map(m => a.fuelPerNm(m).toFixed(1)).join(", ") : a.fuelPerNm(a.design).toFixed(1)}</td>
        <td>${a.nonFuelPerBH.toLocaleString()}</td><td class="wrap">${a.note}</td></tr>`).join("");
  }

  window.addEventListener("mc-ready", () => {
    MC = window.MC; ACS = window.AIRCRAFT; RT = window.ROUTE;
    renderChips(); renderAcTable();
    $("econRun").onclick = run;
    // run once by itself the first time the tab is opened, so the answer is there without a click
    new MutationObserver(() => { if (!$("tab-econ").hidden && !data.length && !running) run(); }).observe($("tab-econ"), { attributes: true, attributeFilter: ["hidden"] });
  });
})();
