// Rocket boom forecast page (issue #50). Data: data/rockets.json from engine/rocket.py.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const LEVELS = {
    loud: { label: "Loud boom", color: "#ff5a6a" },
    clear: { label: "Clear boom", color: "#f0a33a" },
    faint: { label: "Faint boom or rumble", color: "#8fb3e8" },
    possible: { label: "Possible, at the edge", color: "#7d8aa3" },
    none: { label: "Not expected", color: "#3a4660" },
  };
  const psfColor = (p) => (p >= 1 ? LEVELS.loud.color : p >= 0.3 ? LEVELS.clear.color : LEVELS.faint.color);
  const state = { data: null, site: null, launch: null, land: null };

  function fmtWhen(iso, tz) {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
  }
  const isRe = () => state.data && state.data.sites[state.site] && state.data.sites[state.site].kind === "reentry";
  function fmtT(s) {
    if (s == null) return "";
    if (isRe()) { const a = Math.abs(s), m = Math.floor(a / 60), r = Math.round(a % 60); return `${s < 0 ? "−" : "+"}${m}:${String(r).padStart(2, "0")}`; }
    const m = Math.floor(Math.abs(s) / 60), r = Math.round(Math.abs(s) % 60);
    return `T+${m}:${String(r).padStart(2, "0")}`;
  }
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function sitesBar() {
    const seg = $("siteSeg");
    seg.textContent = "";
    for (const [k, S] of Object.entries(state.data.sites)) {
      const b = el("button", { type: "button", "aria-pressed": String(k === state.site) }, S.short);
      if (k === state.site) b.classList.add("on");
      b.addEventListener("click", () => { state.site = k; state.launch = null; save(); render(); });
      seg.appendChild(b);
    }
  }

  function launchesFor(site) { return (state.data.launches || []).filter((L) => L.site === site); }

  function launchList() {
    const box = $("launches"), S = state.data.sites[state.site];
    box.textContent = "";
    const Ls = launchesFor(state.site);
    $("range").textContent = "· next 10 days";
    if (!Ls.length) {
      box.appendChild(el("p", { class: "fine" }, isRe() ? "No capsule return off California is publicly scheduled in the next 10 days. Showing a typical Dragon or Orion return in today's atmosphere." :
        state.data.error ? "The launch list could not be loaded on the last update. Showing a typical booster landing in today's atmosphere." :
        `No launches from ${S.short} in the next 10 days. Showing a typical booster landing in today's atmosphere.`));
      return;
    }
    for (const L of Ls) {
      const b = el("button", { type: "button", class: "launch", "aria-pressed": String(state.launch === L.id) });
      b.appendChild(el("span", { class: "when" }, fmtWhen(L.net, S.tz)));
      b.appendChild(el("span", { class: "what" }, `${L.name}${L.status ? " · status " + L.status : ""}`));
      const loud = (L.towns || []).some((t) => t.level === "loud" || t.level === "clear");
      b.appendChild(el("span", { class: "tag" + (L.rtls ? " land" : "") }, L.capsule ? (loud ? "Capsule return: booms on land" : "Capsule return") : L.rtls ? (loud ? "Booster lands here: booms on land" : "Booster lands here") : "Lands at sea: booms mostly offshore"));
      b.addEventListener("click", () => { state.launch = L.id; save(); render(); });
      box.appendChild(b);
    }
  }

  function current() {
    const Ls = launchesFor(state.site);
    const L = Ls.find((x) => x.id === state.launch) || Ls[0];
    if (L) { state.launch = L.id; return { kind: "launch", L, towns: L.towns, parts: L.parts, atm: L.atmosphere, note: L.atmosphere_note }; }
    const E = state.data.examples[state.site];
    return { kind: "example", E, towns: E.towns, parts: E.parts, atm: E.atmosphere };
  }

  function verdict(cur) {
    const S = state.data.sites[state.site];
    const loud = cur.towns.filter((t) => t.level === "loud"), clear = cur.towns.filter((t) => t.level === "clear");
    let v, s;
    if (cur.kind === "launch") {
      const L = cur.L;
      if (!L.rtls) { v = "Probably no boom on land"; s = `The booster lands at sea, so its boom stays offshore. The launch boom starts high and far downrange. ${L.name}, ${fmtWhen(L.net, S.tz)}.`; }
      else if (loud.length || clear.length) { v = `Booms expected in ${[...loud, ...clear].length} of ${cur.towns.length} nearby towns`; s = `${L.capsule ? "The capsule comes back over the coast." : `The booster returns to ${S.short}.`} ${L.name}, ${fmtWhen(L.net, S.tz)}.`; }
      else { v = "Faint booms at most"; s = `${L.name}, ${fmtWhen(L.net, S.tz)}.`; }
    } else {
      if (cur.E.vehicle === "capsule") {
        v = "A typical Dragon or Orion return today";
        s = "A capsule coming back from orbit over the coast, splashing down offshore: what each town would hear in today's atmosphere. The splash point is a typical one.";
      } else {
        v = `A typical ${cur.E.vehicle === "superheavy" ? "Super Heavy" : "Falcon 9"} booster landing today`;
        s = "What a booster returning to the landing zone would sound like in today's atmosphere.";
      }
    }
    $("verdict").textContent = v;
    $("verdictSub").textContent = s;
  }

  function townTable(cur) {
    const tb = $("towns").tBodies[0];
    tb.textContent = "";
    const order = { loud: 0, clear: 1, faint: 2, possible: 3, none: 4 };
    const sorted = [...cur.towns].sort((a, b) => order[a.level] - order[b.level] || b.psf - a.psf);
    const quiet = sorted.filter((t) => t.level === "none");
    for (const t of sorted.filter((t) => t.level !== "none")) {
      const tr = el("tr");
      tr.appendChild(el("td", null, t.town));
      const td = el("td"); const sp = el("span", { class: "lvl" }); const i = el("i"); i.style.background = LEVELS[t.level].color;
      sp.appendChild(i); sp.appendChild(document.createTextNode(LEVELS[t.level].label)); td.appendChild(sp); tr.appendChild(td);
      tr.appendChild(el("td", null, t.psf > 0 ? t.psf.toFixed(t.psf < 1 ? 2 : 1) : "–"));
      tr.appendChild(el("td", null, t.psf > 0 ? fmtT(t.t_s) : ""));
      tb.appendChild(tr);
    }
    if (quiet.length) {     // towns that hear nothing stay folded: one line instead of a long list
      const tr = el("tr"), td = el("td"); td.colSpan = 4;
      const det = el("details"), sm = el("summary", null, `${quiet.length} ${quiet.length === 1 ? "town" : "more towns"}: not expected to hear it`);
      det.appendChild(sm); det.appendChild(el("p", { class: "fine" }, quiet.map((t) => t.town).join(", ")));
      td.appendChild(det); tr.appendChild(td); tb.appendChild(tr);
    }
    const atm = cur.atm === "standard" ? "standard atmosphere (no forecast yet for this time)" : `GFS forecast valid ${cur.atm.replace("T", " ").replace(":00Z", " UTC")}`;
    $("metaTip").setAttribute("data-tip", `Atmosphere: ${atm}. GFS run ${state.data.gfs_run || "n/a"}; updated ${state.data.generated.replace("T", " ").replace("Z", " UTC")}.` + (cur.note ? " " + cur.note : "") + " A focus boom can be louder in a narrow strip.");
    // standard summary strip: peak psf over the towns that hear the boom
    const heard = cur.towns.filter((t) => t.psf > 0).map((t) => t.psf).sort((a, b) => a - b);
    const top = cur.towns.filter((t) => t.psf > 0).sort((a, b) => b.psf - a.psf)[0];
    if (heard.length > 1) MC_UI.stat($("psfStrip"), { values: heard, ref: 1, refLabel: "loud", lo: 0, hl: top.psf, hlLabel: top.town,
      dec: 1, unit: "psf", period: cur.atm === "standard" ? "standard atmosphere" : "forecast for launch time", n: `${heard.length} of ${cur.towns.length} towns`, label: "Peak boom in towns" });
    else { $("psfStrip").textContent = ""; }
  }

  function map(cur) {
    const box = $("stage"), S = state.data.sites[state.site];
    box.textContent = "";
    const W = Math.max(300, Math.round(box.clientWidth || 800)), H = Math.round(W * 0.75), small = W < 560;
    const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid slice");
    const pts = [[S.lon, S.lat], ...cur.towns.map((t) => [t.lon, t.lat])];
    const near = (la, lo) => Math.hypot((la - S.lat) * 111.32, (lo - S.lon) * 111.32 * Math.cos(S.lat * Math.PI / 180)) < (S.kind === "reentry" ? 260 : 140);
    for (const p of cur.parts) for (const h of p.hits) if (h[2] >= 0.05 && near(h[0], h[1])) pts.push([h[1], h[0]]);
    const proj = d3.geoMercator().fitExtent([[small ? 16 : 40, small ? 16 : 40], [W - (small ? 16 : 40), H - (small ? 16 : 40)]], { type: "MultiPoint", coordinates: pts });
    const path = d3.geoPath(proj);
    if (state.land) svg.append("path").attr("d", path(state.land)).attr("fill", "#16243f").attr("stroke", "rgba(226,235,252,.55)").attr("stroke-width", 0.8);
    // the boom zones: the loudest ray landing in each small cell, spread to the neighbouring cells and outlined at
    // 0.05, 0.3 and 1 psf, so the carpet reads as areas (faint, clear, loud) instead of scattered dots
    const cell = small ? 6 : 8, gx = Math.ceil(W / cell) + 2, gy = Math.ceil(H / cell) + 2, grid = new Float64Array(gx * gy);
    for (const p of cur.parts) for (const h of p.hits) {
      const xy = proj([h[1], h[0]]); if (!xy) continue;
      const i = Math.floor(xy[0] / cell) + 1, j = Math.floor(xy[1] / cell) + 1;
      if (i >= 0 && i < gx && j >= 0 && j < gy) grid[j * gx + i] = Math.max(grid[j * gx + i], h[2]);
    }
    let fill = grid;
    for (let pass = 0; pass < 2; pass++) {
      const nxt = new Float64Array(fill.length);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        let m = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && a < gx && b >= 0 && b < gy) m = Math.max(m, fill[b * gx + a]); }
        nxt[j * gx + i] = m;
      }
      fill = nxt;
    }
    d3.blur2({ data: fill, width: gx }, 1);           // soften the cell edges before outlining
    const cpath = d3.geoPath(d3.geoTransform({ point(x, y) { this.stream.point((x - 1) * cell, (y - 1) * cell); } }));
    const zones = svg.append("g");
    for (const [th, k, op] of [[0.04, "faint", 0.2], [0.25, "clear", 0.3], [0.8, "loud", 0.4]]) {
      const [c] = d3.contours().size([gx, gy]).thresholds([th])(fill);
      zones.append("path").attr("d", cpath(c)).attr("fill", LEVELS[k].color).attr("fill-opacity", op).attr("stroke", LEVELS[k].color).attr("stroke-opacity", 0.8).attr("stroke-width", 1);
    }
    const g = svg.append("g");
    for (const p of cur.parts) {
      for (const h of p.hits) {
        const xy = proj([h[1], h[0]]);
        if (!xy || xy[0] < -5 || xy[0] > W + 5 || xy[1] < -5 || xy[1] > H + 5) continue;
        g.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", small ? 1 : 1.3).attr("fill", psfColor(h[2])).attr("fill-opacity", 0.25);
      }
      const tr = p.track.map((q) => proj([q[1], q[0]]));
      svg.append("path").attr("d", d3.line()(tr)).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1.4).attr("stroke-dasharray", p.phase === "ascent" ? "5 4" : null);
    }
    const pad = proj([S.lon, S.lat]);
    svg.append("path").attr("d", `M${pad[0]},${pad[1] - 9} L${pad[0] + 7},${pad[1] + 6} L${pad[0] - 7},${pad[1] + 6} Z`).attr("fill", "#fff");
    for (const t of cur.towns) {
      const xy = proj([t.lon, t.lat]);
      svg.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", 4.5).attr("fill", LEVELS[t.level].color).attr("stroke", "#061029").attr("stroke-width", 1.5);
      if (small && (t.level === "none" || t.level === "possible")) continue;
      svg.append("text").attr("x", xy[0] + 7).attr("y", xy[1] + 4).attr("fill", "#e8eef7").attr("font-size", small ? 11 : 13).attr("font-weight", 500).attr("paint-order", "stroke").attr("stroke", "#061029").attr("stroke-width", 4).text(t.town);
    }
    // scale bar: 20 km at the pad's latitude
    const a = proj([S.lon, S.lat]), b2 = proj([S.lon + 20 / (111.32 * Math.cos(S.lat * Math.PI / 180)), S.lat]);
    const sx = 24, sy = H - 24, len = b2[0] - a[0];
    svg.append("path").attr("d", `M${sx},${sy - 5}V${sy}H${sx + len}V${sy - 5}`).attr("fill", "none").attr("stroke", "#e8eef7").attr("stroke-width", 1.5);
    svg.append("text").attr("x", sx + len + 6).attr("y", sy + 1).attr("fill", "#e8eef7").attr("font-size", 12).text("20 km");
    const lg = $("legend");
    lg.textContent = "";
    for (const [k, txt] of [["faint", "Boom under 0.3 psf"], ["clear", "0.3 to 1 psf"], ["loud", "1 psf or more"]]) {
      const s = el("span"); const i = el("i"); i.style.background = LEVELS[k].color; s.appendChild(i); s.appendChild(document.createTextNode(txt)); lg.appendChild(s);
    }
    const tipEl = document.createElement("button"); tipEl.type = "button"; tipEl.className = "it"; tipEl.setAttribute("aria-label", "How to read the map");
    tipEl.setAttribute("data-tip", S.kind === "reentry" ? "Shaded zones: where the boom reaches the ground, by loudness; each small dot is one traced sound ray. White line: the capsule's path while it is supersonic. Triangle: a typical splash point." : "Shaded zones: where the boom reaches the ground, by loudness; each small dot is one traced sound ray. Where there is nothing, the atmosphere bends the boom back up before it lands. White line: booster path (dashed: ascent). Triangle: pad.");
    lg.appendChild(tipEl);
  }

  // how loud, on one scale: every town that hears it placed by its peak, against everyday references
  function ladder(cur) {
    const box = $("ladder"); box.textContent = "";
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const heard = cur.towns.filter((t) => t.psf > 0).sort((a, b) => b.psf - a.psf);
    const Wd = Math.max(320, Math.min(520, box.clientWidth || 440)), Hd = 150, A = 62, x = d3.scaleLog([0.03, 10], [16, Wd - 16]).clamp(true);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${Wd} ${Hd}`).attr("role", "img")
      .attr("aria-label", heard.length ? `How loud: ${heard.slice(0, 4).map((t) => `${t.town} ${t.psf.toFixed(2)} psf`).join(", ")}` : "No town is expected to hear the boom");
    for (const [a, b, k, lab] of [[0.03, 0.3, "faint", "faint thump"], [0.3, 1, "clear", "clear boom"], [1, 10, "loud", "loud boom"]]) {
      svg.append("rect").attr("x", x(a)).attr("y", A).attr("width", x(b) - x(a)).attr("height", 16).attr("fill", LEVELS[k].color).attr("fill-opacity", 0.85);
      svg.append("text").attr("x", (x(a) + x(b)) / 2).attr("y", A + 12).attr("text-anchor", "middle").attr("font-size", 11).attr("font-weight", 600).attr("fill", "#061029").text(lab);
    }
    for (const [v, lab, row, anc] of [[0.11, "proposed FAA airliner limit", 1, "middle"], [1, "close thunder", 0, "end"], [2, "Concorde overhead", 1, "start"]]) {
      svg.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", A + 16).attr("y2", A + 26 + row * 13).attr("stroke", css("--ink-3")).attr("stroke-dasharray", "2 2");
      svg.append("text").attr("x", x(v)).attr("y", A + 36 + row * 13).attr("text-anchor", anc).attr("dx", anc === "end" ? 4 : anc === "start" ? -4 : 0).attr("font-size", 10).attr("fill", css("--ink-2")).text(lab);
    }
    for (const v of [0.1, 0.3, 1, 3, 10]) svg.append("text").attr("x", x(v)).attr("y", Hd - 4).attr("text-anchor", v === 10 ? "end" : "middle").attr("font-size", 10).attr("fill", css("--ink-3")).text(`${v} psf`);
    // towns: a marker each; names for the loudest few, on alternating rows
    const used = [];
    heard.forEach((t, i) => {
      const px = x(t.psf);
      svg.append("path").attr("d", `M${px},${A - 1} l-5,-8 l10,0 z`).attr("fill", LEVELS[t.level].color).attr("stroke", css("--ink")).attr("stroke-width", 0.8);
      if (i < 5) {
        const w = t.town.length * 6 + 6, row = [0, 1, 2].find((r) => used.every((u) => u.r !== r || px + w / 2 < u.a || px - w / 2 > u.b));
        if (row == null) return;
        used.push({ r: row, a: px - w / 2, b: px + w / 2 });
        svg.append("text").attr("x", Math.max(w / 2, Math.min(Wd - w / 2, px))).attr("y", A - 14 - row * 14).attr("text-anchor", "middle").attr("font-size", 11)
          .attr("font-weight", i === 0 ? 600 : 400).attr("fill", css("--ink")).text(`${t.town} ${t.psf.toFixed(t.psf < 1 ? 2 : 1)}`);
      }
    });
    if (!heard.length) svg.append("text").attr("x", Wd / 2).attr("y", A - 16).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", css("--ink-2")).text("No nearby town is expected to hear it");
    box.appendChild(svg.node());
  }
  function render() {
    const ab = document.querySelector("#towns thead abbr");
    if (ab) ab.title = isRe() ? "Minutes:seconds before (−) or after (+) splashdown" : "Time after liftoff, minutes:seconds";
    const uh = document.getElementById("upH"); if (uh) uh.firstChild.textContent = isRe() ? "Upcoming returns " : "Upcoming launches ";
    sitesBar(); launchList();
    const cur = current();
    verdict(cur); ladder(cur); townTable(cur); map(cur);
    for (const b of document.querySelectorAll(".launch")) b.setAttribute("aria-pressed", "false");
    const i = launchesFor(state.site).findIndex((L) => L.id === state.launch);
    if (i >= 0) document.querySelectorAll(".launch")[i].setAttribute("aria-pressed", "true");
  }
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.data) { map(current()); ladder(current()); } }, 200); });
  function save() { try { history.replaceState(null, "", `#${state.site}${state.launch ? "/" + state.launch : ""}`); } catch (e) { /* ignore */ } }

  Promise.all([
    fetch("data/rockets.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("vendor/countries-50m.json").then((r) => r.json()).catch(() => null),
  ]).then(([data, topo]) => {
    state.data = data;
    if (topo) state.land = topojson.merge(topo, topo.objects.countries.geometries);
    const [h0, h1] = location.hash.slice(1).split("/");
    state.site = data.sites[h0] ? h0 : (data.launches && data.launches[0] ? data.launches[0].site : "cape");
    state.launch = h1 || null;
    render();
  }).catch((e) => {
    $("verdict").textContent = "The rocket forecast is not available right now.";
    $("verdictSub").textContent = "It is rebuilt with every new GFS run; try again in a few hours.";
    console.info("rockets.json:", e && e.message);
  });
})();
