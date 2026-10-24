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
  function fmtT(s) {
    if (s == null) return "";
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
      box.appendChild(el("p", { class: "fine" }, state.data.error ? "The launch list could not be loaded on the last update. Showing a typical booster landing in today's atmosphere." :
        `No launches from ${S.short} in the next 10 days. Showing a typical booster landing in today's atmosphere.`));
      return;
    }
    for (const L of Ls) {
      const b = el("button", { type: "button", class: "launch", "aria-pressed": String(state.launch === L.id) });
      b.appendChild(el("span", { class: "when" }, fmtWhen(L.net, S.tz)));
      b.appendChild(el("span", { class: "what" }, `${L.name}${L.status ? " · status " + L.status : ""}`));
      const loud = (L.towns || []).some((t) => t.level === "loud" || t.level === "clear");
      b.appendChild(el("span", { class: "tag" + (L.rtls ? " land" : "") }, L.rtls ? (loud ? "Booster lands here: booms on land" : "Booster lands here") : "Lands at sea: booms mostly offshore"));
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
      else if (loud.length || clear.length) { v = `Booms expected in ${[...loud, ...clear].length} of ${cur.towns.length} nearby towns`; s = `The booster returns to ${S.short}. ${L.name}, ${fmtWhen(L.net, S.tz)}.`; }
      else { v = "Faint booms at most"; s = `${L.name}, ${fmtWhen(L.net, S.tz)}.`; }
    } else {
      v = `A typical ${cur.E.vehicle === "superheavy" ? "Super Heavy" : "Falcon 9"} booster landing today`;
      s = "What a booster returning to the landing zone would sound like in today's atmosphere.";
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
    const near = (la, lo) => Math.hypot((la - S.lat) * 111.32, (lo - S.lon) * 111.32 * Math.cos(S.lat * Math.PI / 180)) < 140;
    for (const p of cur.parts) for (const h of p.hits) if (h[2] >= 0.05 && near(h[0], h[1])) pts.push([h[1], h[0]]);
    const proj = d3.geoMercator().fitExtent([[small ? 16 : 40, small ? 16 : 40], [W - (small ? 16 : 40), H - (small ? 16 : 40)]], { type: "MultiPoint", coordinates: pts });
    const path = d3.geoPath(proj);
    if (state.land) svg.append("path").attr("d", path(state.land)).attr("fill", "#16243f").attr("stroke", "rgba(226,235,252,.55)").attr("stroke-width", 0.8);
    const g = svg.append("g");
    for (const p of cur.parts) {
      for (const h of p.hits) {
        const xy = proj([h[1], h[0]]);
        if (!xy || xy[0] < -5 || xy[0] > W + 5 || xy[1] < -5 || xy[1] > H + 5) continue;
        g.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", small ? 1.6 : 2.2).attr("fill", psfColor(h[2])).attr("fill-opacity", 0.55);
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
    tipEl.setAttribute("data-tip", "Each dot is where one sound ray reaches the ground. Where there are no dots, the atmosphere bends the boom back up before it lands. White line: booster path (dashed: ascent). Triangle: pad.");
    lg.appendChild(tipEl);
  }

  function render() {
    sitesBar(); launchList();
    const cur = current();
    verdict(cur); townTable(cur); map(cur);
    for (const b of document.querySelectorAll(".launch")) b.setAttribute("aria-pressed", "false");
    const i = launchesFor(state.site).findIndex((L) => L.id === state.launch);
    if (i >= 0) document.querySelectorAll(".launch")[i].setAttribute("aria-pressed", "true");
  }
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.data) map(current()); }, 200); });
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
