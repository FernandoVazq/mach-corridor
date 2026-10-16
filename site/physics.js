/* Physics tab: factor trade study, day-to-day drivers, altitude, forecast error (site/geo/physics.json, built by
   engine/sensitivity.py, engine/aircraft_study.py, study/validation_eval.py) and the aircraft builder. */
(() => {
  const $ = id => document.getElementById(id);
  let P = null, MC = null, drawn = false;
  const st = { fl: 550, src: "balloon" };
  const KT_PER_M = 575;                       // knots of ground speed per 1.0 Mach at cruise (c ~ 296 m/s)
  const f3 = d3.format("+.3f"), f2 = d3.format(".2f");
  const study = () => P.studies.find(s => s.fl === st.fl && (st.src === "balloon" ? s.source.startsWith("Balloon") : !s.source.startsWith("Balloon")))
    || P.studies.find(s => s.fl === st.fl);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- custom aircraft ----------
  function effOf(E) {
    return M => {
      if (M <= E[0][0]) return E[0][1];
      for (let i = 1; i < E.length; i++) if (M <= E[i][0]) { const [m0, e0] = E[i - 1], [m1, e1] = E[i]; return e0 + (e1 - e0) * (M - m0) / (m1 - m0); }
      return E[E.length - 1][1];
    };
  }
  function makeCustom(p) {
    const base = window.AIRCRAFT.find(a => a.id === "overture"), E = base.E, eff = effOf(E);
    const k = p.fuel * eff(p.M);
    return {
      id: "custom", name: `Your aircraft (${p.W} t, ${p.L} m, M${p.M})`, seats: p.seats, design: p.M, sub: 0.95, supersonic: true,
      fl: p.FL, rangeNm: p.R, nonFuelPerBH: p.NF, mtow: p.W / 0.85, climbFuel: 0.03 * (p.W / 0.85) * 1000,
      boom: { length: p.L, ks: BOOM.shapeFactor(p.W, p.L, Math.max(p.M, 1.2), p.FL) }, E, k, eff, fuelPerNm: M => k / eff(M),
      note: "User-defined: fuel curve shaped like Overture's, anchored at your fuel burn at design Mach (L)", params: p,
    };
  }
  const packP = p => [p.W, p.L, p.FL, p.M, p.seats, p.fuel, p.NF, p.R].join("_");
  const unpackP = s => { const v = s.split("_").map(Number); if (v.length !== 8 || v.some(x => !isFinite(x))) return null;
    return { W: v[0], L: v[1], FL: v[2], M: v[3], seats: v[4], fuel: v[5], NF: v[6], R: v[7] }; };
  function installCustom(p, select) {
    const A = window.AIRCRAFT, c = makeCustom(p), i = A.findIndex(a => a.id === "custom");
    if (i >= 0) A[i] = c; else A.push(c);
    const sel = $("acSel");
    if (sel) {
      let o = [...sel.options].find(o => o.value === "custom");
      if (!o) { o = document.createElement("option"); o.value = "custom"; sel.appendChild(o); }
      o.textContent = c.name;
      if (select) { sel.value = "custom"; sel.dispatchEvent(new Event("change")); }
    }
    if (MC) { MC.hashExtra.cust = packP(p); MC.writeHash(); }
    return c;
  }
  const PRESETS = () => {
    const fromType = a => ({ name: a.name, W: Math.round(0.85 * a.mtow), L: a.boom.length, FL: a.fl, M: a.design, seats: a.seats,
      fuel: +a.fuelPerNm(a.design).toFixed(1), NF: a.nonFuelPerBH, R: a.rangeNm });
    const list = window.AIRCRAFT.filter(a => a.supersonic && a.boom && a.id !== "custom").map(fromType);
    list.push({ name: "Hypothetical 40 m bizliner", W: 45, L: 40, FL: 510, M: 1.6, seats: 20, fuel: 7.5, NF: 5000, R: 4500 });
    list.push({ name: "Demonstrator, XB-1 size", W: 6, L: 18.9, FL: 360, M: 1.3, seats: 1, fuel: 2, NF: 2000, R: 800 });
    return list;
  };
  const readForm = () => ({ W: +$("abW").value, L: +$("abL").value, FL: +$("abFL").value, M: +$("abM").value, seats: +$("abSeats").value,
    fuel: +$("abFuel").value, NF: +$("abNF").value, R: +$("abR").value });
  function writeForm(p) { $("abW").value = p.W; $("abL").value = p.L; $("abFL").value = p.FL; $("abM").value = p.M; $("abSeats").value = p.seats;
    $("abFuel").value = p.fuel; $("abNF").value = p.NF; $("abR").value = p.R; }

  // median boomless Mach at a level, from the balloon year
  function boomlessAt(fl) {
    const a = P.altitude.filter(r => r.source.startsWith("Balloon")).sort((x, y) => x.fl - y.fl);
    const r = a.length ? a : P.altitude.sort((x, y) => x.fl - y.fl);
    const xs = r.map(d => d.fl), ys = r.map(d => d.any_median);
    if (fl <= xs[0]) return ys[0]; if (fl >= xs[xs.length - 1]) return ys[ys.length - 1];
    const i = xs.findIndex(x => x >= fl); return ys[i - 1] + (ys[i] - ys[i - 1]) * (fl - xs[i - 1]) / (xs[i] - xs[i - 1]);
  }

  function renderBuilder() {
    const p = readForm();
    if (!(p.W > 0 && p.L > 0 && p.M > 1 && p.FL >= 300)) return;
    const c = makeCustom(p), isa = BOOM.isa(p.FL * 100 * 0.3048);
    const psfD = BOOM.psf(c, p.M, p.FL), psfC = BOOM.psf(c, 1.15, p.FL);
    const hS = BOOM.quietHeight(c, p.FL), pen = BOOM.bufferPenalty(c, p.FL), Mb = boomlessAt(p.FL) + pen;
    const gs = Mb * isa.a * 1.943844, fr = c.fuelPerNm(Mb) / c.fuelPerNm(p.M);
    const k = (v, l, d, cls = "") => `<div class="kpi"><div class="kl">${l}</div><div class="kv ${cls}">${v}</div><div class="kd">${d}</div></div>`;
    $("abKpis").innerHTML = [
      k(`${f2(psfD)} psf`, `Boom at M${p.M}`, `${Math.round(psfD / BOOM.LIMIT)}× the 0.11 psf limit`, psfD > BOOM.LIMIT ? "neg" : "pos"),
      k(`M${Mb.toFixed(3)}`, `Boomless over land, FL${p.FL}`, `median day, any direction`),
      k(`${Math.round(gs)} kt`, "Speed over land, no wind", `${(gs / 488).toFixed(2)}× a 787 (488 kt)`),
      k(`${Math.round(hS)} m`, "Cushion for ≤ 0.11 psf", pen < 0 ? `${(pen).toFixed(3)} Mach vs the map's 1 km` : "1 km covers it"),
      k(`${f2(psfC)} psf`, "If the cutoff fails at M1.15", "why the margin matters", "neg"),
      k(`${fr.toFixed(2)}×`, "Fuel per nm, boomless vs design", "slow supersonic is inefficient"),
    ].join("");
    $("abNote").textContent = `Shape factor ${c.boom.ks.toFixed(3)} from weight and length (lift-dominated, ±15%). Shaped low-boom designs like the X-59 are quieter than this method can show.`;
    drawPsf(c, p); drawBuf(c, p);
  }

  // ---------- charts ----------
  function axisStyle(g) { g.select(".domain").attr("stroke", "var(--rule)"); g.selectAll("text").style("font-size", "11px").style("fill", "var(--ink-3)"); g.selectAll("line").attr("stroke", "var(--rule)"); }

  function drawTornado() {
    const s = study(), F = { ...s.factors };
    const v = P.validation, vf = v && (v["FL" + st.fl] || v.all);
    if (vf && vf.f24_1p00) F.forecast = { label: "Day-ahead forecast error (1σ)", median: vf.f24_1p00.rmse, p10: -vf.f24_1p00.rmse, p90: vf.f24_1p00.rmse, sym: true };
    F.horizontal = { label: "Change over ~200 km (typical)", median: P.horizontal.per_2deg_median, p10: -P.horizontal.per_2deg_p90, p90: P.horizontal.per_2deg_p90, sym: true };
    const rows = Object.values(F).filter(r => r.label).sort((a, b) => Math.abs(b.median) - Math.abs(a.median));
    const svg = d3.select("#phTornado"); svg.selectAll("*").remove();
    const W = 520, m = { l: 218, r: 104, t: 10, b: 26 }, rh = 24, H = m.t + rows.length * rh + m.b;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    const ext = d3.max(rows, r => Math.max(Math.abs(r.p10), Math.abs(r.p90), Math.abs(r.median))) * 1.05;
    const x = d3.scaleLinear([-ext, ext], [m.l, W - m.r]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("+.2f"))).call(axisStyle);
    svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", H - m.b);
    const g = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (d, i) => `translate(0,${m.t + i * rh})`);
    g.append("text").attr("class", "tlabel").attr("x", m.l - 8).attr("y", rh / 2 + 4).attr("text-anchor", "end").text(d => d.label);
    g.append("line").attr("class", "twhisk").attr("x1", d => x(d.p10)).attr("x2", d => x(d.p90)).attr("y1", rh / 2).attr("y2", rh / 2);
    g.filter(d => !d.sym).append("rect").attr("class", d => "tbar" + (d.median < 0 ? " neg" : "")).attr("rx", 3)
      .attr("x", d => Math.min(x(0), x(d.median))).attr("width", d => Math.max(1.5, Math.abs(x(d.median) - x(0)))).attr("y", rh / 2 - 6).attr("height", 12);
    g.filter(d => d.sym).append("rect").attr("rx", 3).attr("fill", "var(--ink-3)").attr("opacity", .35)
      .attr("x", d => x(-d.median)).attr("width", d => x(d.median) - x(-d.median)).attr("y", rh / 2 - 6).attr("height", 12);
    g.append("text").attr("class", "tval").attr("x", W - m.r + 6).attr("y", rh / 2 + 4)
      .text(d => d.sym ? `±${d.median.toFixed(3)}` : Math.abs(d.median) < 0.0005 ? "≈ 0" : `${f3(d.median)} · ${d3.format("+d")(Math.round(d.median * KT_PER_M))} kt`);
    g.append("title").text(d => `${d.label}: typical ${d.sym ? "±" + d.median.toFixed(4) : f3(d.median)} Mach; 80% of cases between ${d.p10.toFixed(4)} and ${d.p90.toFixed(4)}`);
  }

  function drawImp() {
    const s = study(), I = s.importance; if (!I) return;
    const rows = I.drivers.filter(d => d.name !== "Terrain height").map(d => ({ ...d, v: d.mach_per_sd })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const svg = d3.select("#chImp"); svg.selectAll("*").remove();
    const W = 520, m = { l: 218, r: 104, t: 8, b: 26 }, rh = 30, H = m.t + rows.length * rh + m.b;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    const ext = d3.max(rows, r => Math.abs(r.v)) * 1.1, x = d3.scaleLinear([-ext, ext], [m.l, W - m.r]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("+.2f"))).call(axisStyle);
    svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", H - m.b);
    const g = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (d, i) => `translate(0,${m.t + i * rh})`);
    g.append("text").attr("class", "tlabel").attr("x", m.l - 8).attr("y", rh / 2).attr("text-anchor", "end").text(d => d.name);
    g.append("text").attr("class", "tval").attr("x", m.l - 8).attr("y", rh / 2 + 13).attr("text-anchor", "end").text(d => `normal swing ±${d.natural_sd} ${d.unit}`);
    g.append("rect").attr("class", d => "tbar" + (d.v < 0 ? " neg" : "")).attr("rx", 3).attr("x", d => Math.min(x(0), x(d.v))).attr("width", d => Math.abs(x(d.v) - x(0))).attr("y", rh / 2 - 6).attr("height", 12);
    g.append("text").attr("class", "tval").attr("x", W - m.r + 6).attr("y", rh / 2 + 4).text(d => `${f3(d.v)} · ${d3.format("+d")(Math.round(d.v * KT_PER_M))} kt`);
    g.append("title").text(d => `${d.name}: one normal swing (±${d.natural_sd} ${d.unit}) moves the limit ${f3(d.v)} Mach`);
    $("impNote").textContent = `These drivers explain ${Math.round(100 * I.r2)}% of the day-to-day variation (±${I.y_sd.toFixed(3)} Mach) at FL${st.fl}. Terrain is fixed for a place, so it is not a day-to-day driver.`;
  }

  function drawAlt() {
    const svg = d3.select("#chAlt"); svg.selectAll("*").remove();
    const W = 520, H = 300, m = { l: 44, r: 16, t: 14, b: 30 };
    const srcs = [["balloon", "Balloons, 6 US stations", "var(--accent)"], ["gfs", "Global forecast, all land", "var(--warn)"]];
    const data = srcs.map(([k, n, c]) => ({ k, n, c, r: P.altitude.filter(r => (k === "balloon") === r.source.startsWith("Balloon")).sort((a, b) => a.fl - b.fl) })).filter(d => d.r.length);
    const x = d3.scaleLinear([300, 600], [m.l, W - m.r]);
    const y = d3.scaleLinear([d3.min(data, d => d3.min(d.r, r => r.any_p10)) - 0.01, d3.max(data, d => d3.max(d.r, r => r.any_p90)) + 0.01], [H - m.b, m.t]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => "FL" + d)).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".2f"))).call(axisStyle);
    svg.append("line").attr("class", "lim").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1.10)).attr("y2", y(1.10));
    svg.append("text").attr("x", W - m.r).attr("y", y(1.10) - 5).attr("text-anchor", "end").style("font-size", "11px").style("fill", "var(--ink-2)").text("usable: M1.05 + 0.05 margin");
    for (const d of data) {
      svg.append("path").datum(d.r).attr("class", "band").attr("fill", d.c).attr("d", d3.area().x(r => x(r.fl)).y0(r => y(r.any_p10)).y1(r => y(r.any_p90)));
      svg.append("path").datum(d.r).attr("fill", "none").attr("stroke", d.c).attr("stroke-width", 2).attr("d", d3.line().x(r => x(r.fl)).y(r => y(r.any_median)));
      svg.append("g").selectAll("circle").data(d.r).join("circle").attr("cx", r => x(r.fl)).attr("cy", r => y(r.any_median)).attr("r", 6).attr("fill", "transparent")
        .append("title").text(r => `${d.n}, FL${r.fl}: median M${r.any_median.toFixed(3)}, usable ${r.usable_pct}% of the time`);
    }
    const lg = svg.append("g").attr("transform", `translate(${m.l + 8},${m.t + 4})`);
    data.forEach((d, i) => { const g = lg.append("g").attr("transform", `translate(0,${i * 16})`); g.append("rect").attr("width", 14).attr("height", 3).attr("y", 4).attr("rx", 1.5).attr("fill", d.c); g.append("text").attr("x", 20).attr("y", 9).style("font-size", "11.5px").style("fill", "var(--ink-2)").text(d.n); });
  }

  function drawVal() {
    const svg = d3.select("#chVal"); svg.selectAll("*").remove();
    const v = P.validation; if (!v) { svg.append("text").attr("x", 10).attr("y", 20).text("Validation run pending").style("fill", "var(--ink-3)"); return; }
    const W = 520, H = 300, m = { l: 44, r: 16, t: 34, b: 30 };
    const keys = [["ana_1p00", "Analysis, 1°", "var(--ink-3)"], ["f24_1p00", "Day ahead, 1°", "var(--accent)"], ["f24_0p25", "Day ahead, 0.25°", "var(--warn)"]];
    const fls = ["FL350", "FL450", "FL550"].filter(f => v[f]);
    const x0 = d3.scaleBand(fls, [m.l + 100, W - m.r]).padding(0.22), x1 = d3.scaleBand(keys.map(k => k[0]), [0, x0.bandwidth()]).padding(0.12);
    const y = d3.scaleLinear([0, 0.018], [H - m.b, m.t]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x0)).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".3f"))).call(axisStyle);
    svg.append("line").attr("class", "lim").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0.010)).attr("y2", y(0.010));
    svg.append("text").attr("x", m.l + 4).attr("y", y(0.010) - 5).style("font-size", "11px").style("fill", "var(--ink-2)").text("Phase 1 gate 0.010");
    const g = svg.append("g").selectAll("g").data(fls).join("g").attr("transform", f => `translate(${x0(f)},0)`);
    g.selectAll("rect").data(f => keys.map(k => ({ f, k: k[0], n: k[1], c: k[2], e: v[f][k[0]] })).filter(d => d.e)).join("rect")
      .attr("x", d => x1(d.k)).attr("width", x1.bandwidth()).attr("y", d => y(d.e.rmse)).attr("height", d => y(0) - y(d.e.rmse)).attr("rx", 3).attr("fill", d => d.c)
      .append("title").text(d => `${d.f}, ${d.n}: RMS error ${d.e.rmse.toFixed(4)} Mach (bias ${d.e.bias >= 0 ? "+" : ""}${d.e.bias.toFixed(4)}), ${d.e.n.toLocaleString()} values`);
    const lg = svg.append("g").attr("transform", `translate(${m.l},12)`);
    keys.forEach((k, i) => { const gg = lg.append("g").attr("transform", `translate(${i * 150},0)`); gg.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", k[2]); gg.append("text").attr("x", 15).attr("y", 9).style("font-size", "11.5px").style("fill", "var(--ink-2)").text(k[1]); });
  }

  function drawPsf(c, p) {
    const svg = d3.select("#chPsf"); svg.selectAll("*").remove();
    const W = 520, H = 300, m = { l: 44, r: 16, t: 14, b: 30 };
    const Ms = d3.range(1.05, Math.max(2.05, p.M + 0.15), 0.025), pts = Ms.map(M => ({ M, v: BOOM.psf(c, M, p.FL) }));
    const x = d3.scaleLinear(d3.extent(Ms), [m.l, W - m.r]), y = d3.scaleLinear([0, d3.max(pts, d => d.v) * 1.1], [H - m.b, m.t]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => "M" + d.toFixed(1))).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1f"))).call(axisStyle);
    svg.append("line").attr("class", "lim").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(BOOM.LIMIT)).attr("y2", y(BOOM.LIMIT));
    svg.append("path").datum(pts).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("d", d3.line().x(d => x(d.M)).y(d => y(d.v)));
    const Mb = boomlessAt(p.FL);
    svg.append("rect").attr("x", m.l).attr("width", Math.max(0, x(Mb) - m.l)).attr("y", m.t).attr("height", H - m.b - m.t).attr("fill", "var(--good)").attr("opacity", .08);
    svg.append("text").attr("x", m.l + 6).attr("y", m.t + 12).style("font-size", "11px").style("fill", "var(--ink-2)").text(`below M${Mb.toFixed(2)}: boom turns before the ground on a median day`);
    svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", d => x(d.M)).attr("cy", d => y(d.v)).attr("r", 5).attr("fill", "transparent")
      .append("title").text(d => `M${d.M.toFixed(2)}: ${d.v.toFixed(2)} psf if it reaches the ground`);
  }

  function drawBuf(c, p) {
    const svg = d3.select("#chBuf"); svg.selectAll("*").remove();
    const W = 520, H = 300, m = { l: 48, r: 16, t: 14, b: 30 }, r = P.aircraft.buffer_by_length;
    const x = d3.scaleLinear([0, 120], [m.l, W - m.r]), y = d3.scaleLinear([0, 2100], [H - m.b, m.t]);
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d + " m")).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d => d3.format(",")(d) + " m")).call(axisStyle);
    svg.append("line").attr("class", "lim").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1000)).attr("y2", y(1000));
    svg.append("text").attr("x", W - m.r).attr("y", y(1000) - 5).attr("text-anchor", "end").style("font-size", "11px").style("fill", "var(--ink-2)").text("map: 1 km");
    svg.append("path").datum(r).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 2).attr("d", d3.line().x(d => x(d.length_m)).y(d => y(d.quiet_height_m ?? d.safe_height_m)));
    const h = BOOM.quietHeight(c, p.FL);
    svg.append("circle").attr("cx", x(Math.min(120, p.L))).attr("cy", y(Math.min(2100, h))).attr("r", 6).attr("fill", "var(--accent)").attr("stroke", "var(--surface)").attr("stroke-width", 2)
      .append("title").text(`Your aircraft: ${Math.round(h)} m`);
    svg.append("text").attr("x", x(Math.min(120, p.L)) + 9).attr("y", y(Math.min(2100, h)) + 4).style("font-size", "11.5px").style("fill", "var(--ink)").text("your aircraft");
    svg.append("text").attr("x", m.l + 6).attr("y", m.t + 12).style("font-size", "11px").style("fill", "var(--ink-3)").text("grey: aircraft of airliner-like weight for their length");
  }

  function insights() {
    const s550 = P.studies.find(s => s.fl === 550 && s.source.startsWith("Balloon")) || P.studies.find(s => s.fl === 550);
    const s350 = P.studies.find(s => s.fl === 350 && s.source.startsWith("Balloon")) || P.studies.find(s => s.fl === 350);
    const F = s550.factors, imp = s550.importance.drivers;
    const jet = imp.find(d => d.name.includes("wind at cruise")), a35 = boomlessAt(350), a55 = boomlessAt(550);
    const v = P.validation;
    const t = P.aircraft.types, ov = t.find(x => x.name.includes("Overture")), xb = t.find(x => x.name.includes("XB-1"));
    const L = [
      `<b>The rule of thumb.</b> The boom stays up when sound near the ground travels faster than the aircraft moves over it. Warm air low, cold air high, and wind that helps you up high but not down low all push the limit up.`,
      `<b>Wind matters more than temperature.</b> A 10 kt tailwind at cruise lowers the limit by ${Math.abs(F.wind_cruise.median).toFixed(3)} Mach; the same tailwind near the ground raises it by ${F.wind_low.median.toFixed(3)}. Wind that blows the same at every height changes nothing: only the difference counts.`,
      `<b>The jet stream decides most days.</b> A normal day-to-day swing of the wind at cruise (±${jet.natural_sd} kt) moves the limit by ±${Math.abs(jet.mach_per_sd).toFixed(3)} Mach at FL550 and ±${Math.abs(s350.importance.drivers.find(d => d.name.includes("wind at cruise")).mach_per_sd).toFixed(3)} at FL350, more than any temperature swing.`,
      `<b>Altitude is the lever, up to the stratosphere.</b> The median limit rises from M${a35.toFixed(3)} at FL350 to M${a55.toFixed(3)} at FL550. Above about FL550 it barely moves.`,
      `<b>Direction matters as much as the weather.</b> In the same air, the best and worst direction differ by ${s550.heading_spread.median.toFixed(3)} Mach on a median day (${s350.heading_spread.median.toFixed(3)} at FL350).`,
      `<b>Descending costs speed.</b> A 3° descent lowers the limit by ${Math.abs(F.descent.median).toFixed(3)} Mach and a 3° climb raises it by ${F.climb.median.toFixed(3)}, which is why descents are flown subsonic.`,
      `<b>Every 500 m of terrain or cushion costs about ${Math.abs(F.terrain.median).toFixed(3)} Mach</b> (up to ${Math.abs(F.terrain.p10).toFixed(3)} where the air is calm).`,
      `<b>The airplane barely changes the limit, but it decides how loud it is.</b> Only its altitude and the length of its boom enter: a ${ov.length_m} m airliner needs its turning point ${(ov.quiet_height_m / 1000).toFixed(1)} km above the ground to stay under 0.11 psf (${ov.mach_vs_1km_buffer.toFixed(3)} Mach), a ${xb.length_m} m demonstrator ${(xb.quiet_height_m / 1000).toFixed(1)} km. If the boom does land, an Overture-class aircraft puts ${ov.psf_design} psf on the ground, ${Math.round(ov.psf_design / 0.11)}× the limit.`,
    ];
    if (v && v.all) L.push(`<b>Forecast skill.</b> Against a year of balloons, the day-ahead forecast misses by ±${v.all.f24_1p00.rmse.toFixed(4)} Mach (1σ) and the analysis by ±${v.all.ana_1p00.rmse.toFixed(4)}. Finer 0.25° data does not help (±${v.all.f24_0p25.rmse.toFixed(4)}): the error is in the weather, not the grid.`);
    $("physPlain").innerHTML = `<h3>In plain words</h3><ol>${L.map(x => `<li>${x}</li>`).join("")}</ol>`;
  }

  function seg(el, items, get, set) {
    el.innerHTML = items.map(([v, l]) => `<button role="radio" data-v="${v}">${l}</button>`).join("");
    const mark = () => el.querySelectorAll("button").forEach(b => { const on = b.dataset.v === String(get()); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    el.querySelectorAll("button").forEach(b => b.onclick = () => { set(isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v); mark(); });
    el.onkeydown = e => { const bs = [...el.querySelectorAll("button")], i = bs.indexOf(document.activeElement), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (i < 0 || !d) return; const n = bs[(i + d + bs.length) % bs.length]; n.click(); n.focus(); e.preventDefault(); };
    mark();
  }
  const redraw = () => { drawTornado(); drawImp(); };

  // ---------- climatology for network planners (study/climatology.py -> geo/clim.png, clim.json) ----------
  const cl = { fl: 550, season: "Year", meta: null, bytes: null, land: null };
  const clColor = v => d3.interpolateYlGnBu(0.08 + 0.92 * v);
  async function loadClim() {
    if (cl.meta) return;
    const [meta, img, topo] = await Promise.all([
      fetch("geo/clim.json").then(r => r.json()),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "geo/clim.png"; }),
      fetch("vendor/countries-50m.json").then(r => r.json())]);
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data, b = new Uint8Array(img.width * img.height);
    for (let i = 0; i < b.length; i++) b[i] = d[4 * i];
    Object.assign(cl, { meta, bytes: b, W: img.width, land: topojson.mesh(topo, topo.objects.countries, (x, y) => x === y) });
  }
  function drawClim() {
    if (!cl.meta) return;
    const m = cl.meta, [tw, th] = m.tile, r = m.fls.indexOf(cl.fl), c = m.periods.indexOf(cl.season);
    const cv = $("clMap"), W = cv.width, H = cv.height, g = cv.getContext("2d");
    const lat0 = 78, lat1 = -60, proj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2 + (lat0 + lat1) / 2 / 360 * W]);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const ll = proj.invert([W / 2, y]); const lat = ll[1]; const j = Math.round(90 - lat);
      if (j < 0 || j >= th) continue;
      for (let x = 0; x < W; x++) {
        const lon = proj.invert([x, y])[0], i = ((Math.round(lon + 180) % 360) + 360) % 360;
        const v = cl.bytes[(r * th + j) * cl.W + c * tw + i]; if (v === 255) continue;
        const col = d3.rgb(clColor(v / 250)), o = 4 * (y * W + x);
        img.data[o] = col.r; img.data[o + 1] = col.g; img.data[o + 2] = col.b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.beginPath(); d3.geoPath(proj, g)(cl.land);
    g.strokeStyle = "rgba(10,18,30,.55)"; g.lineWidth = 2; g.stroke();             // halo, then a light line: reads on every shade
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 0.7; g.stroke();
    const n = m.dates_per_period[cl.season];
    $("clTitle").textContent = `Chance that a given heading has a corridor of at least M1.10, FL${cl.fl}, ${cl.season === "Year" ? "all year" : cl.season}`;
    $("clSub").textContent = `Share of days × 36 directions with boomless Mach ≥ 1.15 at the floor (≥ M1.10 after a 0.05 margin). ${n} weekly 00 UTC GFS analyses, Oct 2025 – Oct 2026. Over open sea design Mach is allowed anyway.`;
    $("clMap").setAttribute("aria-label", `${$("clTitle").textContent}. Values by region are in the table below.`);
    $("clRamp").style.background = `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map(clColor).join(",")})`;
    const regs = Object.keys(m.regions), per = m.periods, fk = `FL${cl.fl}`;
    $("clTable").innerHTML = `<tr><th>Region (land, FL${cl.fl})</th>${per.map(p => `<th class="${p === cl.season ? "cur" : ""}">${p === "Year" ? "All year" : p}</th>`).join("")}</tr>` +
      regs.map(rg => `<tr><td>${rg}</td>${per.map(p => `<td class="${p === cl.season ? "cur" : ""}">${Math.round(100 * m.regions[rg][fk][p])}%</td>`).join("")}</tr>`).join("") +
      `<tr><td>All land</td>${per.map(p => `<td class="${p === cl.season ? "cur" : ""}">${Math.round(100 * m.all_land[fk][p])}%</td>`).join("")}</tr>`;
  }

  // ---------- month by month, five years (study/variability_eval.py -> geo/seasonal.json) ----------
  let SE = null;
  async function drawSeasonal() {
    if (!SE) SE = await fetch("geo/seasonal.json").then(r => r.json());
    const fk = `FL${cl.fl}`, mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const regs = Object.keys(SE.months);
    // text colour with the better WCAG contrast against the cell (relative luminance, both themes use these fills)
    const relL = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const DARK = d3.rgb("#0b1220"), LD = relL(DARK);
    const cell = v => {
      let c = d3.rgb(clColor(v)); const L = relL(c), white = 1.05 / (L + 0.05) >= (L + 0.05) / (LD + 0.05);
      // mid tones reach neither text colour at 4.5:1: nudge the fill (darker under white text, lighter under dark text)
      for (let i = 0; i < 20; i++) {
        const Lc = relL(c), ratio = white ? 1.05 / (Lc + 0.05) : (Lc + 0.05) / (LD + 0.05);
        if (ratio >= 4.6) break;
        c = white ? c.darker(0.1) : c.brighter(0.1);
      }
      return `<td style="background:${c.formatHex()};color:${white ? "#fff" : "#0b1220"}">${Math.round(100 * v)}</td>`;
    };
    $("seTable").innerHTML = `<tr><th>Region (land, ${fk}), %</th>${mon.map(m => `<th>${m}</th>`).join("")}</tr>` +
      regs.map(r => `<tr><td>${r}</td>${SE.months[r][fk].map(cell).join("")}</tr>`).join("");
    const us = SE.annual_fl550["Contiguous US"], yrs = Object.keys(us);
    $("seSub").textContent = `Share of time every direction has a corridor of at least M1.10 (${SE.analyses.toLocaleString()} GFS analyses, Apr 2021 – Sep 2026)`;
    $("seNote").innerHTML = `The year-to-year change is small (contiguous US at FL550: ${yrs.map(y => `${y} ${Math.round(100 * us[y])}%`).join(", ")}); ` +
      `the hour of day barely matters (median swing ${SE.diurnal_amplitude_median.toFixed(4)} Mach); the weather of the day matters most, and a corridor "forgets" ` +
      `within about three days (autocorrelation ${SE.autocorrelation["72h"]["All land"]} at 72 h). <b>El Niño:</b> in these five years, US months that came about three months after El Niño conditions had fewer corridors, ` +
      `about ${Math.abs(Math.round(1000 * SE.enso.slope_us_per_oni) / 10)} points less per unit of the ENSO index. The index is now ${SE.enso.oni_latest.replace(" (NOAA CPC)", "")}, a strong El Niño, so this winter may run a few points below the table; five years is too short to be sure (Method §6.6).`;
  }

  // live: the current run's land statistics at every level, FL300-FL1000 (FL700+ an estimate, GFS only), against
  // the calm standard atmosphere (c 1 km above sea level over c at cruise): the stratosphere warms above 20 km, so a
  // calm sky gives less boomless Mach up there; real winds and the cold tropical tropopause move it
  function drawLiveAlt() {
    const MC = window.MC, man = MC && MC.S.man; if (!man) return;
    const fi = MC.S.fi, rows = man.flight_levels.map(fl => ({ fl, s: man.stats[String(fl)]?.[fi] })).filter(r => r.s);
    if (!rows.length) return;
    const svg = d3.select("#chLiveAlt"); svg.selectAll("*").remove();
    const W = 1060, H = 300, m = { l: 48, r: 18, t: 16, b: 32 }, hiFl = MC.HI_FL || 600;
    const isaT = h => h < 11000 ? 288.15 - 0.0065 * h : h < 20000 ? 216.65 : 216.65 + 0.001 * (h - 20000), cS = T => Math.sqrt(1.4 * 287.05 * T);
    const isa = d3.range(300, 1001, 25).map(fl => ({ fl, m: cS(isaT(1000)) / cS(isaT(fl * 30.48)) }));
    const x = d3.scaleLinear([300, d3.max(rows, r => r.fl)], [m.l, W - m.r]);
    const lo = d3.min(rows, r => r.s.land_any_p10), hi = d3.max(rows, r => r.s.land_best_p90);
    const y = d3.scaleLinear([Math.min(lo, 1.0) - 0.01, Math.max(hi, 1.2) + 0.01], [H - m.b, m.t]);
    if (rows.some(r => r.fl > hiFl)) {
      svg.append("rect").attr("x", x(hiFl + 50)).attr("width", W - m.r - x(hiFl + 50)).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", "var(--low-soft)");
      svg.append("text").attr("x", x(hiFl + 50) + 8).attr("y", m.t + 14).style("font-size", "11.5px").style("fill", "var(--ink-2)").text("estimate: GFS only, not yet checked against balloons");
    }
    svg.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(rows.map(r => r.fl)).tickFormat(d => "FL" + d)).call(axisStyle);
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(".2f"))).call(axisStyle);
    svg.append("line").attr("class", "lim").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1.05)).attr("y2", y(1.05));
    svg.append("text").attr("x", m.l + 6).attr("y", y(1.05) + 14).style("font-size", "11px").style("fill", "var(--ink-2)").text("M1.05 floor");
    svg.append("path").datum(rows).attr("class", "band").attr("fill", "var(--accent)").attr("d", d3.area().x(r => x(r.fl)).y0(r => y(r.s.land_any_p10)).y1(r => y(r.s.land_best_p90)));
    svg.append("path").datum(isa).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 1.5).attr("stroke-dasharray", "5 4").attr("d", d3.line().x(r => x(r.fl)).y(r => y(r.m)));
    const lastI = isa.at(-1);
    svg.append("text").attr("x", x(lastI.fl) - 4).attr("y", y(lastI.m) + 16).attr("text-anchor", "end").style("font-size", "11px").style("fill", "var(--ink-3)").text("standard atmosphere, no wind");
    svg.append("path").datum(rows).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2.2).attr("d", d3.line().x(r => x(r.fl)).y(r => y(r.s.land_any_median)));
    svg.append("g").selectAll("circle").data(rows).join("circle").attr("cx", r => x(r.fl)).attr("cy", r => y(r.s.land_any_median)).attr("r", 4)
      .attr("fill", r => r.fl > hiFl ? "var(--surface)" : "var(--accent)").attr("stroke", "var(--accent)").attr("stroke-width", 2)
      .append("title").text(r => `FL${r.fl}${r.fl > hiFl ? " (estimate)" : ""}: median M${r.s.land_any_median.toFixed(3)} in any direction; 10th percentile ${r.s.land_any_p10.toFixed(3)}; best direction 90th ${r.s.land_best_p90.toFixed(3)}`);
    const best = rows.reduce((b, r) => r.s.land_any_median > b.s.land_any_median ? r : b);
    svg.append("text").attr("x", x(best.fl)).attr("y", y(best.s.land_any_median) - 10).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", 600).style("fill", "var(--ink)").text(`M${best.s.land_any_median.toFixed(3)}`);
    const vt = d3.utcFormat("%a %d %b %HZ")(new Date(man.valid_times[fi]));
    const hiRows = rows.filter(r => r.fl > hiFl);
    $("liveAltNote").innerHTML = `Valid ${vt}. Highest median over land in any direction: <b>FL${best.fl}</b> (M${best.s.land_any_median.toFixed(3)}). ` +
      (hiRows.length ? `Above FL${hiFl} the standard atmosphere loses boomless Mach because the air warms again above 20 km (sound is faster at the aircraft); the forecast at FL1000 has M${hiRows.at(-1).s.land_any_median.toFixed(3)}. ` : "High-altitude levels appear after the next forecast build. ") +
      "Margins and the aircraft's cushion come off these values on the map.";
  }

  async function open() {
    drawLiveAlt();
    if (drawn) return;
    if (!P) P = await fetch("geo/physics.json").then(r => r.json());
    drawn = true;
    seg($("phFl"), [[350, "FL350"], [450, "FL450"], [550, "FL550"]], () => st.fl, v => { st.fl = v; redraw(); });
    seg($("phSrc"), [["balloon", "Balloons"], ["gfs", "Global forecast"]], () => st.src, v => { st.src = v; redraw(); });
    insights(); redraw(); drawAlt(); drawVal();
    seg($("clFl"), [[350, "FL350"], [450, "FL450"], [550, "FL550"]], () => cl.fl, v => { cl.fl = v; drawClim(); drawSeasonal().catch(e => console.warn("seasonal", e)); });
    seg($("clSeason"), [["Year", "All year"], ["Dec-Feb", "Dec–Feb"], ["Mar-May", "Mar–May"], ["Jun-Aug", "Jun–Aug"], ["Sep-Nov", "Sep–Nov"]], () => cl.season, v => { cl.season = v; drawClim(); });
    loadClim().then(drawClim).catch(err => console.warn("climatology", err));
    drawSeasonal().catch(e => console.warn("seasonal", e));
    const pre = PRESETS();
    $("abPreset").innerHTML = pre.map((p, i) => `<option value="${i}">${p.name}</option>`).join("");
    const cur = window.AIRCRAFT.find(a => a.id === "custom");
    if (cur && cur.params) { writeForm(cur.params); } else { $("abPreset").value = String(pre.length - 2); writeForm(pre[pre.length - 2]); }
    $("abPreset").onchange = () => { writeForm(pre[+$("abPreset").value]); renderBuilder(); };
    document.querySelectorAll("#acBuild input").forEach(i => i.oninput = renderBuilder);
    $("abUse").onclick = () => {
      installCustom(readForm(), true);
      if (!$("fromIn").value || !$("toIn").value) { $("fromIn").value = "KJFK"; $("toIn").value = "KLAX"; }   // an overland route by default
      document.querySelector('.tabs button[data-tab="map"]').click();
      const fls = MC.S.man.flight_levels, fl = fls.reduce((b, x) => Math.abs(x - +$("abFL").value) < Math.abs(b - +$("abFL").value) ? x : b, fls[0]);
      const fb = document.querySelector(`#flSeg button[data-v="${fl}"]`); if (fb) fb.click();   // map at the aircraft's level
      setTimeout(() => $("routeGo") && $("routeGo").click(), 400);
    };
    renderBuilder();
  }

  window.addEventListener("mc-ready", ev => {
    MC = window.MC;
    const p = ev.detail, c = p && p.get && p.get("cust") && unpackP(p.get("cust"));
    if (c) installCustom(c, false);
  });
  window.addEventListener("mc-tab", e => { if (e.detail === "physics") open().catch(err => console.warn("physics", err)); });
  window.addEventListener("mc-ready", () => { if (window.MC) window.MC.on("refresh", () => { if (!$("tab-physics").hidden) drawLiveAlt(); }); });
  window.MCPHYS = { makeCustom, installCustom };
})();
