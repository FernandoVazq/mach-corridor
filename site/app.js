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

  const S = { man: null, fl: 400, hd: "hd", hdDeg: 100, fi: 2, margin: 0.05, auto: true, fade: false, view: "2d", thresh: 0, relief: true,
              t: d3.zoomIdentity, sel: null, playing: null };
  const cache = new Map();
  const $ = id => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  let W = 0, H = 0, W0 = 0, H0 = 0, x0 = 0, y0 = 0, dpr = 1, land = null, borders = null, landGeo = null;
  const UP = 4;                                    // global raster: 4 pixels per 1° cell, values interpolated before colouring
  const off = document.createElement("canvas"); off.width = NX * UP; off.height = NY * UP;
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
    updateKpis(); updateInspector(); schedule(); writeHash();
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
  const sExtra = (lon, lat) => { if (!terrain || lon == null) return S_EXTRA_MTN; const t = Math.max(0, Math.min(1, (elevAt(lon, lat) - 500) / 1000)); return S_EXTRA + (S_EXTRA_MTN - S_EXTRA) * t; };
  const ensMargin = (fl, sd, lon, lat) => { const e = sExtra(lon, lat); return kEns(fl) * Math.sqrt(sd * sd + e * e); };
  // static error map (built with 0.012): add the mountain excess in quadrature
  const staticMtn = (v, kk, lon, lat) => { const e = sExtra(lon, lat); return kk * Math.sqrt(v * v + e * e - S_EXTRA * S_EXTRA); };
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
    mgCache[fl] = { k, g }; return g;
  }
  const bil = (f, lon, lat) => {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % NX;
    return (f(i0, j0) * (1 - di) + f(i1, j0) * di) * (1 - dj) + (f(i0, j0 + 1) * (1 - di) + f(i1, j0 + 1) * di) * dj;
  };
  // brg (deg): direction of travel of a route leg; without it, the map's direction tile
  // validMs: when the aircraft is there (route legs); default the map's time
  function marginAt(lon, lat, fl = S.fl, brg = null, validMs = null) {
    if (!S.auto) return S.margin;
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
  const marginTypical = () => S.auto && sigma ? kAt(S.fl) * nearest(sigma.landMedian, S.fl) : S.margin;

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
  // fill an ImageData; px(x, y) -> [fi, fj] fractional grid coordinates (fi along longitude, fj from the north pole)
  function rasterize(img, w, h, px) {
    const a = current, tile = curTile(), cols = A().cols, aw = AW();
    const base = Math.floor(tile / cols) * NY * aw + (tile % cols) * NX;
    const lt = A().tile_land, lbase = Math.floor(lt / cols) * NY * aw + (lt % cols) * NX;
    const lut = colorLut(), m0 = enc().M0, ms = enc().M_step, nz = 0.98, sc = (LUT_N - 1) / (LUT_M1 - LUT_M0), g = marginGrid();
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
    drawLegend();
    return true;
  }
  // when zoomed in, re-render just the visible window at screen resolution (after the view settles)
  let vp = null, vpTimer = null;
  const vpCanvas = document.createElement("canvas"), vpCtx = vpCanvas.getContext("2d");
  function viewportKey() { return [colorKey, S.t.x.toFixed(1), S.t.y.toFixed(1), S.t.k.toFixed(4), W, H].join("|"); }
  function requestViewport() {
    if (S.t.k < 2 || !current) { vp = null; return; }
    if (vp && vp.key === viewportKey()) return;
    clearTimeout(vpTimer);
    vpTimer = setTimeout(() => {
      const r = Math.min(2, dpr), w = Math.ceil(W * r / 1.5), h = Math.ceil(H * r / 1.5);
      vpCanvas.width = w; vpCanvas.height = h;
      const img = vpCtx.createImageData(w, h);
      rasterize(img, w, h, (x, y) => { const [lon, lat] = toLonLat((x + 0.5) * W / w, (y + 0.5) * H / h); return [lon + 180, 90 - lat]; });
      vpCtx.putImageData(img, 0, 0);
      vp = { key: viewportKey() }; schedule();
    }, 160);
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
      }
    }
    for (const dx of wraps) {
      const path = d3.geoPath(proj(dx), ctx);
      ctx.lineJoin = "round";
      ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = css("--grat"); ctx.lineWidth = 1; ctx.stroke();
      if (borders) { ctx.beginPath(); path(borders); ctx.strokeStyle = css("--border-c"); ctx.lineWidth = 0.6; ctx.stroke(); }
      if (land) { ctx.beginPath(); path(land); ctx.strokeStyle = css("--coast"); ctx.lineWidth = 0.9; ctx.stroke(); }
    }
    if (S.hd === "max" && current) drawBestArrows();
    for (const f of overlays) f(ctx, toScreen, S.t.k * W0);
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
    for (let x = 0; x < c.width; x++) {
      const M = 1.0 + (x / (c.width - 1)) * 0.30;
      g.fillStyle = `rgb(${colorFor(M)})`; g.fillRect(x, 0, 1, c.height);
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
    $("layersSummary").textContent = `FL${S.fl}, ${S.hd === "hd" ? String(S.hdDeg).padStart(3, "0") + "°" : S.hd === "min" ? "any direction" : "best direction"}${S.thresh ? ", M " + S.thresh.toFixed(2) + "+" : ""}`;
    $("legendNote").textContent = S.thresh ? `Only Mach ${S.thresh.toFixed(2)} and above is lit; everything below stays dark.` : "Brighter means more Mach without a boom reaching the ground. Orange marks the usable floor.";
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
    seg($("flSeg"), S.man.flight_levels.map(f => [f, String(f), `FL${f}, about ${Math.round(f / 10)},000 ft`]), () => S.fl, v => { S.fl = v; refresh(); });
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
    $("relief").checked = S.relief;
    $("relief").onchange = e => { S.relief = e.target.checked; schedule(); emit("texture"); };
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

  // ---------- URL state ----------
  const hashExtra = {};
  function writeHash() {
    if (!S.man) return;
    const p = new URLSearchParams({ fl: S.fl, d: S.hd === "hd" ? S.hdDeg : S.hd, t: S.fi, mg: S.auto && sigma ? "auto" : S.margin, v: S.view });
    if (S.thresh) p.set("th", S.thresh);
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
    get terrain() { return terrain; }, get shade() { return shade; }, elevAt, restrictedAt, regulatedLand, landDistKm, prepareSsb, ssbAt, kEffective: fl => !S.auto ? 3.75 : gefs.meta ? kEns(fl) : sigma ? kAt(fl) : 3.75, get ssbReady() { return ssb.ready.size > 0; }, zoneNm, marginAt, marginTypical, get sigmaReady() { return !!sigma; }, kAt, prepareGefs, get gefsMeta() { return gefs.meta; },
    on: (ev, f) => listeners[ev].push(f), css, isDark,
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
      $("runInfo").innerHTML = `GFS ${d3.utcFormat("%d %b %Y %HZ")(rt)} run · updated ${d3.utcFormat("%d %b %H:%MZ")(gen)}`;
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
