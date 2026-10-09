/* Mach Corridor — core map app (v2). Data: engine/build.py (manifest.json v2). */
(() => {
  "use strict";
  const DATA = window.MC_DATA_BASE || "data/";
  const NX = 360, NY = 181;
  const KT = 1.943844;
  const FLOOR = 1.05;                         // one usable-corridor floor everywhere

  const AIRPORTS = [
    ["KJFK", "New York JFK", 40.64, -73.78], ["KBOS", "Boston", 42.36, -71.01], ["KIAD", "Washington Dulles", 38.95, -77.46],
    ["KATL", "Atlanta", 33.64, -84.43], ["KMIA", "Miami", 25.79, -80.29], ["KORD", "Chicago O'Hare", 41.98, -87.90],
    ["KCLE", "Cleveland", 41.41, -81.85], ["KMSP", "Minneapolis", 44.88, -93.22], ["KDFW", "Dallas/Fort Worth", 32.90, -97.04],
    ["KIAH", "Houston", 29.98, -95.34], ["KDEN", "Denver", 39.86, -104.67], ["KPHX", "Phoenix", 33.43, -112.01],
    ["KLAS", "Las Vegas", 36.08, -115.15], ["KLAX", "Los Angeles", 33.94, -118.41], ["KSFO", "San Francisco", 37.62, -122.38],
    ["KSEA", "Seattle", 47.45, -122.31], ["PANC", "Anchorage", 61.17, -150.00], ["PHNL", "Honolulu", 21.32, -157.92],
    ["TJSJ", "San Juan", 18.44, -66.00], ["CYYZ", "Toronto", 43.68, -79.63], ["CYVR", "Vancouver", 49.19, -123.18],
    ["MMMX", "Mexico City", 19.44, -99.07], ["SKBO", "Bogotá", 4.70, -74.15], ["SPJC", "Lima", -12.02, -77.11],
    ["SBGR", "São Paulo", -23.44, -46.47], ["SAEZ", "Buenos Aires", -34.82, -58.54], ["SCEL", "Santiago", -33.39, -70.79],
    ["EGLL", "London Heathrow", 51.47, -0.45], ["LFPG", "Paris CDG", 49.01, 2.55], ["EHAM", "Amsterdam", 52.31, 4.76],
    ["EDDF", "Frankfurt", 50.03, 8.56], ["LEMD", "Madrid", 40.49, -3.57], ["LIRF", "Rome", 41.80, 12.25],
    ["LTFM", "Istanbul", 41.26, 28.74], ["UUEE", "Moscow SVO", 55.97, 37.41], ["HECA", "Cairo", 30.12, 31.41],
    ["GMMN", "Casablanca", 33.37, -7.59], ["DNMM", "Lagos", 6.58, 3.32], ["HKJK", "Nairobi", -1.32, 36.93],
    ["FAOR", "Johannesburg", -26.14, 28.24], ["OMDB", "Dubai", 25.25, 55.36], ["OTHH", "Doha", 25.27, 51.61],
    ["VIDP", "Delhi", 28.57, 77.10], ["VABB", "Mumbai", 19.09, 72.87], ["WSSS", "Singapore", 1.36, 103.99],
    ["VHHH", "Hong Kong", 22.31, 113.91], ["ZBAA", "Beijing", 40.08, 116.58], ["ZSPD", "Shanghai", 31.14, 121.81],
    ["RKSI", "Seoul Incheon", 37.46, 126.44], ["RJTT", "Tokyo Haneda", 35.55, 139.78], ["YSSY", "Sydney", -33.95, 151.18],
    ["YMML", "Melbourne", -37.67, 144.84], ["NZAA", "Auckland", -37.01, 174.79],
  ];
  const APT = Object.fromEntries(AIRPORTS.map(a => [a[0], a]));

  const S = { man: null, fl: 450, hd: "min", hdDeg: 90, fi: 0, margin: 0.03, fade: true, view: "2d",
              t: d3.zoomIdentity, sel: null, playing: null };
  const cache = new Map();
  const $ = id => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  let W = 0, H = 0, W0 = 0, H0 = 0, x0 = 0, y0 = 0, dpr = 1, land = null, borders = null, landGeo = null;
  const off = document.createElement("canvas"); off.width = NX; off.height = NY;
  const offCtx = off.getContext("2d");
  let colorKey = "", current = null;
  const listeners = { refresh: [], select: [], shiftSelect: [], texture: [], ready: [] };
  const emit = (ev, ...a) => listeners[ev].forEach(f => f(...a));

  // ---------- color: diverging red (no corridor) -> pale -> green (corridor), midpoint at FLOOR ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => {
    const a = document.documentElement.getAttribute("data-theme");
    return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const RED = d3.interpolateRgbBasis(["#8e0f22", "#c62d36", "#e8735f", "#f6c9a8"]);
  const GREEN = d3.interpolateRgbBasis(["#d9efb0", "#8fcf6b", "#3aa356", "#137a3b", "#04492a"]);
  function colorFor(M) {
    let c;
    if (M < FLOOR) c = d3.rgb(RED(Math.max(0, Math.min(1, (M - 0.98) / (FLOOR - 0.98)))));
    else c = d3.rgb(GREEN(Math.min(1, (M - FLOOR) / (1.30 - FLOOR))));
    return [c.r, c.g, c.b];
  }

  // ---------- data ----------
  const enc = () => S.man.encoding;
  const A = () => S.man.atlas;
  const AW = () => A().cols * NX;
  const toM = v => v === 0 ? 0.98 : enc().M0 + enc().M_step * v;
  const fhs = () => S.man.forecast_hours;
  function loadAtlas(fh, fl) {
    const k = `${fh}_${fl}`;
    if (cache.has(k)) return cache.get(k);
    const p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        const a = new Uint8Array(img.width * img.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4];
        res(a);
      };
      img.onerror = rej;
      img.src = DATA + `f${String(fh).padStart(3, "0")}_FL${fl}.png?r=${S.man.run}`;
    });
    cache.set(k, p);
    return p;
  }
  const profCache = new Map();
  function loadProfiles(fh) {
    if (profCache.has(fh)) return profCache.get(fh);
    const p = fetch(DATA + `prof_f${String(fh).padStart(3, "0")}.bin?r=${S.man.run}`).then(r => r.arrayBuffer()).then(b => new Int16Array(b));
    profCache.set(fh, p); return p;
  }
  function profileAt(arr, lon, lat) {
    const P = S.man.profiles, L = P.levels, nx = P.nx, ny = P.ny;
    const i = ((Math.round((lon - P.lon0) / P.d) % nx) + nx) % nx, j = Math.min(ny - 1, Math.max(0, Math.round((P.lat0 - lat) / P.d)));
    const g = (f, k) => arr[((f * L + k) * ny + j) * nx + i];
    const out = { plev: S.man.plev, c: [], u: [], v: [], z: [], lon: P.lon0 + i * P.d, lat: P.lat0 - j * P.d };
    for (let k = 0; k < L; k++) { out.c.push(g(0, k) / 10); out.u.push(g(1, k) / 10); out.v.push(g(2, k) / 10); out.z.push(g(3, k)); }
    out.ground = arr[((4 * L) * ny + j) * nx + i];
    return out;
  }

  const tileOf = hd => hd === "min" ? A().tile_min : hd === "max" ? A().tile_max : Math.round(hd / 10) % 36;
  const curTile = () => tileOf(S.hd === "hd" ? S.hdDeg : S.hd);
  const raw = (a, tile, i, j) => a[(Math.floor(tile / A().cols) * NY + j) * AW() + (tile % A().cols) * NX + i];
  function sample(a, tile, lon, lat) {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
    return (raw(a, tile, i0, j0) * (1 - di) + raw(a, tile, i1, j0) * di) * (1 - dj) +
           (raw(a, tile, i0, j0 + 1) * (1 - di) + raw(a, tile, i1, j0 + 1) * di) * dj;
  }
  // M at a point: zero-valued (no corridor) neighbours pull the value below 1 naturally (toM(0)=0.98)
  function mAt(a, tile, lon, lat) {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
    const m = (i, j) => toM(raw(a, tile, i, j));
    return (m(i0, j0) * (1 - di) + m(i1, j0) * di) * (1 - dj) + (m(i0, j0 + 1) * (1 - di) + m(i1, j0 + 1) * di) * dj;
  }
  // conservative between headings: min of the two bracketing 10-degree tiles
  function mHeading(a, hdg, lon, lat) {
    const h = ((hdg % 360) + 360) % 360 / 10, k0 = Math.floor(h) % 36, k1 = (k0 + 1) % 36;
    return Math.min(mAt(a, k0, lon, lat), mAt(a, k1, lon, lat));
  }
  const cAt = (a, lon, lat) => sample(a, A().tile_c, lon, lat) + enc().c_offset;
  const landAt = (a, lon, lat) => sample(a, A().tile_land, lon, lat) / 255;
  const windAt = (a, lon, lat) => [sample(a, A().tile_u, lon, lat) - enc().wind_offset, sample(a, A().tile_v, lon, lat) - enc().wind_offset];

  // ---------- geometry ----------
  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    W0 = W / H < 1.3 ? W * 1.6 : Math.max(W, 2 * H * 0.92); H0 = W0 / 2; x0 = (W - W0) / 2; y0 = (H - H0) / 2;
    zoom.extent([[0, 0], [W, H]]).translateExtent([[Math.min(0, x0) - W0, Math.min(0, y0)], [Math.max(W, x0 + W0) + W0, Math.max(H, y0 + H0)]]);
  }
  const toScreen = (lon, lat) => [S.t.x + S.t.k * (x0 + (lon + 180) / 360 * W0), S.t.y + S.t.k * (y0 + (90 - lat) / 180 * H0)];
  function toLonLat(sx, sy) {
    const bx = (sx - S.t.x) / S.t.k, by = (sy - S.t.y) / S.t.k;
    return [(bx - x0) / W0 * 360 - 180, 90 - (by - y0) / H0 * 180];
  }
  const proj = (dx = 0) => d3.geoEquirectangular().precision(0.5)
    .scale(S.t.k * W0 / (2 * Math.PI)).translate([S.t.x + S.t.k * (x0 + W0 / 2 + dx), S.t.y + S.t.k * (y0 + H0 / 2)]);

  // ---------- render ----------
  let rafPending = false;
  const schedule = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(draw); } };
  const overlays = [];   // functions (ctx, toScreen, wrapOffsets) drawn on top (routes)

  async function refresh() {
    if (!S.man) return;
    current = await loadAtlas(fhs()[S.fi], S.fl);
    colorKey = "";
    updateKpis(); updateInspector(); schedule(); writeHash();
    emit("refresh");
  }

  function paintData() {
    const k = [S.fi, S.fl, S.hd, S.hdDeg, S.margin, S.fade, isDark()].join("|");
    if (k === colorKey || !current) return false;
    colorKey = k;
    const img = offCtx.createImageData(NX, NY), tile = curTile();
    const lut = [];
    for (let v = 0; v < 256; v++) lut.push(colorFor(toM(v) - S.margin));
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = lut[raw(current, tile, i, j)], o = (j * NX + i) * 4;
      const isLand = raw(current, A().tile_land, i, j) > 127;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
      img.data[o + 3] = S.fade && !isLand ? 80 : 235;
    }
    offCtx.putImageData(img, 0, 0);
    drawLegend();
    return true;
  }

  function draw() {
    rafPending = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--ocean"); ctx.fillRect(0, 0, W, H);
    const changed = paintData();
    if (changed) emit("texture");
    const wraps = [-W0, 0, W0];
    if (current) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      for (const dx of wraps) {
        const [ax, ay] = toScreen(-180.5, 90.5), [bx, by] = toScreen(179.5, -90.5);
        const ox = dx * S.t.k;
        if (bx + ox < 0 || ax + ox > W) continue;
        ctx.drawImage(off, ax + ox, ay, bx - ax, by - ay);
      }
    }
    for (const dx of wraps) {
      const path = d3.geoPath(proj(dx), ctx);
      ctx.lineJoin = "round";
      ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = css("--grat"); ctx.lineWidth = 1; ctx.stroke();
      if (borders) { ctx.beginPath(); path(borders); ctx.strokeStyle = css("--border-c"); ctx.lineWidth = 0.6; ctx.stroke(); }
      if (land) { ctx.beginPath(); path(land); ctx.strokeStyle = css("--coast"); ctx.lineWidth = 0.9; ctx.stroke(); }
    }
    for (const f of overlays) f(ctx, toScreen, S.t.k * W0);
    if (S.sel) {
      const [sx, sy] = toScreen(S.sel[0], S.sel[1]);
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
      ctx.lineWidth = 4; ctx.strokeStyle = css("--casing"); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = css("--text"); ctx.stroke();
    }
  }

  function drawLegend() {
    const c = $("legendBar"), g = c.getContext("2d");
    for (let x = 0; x < c.width; x++) {
      const M = 1.0 + (x / (c.width - 1)) * 0.30;
      g.fillStyle = `rgb(${colorFor(M)})`; g.fillRect(x, 0, 1, c.height);
    }
  }

  // ---------- inspector ----------
  const fmtLat = lat => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const fmtLon = lon => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  function updateInspector() {
    if (!S.sel || !current) return;
    const [lon, lat] = S.sel;
    $("inspHint").textContent = ""; $("inspBody").hidden = false;
    $("inspLoc").textContent = `${fmtLat(lat)} ${fmtLon(lon)}`;
    $("inspSurf").textContent = landAt(current, lon, lat) > 0.5 ? "land" : "ocean";
    const ms = S.man.headings.map((h, i) => mAt(current, i, lon, lat) - S.margin);
    const c = cAt(current, lon, lat), [u, v] = windAt(current, lon, lat);
    const iMin = ms.indexOf(Math.min(...ms)), iMax = ms.indexOf(Math.max(...ms));
    const selI = S.hd === "min" ? iMin : S.hd === "max" ? iMax : Math.round(S.hdDeg / 10) % 36;
    const fmtM = m => m < 1.0 ? "none" : "M " + m.toFixed(3);
    const dirLbl = S.hd === "min" ? "Any direction" : S.hd === "max" ? "Best direction" : `Heading ${String(S.hdDeg).padStart(3, "0")}°`;
    const wspd = Math.hypot(u, v), wdir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
    $("inspFacts").innerHTML = `
      <dt>${dirLbl}</dt><dd>${fmtM(ms[selI])}</dd>
      <dt>True airspeed</dt><dd>${ms[selI] >= 1 ? Math.round(ms[selI] * c * KT) + " kt" : "—"}</dd>
      <dt>Worst (${String(S.man.headings[iMin]).padStart(3, "0")}°)</dt><dd>${fmtM(ms[iMin])}</dd>
      <dt>Best (${String(S.man.headings[iMax]).padStart(3, "0")}°)</dt><dd>${fmtM(ms[iMax])}</dd>
      <dt>Wind FL${S.fl}</dt><dd>${String(Math.round(wdir)).padStart(3, "0")}° / ${Math.round(wspd * KT)} kt</dd>
      <dt>Sound speed</dt><dd>${Math.round(c * KT)} kt</dd>`;
    drawPolar(ms, selI);
    drawTimeSeries(lon, lat);
  }
  function drawPolar(ms, selI) {
    const svg = d3.select("#polar"); svg.selectAll("*").remove();
    const R = 92, r = d3.scaleLinear([0.98, 1.3], [0, R]).clamp(true);
    svg.append("circle").attr("r", r(FLOOR)).attr("fill", "var(--red-soft)").attr("stroke", "var(--red)").attr("stroke-dasharray", "3 3");
    for (const v of [1.1, 1.2, 1.3]) {
      svg.append("circle").attr("r", r(v)).attr("fill", "none").attr("stroke", "var(--line)");
      svg.append("text").attr("x", 3).attr("y", -r(v) + 10).text(v.toFixed(1));
    }
    for (const [lbl, a] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
      const t = a * Math.PI / 180;
      svg.append("text").attr("x", Math.sin(t) * (R + 13)).attr("y", -Math.cos(t) * (R + 13) + 4).attr("text-anchor", "middle").style("font-weight", 600).text(lbl);
    }
    const pt = (m, i) => { const t = S.man.headings[i] * Math.PI / 180; return [Math.sin(t) * r(m), -Math.cos(t) * r(m)]; };
    const pts = ms.map(pt);
    svg.append("path").attr("d", d3.line().curve(d3.curveLinearClosed)(pts))
      .attr("fill", "var(--green)").attr("fill-opacity", 0.15).attr("stroke", "var(--green)").attr("stroke-width", 2);
    svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", d => d[0]).attr("cy", d => d[1])
      .attr("r", (d, i) => i === selI ? 5 : 1.8).attr("fill", (d, i) => i === selI ? "var(--text)" : "var(--green)")
      .attr("stroke", "var(--surface)").attr("stroke-width", (d, i) => i === selI ? 1.5 : 0)
      .append("title").text((d, i) => `${S.man.headings[i]}°: ${ms[i] < 1 ? "no corridor" : "M " + ms[i].toFixed(3)}`);
  }
  async function drawTimeSeries(lon, lat) {
    const fl = S.fl, key = [S.hd, S.hdDeg].join(), sel = S.sel;
    const atl = await Promise.all(fhs().map(fh => loadAtlas(fh, fl)));
    if (S.sel !== sel || S.fl !== fl || [S.hd, S.hdDeg].join() !== key) return;
    const tile = curTile();
    const vt = S.man.valid_times.map(s => new Date(s));
    const data = atl.map((a, i) => ({ t: vt[i], m: mAt(a, tile, lon, lat) - S.margin }));
    const svg = d3.select("#ts"); svg.selectAll("*").remove();
    const m = { l: 30, r: 8, t: 8, b: 22 }, w = 320 - m.l - m.r, h = 130 - m.t - m.b;
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleUtc(d3.extent(vt), [0, w]);
    const y = d3.scaleLinear([0.98, Math.max(1.3, d3.max(data, d => d.m))], [h, 0]);
    g.append("rect").attr("x", 0).attr("width", w).attr("y", y(FLOOR)).attr("height", h - y(FLOOR)).attr("fill", "var(--red-soft)");
    g.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(4).tickFormat(d3.format(".2f"))).call(s => s.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(d3.utcHour.every(12)).tickSize(3).tickFormat(d3.utcFormat("%a %HZ"))).call(s => s.select(".domain").attr("stroke", "var(--line)"));
    g.append("line").attr("x1", x(vt[S.fi])).attr("x2", x(vt[S.fi])).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text-2)").attr("stroke-dasharray", "3 3");
    g.append("path").datum(data).attr("fill", "none").attr("stroke", "var(--green)").attr("stroke-width", 2).attr("d", d3.line().x(d => x(d.t)).y(d => y(Math.max(0.98, d.m))));
    g.append("g").selectAll("circle").data(data).join("circle").attr("cx", d => x(d.t)).attr("cy", d => y(Math.max(0.98, d.m))).attr("r", (d, i) => i === S.fi ? 4.5 : 3)
      .attr("fill", (d, i) => i === S.fi ? "var(--text)" : (d.m >= FLOOR ? "var(--green)" : "var(--red)")).attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .append("title").text(d => `${d3.utcFormat("%a %d %HZ")(d.t)}: ${d.m < 1 ? "no corridor" : "M " + d.m.toFixed(3)}`);
    $("tsSub").textContent = `· FL${fl}, ${S.hd === "min" ? "any direction" : S.hd === "max" ? "best direction" : S.hdDeg + "°"}`;
  }

  // ---------- kpis / labels ----------
  function updateKpis() {
    const st = S.man.stats[String(S.fl)]?.[S.fi];
    if (st) {
      $("kpiLand").textContent = st.land_any_median - S.margin < 1 ? "none" : `M ${(st.land_any_median - S.margin).toFixed(2)}`;
      const th = S.man.stats_thresholds, target = FLOOR + S.margin;
      let pct = 0;
      for (let i = 0; i < th.length - 1; i++) if (target >= th[i] && target <= th[i + 1]) {
        const f = (target - th[i]) / (th[i + 1] - th[i]); pct = st.land_any_cdf[i] * (1 - f) + st.land_any_cdf[i + 1] * f;
      }
      $("kpiPct").textContent = `${Math.round(pct * 100)}%`;
    }
    const vt = new Date(S.man.valid_times[S.fi]);
    $("timeLbl").textContent = `${d3.utcFormat("%a %d %b %H:%M")(vt)} UTC (+${fhs()[S.fi]}h)`;
    $("hdLbl").textContent = S.hd === "min" ? "any (worst case)" : S.hd === "max" ? "best" : `${String(S.hdDeg).padStart(3, "0")}°`;
    $("marginLbl").textContent = S.margin.toFixed(3);
  }

  // ---------- hover / click ----------
  const tip = $("tip");
  const normLon = lon => ((lon + 540) % 360) - 180;
  function describe(lon, lat) {
    const M = mAt(current, curTile(), lon, lat) - S.margin, c = cAt(current, lon, lat);
    return `<b>${M < 1 ? "No corridor" : "M " + M.toFixed(3)}</b>${M >= 1 ? " · " + Math.round(M * c * KT) + " kt" : ""}${M >= 1 && M < FLOOR ? " <span class='muted'>(below 1.05)</span>" : ""}<br><span class="muted">${fmtLat(lat)} ${fmtLon(lon)} · ${landAt(current, lon, lat) > 0.5 ? "land" : "ocean"}</span>`;
  }
  function showTip(html, sx, sy) {
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, r = $("mapWrap").getBoundingClientRect();
    tip.style.left = Math.min(r.width - tw - 6, sx + 14) + "px";
    tip.style.top = Math.max(6, sy - th - 10) + "px";
  }
  function onMove(e) {
    if (!current) return;
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [lon, lat] = toLonLat(sx, sy);
    if (lat > 90 || lat < -90) { tip.hidden = true; return; }
    showTip(describe(normLon(lon), lat), sx, sy);
  }
  function pick(lon, lat, shift) {
    lon = normLon(lon);
    if (shift && S.sel) emit("shiftSelect", S.sel.slice(), [lon, lat]);
    else { S.sel = [lon, lat]; updateInspector(); emit("select", S.sel); }
    schedule(); writeHash();
  }
  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    const [lon, lat] = toLonLat(e.clientX - r.left, e.clientY - r.top);
    if (lat > 90 || lat < -90) return;
    pick(lon, lat, e.shiftKey);
  }

  // ---------- controls ----------
  function seg(el, items, get, set) {
    if (items) {
      el.innerHTML = "";
      for (const [val, label, title] of items) {
        const b = document.createElement("button");
        b.textContent = label; b.setAttribute("role", "radio"); if (title) b.title = title;
        b.dataset.v = String(val); el.appendChild(b);
      }
    }
    const mark = () => el.querySelectorAll("button").forEach(b => {
      const on = b.dataset.v === String(get()); b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
    });
    el.querySelectorAll("button").forEach(b => b.onclick = () => { set(isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v); mark(); });
    mark(); return mark;
  }
  function buildControls() {
    seg($("flSeg"), S.man.flight_levels.map(f => [f, `FL${f}`]), () => S.fl, v => { S.fl = v; refresh(); });
    seg($("hdSeg"), null, () => S.hd, v => { S.hd = v; $("hdSlider").disabled = v !== "hd"; refresh(); });
    $("hdSlider").value = S.hdDeg; $("hdSlider").disabled = S.hd !== "hd";
    $("hdSlider").oninput = e => { S.hdDeg = +e.target.value; refresh(); };
    const sl = $("timeSlider"); sl.max = fhs().length - 1; sl.value = S.fi;
    sl.oninput = () => { S.fi = +sl.value; refresh(); };
    $("marginSlider").value = S.margin;
    $("marginSlider").oninput = e => { S.margin = +e.target.value; refresh(); };
    $("fadeOcean").onchange = e => { S.fade = e.target.checked; schedule(); };
    $("playBtn").onclick = togglePlay;
    $("apts").innerHTML = AIRPORTS.map(a => `<option value="${a[0]}">${a[1]}</option>`).join("");
    $("aboutBtn").onclick = () => $("about").showModal();
    $("limitsX").onclick = () => { $("limits").hidden = true; };
    seg($("viewSeg"), null, () => S.view, v => { S.view = v; setView(); });
    document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  }
  function setView() {
    const g = S.view === "3d";
    $("globe").hidden = !g; canvas.style.visibility = g ? "hidden" : "visible";
    $("hint").textContent = g ? "Drag to rotate · click: inspect · shift-click: route" : "Click: inspect + 3D column · Shift-click: route to here · scroll to zoom";
    if (g && window.MC3D) window.MC3D.showGlobe($("globe"));
    writeHash();
  }
  function setTab(t) {
    document.querySelectorAll(".tabs button").forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $("tab-map").hidden = t !== "map"; $("mapControls").hidden = t !== "map"; $("tab-econ").hidden = t !== "econ";
    if (t === "map") { layout(); schedule(); }
  }
  function togglePlay() {
    if (S.playing) { clearInterval(S.playing); S.playing = null; $("playBtn").textContent = "▶"; return; }
    fhs().forEach(fh => loadAtlas(fh, S.fl));
    $("playBtn").textContent = "❚❚";
    S.playing = setInterval(() => { S.fi = (S.fi + 1) % fhs().length; $("timeSlider").value = S.fi; refresh(); }, 900);
  }

  // ---------- URL state ----------
  const hashExtra = {};
  function writeHash() {
    if (!S.man) return;
    const p = new URLSearchParams({ fl: S.fl, d: S.hd === "hd" ? S.hdDeg : S.hd, t: S.fi, mg: S.margin, v: S.view });
    for (const [k, v] of Object.entries(hashExtra)) if (v != null) p.set(k, v);
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("fl") && S.man.flight_levels.includes(+p.get("fl"))) S.fl = +p.get("fl");
    const d = p.get("d");
    if (d === "min" || d === "max") S.hd = d; else if (d != null && !isNaN(+d)) { S.hd = "hd"; S.hdDeg = (Math.round(+d / 10) * 10) % 360; }
    if (p.get("t")) S.fi = Math.min(fhs().length - 1, Math.max(0, +p.get("t")));
    if (p.get("mg") != null) S.margin = Math.max(0, +p.get("mg"));
    if (p.get("v") === "3d") S.view = "3d";
    return p;
  }

  // ---------- public API for plan.js / view3d.js ----------
  window.MC = {
    S, APT, AIRPORTS, FLOOR, KT, loadAtlas, loadProfiles, profileAt, mAt, mHeading, cAt, landAt, windAt, tileOf, curTile,
    colorFor, toM, raw, off, overlays, schedule, refresh, pick, describe, showTip, normLon, fmtLat, fmtLon, hashExtra, writeHash,
    get current() { return current; }, get landGeo() { return landGeo; }, get landMesh() { return land; },
    on: (ev, f) => listeners[ev].push(f), css, isDark,
  };

  // ---------- boot ----------
  const zoom = d3.zoom().scaleExtent([1, 16]).on("zoom", e => { S.t = e.transform; tip.hidden = true; schedule(); });
  async function boot() {
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => tip.hidden = true);
    canvas.addEventListener("click", onClick);
    layout();
    window.addEventListener("resize", () => { layout(); schedule(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { colorKey = ""; schedule(); });
    try {
      const [man, topo] = await Promise.all([
        fetch(DATA + "manifest.json", { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("vendor/countries-50m.json").then(r => r.json()),
      ]);
      if ((man.version || 1) < 2) throw new Error("data is v1; waiting for the next forecast build");
      S.man = man;
      land = topojson.mesh(topo, topo.objects.countries, (a, b) => a === b);
      borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
      landGeo = topojson.merge(topo, topo.objects.countries.geometries);
      const p = readHash();
      buildControls();
      const rt = new Date(man.run_time), gen = new Date(man.generated);
      $("runInfo").innerHTML = `GFS ${d3.utcFormat("%d %b %Y %HZ")(rt)} run · updated ${d3.utcFormat("%d %b %H:%MZ")(gen)}`;
      await refresh();
      if (S.view === "3d") setView();
      emit("ready", p);
      window.dispatchEvent(new CustomEvent("mc-ready", { detail: p }));
    } catch (err) {
      console.error(err);
      $("runInfo").textContent = "Could not load forecast data: " + err.message;
    }
  }
  boot();
})();
