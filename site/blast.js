// Blast window forecast (issue #65): for a site (quarry, mine, range, fireworks), the next 48 hours rated toward each
// direction where people live: Good (the air bends sound up), Caution, Avoid (the air traps sound near the ground and
// carries it to the neighbours). Data: the sound-carry atlas (engine/sound.py): critical trapping angle toward 8
// directions, 1 degree, every 6 hours. Thresholds are a first guess, to be calibrated with microphone data.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DIRN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const RATE = [{ k: "good", lab: "Good", tip: "Sound escapes upward", col: "var(--good)", bg: "var(--good-soft)" },
                { k: "caution", lab: "Caution", tip: "Some sound trapped near the ground", col: "var(--warn)", bg: "var(--warn-soft)" },
                { k: "avoid", lab: "Avoid", tip: "Sound trapped and carried to the neighbours", col: "var(--bad)", bg: "var(--bad-soft)" }];
  const T_CAUTION = 2.0, T_AVOID = 5.0;           // degrees of trapping angle (engine/sound.py LEVELS)
  const rate = (th) => (th >= T_AVOID ? 2 : th >= T_CAUTION ? 1 : 0);
  const st = { man: null, C: null, tiles: [], site: null, dirs: new Set([0, 1, 2, 3, 4, 5, 6, 7]) };
  const PRESETS = [["Juncos, PR", 18.23, -65.92], ["Ponce, PR", 18.03, -66.6], ["Fort Bragg, NC", 35.14, -79.0], ["Aberdeen, MD", 39.47, -76.13], ["Cleveland, OH", 41.5, -81.69]];

  function tile(fh) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, a = new Uint8Array(img.width * img.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4]; res(a); };
      img.onerror = rej;
      img.src = "data/" + st.C.pattern.replace("{fh:03d}", String(fh).padStart(3, "0")) + "?r=" + st.man.run;
    });
  }
  function at(a, t, i, j) { const C = st.C, W = C.cols * C.nx; return a[(Math.floor(t / C.cols) * C.ny + j) * W + (t % C.cols) * C.nx + i] * C.step_deg; }
  function sample(a, t, lon, lat) {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % 360;
    return (at(a, t, i0, j0) * (1 - di) + at(a, t, i1, j0) * di) * (1 - dj) + (at(a, t, i0, j0 + 1) * (1 - di) + at(a, t, i1, j0 + 1) * di) * dj;
  }
  const vt = (k) => new Date(st.man.valid_times[st.man.forecast_hours.indexOf(st.C.fhs[k])]);
  const fmt = (d, o) => new Intl.DateTimeFormat(undefined, o).format(d);
  const el = (t, a, x) => { const e = document.createElement(t); for (const k in a || {}) e.setAttribute(k, a[k]); if (x != null) e.textContent = x; return e; };

  function render() {
    const s = st.site, out = $("out");
    out.textContent = "";
    if (!s) { out.appendChild(el("p", { class: "empty" }, "Enter the site's coordinates or pick an example.")); return; }
    $("siteName").textContent = s.name || `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
    const dirs = [...st.dirs].sort();
    // matrix: time x direction
    const M = st.tiles.map((a) => dirs.map((d) => sample(a, d, s.lon, s.lat)));
    const worst = M.map((r) => Math.max(...r));
    const best = worst.indexOf(Math.min(...worst));
    const tw = el("div", { class: "tblwrap", tabindex: "0", role: "region", "aria-label": "Blast windows" });
    const tb = el("table", { class: "tbl bw" });
    const hr = el("tr"); hr.appendChild(el("th", { scope: "col" }, "When (your time)"));
    dirs.forEach((d) => hr.appendChild(el("th", { scope: "col" }, `To ${DIRN[d]}`)));
    hr.appendChild(el("th", { scope: "col" }, "Overall"));
    const th = el("thead"); th.appendChild(hr); tb.appendChild(th);
    const body = el("tbody");
    M.forEach((r, k) => {
      const tr = el("tr", k === best ? { class: "key" } : {});
      tr.appendChild(el("td", { "data-label": "When" }, fmt(vt(k), { weekday: "short", hour: "numeric", minute: "2-digit" })));
      r.forEach((v, i) => { const R = RATE[rate(v)], td = el("td", { "data-label": `To ${DIRN[dirs[i]]}`, title: `${R.tip}; trapping angle ${v.toFixed(1)}°` });
        const b = el("span", { class: "chipr " + R.k }, R.lab); td.appendChild(b); tr.appendChild(td); });
      const R = RATE[rate(worst[k])]; const td = el("td", { "data-label": "Overall" }); td.appendChild(el("span", { class: "chipr " + R.k }, R.lab)); tr.appendChild(td);
      body.appendChild(tr);
    });
    tb.appendChild(body); tw.appendChild(tb);
    const v = el("p", { class: "bwverdict" }), nGood = worst.filter((w) => rate(w) === 0).length;
    v.textContent = nGood ? `${nGood} of ${worst.length} forecast times are Good toward every chosen direction` : "No fully Good time in the next 48 hours";
    out.appendChild(v);
    out.appendChild(el("p", { class: "sub" }, `Best: ${fmt(vt(best), { weekday: "long", hour: "numeric", minute: "2-digit" })}. Worst direction then: ${DIRN[dirs[M[best].indexOf(Math.max(...M[best]))]]}.`));
    out.appendChild(tw);
    // summary strip of the worst-direction angle over the 48 h
    const strip = el("div", { class: "ss" }); out.appendChild(strip);
    MC_UI.stat(strip, { values: worst, first: worst[0], last: worst[worst.length - 1], up: "bad", hl: worst[best], hlLabel: "best time", ref: T_AVOID, refLabel: "avoid",
      unit: "°", dec: 1, lo: 0, period: "next 48 h", label: "Worst-direction trapping angle" });
    const csv = el("button", { type: "button", class: "btn" }, "Download CSV"); csv.addEventListener("click", () => download(dirs, M));
    const pr = el("button", { type: "button", class: "btn" }, "Print"); pr.addEventListener("click", () => window.print());
    const row = el("div", { class: "btnrow" }); row.appendChild(csv); row.appendChild(pr); out.appendChild(row);
    save();
  }
  function download(dirs, M) {
    const head = ["valid_utc", ...dirs.map((d) => `angle_to_${DIRN[d]}_deg`), ...dirs.map((d) => `rating_to_${DIRN[d]}`)];
    const rows = M.map((r, k) => [vt(k).toISOString(), ...r.map((v) => v.toFixed(2)), ...r.map((v) => RATE[rate(v)].lab)]);
    const s = st.site, txt = [`# Mach Corridor blast windows, site ${s.lat.toFixed(4)},${s.lon.toFixed(4)}, GFS run ${st.man.run}. Research prototype; not a regulatory assessment.`, head.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv" })); a.download = `blast-windows_${s.lat.toFixed(2)}_${s.lon.toFixed(2)}.csv`; a.click();
  }
  function setSite(lat, lon, name) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 89) return;
    st.site = { lat, lon, name }; $("lat").value = lat.toFixed(4); $("lon").value = lon.toFixed(4); render();
  }
  function save() { try { localStorage.setItem("mc-blast", JSON.stringify({ site: st.site, dirs: [...st.dirs] })); } catch (e) { /* private mode */ } }
  function load() { try { return JSON.parse(localStorage.getItem("mc-blast") || "{}"); } catch (e) { return {}; } }

  async function main() {
    st.man = await fetch("data/manifest.json", { cache: "no-cache" }).then((r) => r.json());
    st.C = st.man.carry;
    if (!st.C || !st.C.fhs || !st.C.fhs.length) { $("out").appendChild(el("p", { class: "empty" }, "The forecast is not available in this update.")); return; }
    st.tiles = await Promise.all(st.C.fhs.map(tile));
    const ps = $("presets");
    for (const [n, la, lo] of PRESETS) { const b = el("button", { type: "button" }, n); b.addEventListener("click", () => setSite(la, lo, n)); ps.appendChild(b); }
    const ds = $("dirSeg");
    DIRN.forEach((n, i) => {
      const b = el("button", { type: "button", "aria-pressed": "true", "aria-label": `Neighbours to the ${n}` }, n); b.classList.add("on");
      b.addEventListener("click", () => { if (st.dirs.has(i) && st.dirs.size > 1) st.dirs.delete(i); else st.dirs.add(i);
        const on = st.dirs.has(i); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); render(); });
      ds.appendChild(b);
    });
    $("siteForm").addEventListener("submit", (e) => { e.preventDefault(); setSite(+$("lat").value, +$("lon").value, $("sname").value || null); });
    $("geo").addEventListener("click", () => navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => setSite(p.coords.latitude, p.coords.longitude, "Your location"), () => {}, { timeout: 10000 }));
    const sv = load();
    if (Array.isArray(sv.dirs) && sv.dirs.length) { st.dirs = new Set(sv.dirs); ds.querySelectorAll("button").forEach((b, i) => { const on = st.dirs.has(i); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); }
    if (sv.site) setSite(sv.site.lat, sv.site.lon, sv.site.name); else setSite(PRESETS[0][1], PRESETS[0][2], PRESETS[0][0]);
    $("runNote").textContent = `NOAA GFS run ${st.man.run_time.replace("T", " ").replace(":00:00Z", " UTC")}, every 6 hours, about 100 km grid.`;
  }
  main().catch((e) => { console.error(e); $("out").appendChild(el("p", { class: "empty" }, "The forecast could not be loaded.")); });
})();
