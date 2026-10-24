// Fireball booms (issue #61). Data: data/fireballs.json from engine/bolide.py (NASA JPL CNEOS events).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const st = { data: null, sel: null, land: null, rockets: null };
  const paColor = d3.scaleThreshold().domain([5, 50, 500]).range(["#8fb3e8", "#f0a33a", "#ff5a6a", "#ffd0e0"]);
  const PA_LV = [["under 5 Pa", "a faint thump or rumble", "#8fb3e8"], ["5–50 Pa", "a clear boom, windows rattle", "#f0a33a"],
                 ["50–500 Pa", "a loud bang", "#ff5a6a"], ["over 500 Pa", "can break windows", "#ffd0e0"]];
  const fmtDate = (iso) => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(iso));
  const ll = (la, lo) => `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}, ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`;
  const kt = (e) => e == null ? "energy n/a" : e >= 1 ? `${e.toFixed(e >= 10 ? 0 : 1)} kt` : `${Math.round(e * 1000)} t TNT`;
  const mmss = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
  function el(tag, attrs, text) { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }

  // ---------- map
  let svg, gLand, gPts, proj, path, W = 0, H = 0;
  function initMap() {
    const box = $("stage"); W = box.clientWidth; H = box.clientHeight;
    svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Map of fireballs and where their booms reached the ground");
    gLand = svg.append("g"); gPts = svg.append("g");
    proj = d3.geoEquirectangular(); path = d3.geoPath(proj);
  }
  function fitTo(ev) {
    if (!ev || !ev.carpet.length) proj.fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
    else {
      // the carpet plus at least +/-3 deg around the fireball, so a small carpet still shows the coast around it
      const pts = ev.carpet.map((h) => [h[1], h[0]]).concat([[ev.lon - 4, ev.lat - 3], [ev.lon + 4, ev.lat + 3]]);
      proj.fitExtent([[24, 24], [W - 24, H - 24]], { type: "MultiPoint", coordinates: pts });
    }
  }
  function draw() {
    const ev = st.sel;
    fitTo(ev);
    gLand.selectAll("*").remove(); gPts.selectAll("*").remove();
    gLand.append("path").datum({ type: "Sphere" }).attr("d", path).attr("fill", "none").attr("stroke", "rgba(226,235,252,.15)");
    gLand.append("path").datum(d3.geoGraticule10()).attr("d", path).attr("fill", "none").attr("stroke", "rgba(226,235,252,.06)");
    if (st.land) gLand.append("path").datum(st.land).attr("d", path).attr("fill", "none").attr("stroke", "rgba(226,235,252,.55)").attr("stroke-width", 0.8);
    if (ev && ev.carpet.length) {
      gPts.selectAll("circle.h").data(ev.carpet).join("circle").attr("class", "h")
        .attr("cx", (h) => proj([h[1], h[0]])[0]).attr("cy", (h) => proj([h[1], h[0]])[1]).attr("r", 2.6)
        .attr("fill", (h) => paColor(h[2])).attr("opacity", 0.85);
      const [x, y] = proj([ev.lon, ev.lat]);
      gPts.append("circle").attr("cx", x).attr("cy", y).attr("r", 7).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 2);
      // the path direction: an arrow pointing where the fireball went
      const a = (ev.heading - 90) * Math.PI / 180, L = 34;
      gPts.append("line").attr("x1", x - L * Math.cos(a)).attr("y1", y - L * Math.sin(a)).attr("x2", x).attr("y2", y).attr("stroke", "#fff").attr("stroke-width", 2).attr("stroke-dasharray", "4 3");
    } else {
      const evs = st.data.events.filter((e) => e.lat != null);
      const r = d3.scaleSqrt().domain([0, d3.max(evs, (e) => e.impact_kt || 0) || 1]).range([2.5, 16]);
      gPts.selectAll("circle").data(evs).join("circle")
        .attr("cx", (e) => proj([e.lon, e.lat])[0]).attr("cy", (e) => proj([e.lon, e.lat])[1]).attr("r", (e) => r(e.impact_kt || 0))
        .attr("fill", (e) => e.boom && e.boom.heard ? "#f0a33a" : "#8fb3e8").attr("fill-opacity", 0.75).attr("stroke", "#061029")
        .style("cursor", "pointer").on("click", (_, e) => select(e))
        .append("title").text((e) => `${fmtDate(e.date)}, ${kt(e.impact_kt)}`);
    }
  }
  function key() {
    const k = $("key"); k.textContent = "";
    const items = st.sel && st.sel.carpet.length ? PA_LV.map(([a, b, c]) => [c, `${a}: ${b}`]) : [["#f0a33a", "Boom reached the ground"], ["#8fb3e8", "No boom traced (too high, too shallow or no direction)"]];
    for (const [c, t] of items) { const s = el("span"); const i = el("i"); i.style.background = c; s.appendChild(i); s.appendChild(document.createTextNode(t)); k.appendChild(s); }
    if (st.sel) { const b = el("button", { type: "button", class: "linkish" }, "Back to all fireballs"); b.addEventListener("click", () => select(null)); k.appendChild(b); }
  }

  // ---------- list and detail
  function list() {
    const box = $("evs"); box.textContent = "";
    const evs = st.data.events;
    $("cnt").textContent = `· ${evs.length}`;
    for (const e of evs.slice(0, 60)) {
      const b = el("button", { type: "button", class: "ev", "aria-pressed": String(st.sel === e) });
      b.appendChild(el("span", { class: "w" }, fmtDate(e.date)));
      b.appendChild(el("span", { class: "s" }, `${ll(e.lat, e.lon)} · ${kt(e.impact_kt)}${e.alt ? ` · ${e.alt.toFixed(0)} km up` : ""}`));
      const heard = e.boom && e.boom.heard;
      b.appendChild(el("span", { class: "t" + (heard ? " h" : "") }, heard ? "Boom on the ground" : e.boom ? "No boom" : "Not traced"));
      b.addEventListener("click", () => select(e));
      box.appendChild(b);
    }
  }
  function select(e) {
    st.sel = e; draw(); key(); list(); detail();
  }
  function detail() {
    const e = st.sel, v = $("verdict"), s = $("vsub"), strip = $("carpetStrip");
    strip.textContent = "";
    if (!e) { v.textContent = ""; s.textContent = "Tap a fireball on the map or in the list."; return; }
    if (!e.boom) { v.textContent = "Not traced"; s.textContent = "CNEOS gives no height or direction for this one, so its boom cannot be traced."; return; }
    if (!e.boom.heard) { v.textContent = e.boom.reason === "grazing" ? "Not traced: a grazing path" : "No boom on the ground";
      s.textContent = e.boom.reason === "grazing" ? "It skimmed the atmosphere almost level, so where its boom went is too uncertain to trace." : "Too high: every shock ray turned back up before the ground."; return; }
    const b = e.boom;
    v.textContent = `Boom could be heard up to ${b.radius_km} km away`;
    const pa = (x) => x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(x >= 10 ? 0 : 1);
    s.textContent = `${mmss(b.t_min_s)} to ${mmss(b.t_max_s)} after the flash. Strongest about ${pa(b.pa_max)} Pa (estimate, ×3). Object about ${b.diameter_m >= 3 ? Math.round(b.diameter_m) : b.diameter_m.toFixed(1)} m across, ${kt(e.impact_kt)}.`;
    MC_UI.stat(strip, { values: e.carpet.map((h) => h[2]), hl: b.pa_max, hlLabel: "strongest", unit: "Pa", dec: b.pa_max >= 100 ? 0 : 1, lo: 0,
      period: fmtDate(e.date), label: "Boom strength on the ground" });
  }
  function kpis() {
    const evs = st.data.events, heard = evs.filter((e) => e.boom && e.boom.heard);
    const big = evs.reduce((m, e) => (e.impact_kt || 0) > (m.impact_kt || 0) ? e : m, evs[0] || {});
    const k = $("kp"); k.textContent = "";
    for (const [v, t] of [[String(evs.length), "fireballs listed, last 2 years"], [String(heard.length), "with a boom that reached the ground"], [big ? kt(big.impact_kt) : "–", "largest, " + (big && big.date ? new Date(big.date).getUTCFullYear() : "")]]) {
      const d = el("div"); d.appendChild(el("b", null, v)); d.appendChild(el("span", null, t)); k.appendChild(d);
    }
  }

  // ---------- "heard a boom?" check
  function hav(a, b, c, d) { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
  function check(ev) {
    ev.preventDefault();
    const t = new Date($("chkWhen").value).getTime(), la = +$("chkLat").value, lo = +$("chkLon").value, out = $("chkOut");
    out.textContent = "";
    if (!isFinite(t) || !isFinite(la) || !isFinite(lo)) return;
    const ul = el("ul");
    const near = st.data.events.filter((e) => Math.abs(new Date(e.date).getTime() - t) < 3 * 3600e3 && hav(la, lo, e.lat, e.lon) < 600);
    for (const e of near) {
      const d = hav(la, lo, e.lat, e.lon), heard = e.boom && e.boom.heard && d <= e.boom.radius_km + 30;
      ul.appendChild(el("li", null, `Fireball ${fmtDate(e.date)}, ${Math.round(d)} km from you, ${kt(e.impact_kt)}: ${heard ? "its boom could have reached you." : "probably too far for its boom to reach you."}`));
    }
    const rk = (st.rockets && st.rockets.launches || []).filter((L) => Math.abs(new Date(L.net).getTime() - t) < 2 * 3600e3);
    for (const L of rk) ul.appendChild(el("li", null, `Rocket launch ${L.name} from ${L.pad || L.site} at ${fmtDate(L.net)}. See the rocket boom forecast.`));
    if (!ul.children.length) {
      out.appendChild(el("p", { class: "sub" }, "No listed fireball or tracked launch matches. CNEOS lists only the largest fireballs, often weeks later; military jets, quarry blasts and thunder also boom."));
      const p = el("p", { class: "sub" }); p.appendChild(document.createTextNode("Saw a bright light too? Report it to the ")); const a = el("a", { href: "https://www.amsmeteors.org/" }, "American Meteor Society"); p.appendChild(a); p.appendChild(document.createTextNode(".")); out.appendChild(p);
    } else out.appendChild(ul);
  }

  async function main() {
    const [data, topo, rockets] = await Promise.all([
      fetch("data/fireballs.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("vendor/countries-50m.json").then((r) => r.json()).catch(() => null),
      fetch("data/rockets.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    st.data = data; st.rockets = rockets;
    if (topo) st.land = topojson.mesh(topo, topo.objects.countries);
    initMap(); kpis(); list(); select(null);
    $("chkForm").addEventListener("submit", check);
    $("chkGeo").addEventListener("click", () => navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => { $("chkLat").value = p.coords.latitude.toFixed(2); $("chkLon").value = p.coords.longitude.toFixed(2); }, () => {}, { timeout: 10000 }));
    if (data.error) $("vsub").textContent = "The fireball list could not be loaded on the last update; it retries every hour.";
  }
  main().catch((e) => { console.error(e); $("stage").insertAdjacentHTML("afterend", '<p class="empty">The fireball list is not available right now.</p>'); });
})();
