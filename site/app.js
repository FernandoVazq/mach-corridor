/* Mach Corridor — client app. Data: atlases built by engine/build.py (see manifest.json). */
(() => {
  "use strict";
  const DATA = window.MC_DATA_BASE || "data/";
  const NX = 360, NY = 181, AW = 1440;
  const KT = 1.943844, NM = 3440.065;

  const AIRPORTS = [
    ["KJFK", "New York JFK", 40.64, -73.78], ["KBOS", "Boston", 42.36, -71.01], ["KIAD", "Washington Dulles", 38.95, -77.46],
    ["KATL", "Atlanta", 33.64, -84.43], ["KMIA", "Miami", 25.79, -80.29], ["KORD", "Chicago O'Hare", 41.98, -87.90],
    ["KCLE", "Cleveland", 41.41, -81.85], ["KMSP", "Minneapolis", 44.88, -93.22], ["KDFW", "Dallas/Fort Worth", 32.90, -97.04],
    ["KGPM", "Grand Prairie", 32.70, -97.05], ["KIAH", "Houston", 29.98, -95.34], ["KDEN", "Denver", 39.86, -104.67],
    ["KPHX", "Phoenix", 33.43, -112.01], ["KLAS", "Las Vegas", 36.08, -115.15], ["KLAX", "Los Angeles", 33.94, -118.41],
    ["KSFO", "San Francisco", 37.62, -122.38], ["KSEA", "Seattle", 47.45, -122.31], ["PANC", "Anchorage", 61.17, -150.00],
    ["PHNL", "Honolulu", 21.32, -157.92], ["TJSJ", "San Juan", 18.44, -66.00], ["CYYZ", "Toronto", 43.68, -79.63],
    ["CYVR", "Vancouver", 49.19, -123.18], ["MMMX", "Mexico City", 19.44, -99.07], ["SKBO", "Bogotá", 4.70, -74.15],
    ["SPJC", "Lima", -12.02, -77.11], ["SBGR", "São Paulo", -23.44, -46.47], ["SAEZ", "Buenos Aires", -34.82, -58.54],
    ["SCEL", "Santiago", -33.39, -70.79], ["EGLL", "London Heathrow", 51.47, -0.45], ["LFPG", "Paris CDG", 49.01, 2.55],
    ["EHAM", "Amsterdam", 52.31, 4.76], ["EDDF", "Frankfurt", 50.03, 8.56], ["LEMD", "Madrid", 40.49, -3.57],
    ["LIRF", "Rome", 41.80, 12.25], ["LTFM", "Istanbul", 41.26, 28.74], ["UUEE", "Moscow SVO", 55.97, 37.41],
    ["HECA", "Cairo", 30.12, 31.41], ["GMMN", "Casablanca", 33.37, -7.59], ["DNMM", "Lagos", 6.58, 3.32],
    ["HKJK", "Nairobi", -1.32, 36.93], ["FAOR", "Johannesburg", -26.14, 28.24], ["OMDB", "Dubai", 25.25, 55.36],
    ["OTHH", "Doha", 25.27, 51.61], ["VIDP", "Delhi", 28.57, 77.10], ["VABB", "Mumbai", 19.09, 72.87],
    ["WSSS", "Singapore", 1.36, 103.99], ["VHHH", "Hong Kong", 22.31, 113.91], ["ZBAA", "Beijing", 40.08, 116.58],
    ["ZSPD", "Shanghai", 31.14, 121.81], ["RKSI", "Seoul Incheon", 37.46, 126.44], ["RJTT", "Tokyo Haneda", 35.55, 139.78],
    ["YSSY", "Sydney", -33.95, 151.18], ["YMML", "Melbourne", -37.67, 144.84], ["NZAA", "Auckland", -37.01, 174.79],
  ];
  const APT = Object.fromEntries(AIRPORTS.map(a => [a[0], a]));

  // ---------- state ----------
  const S = { man: null, fl: 450, hd: "min", fi: 0, margin: 0, mode: "inspect", fade: true,
              t: d3.zoomIdentity, sel: null, route: [], routeRes: null, playing: null };
  const cache = new Map();   // "fh_fl" -> Uint8Array (atlas gray values)
  const $ = id => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  let W = 0, H = 0, W0 = 0, H0 = 0, x0 = 0, y0 = 0, dpr = 1, world = null, land = null, borders = null;
  const off = document.createElement("canvas"); off.width = NX; off.height = NY;
  const offCtx = off.getContext("2d");
  let colorKey = "";

  // ---------- theme + color ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => {
    const a = document.documentElement.getAttribute("data-theme");
    return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  let rampFn;
  function setRamp() {
    rampFn = d3.interpolateRgbBasis(isDark() ? RAMP.slice().reverse() : RAMP);
  }
  const NONE_LIGHT = [216, 214, 208], NONE_DARK = [46, 46, 43];
  const MLO = 1.0, MHI = 1.3;
  function colorFor(M) {
    if (M < 1.005) return isDark() ? NONE_DARK : NONE_LIGHT;
    const c = d3.rgb(rampFn(Math.min(1, (M - MLO) / (MHI - MLO))));
    return [c.r, c.g, c.b];
  }

  // ---------- data ----------
  const enc = () => S.man.encoding;
  const toM = v => enc().M0 + enc().M_step * v;
  const fhs = () => S.man.forecast_hours;
  const key = (fh, fl) => `${fh}_${fl}`;
  function loadAtlas(fh, fl) {
    const k = key(fh, fl);
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
  const tileOf = hd => hd === "min" ? 12 : hd === "max" ? 13 : hd / 30;
  const raw = (a, tile, i, j) => a[((tile >> 2) * NY + j) * AW + (tile & 3) * NX + i];
  function sample(a, tile, lon, lat) {
    let fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
    return (raw(a, tile, i0, j0) * (1 - di) + raw(a, tile, i1, j0) * di) * (1 - dj) +
           (raw(a, tile, i0, j0 + 1) * (1 - di) + raw(a, tile, i1, j0 + 1) * di) * dj;
  }
  const mAt = (a, tile, lon, lat) => toM(sample(a, tile, lon, lat));
  function mHeading(a, hdg, lon, lat) {
    const h = ((hdg % 360) + 360) % 360 / 30, k0 = Math.floor(h) % 12, k1 = (k0 + 1) % 12, f = h - Math.floor(h);
    return mAt(a, k0, lon, lat) * (1 - f) + mAt(a, k1, lon, lat) * f;
  }
  const cAt = (a, lon, lat) => sample(a, 14, lon, lat) + enc().c_offset;
  const landAt = (a, lon, lat) => sample(a, 15, lon, lat) / 255;

  // ---------- geometry ----------
  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    W0 = W / H < 1.3 ? W * 1.6 : Math.max(W, 2 * H * 0.92); H0 = W0 / 2; x0 = (W - W0) / 2; y0 = (H - H0) / 2;
    zoom.extent([[0, 0], [W, H]]).translateExtent([[Math.min(0, x0), Math.min(0, y0)], [Math.max(W, x0 + W0), Math.max(H, y0 + H0)]]);
  }
  const toScreen = (lon, lat) => [S.t.x + S.t.k * (x0 + (lon + 180) / 360 * W0), S.t.y + S.t.k * (y0 + (90 - lat) / 180 * H0)];
  function toLonLat(sx, sy) {
    const bx = (sx - S.t.x) / S.t.k, by = (sy - S.t.y) / S.t.k;
    return [(bx - x0) / W0 * 360 - 180, 90 - (by - y0) / H0 * 180];
  }
  const proj = () => d3.geoEquirectangular().precision(0.5)
    .scale(S.t.k * W0 / (2 * Math.PI)).translate([S.t.x + S.t.k * (x0 + W0 / 2), S.t.y + S.t.k * (y0 + H0 / 2)]);

  // ---------- render ----------
  let rafPending = false, current = null;
  const schedule = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(draw); } };

  async function refresh() {
    if (!S.man) return;
    const fh = fhs()[S.fi];
    const a = await loadAtlas(fh, S.fl);
    current = a;
    colorKey = "";
    updateKpis(); updateInspector(); if (S.route.length === 2) computeRoute(); schedule(); writeHash();
  }

  function paintData() {
    const k = [S.fi, S.fl, S.hd, S.margin, S.fade, isDark()].join("|");
    if (k === colorKey || !current) return;
    colorKey = k;
    const img = offCtx.createImageData(NX, NY), tile = tileOf(S.hd);
    const lut = [];
    for (let v = 0; v < 256; v++) lut.push(colorFor(toM(v) - S.margin));
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v = raw(current, tile, i, j), c = lut[v], o = (j * NX + i) * 4;
      const isLand = raw(current, 15, i, j) > 127;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
      img.data[o + 3] = S.fade && !isLand ? 95 : 235;
    }
    offCtx.putImageData(img, 0, 0);
    drawLegend();
  }

  function draw() {
    rafPending = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--ocean"); ctx.fillRect(0, 0, W, H);
    paintData();
    if (current) {
      const [ax, ay] = toScreen(-180.5, 90.5), [bx, by] = toScreen(179.5, -90.5);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, ax, ay, bx - ax, by - ay);
    }
    const path = d3.geoPath(proj(), ctx);
    ctx.lineJoin = "round";
    ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = css("--grat"); ctx.lineWidth = 1; ctx.stroke();
    if (borders) { ctx.beginPath(); path(borders); ctx.strokeStyle = css("--border-c"); ctx.lineWidth = 0.6; ctx.stroke(); }
    if (land) { ctx.beginPath(); path(land); ctx.strokeStyle = css("--coast"); ctx.lineWidth = 0.9; ctx.stroke(); }
    drawRoute();
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
      const M = MLO + (x / (c.width - 1)) * (MHI - MLO);
      const col = colorFor(M === 1 ? 1.0051 : M);
      g.fillStyle = `rgb(${col})`; g.fillRect(x, 0, 1, c.height);
    }
    g.fillStyle = css("--text"); g.fillRect(Math.round(c.width * (0.05 / 0.3)), 0, 1.5, c.height);
  }

  // ---------- route ----------
  function bearing(a, b) {
    const [l1, p1] = a.map(d => d * Math.PI / 180), [l2, p2] = b.map(d => d * Math.PI / 180);
    const y = Math.sin(l2 - l1) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function computeRoute() {
    if (!current || S.route.length < 2) return;
    const [A, B] = S.route.map(r => [r.lon, r.lat]);
    const distNm = d3.geoDistance(A, B) * NM;
    const n = Math.max(20, Math.ceil(distNm / 15));
    const interp = d3.geoInterpolate(A, B);
    const mW = +$("mWater").value, mS = +$("mSub").value, mB = +$("mBase").value;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(interp(i / n));
    const segs = [];
    let tBase = 0, tToday = 0, tCut = 0, dLand = 0, dBoomless = 0, sumMland = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1], mid = interp((i + 0.5) / n);
      const d = d3.geoDistance(p, q) * NM, hd = bearing(p, q);
      const c = cAt(current, mid[0], mid[1]), kt = c * KT;
      const isLand = landAt(current, mid[0], mid[1]) > 0.5;
      const mmax = mHeading(current, hd, mid[0], mid[1]) - S.margin;
      let type, mPlan;
      if (!isLand) { type = "water"; mPlan = mW; }
      else if (mmax >= 1.01) { type = "boomless"; mPlan = Math.min(mmax, mW); }
      else { type = "sub"; mPlan = mS; }
      if (isLand) { dLand += d; sumMland += mPlan * d; if (type === "boomless") dBoomless += d; }
      tBase += d / (mB * kt); tToday += d / ((isLand ? mS : mW) * kt); tCut += d / (mPlan * kt);
      segs.push({ p, q, d, type, mPlan, mmax, isLand, x0: i === 0 ? 0 : segs[i - 1].x1, x1: (i === 0 ? 0 : segs[i - 1].x1) + d });
    }
    S.routeRes = { distNm, segs, tBase, tToday, tCut, dLand, dBoomless, avgLand: dLand ? sumMland / dLand : null, mW, mS, mB };
    renderRoute(); schedule();
  }
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  function renderRoute() {
    const R = S.routeRes; if (!R) return;
    $("routeOut").hidden = false;
    const [a, b] = S.route;
    const pct = x => `${Math.round(100 * x)}%`;
    $("routeTable").innerHTML = `
      <tr><td colspan="4"><b>${a.name} → ${b.name}</b> · ${Math.round(R.distNm).toLocaleString()} nm · ${pct(R.dLand / R.distNm)} over land
      ${R.dLand ? ` · ${pct(R.dBoomless / R.dLand)} of land leg boomless` : ""}</td></tr>
      <tr><th>Scenario</th><th title="Average over land / over water">Mach land / water</th><th>Time</th><th>vs airliner</th></tr>
      <tr><td>Airliner today</td><td>${R.mB.toFixed(2)}</td><td>${fmtT(R.tBase)}</td><td>—</td></tr>
      <tr><td>Supersonic, overland ban</td><td>${R.mS.toFixed(2)} / ${R.mW.toFixed(2)}</td><td>${fmtT(R.tToday)}</td><td>−${fmtT(R.tBase - R.tToday)}</td></tr>
      <tr class="hl"><td>Supersonic + Mach cutoff</td><td>${R.avgLand ? R.avgLand.toFixed(2) : "—"} / ${R.mW.toFixed(2)}</td><td>${fmtT(R.tCut)}</td><td>−${fmtT(R.tBase - R.tCut)}</td></tr>
      <tr><td colspan="3">Time saved by boomless corridors</td><td class="save"><b>${fmtT(R.tToday - R.tCut)}</b></td></tr>`;
    drawProfile();
  }
  function drawProfile() {
    const R = S.routeRes, svg = d3.select("#rprof"); svg.selectAll("*").remove();
    const m = { l: 30, r: 6, t: 8, b: 22 }, w = 320 - m.l - m.r, h = 150 - m.t - m.b;
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleLinear([0, R.distNm], [0, w]);
    const yMax = Math.max(R.mW, 1.3) + 0.05;
    const y = d3.scaleLinear([0.8, yMax], [h, 0]);
    g.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(4).tickFormat(d3.format(".1f"))).call(s => s.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickSize(3).tickFormat(d => d3.format(",")(d))).call(s => s.select(".domain").attr("stroke", "var(--line)"));
    g.append("text").attr("x", w).attr("y", h + 20).attr("text-anchor", "end").text("nm along route");
    // land shading
    g.append("g").selectAll("rect").data(R.segs.filter(s => s.isLand)).join("rect")
      .attr("x", s => x(s.x0)).attr("width", s => Math.max(0.5, x(s.x1) - x(s.x0) + 0.3)).attr("y", 0).attr("height", h)
      .attr("fill", "var(--surface-2)");
    const color = { boomless: "var(--boomless)", sub: "var(--subsonic)", water: "var(--water)" };
    g.append("path").datum(R.segs.filter(s => s.isLand)).attr("fill", "none").attr("stroke", "var(--text-2)").attr("stroke-width", 1).attr("stroke-dasharray", "2 2")
      .attr("d", d3.line().defined((s, i, arr) => true).x(s => x((s.x0 + s.x1) / 2)).y(s => y(Math.min(s.mmax, yMax))));
    g.append("g").selectAll("line").data(R.segs).join("line")
      .attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1)).attr("y1", s => y(s.mPlan)).attr("y2", s => y(s.mPlan))
      .attr("stroke", s => color[s.type]).attr("stroke-width", 2.5).attr("stroke-linecap", "round")
      .attr("stroke-dasharray", s => s.type === "water" ? "4 3" : null);
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", "var(--text-2)").attr("stroke-width", 0.8);
    g.append("text").attr("x", 2).attr("y", y(1) - 3).text("Mach 1");
  }
  function drawRoute() {
    const R = S.routeRes;
    const pins = S.route;
    if (R) {
      const color = { boomless: css("--boomless"), sub: css("--subsonic"), water: css("--water") };
      const jump = S.t.k * W0 / 2;
      for (const pass of ["casing", "color"]) {
        for (const s of R.segs) {
          const [ax, ay] = toScreen(...s.p), [bx, by] = toScreen(...s.q);
          if (Math.abs(bx - ax) > jump) continue;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          if (pass === "casing") { ctx.setLineDash([]); ctx.strokeStyle = css("--casing"); ctx.lineWidth = 5.5; }
          else { ctx.setLineDash(s.type === "water" ? [5, 4] : []); ctx.strokeStyle = color[s.type]; ctx.lineWidth = 3; }
          ctx.lineCap = "round"; ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    for (const p of pins) {
      const [sx, sy] = toScreen(p.lon, p.lat);
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI); ctx.fillStyle = css("--text"); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = css("--casing"); ctx.stroke();
      ctx.font = "600 12px system-ui, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = css("--casing");
      ctx.strokeText(p.name, sx + 8, sy - 6); ctx.fillStyle = css("--text"); ctx.fillText(p.name, sx + 8, sy - 6);
    }
  }
  function setRouteFromInputs() {
    const a = APT[$("fromIn").value.trim().toUpperCase()], b = APT[$("toIn").value.trim().toUpperCase()];
    if (!a || !b) { $("routeTable").innerHTML = `<tr><td>Unknown airport code — pick from the list or click the map.</td></tr>`; $("routeOut").hidden = false; return; }
    S.route = [{ name: a[0], lat: a[2], lon: a[3] }, { name: b[0], lat: b[2], lon: b[3] }];
    computeRoute(); fitRoute();
  }
  function fitRoute() {
    if (S.route.length < 2) return;
    const lons = S.route.map(r => r.lon), lats = S.route.map(r => r.lat);
    if (Math.abs(lons[0] - lons[1]) > 180) return;
    const [ax, ay] = [x0 + (Math.min(...lons) + 180) / 360 * W0, y0 + (90 - Math.max(...lats)) / 180 * H0];
    const [bx, by] = [x0 + (Math.max(...lons) + 180) / 360 * W0, y0 + (90 - Math.min(...lats)) / 180 * H0];
    const k = Math.max(1, Math.min(8, 0.6 / Math.max((bx - ax) / W, (by - ay) / H, 0.02)));
    const t = d3.zoomIdentity.translate(W / 2 - k * (ax + bx) / 2, H / 2 - k * (ay + by) / 2).scale(k);
    d3.select(canvas).transition().duration(600).call(zoom.transform, t);
  }

  // ---------- inspector ----------
  function updateInspector() {
    if (!S.sel || !current) return;
    const [lon, lat] = S.sel;
    $("inspEmpty").hidden = true; $("inspBody").hidden = false;
    $("inspLoc").textContent = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
    $("inspSurf").textContent = landAt(current, lon, lat) > 0.5 ? "land" : "ocean";
    const ms = S.man.headings.map((h, i) => mAt(current, i, lon, lat) - S.margin);
    const c = cAt(current, lon, lat);
    const iMin = ms.indexOf(Math.min(...ms)), iMax = ms.indexOf(Math.max(...ms));
    const selM = S.hd === "min" ? ms[iMin] : S.hd === "max" ? ms[iMax] : ms[S.hd / 30];
    const dirLbl = S.hd === "min" ? "Any direction" : S.hd === "max" ? "Best direction" : `Heading ${String(S.hd).padStart(3, "0")}°`;
    $("inspFacts").innerHTML = `
      <dt>${dirLbl}</dt><dd>M ${selM.toFixed(3)}</dd>
      <dt>True airspeed</dt><dd>${Math.round(selM * c * KT)} kt</dd>
      <dt>Worst (${String(S.man.headings[iMin]).padStart(3, "0")}°)</dt><dd>M ${ms[iMin].toFixed(3)}</dd>
      <dt>Best (${String(S.man.headings[iMax]).padStart(3, "0")}°)</dt><dd>M ${ms[iMax].toFixed(3)}</dd>
      <dt>Sound speed at FL${S.fl}</dt><dd>${Math.round(c * KT)} kt</dd>`;
    drawPolar(ms, iMin, iMax);
    drawTimeSeries(lon, lat);
  }
  function drawPolar(ms, iMin, iMax) {
    const svg = d3.select("#polar"); svg.selectAll("*").remove();
    const R = 92, r = d3.scaleLinear([1.0, 1.3], [0, R]).clamp(true);
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
    svg.append("path").attr("d", d3.line().curve(d3.curveCardinalClosed.tension(0.3))(pts))
      .attr("fill", "var(--accent)").attr("fill-opacity", 0.15).attr("stroke", "var(--accent)").attr("stroke-width", 2);
    const selI = S.hd === "min" ? iMin : S.hd === "max" ? iMax : S.hd / 30;
    svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", d => d[0]).attr("cy", d => d[1])
      .attr("r", (d, i) => i === selI ? 5 : 2.5).attr("fill", (d, i) => i === selI ? "var(--text)" : "var(--accent)")
      .attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .append("title").text((d, i) => `${S.man.headings[i]}°: M ${ms[i].toFixed(3)}`);
  }
  async function drawTimeSeries(lon, lat) {
    const fl = S.fl, hdSel = S.hd, sel = S.sel;
    const atl = await Promise.all(fhs().map(fh => loadAtlas(fh, fl)));
    if (S.sel !== sel || S.fl !== fl || S.hd !== hdSel) return;
    const tile = tileOf(S.hd);
    const vt = S.man.valid_times.map(s => new Date(s));
    const data = atl.map((a, i) => ({ t: vt[i], m: mAt(a, tile, lon, lat) - S.margin }));
    const svg = d3.select("#ts"); svg.selectAll("*").remove();
    const m = { l: 30, r: 8, t: 8, b: 22 }, w = 320 - m.l - m.r, h = 130 - m.t - m.b;
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleUtc(d3.extent(vt), [0, w]);
    const y = d3.scaleLinear([1.0, Math.max(1.3, d3.max(data, d => d.m))], [h, 0]);
    g.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(4).tickFormat(d3.format(".2f"))).call(s => s.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(d3.utcHour.every(12)).tickSize(3).tickFormat(d3.utcFormat("%a %HZ"))).call(s => s.select(".domain").attr("stroke", "var(--line)"));
    g.append("line").attr("x1", x(vt[S.fi])).attr("x2", x(vt[S.fi])).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text-2)").attr("stroke-dasharray", "3 3");
    g.append("path").datum(data).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 2).attr("d", d3.line().x(d => x(d.t)).y(d => y(d.m)));
    g.append("g").selectAll("circle").data(data).join("circle").attr("cx", d => x(d.t)).attr("cy", d => y(d.m)).attr("r", (d, i) => i === S.fi ? 4.5 : 3)
      .attr("fill", (d, i) => i === S.fi ? "var(--text)" : "var(--accent)").attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .append("title").text(d => `${d3.utcFormat("%a %d %HZ")(d.t)}: M ${d.m.toFixed(3)}`);
    $("tsSub").textContent = `· FL${fl}, ${S.hd === "min" ? "any direction" : S.hd === "max" ? "best direction" : S.hd + "°"}`;
  }

  // ---------- kpis / labels ----------
  function updateKpis() {
    const st = S.man.stats[String(S.fl)]?.[S.fi];
    if (st) {
      $("kpiLand").textContent = `M ${(st.land_any_heading_median - S.margin).toFixed(2)}`;
      $("kpiBest").textContent = `M ${(st.global_max - S.margin).toFixed(2)}`;
    }
    const vt = new Date(S.man.valid_times[S.fi]);
    $("timeLbl").textContent = `${d3.utcFormat("%a %d %b %H:%M")(vt)} UTC (+${fhs()[S.fi]}h)`;
  }

  // ---------- hover tooltip ----------
  const tip = $("tip");
  function onMove(e) {
    if (!current) return;
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [lon, lat] = toLonLat(sx, sy);
    if (lat > 90 || lat < -90) { tip.hidden = true; return; }
    const L = ((lon + 540) % 360) - 180;
    const M = mAt(current, tileOf(S.hd), L, lat) - S.margin, c = cAt(current, L, lat);
    tip.innerHTML = `<b>M ${M.toFixed(3)}</b> · ${Math.round(M * c * KT)} kt<br><span class="muted">${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(L).toFixed(1)}°${L >= 0 ? "E" : "W"} · ${landAt(current, L, lat) > 0.5 ? "land" : "ocean"}</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(W - tw - 6, sx + 14) + "px";
    tip.style.top = Math.max(6, sy - th - 10) + "px";
  }
  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    let [lon, lat] = toLonLat(e.clientX - r.left, e.clientY - r.top);
    if (lat > 90 || lat < -90) return;
    lon = ((lon + 540) % 360) - 180;
    if (S.mode === "inspect") { S.sel = [lon, lat]; updateInspector(); }
    else {
      const name = `${Math.abs(lat).toFixed(0)}${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(0)}${lon >= 0 ? "E" : "W"}`;
      if (S.route.length >= 2) { S.route = []; S.routeRes = null; $("routeOut").hidden = true; }
      S.route.push({ name, lat, lon });
      if (S.route.length === 2) computeRoute();
    }
    schedule(); writeHash();
  }

  // ---------- controls ----------
  function seg(el, items, get, set) {
    el.innerHTML = "";
    for (const [val, label, title] of items) {
      const b = document.createElement("button");
      b.textContent = label; b.setAttribute("role", "radio"); if (title) b.title = title;
      b.onclick = () => { set(val); mark(); };
      b.dataset.v = String(val); el.appendChild(b);
    }
    const mark = () => el.querySelectorAll("button").forEach(b => {
      const on = b.dataset.v === String(get()); b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
    });
    mark(); return mark;
  }
  let markFl, markHd;
  function buildControls() {
    markFl = seg($("flSeg"), S.man.flight_levels.map(f => [f, `FL${f}`]), () => S.fl, v => { S.fl = v; refresh(); });
    const dirs = [["min", "Any", "Worst case over all directions"], ["max", "Best", "Most favorable direction"]]
      .concat(S.man.headings.map(h => [h, String(h).padStart(3, "0"), `Direction of travel ${h}° true`]));
    markHd = seg($("hdSeg"), dirs, () => S.hd, v => { S.hd = v; refresh(); });
    const sl = $("timeSlider"); sl.max = fhs().length - 1; sl.value = S.fi;
    sl.oninput = () => { S.fi = +sl.value; refresh(); };
    $("marginSlider").value = S.margin;
    $("marginSlider").oninput = e => { S.margin = +e.target.value; $("marginLbl").textContent = S.margin.toFixed(3); refresh(); };
    $("fadeOcean").onchange = e => { S.fade = e.target.checked; schedule(); };
    $("modeSeg").querySelectorAll("button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $("playBtn").onclick = togglePlay;
    $("routeGo").onclick = setRouteFromInputs;
    for (const id of ["mWater", "mSub", "mBase"]) $(id).onchange = computeRoute;
    for (const id of ["fromIn", "toIn"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") setRouteFromInputs(); });
    $("apts").innerHTML = AIRPORTS.map(a => `<option value="${a[0]}">${a[1]}</option>`).join("");
    $("aboutBtn").onclick = () => $("about").showModal();
  }
  function setMode(m) {
    S.mode = m;
    $("modeSeg").querySelectorAll("button").forEach(b => { const on = b.dataset.mode === m; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    $("inspectPanel").hidden = m !== "inspect"; $("routePanel").hidden = m !== "route";
    $("hint").textContent = m === "inspect" ? "Click the map to inspect a point · scroll / pinch to zoom" : "Click two points to plan a route, or type airport codes";
    writeHash();
  }
  function togglePlay() {
    if (S.playing) { clearInterval(S.playing); S.playing = null; $("playBtn").textContent = "▶"; return; }
    fhs().forEach(fh => loadAtlas(fh, S.fl));
    $("playBtn").textContent = "❚❚";
    S.playing = setInterval(() => { S.fi = (S.fi + 1) % fhs().length; $("timeSlider").value = S.fi; refresh(); }, 900);
  }

  // ---------- URL state ----------
  function writeHash() {
    if (!S.man) return;
    const p = new URLSearchParams({ fl: S.fl, d: S.hd, t: S.fi, m: S.mode });
    if (S.margin) p.set("mg", S.margin);
    if (S.route.length === 2) p.set("r", S.route.map(r => APT[r.name] ? r.name : `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`).join("-"));
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("fl") && S.man.flight_levels.includes(+p.get("fl"))) S.fl = +p.get("fl");
    const d = p.get("d"); if (d === "min" || d === "max") S.hd = d; else if (d && S.man.headings.includes(+d)) S.hd = +d;
    if (p.get("t")) S.fi = Math.min(fhs().length - 1, Math.max(0, +p.get("t")));
    if (p.get("mg")) { S.margin = +p.get("mg"); $("marginLbl").textContent = S.margin.toFixed(3); }
    const r = p.get("r");
    if (r) {
      S.route = r.split("-").map(s => APT[s] ? { name: s, lat: APT[s][2], lon: APT[s][3] }
        : (([la, lo]) => ({ name: `${la},${lo}`, lat: +la, lon: +lo }))(s.split(",")));
      if (APT[S.route[0].name]) $("fromIn").value = S.route[0].name;
      if (APT[S.route[1]?.name]) $("toIn").value = S.route[1].name;
    }
    return p.get("m");
  }

  // ---------- boot ----------
  const zoom = d3.zoom().scaleExtent([1, 16]).on("zoom", e => { S.t = e.transform; tip.hidden = true; schedule(); });
  async function boot() {
    setRamp();
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => tip.hidden = true);
    canvas.addEventListener("click", onClick);
    layout();
    window.addEventListener("resize", () => { layout(); schedule(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { setRamp(); colorKey = ""; schedule(); if (S.routeRes) drawProfile(); });
    try {
      const [man, topo] = await Promise.all([
        fetch(DATA + "manifest.json", { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("vendor/countries-50m.json").then(r => r.json()),
      ]);
      S.man = man;
      land = topojson.mesh(topo, topo.objects.countries, (a, b) => a === b);
      borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
      const mode = readHash();
      buildControls();
      if (mode === "route") setMode("route");
      const rt = new Date(man.run_time), gen = new Date(man.generated);
      $("runInfo").innerHTML = `GFS ${d3.utcFormat("%d %b %Y %HZ")(rt)} run · updated ${d3.utcFormat("%d %b %H:%MZ")(gen)}`;
      await refresh();
      if (S.route.length === 2) fitRoute();
    } catch (err) {
      console.error(err);
      $("runInfo").textContent = "Could not load forecast data.";
    }
  }
  boot();
})();
