/* Mach Corridor — map styles: the style switcher (live thumbnails of each style) and the wind-flow animation.
   The styles themselves are drawn by app.js (MC.setLook, MC.drawContourLook, MC.drawRoseLook, satellite + overlay). */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const NAMES = { mach: "Mach", sat: "Satellite", earth: "No clouds", night: "Night", contour: "Contours", flow: "Wind flow", rose: "Directions" };
  const TIPS = {
    mach: "Boomless cruise Mach as colour",
    sat: "Corridors over yesterday's NASA satellite image",
    earth: "Corridors over NASA's cloud-free Blue Marble",
    night: "Corridors over NASA night lights",
    contour: "Isolines every 0.025 Mach, like a weather chart",
    flow: "The wind at this flight level, moving, coloured by Mach",
    rose: "Boomless Mach for each direction of travel",
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const normLon = lon => ((lon + 540) % 360) - 180;

  // ---------- shared: sample the displayed-Mach grid ----------
  function mAtGrid(G, lon, lat) {
    const fi = ((normLon(lon) + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi) % 360, j0 = Math.min(179, Math.floor(fj)), di = fi - Math.floor(fi), dj = fj - j0, i1 = (i0 + 1) % 360;
    return (G[j0 * 360 + i0] * (1 - di) + G[j0 * 360 + i1] * di) * (1 - dj) + (G[(j0 + 1) * 360 + i0] * (1 - di) + G[(j0 + 1) * 360 + i1] * di) * dj;
  }
  const rgba = (c, a = c[3]) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ---------- thumbnails: the North Atlantic, the same window for every style ----------
  const TH = { lon0: -105, lon1: 15, lat0: 5, lat1: 78 };
  function thumbView(w, h) {
    const toS = (lon, lat) => [(lon - TH.lon0) / (TH.lon1 - TH.lon0) * w, (TH.lat1 - lat) / (TH.lat1 - TH.lat0) * h];
    const sc = w / (TH.lon1 - TH.lon0) * 180 / Math.PI;
    const proj = d3.geoEquirectangular().scale(sc).translate([-sc * TH.lon0 * Math.PI / 180, sc * TH.lat1 * Math.PI / 180]);
    return { toS, proj, ppd: w / (TH.lon1 - TH.lon0) };
  }
  function cropGrid(g, src, perDeg, w, h, half = 0.5) {
    // src covers lon -180..180 (+half cell), lat 90..-90 at perDeg pixels per degree
    g.drawImage(src, (TH.lon0 + 180 + half) * perDeg, (90 - TH.lat1 + half) * perDeg, (TH.lon1 - TH.lon0) * perDeg, (TH.lat1 - TH.lat0) * perDeg, 0, 0, w, h);
  }
  function renderThumb(look, cnv) {
    const MC = window.MC; if (!MC || !MC.current) return;
    const g = cnv.getContext("2d"), w = cnv.width, h = cnv.height, v = thumbView(w, h), path = d3.geoPath(v.proj, g);
    g.save(); g.clearRect(0, 0, w, h);
    g.fillStyle = MC.isPhoto(look) ? "#01040b" : "#061029"; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    if (look === "mach") cropGrid(g, MC.off, 4, w, h);
    else if (MC.isPhoto(look)) {
      const img = MC.satGlobal(look, true);
      if (img) g.drawImage(img, (TH.lon0 + 180) / 360 * img.width, (90 - TH.lat1) / 180 * img.height, (TH.lon1 - TH.lon0) / 360 * img.width, (TH.lat1 - TH.lat0) / 180 * img.height, 0, 0, w, h);
      cropGrid(g, MC.ovl, 4, w, h);
      MC.strokeContours(g, v.toS, [MC.lit()], () => ({ stroke: "#ff9a2e", width: 1.2 }), w, h);
    } else if (MC.landGeo) { g.beginPath(); path(MC.landGeo); g.fillStyle = "rgba(150,175,215,.12)"; g.fill(); }
    if (look === "contour") MC.drawContourLook(g, v.toS, w, h, false);
    if (look === "rose") MC.drawRoseLook(g, v.toS, v.ppd, TH.lon0, TH.lon1, TH.lat1, TH.lat0, 34);
    if (look === "flow") streamlines(g, v.toS, w, h, 150, 16, 2600 / v.ppd, 1.2);
    if (MC.landMesh) { g.beginPath(); path(MC.landMesh); g.strokeStyle = look === "mach" ? "rgba(226,235,252,.5)" : "rgba(255,255,255,.35)"; g.lineWidth = 0.7; g.stroke(); }
    g.restore();
  }

  // ---------- wind flow ----------
  // static streamlines (thumbnails, reduced motion): n seeds, each integrated `steps` steps of dt seconds
  function streamlines(g, toS, w, h, n, steps, dt, lw, box) {
    const MC = window.MC, G = MC.mGrid(), a = MC.current;
    const b = box || { lon0: TH.lon0, lon1: TH.lon1, lat0: TH.lat0, lat1: TH.lat1 };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.lineCap = "round"; g.lineWidth = lw;
    for (let s = 0; s < n; s++) {
      let lon = b.lon0 + rnd() * (b.lon1 - b.lon0), lat = Math.max(-82, Math.min(82, b.lat0 + rnd() * (b.lat1 - b.lat0)));
      const c = MC.corridorColor(mAtGrid(G, lon, lat));
      let [x, y] = toS(lon, lat);
      for (let k = 0; k < steps; k++) {
        const [u, v] = MC.windAt(a, normLon(lon), lat);
        lon += u * dt / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180))); lat = Math.max(-85, Math.min(85, lat + v * dt / 111320));
        const [x2, y2] = toS(lon, lat);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.strokeStyle = rgba(c, (k + 1) / steps * 0.9); g.stroke();
        x = x2; y = y2;
      }
    }
  }
  const F = { on: false, raf: 0, parts: [], key: "", cnv: null, g: null };
  function flowActive() { const MC = window.MC; return MC && MC.look === "flow" && MC.S.view !== "3d" && !$("tab-map").hidden && !!MC.current; }
  function sizeFlow() {
    const MC = window.MC, v = MC.view, c = F.cnv, w = Math.round(v.W * v.dpr), h = Math.round(v.H * v.dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    F.g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  }
  function box() {
    const MC = window.MC, v = MC.view, [lonA, latA] = MC.toLonLat(0, 0), [lonB, latB] = MC.toLonLat(v.W, v.H);
    return { lon0: lonA, lon1: lonB, lat0: Math.max(-82, latB), lat1: Math.min(82, latA) };
  }
  function spawn(p, b) {
    p.lon = b.lon0 + Math.random() * (b.lon1 - b.lon0); p.lat = b.lat0 + Math.random() * (b.lat1 - b.lat0);
    p.age = 0; p.max = 90 + Math.random() * 110; return p;
  }
  function viewKey() { const MC = window.MC, t = MC.S.t, v = MC.view; return [t.x.toFixed(1), t.y.toFixed(1), t.k.toFixed(3), v.W, v.H, MC.S.fl].join("|"); }   // time steps keep the particles
  function resetFlow() {
    const MC = window.MC, v = MC.view, b = box(), n = Math.min(7000, Math.round(v.W * v.H / 330));
    F.parts = Array.from({ length: n }, () => spawn({}, b)); F.parts.forEach(p => { p.age = Math.random() * p.max; });
    F.g.clearRect(0, 0, v.W, v.H); F.key = viewKey();
  }
  const BUCKETS = 14;
  function frame() {
    F.raf = 0;
    if (!flowActive()) { stopFlow(); return; }
    const MC = window.MC, v = MC.view, g = F.g;
    sizeFlow();
    if (F.key !== viewKey()) resetFlow();
    if (reduced.matches) {          // no motion: one still frame of streamlines
      g.clearRect(0, 0, v.W, v.H);
      streamlines(g, (lon, lat) => MC.toScreen(lon, lat), v.W, v.H, Math.min(1400, Math.round(v.W * v.H / 1400)), 14, 2600 / (v.k * v.W0 / 360), 1.2, box());
      return;
    }
    const ppd = v.k * v.W0 / 360, dt = 3.0 * 111320 / (50 * ppd), b = box(), G = MC.mGrid(), a = MC.current;
    g.globalCompositeOperation = "destination-in"; g.fillStyle = "rgba(0,0,0,0.955)"; g.fillRect(0, 0, v.W, v.H);
    g.globalCompositeOperation = "source-over";
    const paths = Array.from({ length: BUCKETS + 1 }, () => new Path2D());
    for (const p of F.parts) {
      if (p.age++ > p.max) { spawn(p, b); continue; }
      const [u, w] = MC.windAt(a, normLon(p.lon), p.lat);
      const [x0, y0] = MC.toScreen(p.lon, p.lat);
      p.lon += u * dt / (111320 * Math.max(0.2, Math.cos(p.lat * Math.PI / 180))); p.lat += w * dt / 111320;
      if (p.lat > 85 || p.lat < -85) { spawn(p, b); continue; }
      const [x1, y1] = MC.toScreen(p.lon, p.lat);
      if (x1 < -20 || x1 > v.W + 20 || y1 < -20 || y1 > v.H + 20) { spawn(p, b); continue; }
      const M = mAtGrid(G, p.lon, p.lat), f = MC.lit();
      const k = M < f ? BUCKETS : Math.min(BUCKETS - 1, Math.floor((M - f) / 0.25 * BUCKETS));
      paths[k].moveTo(x0, y0); paths[k].lineTo(x1, y1);
    }
    g.lineWidth = 1.5; g.lineCap = "round";
    for (let k = 0; k <= BUCKETS; k++) {
      const c = MC.corridorColor(k === BUCKETS ? 0 : MC.lit() + (k + 0.5) / BUCKETS * 0.25);
      g.strokeStyle = rgba(c, k === BUCKETS ? 0.45 : 0.9); g.stroke(paths[k]);
    }
    F.raf = requestAnimationFrame(frame);
  }
  function startFlow() { if (!F.raf) { F.cnv.hidden = false; F.raf = requestAnimationFrame(frame); } }
  function stopFlow() { if (F.raf) cancelAnimationFrame(F.raf); F.raf = 0; if (F.cnv) { F.cnv.hidden = !flowActive(); if (F.cnv.hidden) F.g.clearRect(0, 0, F.cnv.width, F.cnv.height); } }
  function syncFlow() { if (flowActive()) startFlow(); else stopFlow(); }

  // ---------- the switcher ----------
  let thumbTimer = null;
  function renderThumbs() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      if (window.MC.S.playing) { renderThumbs(); return; }      // the forecast is playing: wait until it stops
      document.querySelectorAll("#lens canvas").forEach(c => renderThumb(c.dataset.look, c));
    }, 700);
  }
  function mark() {
    document.querySelectorAll("#lens button").forEach(b => {
      const on = b.dataset.look === window.MC.look;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1;
    });
  }
  function build() {
    const MC = window.MC, el = $("lens");
    el.innerHTML = MC.LOOKS.map(l => `<button role="radio" data-look="${l}" title="${TIPS[l]}"><canvas data-look="${l}" width="128" height="80" aria-hidden="true"></canvas><span>${NAMES[l]}</span></button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => { MC.setLook(b.dataset.look); });
    el.onkeydown = e => {
      const bs = [...el.querySelectorAll("button")], i = bs.indexOf(document.activeElement), d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (i < 0 || !d) return;
      const n = bs[(i + d + bs.length) % bs.length]; n.click(); n.focus(); e.preventDefault();
    };
    el.hidden = false;
    F.cnv = $("flow"); F.g = F.cnv.getContext("2d");
    MC.on("look", () => { mark(); syncFlow(); });
    MC.on("texture", renderThumbs);
    MC.on("refresh", () => { renderThumbs(); syncFlow(); });
    MC.on("draw", syncFlow);
    window.addEventListener("mc-tab", () => setTimeout(syncFlow, 0));
    reduced.addEventListener("change", () => { F.key = ""; syncFlow(); });
    MC.satGlobal("sat", true); MC.satGlobal("earth", true); MC.satGlobal("night", true);   // small images, so the thumbnails fill in
    mark(); renderThumbs(); syncFlow();
  }
  window.addEventListener("mc-ready", build);
})();
