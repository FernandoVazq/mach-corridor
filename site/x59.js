// X-59 boom carpet (issue #64). Data: data/x59.json from engine/x59.py.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DIRN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const st = { d: null, S: null, ti: 0, hi: 0, land: null };
  const total = (c) => (c && c[0] != null ? c[0] + c[1] : 0);
  const fmtT = (iso) => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const el = (t, a, x) => { const e = document.createElement(t); for (const k in a || {}) e.setAttribute(k, a[k]); if (x != null) e.textContent = x; return e; };
  const cur = () => st.S.by_time[st.ti][st.hi];

  // point at distance d (km) along bearing b (deg) from (lat, lon)
  function dest(lat, lon, b, d) {
    const R = 6371, br = b * Math.PI / 180, la = lat * Math.PI / 180, lo = lon * Math.PI / 180, dr = d / R;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
  }
  // signed cross-track distance (km, + right of the direction of flight) of a town from the track through the site
  function cross(lat, lon, hdg) {
    const S = st.S, x = (lon - S.lon) * 111.32 * Math.cos(S.lat * Math.PI / 180), y = (lat - S.lat) * 111.32, h = hdg * Math.PI / 180;
    return x * Math.cos(h) - y * Math.sin(h);
  }

  function map() {
    const box = $("stage"); box.textContent = "";
    const W = Math.max(300, box.clientWidth), H = W, S = st.S, hdg = st.d.headings[st.hi], c = cur();
    const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", `Boom carpet for a flight heading ${DIRN[st.hi]} over Edwards: ${c[0] == null ? "no boom on the ground" : `${c[0]} km to the left and ${c[1]} km to the right of the track`}`);
    const ext = { type: "MultiPoint", coordinates: [dest(S.lat, S.lon, 0, 120), dest(S.lat, S.lon, 90, 120), dest(S.lat, S.lon, 180, 120), dest(S.lat, S.lon, 270, 120)] };
    const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], ext), path = d3.geoPath(proj);
    if (st.land) svg.append("path").attr("d", path(st.land)).attr("fill", "none").attr("stroke", "rgba(226,235,252,.5)");
    if (c[0] != null) {
      const L = 220, poly = [dest(...[...dest(S.lat, S.lon, hdg + 180, L)].reverse(), hdg - 90, c[0]), dest(...[...dest(S.lat, S.lon, hdg, L)].reverse(), hdg - 90, c[0]),
                             dest(...[...dest(S.lat, S.lon, hdg, L)].reverse(), hdg + 90, c[1]), dest(...[...dest(S.lat, S.lon, hdg + 180, L)].reverse(), hdg + 90, c[1])];
      svg.append("path").attr("d", "M" + poly.map((p) => proj(p).join(",")).join("L") + "Z").attr("fill", "rgba(240,163,58,.28)").attr("stroke", "#f0a33a").attr("stroke-dasharray", "4 3");
    }
    const a = proj(dest(S.lat, S.lon, hdg + 180, 220)), b = proj(dest(S.lat, S.lon, hdg, 220));
    svg.append("line").attr("x1", a[0]).attr("y1", a[1]).attr("x2", b[0]).attr("y2", b[1]).attr("stroke", "#fff").attr("stroke-width", 1.6);
    const tip = proj(dest(S.lat, S.lon, hdg, 60)), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    svg.append("path").attr("d", `M${tip[0] + 9 * Math.cos(ang)},${tip[1] + 9 * Math.sin(ang)}L${tip[0] + 7 * Math.cos(ang + 2.5)},${tip[1] + 7 * Math.sin(ang + 2.5)}L${tip[0] + 7 * Math.cos(ang - 2.5)},${tip[1] + 7 * Math.sin(ang - 2.5)}Z`).attr("fill", "#fff");
    const small = W < 520;
    for (const t of S.towns) {
      const x = cross(t.lat, t.lon, hdg), inside = c[0] != null && (x < 0 ? -x <= c[0] : x <= c[1]), p = proj([t.lon, t.lat]);
      t.inside = inside;
      svg.append("circle").attr("cx", p[0]).attr("cy", p[1]).attr("r", 4.5).attr("fill", inside ? "#f0a33a" : "#7d8aa3").attr("stroke", "#061029").attr("stroke-width", 1.5);
      svg.append("text").attr("x", p[0] + 7).attr("y", p[1] + 4).attr("fill", "#e8eef7").attr("font-size", small ? 11 : 13).attr("paint-order", "stroke").attr("stroke", "#061029").attr("stroke-width", 4).text(t.town);
    }
    const e = proj([S.lon, S.lat]);
    svg.append("rect").attr("x", e[0] - 5).attr("y", e[1] - 5).attr("width", 10).attr("height", 10).attr("fill", "#fff").attr("transform", `rotate(45 ${e[0]} ${e[1]})`);
    const k = $("key"); k.textContent = "";
    for (const [col, txt] of [["rgba(240,163,58,.5)", "Boom reaches the ground (carpet)"], ["#f0a33a", "Town under the carpet"], ["#7d8aa3", "Town outside it"]]) {
      const s = el("span"), i = el("i"); i.style.background = col; s.appendChild(i); s.appendChild(document.createTextNode(txt)); k.appendChild(s);
    }
  }
  function verdict() {
    const c = cur(), std = st.S.standard[st.hi];
    if (c[0] == null) { $("verdict").textContent = "No boom on the ground"; $("vsub").textContent = "Every ray turns back up before the ground: Mach cutoff in this direction."; return; }
    const w = total(c), ws = total(std), towns = st.S.towns.filter((t) => t.inside).map((t) => t.town);
    $("verdict").textContent = `A ${Math.round(w)} km wide carpet flying ${DIRN[st.hi]}`;
    $("vsub").textContent = `${Math.round(c[0])} km to the left, ${Math.round(c[1])} km to the right; ${w < ws ? Math.round((1 - w / ws) * 100) + "% narrower" : Math.round((w / ws - 1) * 100) + "% wider"} than in a standard atmosphere. ` +
      (towns.length ? `Under it: ${towns.join(", ")}.` : "No listed town under it.") + ` The thump arrives ${Math.round(c[3] / 60 * 10) / 10}–${Math.round(c[4] / 60 * 10) / 10} min after the jet passes overhead of each point.`;
  }
  function chart() {
    const box = $("chart"); box.textContent = "";
    const T = st.S.times.map((t) => new Date(t)), sel = st.S.by_time.map((r) => total(r[st.hi])),
          lo = st.S.by_time.map((r) => Math.min(...r.map(total))), hi = st.S.by_time.map((r) => Math.max(...r.map(total)));
    const Wd = 360, Hd = 170, m = { l: 48, r: 8, t: 14, b: 30 };
    const svg = d3.create("svg").attr("viewBox", `0 0 ${Wd} ${Hd}`).attr("class", "tlchart").attr("role", "img")
      .attr("aria-label", `Carpet width flying ${DIRN[st.hi]} over the next 48 hours: ` + sel.map((v, i) => `${fmtT(T[i])} ${Math.round(v)} km`).join(", "));
    const x = d3.scaleTime().domain(d3.extent(T)).range([m.l, Wd - m.r]);
    const y = d3.scaleLinear().domain([0, Math.max(total(st.S.standard[st.hi]), d3.max(hi)) * 1.08]).nice().range([Hd - m.b, m.t]);
    const ys = y(total(st.S.standard[st.hi]));
    svg.append("line").attr("x1", m.l).attr("x2", Wd - m.r).attr("y1", ys).attr("y2", ys).attr("stroke", "var(--ink-3)").attr("stroke-dasharray", "2 3");
    svg.append("text").attr("x", Wd - m.r).attr("y", ys - 3).attr("text-anchor", "end").attr("font-size", 9.5).attr("fill", "var(--ink-3)").text("standard atmosphere");
    svg.append("path").attr("d", d3.area().x((_, i) => x(T[i])).y0((_, i) => y(lo[i])).y1((v) => y(v))(hi)).attr("fill", "var(--low-soft)");
    svg.append("path").attr("d", d3.line().x((_, i) => x(T[i])).y((v) => y(v))(sel)).attr("fill", "none").attr("stroke", "var(--data-1)").attr("stroke-width", 2);
    svg.append("g").selectAll("circle").data(sel).join("circle").attr("cx", (_, i) => x(T[i])).attr("cy", (v) => y(v)).attr("r", (_, i) => i === st.ti ? 4.5 : 2.5).attr("fill", (_, i) => i === st.ti ? "var(--ink)" : "var(--data-1)");
    svg.append("g").attr("transform", `translate(0,${Hd - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric" }).format(d)))
      .call((g) => g.selectAll("text").attr("font-size", 9.5)).call((g) => g.select(".domain").attr("stroke", "var(--rule)"));
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((d) => d + " km")).call((g) => g.selectAll("text").attr("font-size", 9.5)).call((g) => g.select(".domain").remove());
    svg.append("text").attr("x", m.l).attr("y", Hd - 2).attr("font-size", 9.5).attr("fill", "var(--ink-3)").text(`Line: flying ${DIRN[st.hi]} · band: all eight directions`);
    box.appendChild(svg.node());
    MC_UI.stripFor(svg.node(), { values: sel, first: sel[0], last: sel[sel.length - 1], up: "bad", hl: sel[st.ti], hlLabel: fmtT(T[st.ti]), ref: total(st.S.standard[st.hi]),
      refLabel: "standard atm.", unit: "km", dec: 0, period: "next 48 h", label: `Carpet width, flying ${DIRN[st.hi]}` });
  }
  function kpis() {
    const r = st.S.by_time[st.ti], w = r.map(total), sorted = w.slice().sort((a, b) => a - b), med = (sorted[3] + sorted[4]) / 2;
    const ws = total(st.S.standard[0]), nar = w.indexOf(Math.min(...w));
    const k = $("kp"); k.textContent = "";
    for (const [v, t] of [[`${Math.round(med)} km`, "carpet width now, typical direction"], [`${med < ws ? "−" : "+"}${Math.abs(Math.round((med / ws - 1) * 100))}%`, `vs a standard atmosphere (${Math.round(ws)} km)`], [`${Math.round(w[nar])} km`, `narrowest, flying ${DIRN[nar]}`]]) {
      const d = el("div"); d.appendChild(el("b", null, v)); d.appendChild(el("span", null, t)); k.appendChild(d);
    }
  }
  function render() { $("tLbl").textContent = fmtT(st.S.times[st.ti]); kpis(); map(); verdict(); chart(); }
  async function main() {
    const [d, topo] = await Promise.all([fetch("data/x59.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("vendor/countries-50m.json").then((r) => r.json()).catch(() => null)]);
    st.d = d; st.S = d.sites.edwards;
    if (!st.S || !st.S.times.length) { $("stage").insertAdjacentHTML("afterend", '<p class="empty">The X-59 forecast is not available in this update.</p>'); return; }
    if (topo) st.land = topojson.mesh(topo, topo.objects.countries);
    const seg = $("hdSeg");
    DIRN.forEach((n, i) => {
      const b = el("button", { type: "button", "aria-pressed": String(i === st.hi), "aria-label": `Flying ${n}` }, n); if (i === st.hi) b.classList.add("on");
      b.addEventListener("click", () => { st.hi = i; seg.querySelectorAll("button").forEach((x, j) => { x.classList.toggle("on", j === i); x.setAttribute("aria-pressed", String(j === i)); }); render(); });
      seg.appendChild(b);
    });
    $("tSl").max = st.S.times.length - 1;
    $("tSl").addEventListener("input", (e) => { st.ti = +e.target.value; render(); });
    render();
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(map, 200); });
  }
  main().catch((e) => { console.error(e); $("stage").insertAdjacentHTML("afterend", '<p class="empty">The X-59 forecast could not be loaded.</p>'); });
})();
