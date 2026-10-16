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

  const S = { man: null, fl: 400, hd: "hd", hdDeg: 100, fi: 2, margin: 0.05, auto: true, fade: false, view: "2d", thresh: 0, relief: true, dis: false,
              look: "mach", land: false, snow: false, mtn: false, t: d3.zoomIdentity, sel: null, playing: null };
  // map styles ("looks", site/looks.js draws the switcher and the wind animation):
  //   mach     the boomless-Mach raster (navy -> white)
  //   sat      NASA GIBS true-colour satellite image of yesterday, corridors as a cyan wash, floor as an orange line
  //   night    NASA Black Marble night lights, same overlay
  //   contour  isolines every 0.025 Mach on a plain chart
  //   flow     the wind at the flight level as moving streaks, coloured by boomless Mach (looks.js)
  //   rose     per-point petals: boomless Mach for each of the 36 directions of travel
  //   earth    NASA Blue Marble: the cloud-free satellite mosaic with shaded relief and sea-floor shading
  const LOOKS = ["mach", "sat", "earth", "night", "contour", "flow", "rose"];
  const SAT_LOOK = l => l === "sat" || l === "earth" || l === "night";
  const CHART_LOOK = l => l === "contour" || l === "flow" || l === "rose";
  const cache = new Map();
  const $ = id => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  let W = 0, H = 0, W0 = 0, H0 = 0, x0 = 0, y0 = 0, dpr = 1, land = null, borders = null, landGeo = null;
  const UP = 4;                                    // global raster: 4 pixels per 1° cell, values interpolated before colouring
  const off = document.createElement("canvas"); off.width = NX * UP; off.height = NY * UP;
  const offCtx = off.getContext("2d");
  let colorKey = "", current = null;
  const listeners = { refresh: [], select: [], shiftSelect: [], texture: [], ready: [], look: [], draw: [] };
  const emit = (ev, ...a) => listeners[ev].forEach(f => f(...a));

  // ---------- color: diverging red (no corridor) -> pale -> green (corridor), midpoint at FLOOR ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => {
    const a = document.documentElement.getAttribute("data-theme");
    return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  // sequential: very dark blue (little or no boomless Mach) -> white (lots of Mach allowed)
  const RAMP = d3.interpolateRgbBasis(["#030b26", "#0a1f5c", "#17408f", "#3a6fbf", "#7fa6db", "#c3d6ef", "#ffffff"]);
  const NAVY = [3, 11, 38];
  function colorFor(M) {
    const lo = S.thresh || 0.98, hi = Math.max(1.30, lo + 0.15);
    if (S.thresh && M < S.thresh) return NAVY;
    const f = S.thresh ? 0.35 + 0.65 * Math.max(0, Math.min(1, (M - lo) / (hi - lo))) : Math.max(0, Math.min(1, (M - lo) / (hi - lo)));
    const c = d3.rgb(RAMP(f));
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
  function imgBytes(src) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, a = new Uint8Array(img.width * img.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4];
        res(a);
      };
      img.onerror = rej; img.src = src;
    });
  }
  // ---------- live ensemble spread (engine/gefs_live.py): margin per point and direction ----------
  const gefs = { meta: null, pending: new Map(), ready: new Map(), maxSd: new Map() };
  async function loadGefsMeta() {
    try { gefs.meta = await fetch(DATA + "gefs/gefs.json", { cache: "no-cache" }).then(r => { if (!r.ok) throw 0; return r.json(); }); }
    catch (e) { gefs.meta = null; }
  }
  function gefsFh(fi = S.fi, validMs = null) {   // GEFS hour matching a valid time (GFS index or ms), within 3 h
    if (!gefs.meta) return null;
    const v = validMs ?? Date.parse(S.man.valid_times[fi]), h = (v - Date.parse(gefs.meta.run_time)) / 3.6e6;
    const fh = gefs.meta.fhs.reduce((b, x) => Math.abs(x - h) < Math.abs(b - h) ? x : b, gefs.meta.fhs[0]);
    return Math.abs(fh - h) <= 3 ? fh : null;
  }
  async function prepareGefs(fl, fi = S.fi) {
    const fh = gefsFh(fi); if (fh == null || !gefs.meta.fls.includes(fl)) return null;
    const key = `${fh}_${fl}`;
    if (!gefs.pending.has(key)) gefs.pending.set(key, imgBytes(DATA + "gefs/" + `g${String(fh).padStart(3, "0")}_FL${fl}.png?r=${gefs.meta.run}`)
      .then(a => { gefs.ready.set(key, a); return a; }).catch(() => null));
    return gefs.pending.get(key);
  }
  const gefsNow = (fl, fi = S.fi, validMs = null) => { const fh = gefsFh(fi, validMs); return fh == null ? null : gefs.ready.get(`${fh}_${fl}`) || null; };
  // spread for direction tile t at (lon, lat), bilinear on the GEFS grid (2 deg, lon -180.., lat 90..)
  function sdAt(a, t, lon, lat) {
    const m = gefs.meta, gx = m.nx, gy = m.ny, d = m.d, step = m.sd_step;
    const fi = ((((lon + 180) % 360) + 360) % 360) / d, fj = Math.min(gy - 1, Math.max(0, (90 - lat) / d));
    const i0 = Math.floor(fi) % gx, j0 = Math.min(gy - 2, Math.floor(fj)), di = fi - Math.floor(fi), dj = fj - j0, i1 = (i0 + 1) % gx;
    const r = (i, j) => a[(Math.floor(t / 6) * gy + j) * 6 * gx + (t % 6) * gx + i];
    return step * ((r(i0, j0) * (1 - di) + r(i1, j0) * di) * (1 - dj) + (r(i0, j0 + 1) * (1 - di) + r(i1, j0 + 1) * di) * dj);
  }
  const nodeLL = (i, j) => [i - 180, 90 - j];          // 1-degree map node -> lon, lat
  function sdMax(a, key) {             // spread of the worst direction per 1-degree node (for "any" and "best" views)
    if (gefs.maxSd.has(key)) return gefs.maxSd.get(key);
    const m = new Float32Array(NY * NX);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const [lo, la] = nodeLL(i, j); let v = 0; for (let t = 0; t < 36; t++) v = Math.max(v, sdAt(a, t, lo, la)); m[j * NX + i] = v; }
    gefs.maxSd.set(key, m); return m;
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
  // for flight decisions: no interpolation across a no-corridor column (it would invent ~M1.1 next to "none")
  function mSafe(a, tile, lon, lat) {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), i1 = (i0 + 1) % NX;
    if (!raw(a, tile, i0, j0) || !raw(a, tile, i1, j0) || !raw(a, tile, i0, j0 + 1) || !raw(a, tile, i1, j0 + 1)) return 0.98;
    return mAt(a, tile, lon, lat);
  }
  function mHeadingSafe(a, hdg, lon, lat) {
    const h = ((hdg % 360) + 360) % 360 / 10, k0 = Math.floor(h) % 36, k1 = (k0 + 1) % 36;
    return Math.min(mSafe(a, k0, lon, lat), mSafe(a, k1, lon, lat));
  }
  const cAt = (a, lon, lat) => sample(a, A().tile_c, lon, lat) + enc().c_offset;
  const landAt = (a, lon, lat) => sample(a, A().tile_land, lon, lat) / 255;
  const windAt = (a, lon, lat) => [sample(a, A().tile_u, lon, lat) - enc().wind_offset, sample(a, A().tile_v, lon, lat) - enc().wind_offset];

  // ---------- geometry ----------
  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const portrait = W / H < 1.3;
    W0 = portrait ? Math.max(W * 1.6, H * 2) : Math.max(W, 2 * H * 0.92); H0 = W0 / 2; y0 = (H - H0) / 2;
    // on a phone the world doesn't fit; open on the North Atlantic (Americas to Europe)
    x0 = portrait ? Math.min(0, Math.max(W - W0, W / 2 - (-40 + 180) / 360 * W0)) : (W - W0) / 2;
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
    [current] = await Promise.all([loadAtlas(fhs()[S.fi], S.fl), S.auto ? prepareGefs(S.fl) : null]);
    colorKey = "";
    updateKpis(); updateInspector(); disCanvasFor(); schedule(); writeHash();
    emit("refresh");
  }

  // ---------- margin: one number, or per point from the forecast-error map (study/margin.py) ----------
  // sigma(x) = RMS of (24 h forecast - analysis) over a year of weekly hindcasts, combined with the part of the
  // real-world error the analysis cannot see (0.012). Auto margin = k * sigma: the hindcast multiple that keeps
  // flights with a boom on the ground under the Phase 1 gate (0.5%); k is calibrated per level (study/ship_margin.py).
  let sigma = null;      // { fls, grids: {fl: Float32Array(NY*NX)} }, lon -180..179
  async function loadSigma() {
    const meta = await fetch("geo/sigma.json").then(r => r.json());
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "geo/" + meta.file; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, grids = {};
    meta.fls.forEach((fl, r) => {
      const a = new Float32Array(NY * NX);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) a[j * NX + i] = (d[((r * NY + j) * NX + i) * 4] + meta.offset) * meta.scale;
      grids[fl] = a;
    });
    sigma = { fls: meta.fls, grids, landMedian: meta.land_median, k: meta.k };
  }
  function sigmaGrid(fl) {            // nearest level with a map; levels between two maps average them
    const f = sigma.fls;
    if (sigma.grids[fl]) return sigma.grids[fl];
    const lo = [...f].reverse().find(x => x < fl) ?? f[0], hi = f.find(x => x > fl) ?? f[f.length - 1];
    const key = "m" + fl;
    if (!sigma.grids[key]) { const a = sigma.grids[lo], b = sigma.grids[hi]; sigma.grids[key] = a.map((v, i) => (v + b[i]) / 2); }
    return sigma.grids[key];
  }
  const nearest = (obj, fl) => { const ks = Object.keys(obj).map(Number); const lo = Math.max(...ks.filter(x => x <= fl), Math.min(...ks)), hi = Math.min(...ks.filter(x => x >= fl), Math.max(...ks)); return (obj[lo] + obj[hi]) / 2; };
  const kAt = fl => sigma ? nearest(sigma.k, fl) : 0;
  const kEns = fl => gefs.meta ? nearest(gefs.meta.k, fl) : 0;
  // real-world error no model run sees: 0.012 over low terrain, 0.015 over mountains (balloon validation at
  // Albuquerque, Grand Junction and Salt Lake City: unsafe-side error ~20% above the low-terrain stations),
  // ramped from 0.5 to 1.5 km of terrain; 0.015 everywhere until the terrain grid has loaded (fail-safe)
  const S_EXTRA = 0.012, S_EXTRA_MTN = 0.015;
  // air data and Mach hold (issue #43): the aircraft does not fly the planned Mach exactly. Assumed 1 sigma 0.005
  // (air-data computer Mach accuracy plus autothrottle Mach-hold excursions), added in quadrature; an operator
  // replaces it with its own aircraft's figure.
  const AIR_DATA_SD = 0.005;
  const sExtra = (lon, lat) => { if (!terrain || lon == null) return S_EXTRA_MTN; const t = Math.max(0, Math.min(1, (elevAt(lon, lat) - 500) / 1000)); return S_EXTRA + (S_EXTRA_MTN - S_EXTRA) * t; };
  const ensMargin = (fl, sd, lon, lat) => { const e = sExtra(lon, lat); return kEns(fl) * Math.sqrt(sd * sd + e * e + AIR_DATA_SD * AIR_DATA_SD); };
  // static error map (built with 0.012): add the mountain excess in quadrature
  const staticMtn = (v, kk, lon, lat) => { const e = sExtra(lon, lat); return kk * Math.sqrt(v * v + e * e - S_EXTRA * S_EXTRA + AIR_DATA_SD * AIR_DATA_SD); };
  const mgCache = {};
  // per 1-degree node, for a level, the current mode and the map's direction tile
  function marginGrid(fl = S.fl) {
    const ga = S.auto ? gefsNow(fl) : null, tile = curTile();
    const k = (!S.auto ? "f" + S.margin : ga ? `e${gefsFh()}_${tile}` : sigma ? "a" : "f" + S.margin) + (terrain ? "t" : "n");
    if (mgCache[fl] && mgCache[fl].k === k) return mgCache[fl].g;
    let g;
    if (ga) {
      g = new Float32Array(NY * NX);
      const mx = tile >= 36 ? sdMax(ga, `${gefsFh()}_${fl}`) : null;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const [lo, la] = nodeLL(i, j); g[j * NX + i] = ensMargin(fl, mx ? mx[j * NX + i] : sdAt(ga, tile, lo, la), lo, la); }
    } else if (S.auto && sigma) { const kk = kAt(fl), sg = sigmaGrid(fl); g = new Float32Array(NY * NX); for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const [lo, la] = nodeLL(i, j); g[j * NX + i] = staticMtn(sg[j * NX + i], kk, lo, la); } }
    else g = new Float32Array(NY * NX).fill(S.margin);
    if (S.auto && HI_F(fl) !== 1) for (let n = 0; n < g.length; n++) g[n] *= HI_F(fl);
    mgCache[fl] = { k, g }; return g;
  }
  const bil = (f, lon, lat) => {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
    return (f(i0, j0) * (1 - di) + f(i1, j0) * di) * (1 - dj) + (f(i0, j0 + 1) * (1 - di) + f(i1, j0 + 1) * di) * dj;
  };
  // brg (deg): direction of travel of a route leg; without it, the map's direction tile
  // validMs: when the aircraft is there (route legs); default the map's time
  // high altitude (FL700-FL1000, an estimate: GFS only, no balloon validation yet): the Auto margin of the nearest
  // validated level, inflated 1.5x until the stratosphere is validated against radiosondes (they reach ~10 hPa)
  const HI_FL = 600, HI_F = fl => fl > HI_FL ? 1.5 : 1;
  const isHigh = (fl = S.fl) => fl > HI_FL;
  function marginAt(lon, lat, fl = S.fl, brg = null, validMs = null) {
    if (!S.auto) return S.margin;
    return HI_F(fl) * marginAtBase(lon, lat, fl, brg, validMs);
  }
  function marginAtBase(lon, lat, fl, brg, validMs) {
    const ga = gefsNow(fl, S.fi, validMs);       // no spread for that hour -> static map below, never another hour's spread
    if (ga && brg != null) {
      const h = ((brg % 360) + 360) % 360 / 10, t0 = Math.floor(h) % 36, t1 = (t0 + 1) % 36;
      return ensMargin(fl, Math.max(sdAt(ga, t0, lon, lat), sdAt(ga, t1, lon, lat)), lon, lat);
    }
    if (!ga && !sigma) return Math.max(S.margin, 0.05);
    if (!ga && validMs != null) { const kk = kAt(fl), sg = sigmaGrid(fl); return staticMtn(bil((i, j) => sg[j * NX + i], lon, lat), kk, lon, lat); }
    const g = marginGrid(fl);
    return bil((i, j) => g[j * NX + i], lon, lat);
  }
  const marginTypical = () => S.auto && sigma ? HI_F(S.fl) * kAt(S.fl) * nearest(sigma.landMedian, S.fl) : S.margin;

  // Colour is applied after interpolating Mach (not before), so contours and the threshold edge stay smooth
  // at any zoom instead of showing the 1° grid as blocks.
  const LUT_N = 1024, LUT_M0 = 0.96, LUT_M1 = 1.66;
  let lutCache = null;
  function colorLut() {
    const k = [S.thresh].join("|");
    if (lutCache && lutCache.k === k) return lutCache.lut;
    const lut = new Uint8ClampedArray(LUT_N * 3), th = S.thresh;
    for (let n = 0; n < LUT_N; n++) {
      const M = LUT_M0 + (LUT_M1 - LUT_M0) * n / (LUT_N - 1);
      let c = colorFor(Math.max(M, th ? th + 1e-6 : M));
      if (th) { const t = Math.max(0, Math.min(1, (M - (th - 0.006)) / 0.012)), s2 = t * t * (3 - 2 * t); c = c.map((v, q) => NAVY[q] + (v - NAVY[q]) * s2); }
      lut[n * 3] = c[0]; lut[n * 3 + 1] = c[1]; lut[n * 3 + 2] = c[2];
    }
    lutCache = { k, lut }; return lut;
  }
  // corridor colour for the satellite, flow and rose looks: no corridor = slate (or clear on a photo), corridor = cyan
  // brightening to white over 0.25 Mach above the floor (or the highlight threshold when one is set)
  const CYAN = d3.interpolateRgbBasis(["#1d8fd6", "#3fc6f5", "#a8ecff", "#ffffff"]);
  const lit = () => S.thresh || FLOOR;
  function corridorColor(M) {
    const f = lit();
    if (!(M >= f)) return [118, 132, 158, 0.32];
    const t = Math.min(1, (M - f) / 0.25), c = d3.rgb(CYAN(t));
    return [c.r, c.g, c.b, 0.55 + 0.45 * t];
  }
  // RGBA lookup for the wash laid over satellite images: clear below the floor, a smooth 0.008-Mach edge, then cyan
  let ovlLutCache = null;
  function ovlLut() {
    const k = String(lit());
    if (ovlLutCache && ovlLutCache.k === k) return ovlLutCache.lut;
    const lut = new Uint8ClampedArray(LUT_N * 4), f = lit();
    for (let n = 0; n < LUT_N; n++) {
      const M = LUT_M0 + (LUT_M1 - LUT_M0) * n / (LUT_N - 1), t = Math.max(0, Math.min(1, (M - f) / 0.25));
      const e = Math.max(0, Math.min(1, (M - (f - 0.004)) / 0.008)), s = e * e * (3 - 2 * e), c = d3.rgb(CYAN(t));
      lut[n * 4] = c.r; lut[n * 4 + 1] = c.g; lut[n * 4 + 2] = c.b; lut[n * 4 + 3] = Math.round(255 * s * (0.16 + 0.36 * t));
    }
    ovlLutCache = { k, lut }; return lut;
  }
  // fill an ImageData; px(x, y) -> [fi, fj] fractional grid coordinates (fi along longitude, fj from the north pole)
  // mode "ovl": the translucent cyan wash for the satellite looks instead of the opaque Mach colours
  function rasterize(img, w, h, px, mode = "mach") {
    const a = current, tile = curTile(), cols = A().cols, aw = AW();
    const base = Math.floor(tile / cols) * NY * aw + (tile % cols) * NX;
    const lt = A().tile_land, lbase = Math.floor(lt / cols) * NY * aw + (lt % cols) * NX;
    const lut = colorLut(), m0 = enc().M0, ms = enc().M_step, nz = 0.98, sc = (LUT_N - 1) / (LUT_M1 - LUT_M0), g = marginGrid();
    if (mode === "ovl") {
      const ol = ovlLut(), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, [fi0, fj0] = px(x, y);
        if (fj0 < -0.5 || fj0 > 180.5) { d[o + 3] = 0; continue; }
        const fi = ((fi0 % 360) + 360) % 360, fj = Math.min(180, Math.max(0, fj0));
        const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
        const r0 = base + j0 * aw, r1 = r0 + aw, g0 = j0 * NX, g1 = g0 + NX;
        const v00 = a[r0 + i0], v10 = a[r0 + i1], v01 = a[r1 + i0], v11 = a[r1 + i1];
        const M = ((v00 ? m0 + ms * v00 : nz) - g[g0 + i0]) * (1 - di) * (1 - dj) + ((v10 ? m0 + ms * v10 : nz) - g[g0 + i1]) * di * (1 - dj) + ((v01 ? m0 + ms * v01 : nz) - g[g1 + i0]) * (1 - di) * dj + ((v11 ? m0 + ms * v11 : nz) - g[g1 + i1]) * di * dj;
        const n = Math.max(0, Math.min(LUT_N - 1, Math.round((M - LUT_M0) * sc))) * 4;
        d[o] = ol[n]; d[o + 1] = ol[n + 1]; d[o + 2] = ol[n + 2]; d[o + 3] = ol[n + 3];
      }
      return;
    }
    const fadeOcean = S.fade && !(restricted || zone), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, [fi0, fj0] = px(x, y);
      if (fj0 < -0.5 || fj0 > 180.5) { d[o + 3] = 0; continue; }
      const fi = ((fi0 % 360) + 360) % 360, fj = Math.min(180, Math.max(0, fj0));
      const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
      const r0 = base + j0 * aw, r1 = r0 + aw;
      const v00 = a[r0 + i0], v10 = a[r0 + i1], v01 = a[r1 + i0], v11 = a[r1 + i1];
      const g0 = j0 * NX, g1 = g0 + NX;
      const M = ((v00 ? m0 + ms * v00 : nz) - g[g0 + i0]) * (1 - di) * (1 - dj) + ((v10 ? m0 + ms * v10 : nz) - g[g0 + i1]) * di * (1 - dj) + ((v01 ? m0 + ms * v01 : nz) - g[g1 + i0]) * (1 - di) * dj + ((v11 ? m0 + ms * v11 : nz) - g[g1 + i1]) * di * dj;
      const n = Math.max(0, Math.min(LUT_N - 1, Math.round((M - LUT_M0) * sc))) * 3;
      d[o] = lut[n]; d[o + 1] = lut[n + 1]; d[o + 2] = lut[n + 2];
      if (fadeOcean) {
        const l0 = lbase + j0 * aw, l1 = l0 + aw;
        const L = ((a[l0 + i0] * (1 - di) + a[l0 + i1] * di) * (1 - dj) + (a[l1 + i0] * (1 - di) + a[l1 + i1] * di) * dj) / 255;
        d[o + 3] = 70 + 170 * Math.max(0, Math.min(1, (L - 0.3) / 0.4));
      } else d[o + 3] = 240;
    }
  }
  function paintData() {
    const k = [S.fi, S.fl, S.hd, S.hdDeg, S.margin, S.auto && !!sigma, S.fade, S.thresh].join("|");
    if (k === colorKey || !current) return false;
    colorKey = k;
    const w = NX * UP, h = NY * UP, img = offCtx.createImageData(w, h);
    rasterize(img, w, h, (x, y) => [(x + 0.5) / UP - 0.5, (y + 0.5) / UP - 0.5]);
    offCtx.putImageData(img, 0, 0);
    gridCache = null; ovlKey = "";
    drawLegend();
    return true;
  }
  // the cyan wash for the satellite looks, on the same 4-pixels-per-degree raster as the Mach colours
  const ovl = document.createElement("canvas"); ovl.width = NX * UP; ovl.height = NY * UP;
  let ovlKey = "";
  function paintOverlay() {
    if (!current || ovlKey === colorKey + lit()) return;
    ovlKey = colorKey + lit();
    const g = ovl.getContext("2d"), w = NX * UP, h = NY * UP, img = g.createImageData(w, h);
    rasterize(img, w, h, (x, y) => [(x + 0.5) / UP - 0.5, (y + 0.5) / UP - 0.5], "ovl");
    g.putImageData(img, 0, 0);
  }
  // displayed Mach (forecast minus margin) on the 1-degree nodes for the map's direction; 0.98 = no corridor
  let gridCache = null;
  function mGrid() {
    if (gridCache && gridCache.k === colorKey) return gridCache.g;
    const g = new Float32Array(NX * NY), mg = marginGrid(), tile = curTile();
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const v = raw(current, tile, i, j); g[j * NX + i] = (v ? toM(v) : 0.98) - mg[j * NX + i]; }
    gridCache = { k: colorKey, g }; return g;
  }
  // when zoomed in, re-render just the visible window at screen resolution (after the view settles)
  let vp = null, vpTimer = null;
  const vpCanvas = document.createElement("canvas"), vpCtx = vpCanvas.getContext("2d");
  const rasterMode = () => SAT_LOOK(S.look) ? "ovl" : "mach";
  function viewportKey() { return [colorKey, rasterMode(), lit(), S.t.x.toFixed(1), S.t.y.toFixed(1), S.t.k.toFixed(4), W, H].join("|"); }
  function requestViewport() {
    if (S.t.k < 2 || !current || CHART_LOOK(S.look)) { vp = null; return; }
    if (vp && vp.key === viewportKey()) return;
    clearTimeout(vpTimer);
    vpTimer = setTimeout(() => {
      const r = Math.min(2, dpr), w = Math.ceil(W * r / 1.5), h = Math.ceil(H * r / 1.5);
      vpCanvas.width = w; vpCanvas.height = h;
      const img = vpCtx.createImageData(w, h);
      rasterize(img, w, h, (x, y) => { const [lon, lat] = toLonLat((x + 0.5) * W / w, (y + 0.5) * H / h); return [lon + 180, 90 - lat]; }, rasterMode());
      vpCtx.putImageData(img, 0, 0);
      vp = { key: viewportKey() }; schedule();
    }, 160);
  }

  // ---------- satellite base images: NASA GIBS WMS in EPSG:4326, the same plate carree as this map ----------
  // GIBS imagery is NASA's (no copyright, attribution requested). sat = VIIRS NOAA-20 corrected reflectance of
  // yesterday (UTC; today's swaths are still filling in), falling back to Suomi NPP; night = Black Marble 2016.
  const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
  const yday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const SAT_SRC = {
    sat: { layers: ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS_SNPP_CorrectedReflectance_TrueColor"], time: yday, fmt: "image/jpeg",
           credit: d => `Satellite: NASA GIBS, VIIRS true colour, ${d}` },
    earth: { layers: ["BlueMarble_ShadedRelief_Bathymetry", "BlueMarble_NextGeneration"], time: () => "", fmt: "image/jpeg", credit: () => "Satellite without clouds: NASA Blue Marble (GIBS)" },
    night: { layers: ["VIIRS_Black_Marble"], time: () => "2016-01-01", fmt: "image/jpeg", credit: () => "Night lights: NASA Black Marble 2016 (GIBS)" },
  };
  const wmsUrl = (look, layer, b, w, h) => `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=${b.map(v => v.toFixed(4)).join(",")}&WIDTH=${w}&HEIGHT=${h}&FORMAT=${encodeURIComponent(SAT_SRC[look].fmt)}${SAT_SRC[look].time() ? "&TIME=" + SAT_SRC[look].time() : ""}`;
  // load with CORS first (needed to paint the 3D globe); if refused, without (the 2D map can still draw it)
  function loadImg(url) {
    const once = cors => new Promise((res, rej) => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => res(Object.assign(i, { cors })); i.onerror = rej; i.src = url; });
    return once(true).catch(() => once(false));
  }
  async function loadSatLayers(look, b, w, h) {
    let err;
    for (const layer of SAT_SRC[look].layers) { try { return await loadImg(wmsUrl(look, layer, b, w, h)); } catch (e) { err = e; } }
    throw err || new Error("no imagery");
  }
  const sat = { global: {}, view: null, timer: null, status: {} };
  // small = 1024 x 512 for the style thumbnails; the full 4096 x 2048 only once the style is chosen
  // (until it arrives the small one stands in)
  function satGlobal(look, small = false) {
    if (!SAT_LOOK(look)) return null;
    const key = look + (small ? "s" : "");
    if (!sat.global[key]) {
      const p = loadSatLayers(look, [-180, -90, 180, 90], small ? 1024 : 4096, small ? 512 : 2048);
      sat.global[key] = { img: null };
      if (!small) sat.status[look] = "loading";
      p.then(img => { sat.global[key].img = img; if (!small) sat.status[look] = "ok"; schedule(); emit("texture"); })
       .catch(e => { if (!small) { sat.status[look] = "failed"; updateKpis(); } console.info("satellite imagery unavailable", look, e && e.type); });
    }
    return sat.global[key].img || (small ? null : (sat.global[look + "s"] && sat.global[look + "s"].img)) || null;
  }
  // sharper image of just the visible window once zoomed in (after the view settles); skipped across the dateline
  function requestSatView() {
    if (!SAT_LOOK(S.look) || S.t.k < 1.8) { sat.view = null; return; }
    const [lonA, latA] = toLonLat(0, 0), [lonB, latB] = toLonLat(W, H);
    const b = [Math.max(-180, lonA), Math.max(-90, latB), Math.min(180, lonB), Math.min(90, latA)];
    if (lonA < -180 || lonB > 180 || b[2] - b[0] < 1 || b[3] - b[1] < 1) { sat.view = null; return; }
    const key = S.look + b.map(v => v.toFixed(2)).join(",");
    if (sat.view && sat.view.key === key) return;
    clearTimeout(sat.timer);
    sat.timer = setTimeout(async () => {
      const pw = Math.min(2048, Math.ceil((b[2] - b[0]) / (lonB - lonA) * W * Math.min(2, dpr))), ph = Math.min(2048, Math.ceil(pw * (b[3] - b[1]) / (b[2] - b[0])));
      try { const img = await loadSatLayers(S.look, b, pw, ph); sat.view = { key, img, b, look: S.look }; schedule(); } catch (e) { /* keep the global image */ }
    }, 350);
  }
  function drawSat(dxs) {
    const img = satGlobal(S.look);
    if (img) for (const dx of dxs) {
      const [tx, ty] = toScreen(-180, 90), [ux, uy] = toScreen(180, -90), ox = dx * S.t.k;
      if (ux + ox < 0 || tx + ox > W) continue;
      ctx.drawImage(img, tx + ox, ty, ux - tx, uy - ty);
    }
    requestSatView();
    const v = sat.view;
    if (v && v.look === S.look) { const [ax, ay] = toScreen(v.b[0], v.b[3]), [bx, by] = toScreen(v.b[2], v.b[1]); ctx.drawImage(v.img, ax, ay, bx - ax, by - ay); }
  }

  // ---------- surface layers: land cover, snow, mountains (any style) ----------
  // why they matter: hot ground (deserts) speeds up sound near the surface and lifts the boomless Mach; snow-covered,
  // cold ground slows it and lowers it; mountains raise the floor the boom's turning point must clear (Method 3.2)
  const SURF = {
    land: { layers: ["MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual"], time: () => "", fmt: "image/png", alpha: 0.62, credit: "Land cover: NASA MODIS IGBP (GIBS)" },
    snow: { layers: ["MODIS_Terra_NDSI_Snow_Cover", "MODIS_Aqua_NDSI_Snow_Cover"], time: yday, fmt: "image/png", alpha: 0.9, credit: d => `Snow: NASA MODIS, ${d} (GIBS)` },
  };
  // land-cover key: each swatch is read from the image itself at a place that is that class, so key and map agree
  const LAND_KEY = [["Desert, bare ground", 23, 12], ["Farmland", 42, -93.5], ["Rainforest", -3, -62], ["Boreal forest", 62, 100], ["Grassland", 47, 104], ["Savanna", 9, 22], ["Shrubland", -25, 133], ["Ice", 75, -40]];
  const surf = { img: {}, status: {}, key: null, mtn: null };
  function surfImg(k) {
    if (surf.img[k] !== undefined) return surf.img[k];
    surf.img[k] = null; surf.status[k] = "loading";
    const src = SURF[k];
    (async () => {
      for (const layer of src.layers) {
        const u = `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048&FORMAT=${encodeURIComponent(src.fmt)}&TRANSPARENT=TRUE${src.time() ? "&TIME=" + src.time() : ""}`;
        try { const img = await loadImg(u); surf.img[k] = img; surf.status[k] = "ok"; if (k === "land") landKey(img); schedule(); updateKpis(); return; } catch (e) { /* next layer */ }
      }
      surf.status[k] = "failed"; updateKpis();
    })();
    return null;
  }
  function landKey(img) {
    if (!img.cors) { surf.key = null; return; }
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    surf.key = LAND_KEY.map(([name, lat, lon]) => {
      const x = Math.round((lon + 180) / 360 * img.width), y = Math.round((90 - lat) / 180 * img.height), d = g.getImageData(x - 2, y - 2, 5, 5).data;
      const px = []; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
      if (!px.length) return null;
      px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      const m = px[Math.floor(px.length / 2)]; return { name, rgb: `rgb(${m[0]},${m[1]},${m[2]})` };
    }).filter(Boolean);
    updateKpis();
  }
  // mountains: diagonal hatch where the terrain is above 1,500 m, twice as dense above 3,000 m (GFS orography)
  function mtnCanvas() {
    if (!terrain) return null;
    if (surf.mtn) return surf.mtn;
    const { nx, ny, z } = terrain, mask = document.createElement("canvas"); mask.width = nx; mask.height = ny;
    const mg = mask.getContext("2d"), md = mg.createImageData(nx, ny);
    for (let i = 0; i < nx * ny; i++) md.data[i * 4 + 3] = z[i] >= 3000 ? 255 : z[i] >= 1500 ? 150 : 0;
    mg.putImageData(md, 0, 0);
    const W2 = 2880, H2 = 1440, c = document.createElement("canvas"); c.width = W2; c.height = H2;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(255,228,190,.95)"; g.lineWidth = 1.1; g.beginPath();
    for (let x = -H2; x < W2; x += 5) { g.moveTo(x, H2); g.lineTo(x + H2, 0); }
    g.stroke();
    g.globalCompositeOperation = "destination-in"; g.imageSmoothingEnabled = true; g.drawImage(mask, 0, 0, W2, H2);
    surf.mtn = c; return c;
  }
  function drawSurface(wraps) {
    const world = (img, alpha) => { for (const dx of wraps) { const [tx, ty] = toScreen(-180, 90), [ux, uy] = toScreen(180, -90), ox = dx * S.t.k; if (ux + ox < 0 || tx + ox > W) continue; ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(img, tx + ox, ty, ux - tx, uy - ty); ctx.restore(); } };
    if (S.land) { const im = surfImg("land"); if (im) world(im, SURF.land.alpha); }
    if (S.snow) { const im = surfImg("snow"); if (im) world(im, SURF.snow.alpha); }
    if (S.mtn) { const m = mtnCanvas(); if (m) world(m, S.t.k >= 3 ? 0.55 : 0.8); }
  }
  function surfaceLegend() {
    const el = $("landKey"); if (!el) return "";
    const on = S.land || S.snow || S.mtn; el.hidden = !on;
    if (!on) return "";
    const sw = (style, label) => `<span class="lk"><i style="${style}"></i>${label}</span>`;
    let h = "";
    if (S.land) h += surf.key ? surf.key.map(k => sw(`background:${k.rgb}`, k.name)).join("") : sw("background:linear-gradient(90deg,#f9e79f,#c24f44,#086a10,#b6ff05)", surf.status.land === "failed" ? "Land cover unavailable right now" : "Land cover (colours by type)");
    if (S.snow) h += sw("background:#e8f6ff", surf.status.snow === "failed" ? "Snow unavailable right now" : "Snow on the ground, yesterday");
    if (S.mtn) h += sw("background:repeating-linear-gradient(-45deg,#ffe4be 0 1.5px,transparent 1.5px 5px)", "Above 1,500 m (denser above 3,000 m)");
    el.innerHTML = h;
    const cr = [S.land && surf.status.land === "ok" ? SURF.land.credit : "", S.snow && surf.status.snow === "ok" ? SURF.snow.credit(yday()) : ""].filter(Boolean).join(". ");
    return " Deserts and hot ground lift the boomless Mach; snow and cold ground lower it; mountains raise the floor the boom must clear." + (cr ? " " + cr + "." : "");
  }

  // ---------- isolines (contour look; also the floor edge on the satellite looks) ----------
  // marching squares on the 1-degree grid upsampled 2x (bilinear), so lines stay smooth when zoomed in
  const CT_UP = 2, CW = (NX - 1) * CT_UP + 1, CH = (NY - 1) * CT_UP + 1;
  // caches per data state (colorKey): the upsampled grid, the contour sets by level list, and their Path2D in base
  // (unzoomed) map coordinates, so panning and zooming only re-stroke cached paths through a transform
  const ct = { key: "", grid: null, sets: new Map(), paths: new Map() };
  function ctFresh() { if (ct.key !== colorKey) { ct.key = colorKey; ct.grid = null; ct.sets.clear(); ct.paths.clear(); } }
  function contourSet(levels) {
    ctFresh();
    const key = levels.join(",");
    if (ct.sets.has(key)) return ct.sets.get(key);
    if (!ct.grid) {
      const g = mGrid(), v = new Float64Array(CW * CH);
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const fi = x / CT_UP, fj = y / CT_UP, i0 = Math.min(NX - 2, Math.floor(fi)), j0 = Math.min(NY - 2, Math.floor(fj)), di = fi - i0, dj = fj - j0;
        v[y * CW + x] = (g[j0 * NX + i0] * (1 - di) + g[j0 * NX + i0 + 1] * di) * (1 - dj) + (g[(j0 + 1) * NX + i0] * (1 - di) + g[(j0 + 1) * NX + i0 + 1] * di) * dj;
      }
      ct.grid = v;
    }
    const c = d3.contours().size([CW, CH]).thresholds(levels)(ct.grid);
    ct.sets.set(key, c); return c;
  }
  // grid point (d3 pixel corner coordinates) -> lon/lat; edges of the grid are not contour lines and are skipped
  const ctLL = ([x, y]) => [(x - 0.5) / CT_UP - 180, 90 - (y - 0.5) / CT_UP];
  const ctEdge = ([x, y]) => x <= 0.6 || x >= CW - 0.6 || y <= 1.6 || y >= CH - 1.6;   // the poles' rows too
  // draw contour lines through toS(lon, lat) -> [x, y]; style(value) -> {stroke, width, label}; returns label anchors
  function strokeContours(g, toS, levels, style, w, h) {
    const anchors = [];
    for (const ct of contourSet(levels)) {
      const st = style(ct.value); if (!st) continue;
      g.beginPath();
      for (const poly of ct.coordinates) for (const ring of poly) {
        let pen = false, best = null;
        for (let n = 1; n < ring.length; n++) {
          const a = ring[n - 1], b = ring[n];
          if (ctEdge(a) && ctEdge(b)) { pen = false; continue; }
          const pa = toS(...ctLL(a)), pb = toS(...ctLL(b));
          if (!pen) { g.moveTo(pa[0], pa[1]); pen = true; }
          g.lineTo(pb[0], pb[1]);
        }
        if (st.label && ring.length > 40) { const m = ring[Math.floor(ring.length / 2)]; if (!ctEdge(m)) best = toS(...ctLL(m)); }
        if (best && best[0] > 30 && best[0] < w - 30 && best[1] > 20 && best[1] < h - 20) anchors.push({ x: best[0], y: best[1], v: ct.value });
      }
      g.strokeStyle = st.stroke; g.lineWidth = st.width; g.lineJoin = "round"; g.lineCap = "round"; g.stroke();
    }
    return anchors;
  }
  // ---------- vector layers in base (unzoomed) coordinates: built once per layout or data, drawn with the zoom as a
  // canvas transform (re-projecting 50 m coastlines and contours on every pan frame made the chart looks lag) ----------
  const baseKey = () => [W0.toFixed(1), x0.toFixed(1), y0.toFixed(1)].join("|");
  const toBase = (lon, lat) => [x0 + (lon + 180) / 360 * W0, y0 + (90 - lat) / 180 * H0];
  const vec = {};
  function basePath(name, geo) {
    const k = baseKey();
    if (vec[name] && vec[name].k === k) return vec[name].p;
    const p = new Path2D(), pr = d3.geoEquirectangular().precision(0.2).scale(W0 / (2 * Math.PI)).translate([x0 + W0 / 2, y0 + H0 / 2]);
    d3.geoPath(pr, p)(geo);
    vec[name] = { k, p }; return p;
  }
  // run f(s) with the context in base coordinates for world copy dx (s = 1 / zoom, to keep line widths in pixels)
  function inBase(dx, f) {
    const [ax] = toScreen(-180, 0), [bx] = toScreen(180, 0), ox = dx * S.t.k;
    if (bx + ox < 0 || ax + ox > W) return;
    ctx.save(); ctx.setTransform(dpr * S.t.k, 0, 0, dpr * S.t.k, dpr * (S.t.x + S.t.k * dx), dpr * S.t.y); f(1 / S.t.k); ctx.restore();
  }
  function contourPaths(levels) {
    ctFresh();
    const key = baseKey() + "|" + levels.join(",");
    if (ct.paths.has(key)) return ct.paths.get(key);
    const out = contourSet(levels).map(c => {
      const p = new Path2D(), anchors = [];
      for (const poly of c.coordinates) for (const ring of poly) {
        let pen = false;
        for (let n = 1; n < ring.length; n++) {
          const a = ring[n - 1], b = ring[n];
          if (ctEdge(a) && ctEdge(b)) { pen = false; continue; }
          const pa = toBase(...ctLL(a)), pb = toBase(...ctLL(b));
          if (!pen) { p.moveTo(pa[0], pa[1]); pen = true; }
          p.lineTo(pb[0], pb[1]);
        }
        if (ring.length > 40) { const m = ring[Math.floor(ring.length / 2)]; if (!ctEdge(m)) anchors.push(toBase(...ctLL(m))); }
      }
      return { v: c.value, p, anchors };
    });
    ct.paths.set(key, out); return out;
  }
  const isFloor = v => Math.abs(v - lit()) < 1e-9;
  const isMajor = v => Math.abs((v * 1000) % 50) < 1e-6 || Math.abs((v * 1000) % 50 - 50) < 1e-6;
  // main map: cached contour paths for every visible world copy, then labels placed in screen space
  function drawContoursMain(wraps, levels, styleOf, labels) {
    const sets = contourPaths(levels);
    for (const dx of wraps) inBase(dx, s => {
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const c of sets) { const st = styleOf(c.v); ctx.strokeStyle = st.stroke; ctx.lineWidth = st.width * s; ctx.stroke(c.p); }
    });
    if (!labels) return;
    const placed = [];
    ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const c of sets) {
      if (!isMajor(c.v) && !isFloor(c.v)) continue;
      for (const [bx, by] of c.anchors) for (const dx of wraps) {
        const x = S.t.x + S.t.k * (bx + dx), y = S.t.y + S.t.k * by;
        if (x < 30 || x > W - 30 || y < 20 || y > H - 20 || placed.length > 60 || placed.some(p => Math.hypot(p.x - x, p.y - y) < 70)) continue;
        placed.push({ x, y });
        const t = c.v.toFixed(2);
        ctx.lineWidth = 4; ctx.strokeStyle = "#061029"; ctx.strokeText(t, x, y);
        ctx.fillStyle = isFloor(c.v) ? "#ffb15c" : "#e6f2ff"; ctx.fillText(t, x, y);
      }
    }
  }
  const contourStyle = v => isFloor(v) ? { stroke: "#ff9a2e", width: 2.2 } : isMajor(v) ? { stroke: "rgba(214,236,255,.85)", width: 1.25 } : { stroke: "rgba(160,200,240,.42)", width: 0.8 };

  const CT_LEVELS = d3.range(0, 15).map(i => +(1.05 + 0.025 * i).toFixed(3));
  function drawContourLook(g, toS, w, h, labels = true) {
    const f = lit();
    const anchors = strokeContours(g, toS, CT_LEVELS.filter(v => v >= f - 1e-9), v => {
      const major = Math.abs((v * 1000) % 50) < 1e-6 || Math.abs((v * 1000) % 50 - 50) < 1e-6;
      if (Math.abs(v - f) < 1e-9) return { stroke: "#ff9a2e", width: 2.2, label: true };
      return { stroke: major ? "rgba(214,236,255,.85)" : "rgba(160,200,240,.42)", width: major ? 1.25 : 0.8, label: major };
    }, w, h);
    if (!labels) return;
    const placed = [];
    g.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (const a of anchors) {
      if (placed.some(p => Math.hypot(p.x - a.x, p.y - a.y) < 70)) continue;
      placed.push(a);
      const t = a.v.toFixed(2);
      g.lineWidth = 4; g.strokeStyle = "#061029"; g.strokeText(t, a.x, a.y);
      g.fillStyle = Math.abs(a.v - f) < 1e-9 ? "#ffb15c" : "#e6f2ff"; g.fillText(t, a.x, a.y);
      if (placed.length > 60) break;
    }
  }

  // ---------- direction petals (rose look) ----------
  // at grid points spaced >= 46 px: one petal per direction of travel, length = boomless Mach above 1.0 (to 1.30)
  function drawRoseLook(g, toS, pxPerDeg, lonA, lonB, latA, latB, minPx = 46) {
    const step = Math.max(2, Math.ceil(minPx / pxPerDeg)), R = Math.min(22, step * pxPerDeg * 0.46), mg = marginGrid(), f = lit();
    for (let lat = Math.floor(Math.min(78, latA) / step) * step; lat >= Math.max(-70, latB); lat -= step) {
      for (let lon = Math.ceil(lonA / step) * step; lon <= lonB; lon += step) {
        const L = normLon(lon), i = ((Math.round(L) + 180) % 360 + 360) % 360, j = Math.round(90 - lat), [cx, cy] = toS(lon, lat);
        const cl = Math.max(0.2, Math.cos(lat * Math.PI / 180));
        for (let k = 0; k < 36; k++) {
          const v = raw(current, k, i, j), M = (v ? toM(v) : 0.98) - mg[j * NX + i];
          const len = R * Math.max(0.06, Math.min(1, (M - 1.0) / 0.3));
          const th = k * 10 * Math.PI / 180, dir = (a) => { let dx = Math.sin(a) / cl, dy = -Math.cos(a); const n = Math.hypot(dx, dy); return [dx / n, dy / n]; };
          const [ax, ay] = dir(th - 0.075), [bx, by] = dir(th + 0.075);
          const c = corridorColor(M);
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + ax * len, cy + ay * len); g.lineTo(cx + bx * len, cy + by * len); g.closePath();
          g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${M >= f ? c[3] : 0.38})`; g.fill();
        }
        g.beginPath(); g.arc(cx, cy, 1.3, 0, 2 * Math.PI); g.fillStyle = "rgba(230,240,255,.8)"; g.fill();
      }
    }
  }
  function draw() {
    rafPending = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SAT_LOOK(S.look) ? "#01040b" : css("--ocean"); ctx.fillRect(0, 0, W, H);
    const changed = paintData();
    if (changed) emit("texture");
    const wraps = [-W0, 0, W0];
    const shifted = dx => (lon, lat) => { const p = toScreen(lon, lat); return [p[0] + dx * S.t.k, p[1]]; };
    if (current && SAT_LOOK(S.look)) {
      drawSat(wraps); paintOverlay(); requestViewport();
      const sharp = vp && vp.key === viewportKey();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      if (sharp) ctx.drawImage(vpCanvas, 0, 0, W, H);
      else for (const dx of wraps) {
        const [ax, ay] = toScreen(-180.5, 90.5), [bx, by] = toScreen(179.5, -90.5), ox = dx * S.t.k;
        if (bx + ox < 0 || ax + ox > W) continue;
        ctx.drawImage(ovl, ax + ox, ay, bx - ax, by - ay);
      }
    } else if (current && CHART_LOOK(S.look)) {
      if (landGeo) { const lf = basePath("landFill", landGeo); for (const dx of wraps) inBase(dx, () => { ctx.fillStyle = "rgba(150,175,215,.10)"; ctx.fill(lf); }); }
    } else if (current) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      requestViewport();
      const sharp = vp && vp.key === viewportKey();
      if (sharp) ctx.drawImage(vpCanvas, 0, 0, W, H);
      for (const dx of wraps) {
        const [ax, ay] = toScreen(-180.5, 90.5), [bx, by] = toScreen(179.5, -90.5);
        const ox = dx * S.t.k;
        if (bx + ox < 0 || ax + ox > W) continue;
        if (!sharp) ctx.drawImage(off, ax + ox, ay, bx - ax, by - ay);
        if (S.fade && dimCanvas) {
          const [tx, ty] = toScreen(-180, 90), [ux, uy] = toScreen(180, -90);
          ctx.drawImage(dimCanvas, tx + ox, ty, ux - tx, uy - ty);
        }
        if (S.relief && shade) {
          ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.95;
          const [tx, ty] = toScreen(-180, 90), [ux, uy] = toScreen(180, -90);
          ctx.drawImage(shade, tx + ox, ty, ux - tx, uy - ty); ctx.restore();
        }
        if (S.dis && disCanvas && disCanvas.key === `${fhs()[S.fi]}_${S.fl}`) {
          ctx.save(); ctx.imageSmoothingEnabled = false;
          const [tx, ty] = toScreen(-180.5, 90.5), [ux, uy] = toScreen(179.5, -90.5);
          ctx.drawImage(disCanvas, tx + ox, ty, ux - tx, uy - ty); ctx.restore();
        }
      }
    }
    if (current) drawSurface(wraps);
    const onPhoto = SAT_LOOK(S.look);
    const pg = basePath("grat", d3.geoGraticule10()), pb = borders && basePath("borders", borders), pl = land && basePath("coast", land);
    const cGrat = css("--grat"), cBord = onPhoto ? "rgba(255,255,255,.22)" : css("--border-c"), cCoast = onPhoto ? "rgba(255,255,255,.38)" : css("--coast");
    for (const dx of wraps) inBase(dx, s => {
      ctx.lineJoin = "round";
      ctx.strokeStyle = cGrat; ctx.lineWidth = s; ctx.stroke(pg);
      if (pb) { ctx.strokeStyle = cBord; ctx.lineWidth = 0.6 * s; ctx.stroke(pb); }
      if (pl) { ctx.strokeStyle = cCoast; ctx.lineWidth = (onPhoto ? 0.7 : 0.9) * s; ctx.stroke(pl); }
    });
    if (current && S.look === "contour") drawContoursMain(wraps, CT_LEVELS.filter(v => v >= lit() - 1e-9), contourStyle, true);
    if (current && onPhoto) drawContoursMain(wraps, [lit()], () => ({ stroke: "#ff9a2e", width: 1.6 }), false);
    if (current && S.look === "rose") {
      const [lonA, latA] = toLonLat(0, 0), [lonB, latB] = toLonLat(W, H);
      drawRoseLook(ctx, toScreen, S.t.k * W0 / 360, lonA, lonB, latA, latB);
    }
    if (S.hd === "max" && current && S.look !== "rose") drawBestArrows();
    for (const f of overlays) f(ctx, toScreen, S.t.k * W0);
    emit("draw");
    if (S.sel) {
      const [sx, sy] = toScreen(S.sel[0], S.sel[1]);
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
      ctx.lineWidth = 4; ctx.strokeStyle = css("--casing"); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = css("--text"); ctx.stroke();
    }
  }

  // minimal arrows showing the best direction of travel (Best mode)
  function drawBestArrows() {
    const pxPerDeg = S.t.k * W0 / 360, step = Math.max(1, Math.ceil(38 / pxPerDeg));
    const [lonA, latA] = toLonLat(0, 0), [lonB, latB] = toLonLat(W, H);
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let lat = Math.floor(Math.min(80, latA) / step) * step; lat >= Math.max(-80, latB); lat -= step) {
      for (let lon = Math.ceil(Math.max(-540, lonA) / step) * step; lon <= Math.min(540, lonB); lon += step) {
        const L = normLon(lon), i = ((Math.round(L) + 180) % 360 + 360) % 360, j = Math.round(90 - lat);
        let best = 0, bi = 0;
        for (let k = 0; k < 36; k++) { const v = raw(current, k, i, j); if (v > best) { best = v; bi = k; } }
        if (toM(best) - S.margin < FLOOR || (S.thresh && toM(best) - S.margin < S.thresh)) continue;
        const land = raw(current, A().tile_land, i, j) > 127;
        const th = bi * 10 * Math.PI / 180, cl = Math.max(0.2, Math.cos(lat * Math.PI / 180));
        let dx = Math.sin(th) / cl, dy = -Math.cos(th); const n = Math.hypot(dx, dy); dx /= n; dy /= n;
        const [x, y] = toScreen(lon, lat), len = 7;
        const x0 = x - dx * len, y0 = y - dy * len, x1 = x + dx * len, y1 = y + dy * len;
        ctx.strokeStyle = land || !S.fade ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.35)";
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 - dx * 4 - dy * 3, y1 - dy * 4 + dx * 3);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 - dx * 4 + dy * 3, y1 - dy * 4 - dx * 3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLegend() {
    const c = $("legendBar"), g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (S.look !== "mach") { g.fillStyle = "#061029"; g.fillRect(0, 0, c.width, c.height); }
    for (let x = 0; x < c.width; x++) {
      const M = 1.0 + (x / (c.width - 1)) * 0.30;
      if (S.look === "mach") g.fillStyle = `rgb(${colorFor(M)})`;
      else if (S.look === "contour") { const on = Math.abs(((M - 1.05) / 0.025) - Math.round((M - 1.05) / 0.025)) < 0.06 && M >= lit() - 1e-6; g.fillStyle = on ? (Math.abs(M - lit()) < 0.004 ? "#ff9a2e" : "rgba(214,236,255,.9)") : "#061029"; }
      else { const k = corridorColor(M); g.fillStyle = `rgba(${k[0]},${k[1]},${k[2]},${k[3]})`; }
      g.fillRect(x, 0, 1, c.height);
    }
    const fx = Math.round(c.width * Math.min(0.3, (S.thresh || 1.05) - 1.0) / 0.30);
    g.fillStyle = "#ff8c1a"; g.fillRect(fx - 1, 0, 2, c.height);
  }

  // ---------- regulatory zone: national territory (land, lakes, internal waters) + 12 nm territorial sea
  // + boom-carpet half-width. 14 CFR 91.817(b): a sonic boom may not reach the surface within the United
  // States, which includes its territorial sea (12 nm, Proclamation 5928) and the Great Lakes. Most other
  // states ban civil supersonic flight over their territory too. Inside this zone a flight must be
  // boomless (Mach cutoff) or subsonic; full supersonic is allowed only beyond it.
  const TERR_SEA_NM = 12, CARPET_NM = 24, RNX = 1440, RNY = 720;
  let restricted = null;
  function buildRestricted() {
    const c = document.createElement("canvas"); c.width = RNX; c.height = RNY;
    const g = c.getContext("2d", { willReadFrequently: true });
    const pr = d3.geoEquirectangular().scale(RNX / (2 * Math.PI)).translate([RNX / 2, RNY / 2]).precision(0.1);
    g.fillStyle = "#fff"; g.beginPath(); d3.geoPath(pr, g)(landGeo); g.fill();
    const d = g.getImageData(0, 0, RNX, RNY).data, m = new Uint8Array(RNX * RNY);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 64 ? 1 : 0;
    const bufDeg = (TERR_SEA_NM + CARPET_NM) / 60, ry = Math.ceil(bufDeg * RNY / 180);
    const tmp = new Uint8Array(m.length);
    for (let j = 0; j < RNY; j++) {               // dilate along longitude (radius grows with 1/cos lat)
      const lat = 90 - (j + 0.5) * 180 / RNY, rx = Math.min(RNX / 2, Math.ceil(bufDeg / Math.max(0.05, Math.cos(lat * Math.PI / 180)) * RNX / 360));
      let cnt = 0; const row = j * RNX;
      for (let k = -rx; k <= rx; k++) cnt += m[row + ((k % RNX) + RNX) % RNX];
      for (let i = 0; i < RNX; i++) {
        tmp[row + i] = cnt > 0 ? 1 : 0;
        cnt += m[row + ((i + rx + 1) % RNX)] - m[row + ((i - rx) % RNX + RNX) % RNX];
      }
    }
    const out = new Uint8Array(m.length);
    for (let i = 0; i < RNX; i++) {               // then along latitude
      let cnt = 0;
      for (let k = -ry; k <= ry; k++) if (k >= 0 && k < RNY) cnt += tmp[k * RNX + i];
      for (let j = 0; j < RNY; j++) {
        out[j * RNX + i] = cnt > 0 ? 1 : 0;
        if (j + ry + 1 < RNY) cnt += tmp[(j + ry + 1) * RNX + i];
        if (j - ry >= 0) cnt -= tmp[(j - ry) * RNX + i];
      }
    }
    restricted = out;
    // smooth dimming overlay for open ocean (outside the regulated zone)
    dimCanvas = document.createElement("canvas"); dimCanvas.width = RNX; dimCanvas.height = RNY;
    const dg = dimCanvas.getContext("2d"), di = dg.createImageData(RNX, RNY);
    for (let i = 0; i < out.length; i++) { di.data[i * 4] = 6; di.data[i * 4 + 1] = 16; di.data[i * 4 + 2] = 41; di.data[i * 4 + 3] = out[i] ? 0 : 175; }
    dg.putImageData(di, 0, 0);
  }
  let dimCanvas = null, zone = null;   // zone: distance to territory in nm at 0.1 deg (engine/zone.py), 0 = territory
  const ZNX = 3600, ZNY = 1800, ZONE_NM = TERR_SEA_NM + CARPET_NM;
  async function loadZone() {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "geo/zone.png?v=1"; });
    const c = document.createElement("canvas"); c.width = ZNX; c.height = ZNY;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, ZNX, ZNY).data, z = new Uint8Array(ZNX * ZNY);
    for (let i = 0; i < z.length; i++) z[i] = d[i * 4];
    addInternalWaters(z);
    zone = z;
    // soft dimming of open ocean: fades in from the edge of the zone (36 nm) to 56 nm
    dimCanvas = document.createElement("canvas"); dimCanvas.width = RNX; dimCanvas.height = RNY;
    const dg = dimCanvas.getContext("2d"), di = dg.createImageData(RNX, RNY), f = ZNX / RNX;
    for (let j = 0; j < RNY; j++) for (let i = 0; i < RNX; i++) {
      const v = z[Math.floor((j + 0.5) * f) * ZNX + Math.floor((i + 0.5) * f)];
      const t = Math.min(1, Math.max(0, (v - ZONE_NM) / 20)), a = 175 * t * t * (3 - 2 * t), o = (j * RNX + i) * 4;
      di.data[o] = 6; di.data[o + 1] = 16; di.data[o + 2] = 41; di.data[o + 3] = a;
    }
    dg.putImageData(di, 0, 0);
  }
  // internal waters the distance-to-land grid misses: water a state claims as its own territory, where the same
  // overland rule applies. Canada: Hudson Bay complex (historic internal waters) and the Arctic Archipelago inside its
  // 1985 straight baselines (the United States disputes the Northwest Passage; counted as regulated, the cautious side).
  // Rough outlines (~0.5°); the boom-carpet buffer is added by stroking the outline 2.4° wide.
  const INTERNAL_WATERS = [
    [[-95.5, 58.5], [-94.5, 61], [-93, 62.5], [-90.5, 63.8], [-87, 64.5], [-86, 66.5], [-85, 68.5], [-82, 70], [-78.5, 70.3], [-76, 68.8], [-73.5, 67], [-71, 66],
     [-65.5, 62], [-64.4, 60.3], [-67, 58.3], [-69.5, 58.6], [-72, 60.5], [-77.5, 62.5], [-78.5, 60.5], [-77.5, 58], [-76.5, 56], [-79, 54.5], [-78.8, 51.3],
     [-80.5, 51.2], [-82.3, 52.8], [-85.5, 55.3], [-88, 56.5], [-92.5, 57], [-95.5, 58.5]],
    [[-126, 70], [-125.5, 72], [-123.5, 74.5], [-121, 76.2], [-118, 77.5], [-112, 78.8], [-105, 80.2], [-96, 81.3], [-88, 82.3], [-75, 83.1], [-62, 82.6],
     [-61, 82], [-66, 80.8], [-71, 79.3], [-75, 78.2], [-78, 76.3], [-79.5, 74.6], [-80, 73.7], [-78, 72.8], [-75, 72.1], [-71.5, 71], [-68, 70], [-66.5, 68.8],
     [-64, 67], [-62.5, 66.5], [-70, 66], [-80, 69], [-90, 68.5], [-100, 67.5], [-110, 68], [-118, 69], [-126, 70]],
  ];
  function addInternalWaters(z) {
    const c = document.createElement("canvas"); c.width = ZNX; c.height = ZNY;
    const g = c.getContext("2d"), X = lon => (lon + 180) * 10, Y = lat => (90 - lat) * 10;
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineWidth = 24; g.lineJoin = "round";
    for (const poly of INTERNAL_WATERS) { g.beginPath(); poly.forEach(([lo, la], k) => k ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la))); g.closePath(); g.fill(); g.stroke(); }
    const d = g.getImageData(0, 0, ZNX, ZNY).data;
    for (let i = 0; i < z.length; i++) if (d[i * 4 + 3] > 127) z[i] = 0;
  }
  function zoneNm(lon, lat) {
    if (!zone) return null;
    const i = Math.floor((((lon + 180) % 360) + 360) % 360 * 10) % ZNX, j = Math.min(ZNY - 1, Math.max(0, Math.floor((90 - lat) * 10)));
    return zone[j * ZNX + i];
  }
  function restrictedAt(lon, lat) {
    const v = zoneNm(lon, lat);
    if (v != null) return v <= ZONE_NM;
    if (!restricted) return null;
    const i = Math.floor((((lon + 180) % 360) + 360) % 360 / 360 * RNX) % RNX, j = Math.min(RNY - 1, Math.max(0, Math.floor((90 - lat) / 180 * RNY)));
    return restricted[j * RNX + i] === 1;
  }

  // land (and its 12 nm territorial sea) where a secondary boom must not land; the boom-carpet buffer does not apply
  function regulatedLand(lon, lat) {
    const v = zoneNm(lon, lat);
    if (v != null) return v <= 12;
    return restrictedAt(lon, lat);
  }

  // distance (km) from each 1° cell to the nearest regulated land, two-pass chamfer; lets the secondary-boom check
  // skip legs that are far out to sea. Rebuilt lazily once the zone data are in.
  let landDist = null;
  function landDistKm(lon, lat) {
    if (!landDist) {
      if (!zone && !restricted) return 0;
      const W = 360, H = 181, D = new Float32Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) D[j * W + i] = regulatedLand(i - 180 + 0.5, 90 - j) ? 0 : 1e9;
      const step = j => 111.2 * Math.max(0.05, Math.cos((90 - j) * Math.PI / 180));
      for (let pass = 0; pass < 2; pass++) for (let jj = 0; jj < H; jj++) {
        const j = pass ? H - 1 - jj : jj, dx = step(j), dd = Math.hypot(dx, 111.2);
        for (let ii = 0; ii < W; ii++) {
          const i = pass ? W - 1 - ii : ii, k = j * W + i; let v = D[k];
          const nb = pass ? [[1, 0, dx], [0, 1, 111.2], [1, 1, dd], [-1, 1, dd]] : [[-1, 0, dx], [0, -1, 111.2], [-1, -1, dd], [1, -1, dd]];
          for (const [di, dj, w] of nb) { const j2 = j + dj; if (j2 < 0 || j2 >= H) continue; const i2 = (i + di + W) % W; v = Math.min(v, D[j2 * W + i2] + w); }
          D[k] = v;
        }
      }
      landDist = D;
    }
    const i = ((Math.floor(lon + 180) % 360) + 360) % 360, j = Math.min(180, Math.max(0, Math.round(90 - lat)));
    return landDist[j * 360 + i];
  }

  // ---------- secondary booms: per 2° cell and ray direction, the band of trace velocities the stratosphere sends
  // back to the ground and how far they land (engine/secondary.py, built every 12 h) ----------
  const ssb = { ready: new Map(), pending: null };
  function rgbBytes(src) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, a = new Uint8Array(img.width * img.height * 3);
        for (let i = 0, n = img.width * img.height; i < n; i++) { a[3 * i] = d[4 * i]; a[3 * i + 1] = d[4 * i + 1]; a[3 * i + 2] = d[4 * i + 2]; }
        res(a);
      };
      img.onerror = rej; img.src = src;
    });
  }
  function prepareSsb() {
    const m = S.man.ssb;
    if (!m || !m.fhs.length) return Promise.resolve(false);
    if (ssb.pending && ssb.run === S.man.run) return ssb.pending;
    ssb.run = S.man.run; ssb.ready.clear();
    ssb.pending = Promise.all(m.fhs.map(async fh => {
      const k = String(fh).padStart(3, "0");
      const [a, b] = await Promise.all(["a", "b"].map(x => rgbBytes(DATA + `ssb_f${k}_${x}.png?r=${S.man.run}`)));
      ssb.ready.set(fh, { a, b });
    })).then(() => true).catch(() => { ssb.ready.clear(); return false; });
    return ssb.pending;
  }
  function ssbAt(validMs, lon, lat, eDeg) {
    const m = S.man.ssb; if (!m || !ssb.ready.size) return null;
    const h = (validMs - Date.parse(S.man.run_time)) / 3.6e6;
    const fh = [...ssb.ready.keys()].reduce((b, f) => Math.abs(f - h) < Math.abs(b - h) ? f : b);
    const t = ssb.ready.get(fh), tile = ((Math.round(eDeg / 10) % 36) + 36) % 36, tr = Math.floor(tile / 6), tc = tile % 6;
    const i = ((Math.round((lon + 180) / m.d) % m.nx) + m.nx) % m.nx, j = Math.min(m.ny - 1, Math.max(0, Math.round((90 - lat) / m.d)));
    const px = (tr * m.ny + j) * (6 * m.nx) + tc * m.nx + i, A = t.a, B = t.b, R = m.R_step_km;
    const V = x => m.V0 + x * m.V_step, Rk = x => x ? x * R : null;
    return { vlo: V(A[3 * px]), vhi: V(A[3 * px + 1]), r1: [Rk(A[3 * px + 2]), Rk(B[3 * px])], r2: [Rk(B[3 * px + 1]), Rk(B[3 * px + 2])] };
  }

  // ---------- terrain / hillshade ----------
  let terrain = null, shade = null;
  async function loadTerrain() {
    const T = S.man.terrain; if (!T) return;
    const img = new Image(); img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = DATA + T.file + "?r=" + S.man.run; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, nx = c.width, ny = c.height;
    const z = new Float32Array(nx * ny);
    for (let i = 0; i < z.length; i++) z[i] = d[i * 4] * T.step_m;
    terrain = { z, nx, ny, img, dLon: 360 / nx, dLat: 180 / (ny - 1) };
    // hillshade (sun from NW, 45° up), vertical exaggeration so 25-km cells show relief
    const sh = document.createElement("canvas"); sh.width = nx; sh.height = ny;
    const sg = sh.getContext("2d"), out = sg.createImageData(nx, ny), VEX = 25;
    const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, cellY = terrain.dLat * 111320;
    for (let j = 0; j < ny; j++) {
      const cellX = Math.max(2000, terrain.dLon * 111320 * Math.cos((90 - j * terrain.dLat) * Math.PI / 180));
      for (let i = 0; i < nx; i++) {
        const at = (ii, jj) => z[Math.min(ny - 1, Math.max(0, jj)) * nx + ((ii + nx) % nx)];
        const h = at(i, j), o = (j * nx + i) * 4;
        let v = 255;
        if (h > 0) {
          const dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * cellX) * VEX, dzdy = (at(i, j - 1) - at(i, j + 1)) / (2 * cellY) * VEX;
          const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
          const hs = Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
          v = Math.round(255 * Math.max(0.25, Math.min(1, 0.35 + 0.75 * hs)));
        }
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
      }
    }
    sg.putImageData(out, 0, 0); shade = sh; schedule(); emit("texture");
  }
  function elevAt(lon, lat) {
    if (!terrain) return 0;
    const fi = (((lon + 180) % 360 + 360) % 360) / terrain.dLon, fj = Math.min(terrain.ny - 1.001, Math.max(0, (90 - lat) / terrain.dLat));
    const i0 = Math.floor(fi) % terrain.nx, j0 = Math.floor(fj), di = fi - Math.floor(fi), dj = fj - j0, i1 = (i0 + 1) % terrain.nx;
    const z = (i, j) => terrain.z[j * terrain.nx + i];
    return (z(i0, j0) * (1 - di) + z(i1, j0) * di) * (1 - dj) + (z(i0, j0 + 1) * (1 - di) + z(i1, j0 + 1) * di) * dj;
  }

  // ---------- inspector ----------
  const fmtLat = lat => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const fmtLon = lon => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  // where GFS and ECMWF disagree (model 2.9, manifest.models.disagreement): largest |IFS - GFS| over directions
  const disCache = new Map(), disReady = new Map();
  function loadDis(fh, fl) {
    const D = S.man.models && S.man.models.disagreement;
    if (!D) return Promise.resolve(null);
    const k = `${fh}_${fl}`;
    if (!disCache.has(k)) disCache.set(k, new Promise(res => {
      const done = a => { if (a) disReady.set(k, a); res(a); };
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, a = new Uint8Array(img.width * img.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4];
        done(a);
      };
      img.onerror = () => done(null);
      img.src = DATA + D.pattern.replace("{fh:03d}", String(fh).padStart(3, "0")).replace("{fl}", fl) + `?r=${S.man.run}`;
    }));
    return disCache.get(k);
  }
  // nearest node (no interpolation: 254 = one model only is a category); null without a second model
  async function disagreementAt(lon, lat, fh = fhs()[S.fi], fl = S.fl) {
    const a = await loadDis(fh, fl); return a ? disDecode(a, lon, lat) : null;
  }
  const disDecode = (a, lon, lat) => {
    const i = ((Math.round(lon) + 180) % 360 + 360) % 360, j = Math.min(180, Math.max(0, Math.round(90 - lat))), b = a[j * NX + i];
    return b === 0 ? { none: true } : b === 254 ? { one: true } : { d: (b - 1) * S.man.models.disagreement.step };
  };
  // synchronous, for plans and evidence: the forecast hour nearest the leg time, if already loaded (preloadDis)
  function disagreementSync(lon, lat, leadH, fl) {
    const fh = fhs().reduce((b, h) => Math.abs(h - leadH) < Math.abs(b - leadH) ? h : b, fhs()[0]), a = disReady.get(`${fh}_${fl}`);
    return a ? disDecode(a, lon, lat) : null;
  }
  const preloadDis = fl => Promise.all(fhs().map(fh => loadDis(fh, fl)));
  // worst-direction |IFS - GFS| >= 0.02: 6% of balloon columns at the analysis, 19% at 24 h, where the unsafe-side error
  // of the mean was 0.0103 / 0.0122 against 0.0067 / 0.0087 elsewhere (study/results/validation_ifs_mean.json)
  const DIS_HIGH = 0.02;
  // map layer: diagonal hatch on nodes where the models disagree by >= DIS_HIGH or only one has a corridor
  let disCanvas = null;
  async function disCanvasFor() {
    if (!S.dis) return;
    const fh = fhs()[S.fi], fl = S.fl, key = `${fh}_${fl}`;
    if (disCanvas && disCanvas.key === key) return;
    const a = await loadDis(fh, fl); if (!a || key !== `${fhs()[S.fi]}_${S.fl}`) return;
    const Z = 6, c = document.createElement("canvas"); c.width = NX * Z; c.height = NY * Z;
    const g = c.getContext("2d"), hi = Math.round(DIS_HIGH / S.man.models.disagreement.step) + 1;
    g.strokeStyle = css("--dis") || "#c026d3"; g.lineWidth = 1.4; g.beginPath();
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const b = a[j * NX + i]; if (!(b === 254 || (b >= hi && b < 254))) continue;
      g.moveTo(i * Z, (j + 1) * Z); g.lineTo((i + 1) * Z, j * Z);
    }
    g.stroke(); c.key = key; disCanvas = c; schedule();
  }   // top 10% of disagreement in the validation year: 24 h error ~40% above the rest
  function disText(r) {
    if (!r) return null;
    if (r.none) return "neither has a corridor";
    if (r.one) return "only one model has a corridor (map shows none)";
    return r.d < 0.002 ? "agree within 0.002" : `differ by up to ${r.d.toFixed(3)}${r.d >= DIS_HIGH ? " · high: trust less" : ""}`;
  }

  function updateInspector() {
    if (!S.sel || !current) return;
    const [lon, lat] = S.sel;
    $("inspHint").textContent = ""; $("inspBody").hidden = false;
    $("inspLoc").textContent = `${fmtLat(lat)} ${fmtLon(lon)}`;
    $("inspSurf").textContent = landAt(current, lon, lat) > 0.5 ? "land" : "ocean";
    const mg = marginAt(lon, lat), ms = S.man.headings.map((h, i) => mAt(current, i, lon, lat) - mg);
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
    disagreementAt(lon, lat).then(r => {
      const t = disText(r); if (!t || !S.sel || S.sel[0] !== lon || S.sel[1] !== lat) return;
      $("inspFacts").insertAdjacentHTML("beforeend", `<dt title="Largest difference over the 36 directions between NOAA GFS and ECMWF IFS; the map shows their mean">GFS vs ECMWF</dt><dd id="inspDis">${t}</dd>`);
    });
    drawPolar(ms, selI);
    drawTimeSeries(lon, lat);
  }
  function drawPolar(ms, selI) {
    const svg = d3.select("#polar"); svg.selectAll("*").remove();
    const R = 92, r = d3.scaleLinear([0.98, 1.3], [0, R]).clamp(true);
    svg.append("circle").attr("r", r(FLOOR)).attr("fill", "var(--low-soft)").attr("stroke", "var(--text-2)").attr("stroke-dasharray", "3 3");
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
      .attr("fill", "var(--mach)").attr("fill-opacity", 0.15).attr("stroke", "var(--mach)").attr("stroke-width", 2);
    svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", d => d[0]).attr("cy", d => d[1])
      .attr("r", (d, i) => i === selI ? 5 : 1.8).attr("fill", (d, i) => i === selI ? "var(--text)" : "var(--mach)")
      .attr("stroke", "var(--surface)").attr("stroke-width", (d, i) => i === selI ? 1.5 : 0)
      .append("title").text((d, i) => `${S.man.headings[i]}°: ${ms[i] < 1 ? "no corridor" : "M " + ms[i].toFixed(3)}`);
  }
  async function drawTimeSeries(lon, lat) {
    const fl = S.fl, key = [S.hd, S.hdDeg].join(), sel = S.sel;
    const atl = await Promise.all(fhs().map(fh => loadAtlas(fh, fl)));
    if (S.sel !== sel || S.fl !== fl || [S.hd, S.hdDeg].join() !== key) return;
    const tile = curTile();
    const vt = S.man.valid_times.map(s => new Date(s));
    const mg = marginAt(lon, lat), data = atl.map((a, i) => ({ t: vt[i], m: mAt(a, tile, lon, lat) - mg }));
    const svg = d3.select("#ts"); svg.selectAll("*").remove();
    const m = { l: 30, r: 8, t: 8, b: 22 }, w = 320 - m.l - m.r, h = 130 - m.t - m.b;
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleUtc(d3.extent(vt), [0, w]);
    const y = d3.scaleLinear([0.98, Math.max(1.3, d3.max(data, d => d.m))], [h, 0]);
    g.append("rect").attr("x", 0).attr("width", w).attr("y", y(FLOOR)).attr("height", h - y(FLOOR)).attr("fill", "var(--low-soft)");
    g.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(4).tickFormat(d3.format(".2f"))).call(s => s.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(d3.utcHour.every(12)).tickSize(3).tickFormat(d3.utcFormat("%a %HZ"))).call(s => s.select(".domain").attr("stroke", "var(--line)"));
    g.append("line").attr("x1", x(vt[S.fi])).attr("x2", x(vt[S.fi])).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text-2)").attr("stroke-dasharray", "3 3");
    g.append("path").datum(data).attr("fill", "none").attr("stroke", "var(--mach)").attr("stroke-width", 2).attr("d", d3.line().x(d => x(d.t)).y(d => y(Math.max(0.98, d.m))));
    g.append("g").selectAll("circle").data(data).join("circle").attr("cx", d => x(d.t)).attr("cy", d => y(Math.max(0.98, d.m))).attr("r", (d, i) => i === S.fi ? 4.5 : 3)
      .attr("fill", (d, i) => i === S.fi ? "var(--text)" : (d.m >= FLOOR ? "var(--mach)" : "var(--text-2)")).attr("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .append("title").text(d => `${d3.utcFormat("%a %d %HZ")(d.t)}: ${d.m < 1 ? "no corridor" : "M " + d.m.toFixed(3)}`);
    $("tsSub").textContent = `· FL${fl}, ${S.hd === "min" ? "any direction" : S.hd === "max" ? "best direction" : S.hdDeg + "°"}`;
  }

  // ---------- kpis / labels ----------
  function updateKpis() {
    const st = S.man.stats[String(S.fl)]?.[S.fi];
    if (st) {
      const mt = marginTypical();
      $("kpiLand").textContent = st.land_any_median - mt < 1 ? "none" : `M ${(st.land_any_median - mt).toFixed(2)}`;
      const th = S.man.stats_thresholds, target = FLOOR + mt;
      let pct = 0;
      for (let i = 0; i < th.length - 1; i++) if (target >= th[i] && target <= th[i + 1]) {
        const f = (target - th[i]) / (th[i + 1] - th[i]); pct = st.land_any_cdf[i] * (1 - f) + st.land_any_cdf[i + 1] * f;
      }
      $("kpiPct").textContent = `${Math.round(pct * 100)}%`;
    }
    const vt = new Date(S.man.valid_times[S.fi]);
    $("timeLbl").textContent = `${d3.utcFormat("%a %d %b, %H:%M")(vt)} UTC`;
    $("hdLbl").textContent = S.hd === "hd" ? `${String(S.hdDeg).padStart(3, "0")}°` : "";
    $("hdRow").hidden = S.hd !== "hd";
    $("layersSummary").textContent = `FL${S.fl}${isHigh() ? " (est.)" : ""}, ${S.hd === "hd" ? String(S.hdDeg).padStart(3, "0") + "°" : S.hd === "min" ? "any direction" : "best direction"}${S.thresh ? ", M " + S.thresh.toFixed(2) + "+" : ""}`;
    const fl = lit().toFixed(2), credit = SAT_LOOK(S.look) ? (sat.status[S.look] === "failed" ? " Satellite image unavailable right now." : " " + SAT_SRC[S.look].credit(SAT_SRC[S.look].time()) + ".") : "";
    const notes = {
      mach: S.thresh ? `Only Mach ${S.thresh.toFixed(2)} and above is lit; everything below stays dark.` : "Brighter means more Mach without a boom reaching the ground. Orange marks the usable floor.",
      sat: `Cyan: a corridor, brighter with more Mach. Orange line: the M ${fl} edge.` + credit,
      earth: `Cyan: a corridor, brighter with more Mach. Orange line: the M ${fl} edge.` + credit,
      night: `Cyan: a corridor, brighter with more Mach. Orange line: the M ${fl} edge.` + credit,
      contour: `Lines every 0.025 Mach, labelled every 0.05. Orange: the M ${fl} edge; outside it there is no corridor.`,
      flow: `Streaks follow the wind at FL${S.fl}. Colour: boomless Mach where they pass, grey where there is no corridor.`,
      rose: "Each petal is a direction of travel; longer and brighter means more boomless Mach that way. Grey: no corridor that way.",
    };
    const surfNote = surfaceLegend();
    $("legendNote").textContent = (isHigh() ? `FL${S.fl} is an estimate: GFS only, not yet checked against balloons; margin 1.5x. ` : "") + notes[S.look] + (S.dis && S.man.models && S.man.models.disagreement && S.look === "mach" ? " Hatching: GFS and ECMWF differ by 0.02 or more in some direction, or only one has a corridor." : "") + surfNote;
    $("legendTitle").textContent = { mach: "Boomless cruise Mach", sat: "Corridors over satellite", earth: "Corridors over a cloud-free Earth", night: "Corridors over night lights", contour: "Boomless Mach contours", flow: `Wind at FL${S.fl}, coloured by Mach`, rose: "Boomless Mach by direction" }[S.look];
    $("marginLbl").textContent = S.auto && sigma ? "≈" + marginTypical().toFixed(3) : S.margin.toFixed(3);
    $("marginAuto").setAttribute("aria-pressed", S.auto && sigma ? "true" : "false");
    $("marginSlider").disabled = !!(S.auto && sigma);
    $("marginAuto").title = S.auto && gefsNow(S.fl) ? `Margin per point and direction from the 31-member GEFS spread (run ${gefs.meta.run.slice(0, 8)} 00Z)` : "Margin per point from a year of forecast errors";
  }

  // ---------- hover / click ----------
  const tip = $("tip");
  const normLon = lon => ((lon + 540) % 360) - 180;
  function describe(lon, lat) {
    const M = mAt(current, curTile(), lon, lat) - marginAt(lon, lat), c = cAt(current, lon, lat);
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
      const on = b.dataset.v === String(get()); b.classList.toggle("on", on); b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
    el.onkeydown = e => {                     // radio-group pattern: arrows move the selection
      const bs = [...el.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (i < 0 || !d) return;
      const n = bs[(i + d + bs.length) % bs.length]; n.click(); n.focus(); e.preventDefault();
    };
    el.querySelectorAll("button").forEach(b => b.onclick = () => { set(isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v); mark(); });
    mark(); return mark;
  }
  function buildControls() {
    const flLo = S.man.flight_levels.filter(f => f <= HI_FL), flHi = S.man.flight_levels.filter(f => f > HI_FL), marks = [];
    const setFl = v => { S.fl = v; marks.forEach(m => m()); refresh(); };
    marks.push(seg($("flSeg"), flLo.map(f => [f, String(f), `FL${f}, about ${Math.round(f / 10)},000 ft`]), () => S.fl, setFl));
    $("flHiRow").hidden = !flHi.length;
    if (flHi.length) marks.push(seg($("flHiSeg"), flHi.map(f => [f, String(f), `FL${f}, about ${Math.round(f / 10)},000 ft: an estimate (GFS only, not yet validated)`]), () => S.fl, setFl));
    seg($("hdSeg"), null, () => S.hd, v => { S.hd = v; $("hdSlider").disabled = v !== "hd"; refresh(); });
    $("hdSlider").value = S.hdDeg; $("hdSlider").disabled = S.hd !== "hd";
    $("hdSlider").oninput = e => { S.hdDeg = +e.target.value; refresh(); };
    const sl = $("timeSlider"); sl.max = fhs().length - 1; sl.value = S.fi;
    sl.oninput = () => { S.fi = +sl.value; refresh(); };
    $("marginSlider").value = S.margin;
    $("marginSlider").oninput = e => { S.margin = +e.target.value; refresh(); };
    $("marginAuto").hidden = !sigma;
    $("marginAuto").onclick = () => { S.auto = !S.auto; refresh(); };
    $("fadeOcean").checked = S.fade;
    $("fadeOcean").onchange = e => { S.fade = e.target.checked; schedule(); };
    $("disWrap").hidden = !(S.man.models && S.man.models.disagreement);
    $("disShow").checked = S.dis;
    $("disShow").onchange = e => { S.dis = e.target.checked; disCanvasFor(); updateKpis(); schedule(); };
    $("relief").checked = S.relief;
    $("relief").onchange = e => { S.relief = e.target.checked; schedule(); emit("texture"); };
    for (const [id, k] of [["landShow", "land"], ["snowShow", "snow"], ["mtnShow", "mtn"]]) {
      $(id).checked = S[k];
      $(id).onchange = e => { S[k] = e.target.checked; if (S[k] && SURF[k]) surfImg(k); updateKpis(); schedule(); writeHash(); };
    }
    $("threshSel").value = [...$("threshSel").options].find(o => +o.value === (S.thresh || 0))?.value ?? "0";
    $("threshSel").onchange = e => { S.thresh = +e.target.value; refresh(); };
    $("playBtn").onclick = togglePlay;
    $("apts").innerHTML = AIRPORTS.map(a => `<option value="${a[0]}">${a[1]}</option>`).join("");
    $("protoBadge").onclick = () => setTab("method");
    $("layersToggle").onclick = () => { const o = $("mapControls").classList.toggle("open"); $("layersToggle").setAttribute("aria-expanded", o); };
    $("tticks").innerHTML = S.man.valid_times.map((v, i) => i % 2 ? "" : `<span style="left:${100 * i / (fhs().length - 1)}%">${d3.utcFormat("%a %HZ")(new Date(v))}</span>`).join("");
    seg($("viewSeg"), null, () => S.view, v => { S.view = v; setView(); });
    document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  }
  function setView() {
    const g = S.view === "3d";
    $("globe").hidden = !g; canvas.style.visibility = g ? "hidden" : "visible";
    $("hint").textContent = g ? "Drag to rotate. Click to inspect, shift-click to route." : "Click to inspect a point. Shift-click a second point to plan a route.";
    emit("draw");
    if (g && window.MC3D) window.MC3D.showGlobe($("globe"));
    writeHash();
  }
  function setTab(t) {
    document.querySelectorAll(".tabs button").forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    for (const k of ["map", "econ", "physics", "method"]) $("tab-" + k).hidden = t !== k;
    window.dispatchEvent(new CustomEvent("mc-tab", { detail: t }));
    if (t === "map") { layout(); schedule(); }
  }
  function togglePlay() {
    if (S.playing) { clearInterval(S.playing); S.playing = null; $("playBtn").textContent = "▶"; return; }
    fhs().forEach(fh => loadAtlas(fh, S.fl));
    $("playBtn").textContent = "❚❚";
    S.playing = setInterval(() => { S.fi = (S.fi + 1) % fhs().length; $("timeSlider").value = S.fi; refresh(); }, 900);
  }

  function setLook(l) {
    if (!LOOKS.includes(l) || l === S.look) return;
    S.look = l; vp = null; sat.view = null;
    if (SAT_LOOK(l)) satGlobal(l);
    drawLegend(); updateKpis(); schedule(); emit("texture"); emit("look", l); writeHash();
  }

  // ---------- URL state ----------
  const hashExtra = {};
  function writeHash() {
    if (!S.man) return;
    const p = new URLSearchParams({ fl: S.fl, d: S.hd === "hd" ? S.hdDeg : S.hd, t: S.fi, mg: S.auto && sigma ? "auto" : S.margin, v: S.view });
    if (S.thresh) p.set("th", S.thresh);
    if (S.look !== "mach") p.set("lk", S.look);
    const sf = ["land", "snow", "mtn"].filter(k => S[k]); if (sf.length) p.set("sf", sf.join(","));
    for (const [k, v] of Object.entries(hashExtra)) if (v != null) p.set(k, v);
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("fl") && S.man.flight_levels.includes(+p.get("fl"))) S.fl = +p.get("fl");
    const d = p.get("d");
    if (d === "min" || d === "max") S.hd = d; else if (d != null && !isNaN(+d)) { S.hd = "hd"; S.hdDeg = (Math.round(+d / 10) * 10) % 360; }
    S.fi = Math.min(fhs().length - 1, S.fi);
    if (p.get("t")) S.fi = Math.min(fhs().length - 1, Math.max(0, +p.get("t")));
    if (p.get("mg") === "auto") S.auto = true; else if (p.get("mg") != null && !isNaN(+p.get("mg"))) { S.auto = false; S.margin = Math.max(0, +p.get("mg")); }
    if (p.get("v") === "3d") S.view = "3d";
    if (p.get("th")) S.thresh = +p.get("th");
    if (LOOKS.includes(p.get("lk"))) S.look = p.get("lk");
    for (const k of (p.get("sf") || "").split(",")) if (["land", "snow", "mtn"].includes(k)) { S[k] = true; if (SURF[k]) surfImg(k); }
    return p;
  }

  // ---------- public API for plan.js / view3d.js ----------
  window.MC = {
    S, APT, AIRPORTS, FLOOR, KT, loadAtlas, loadProfiles, profileAt, mAt, mHeading, mHeadingSafe, cAt, landAt, windAt, tileOf, curTile,
    colorFor, toM, raw, off, setTab: t => setTab(t), fit: pts => {
      const ls = pts.map(p => normLon(p[0])), as = pts.map(p => p[1]);
      if (Math.max(...ls) - Math.min(...ls) > 180) return;
      const [ax, ay] = [x0 + (Math.min(...ls) + 180) / 360 * W0, y0 + (90 - Math.max(...as)) / 180 * H0];
      const [bx, by] = [x0 + (Math.max(...ls) + 180) / 360 * W0, y0 + (90 - Math.min(...as)) / 180 * H0];
      const k = Math.max(1, Math.min(8, 0.55 / Math.max((bx - ax) / W, (by - ay) / H, 0.02)));
      d3.select(canvas).transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * (ax + bx) / 2, H / 2 - k * (ay + by) / 2).scale(k));
    }, overlays, schedule, refresh, pick, describe, showTip, normLon, fmtLat, fmtLon, hashExtra, writeHash,
    get current() { return current; }, get landGeo() { return landGeo; }, get landMesh() { return land; },
    disagreementAt, disagreementSync, preloadDis, disText, DIS_HIGH,
    get terrain() { return terrain; }, get shade() { return shade; }, elevAt, restrictedAt, regulatedLand, landDistKm, prepareSsb, ssbAt, AIR_DATA_SD, kEffective: fl => !S.auto ? 3.75 : gefs.meta ? kEns(fl) : sigma ? kAt(fl) : 3.75, get ssbReady() { return ssb.ready.size > 0; }, zoneNm, marginAt, marginTypical, get sigmaReady() { return !!sigma; }, kAt, prepareGefs, get gefsMeta() { return gefs.meta; },
    on: (ev, f) => listeners[ev].push(f), css, isDark,
    // map styles (site/looks.js)
    LOOKS, setLook, isHigh, HI_FL, isPhoto: SAT_LOOK, get look() { return S.look; }, satGlobal, get satStatus() { return sat.status; }, get ovl() { paintOverlay(); return ovl; },
    mGrid, corridorColor, drawContourLook, strokeContours, drawRoseLook, toLonLat, toScreen, lit,
    get view() { return { W, H, k: S.t.k, W0, dpr }; }, get canvas() { return canvas; },
  };

  // ---------- boot ----------
  const zoom = d3.zoom().scaleExtent([1, 16]).on("zoom", e => { S.t = e.transform; tip.hidden = true; schedule(); });
  async function boot() {
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", () => tip.hidden = true);
    canvas.addEventListener("click", onClick);
    // keyboard: arrows pan, +/- zoom, Enter inspects the centre (Shift+Enter plans a route to it)
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", e => {
      const step = 60, sel = d3.select(canvas);
      const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (pan) { sel.call(zoom.translateBy, pan[0] / S.t.k, pan[1] / S.t.k); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { sel.call(zoom.scaleBy, 1.4); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { sel.call(zoom.scaleBy, 1 / 1.4); e.preventDefault(); }
      else if (e.key === "Enter") {
        const [lon, lat] = toLonLat(W / 2, H / 2);
        if (lat <= 90 && lat >= -90) { pick(lon, lat, e.shiftKey); showTip(describe(normLon(lon), lat), W / 2, H / 2); }
        e.preventDefault();
      }
    });
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
      await Promise.all([loadZone().catch(e => { console.warn("zone", e); buildRestricted(); }), loadSigma().catch(e => console.warn("sigma", e)), loadGefsMeta()]);
      const p = readHash();
      buildControls();
      const rt = new Date(man.run_time), gen = new Date(man.generated);
      const ifs = man.models && man.models.ifs, f = d3.utcFormat("%d %b %Y %HZ");
      $("runInfo").innerHTML = `GFS ${f(rt)} run${ifs ? ` + ECMWF ${f(d3.utcParse("%Y%m%d%H")(ifs))}` : ""} · updated ${d3.utcFormat("%d %b %H:%MZ")(gen)}`;
      $("runInfo").title = ifs ? "Boomless Mach is the mean of the two models (Method §6.2)" : (man.models ? "GFS only: " + (man.models.ifs_note || "ECMWF not available") : "GFS only");
      // data age (EFB practice, FAA AC 120-76E 11.15.2): amber from 12 h, red from 18 h when the router fails closed
      const age = () => {
        const h = (Date.now() - rt.getTime()) / 3.6e6, el = $("runAge");
        if (!el) return;
        el.textContent = `${h < 1 ? "<1" : Math.floor(h)} h old · model ${man.model_version || "?"}`;
        el.className = "age " + (h >= 18 ? "bad" : h >= 12 ? "warn" : "ok");
        el.title = h >= 18 ? "Older than 18 h: the router flies subsonic over land (fail-closed)" : h >= 12 ? "Getting old: plans need a run at most 12 h old at departure" : "Fresh forecast";
      };
      $("runInfo").insertAdjacentHTML("beforeend", ` · <span id="runAge"></span>`); age(); setInterval(age, 60000);
      await refresh();
      loadTerrain().catch(e => console.warn("terrain", e));
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
