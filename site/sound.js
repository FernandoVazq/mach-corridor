// How far sound carries (issue #60). Data: data/manifest.json (carry) and data/carry_f{HHH}.png from engine/sound.py.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DIRN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const REGIONS = { us: ["United States", [-126, 24, -66, 50]], car: ["Caribbean", [-86, 10, -58, 28]], eu: ["Europe", [-12, 35, 32, 62]], world: ["World", [-180, -60, 180, 78]] };
  const st = { man: null, C: null, fi: 0, x: 0, play: false, wind: true, raw: [], mode: "all", tiles: new Map(), land: null, pt: null, t: d3.zoomIdentity, region: "us" };
  const STEP_MS = 1500;                            // play: 1.5 s per 6-hour step
  // levels (engine/sound.py LEVELS): label and colour; the map ramps continuously between them
  const LV = [[0, "Bends up: fades fast", "#0a1838"], [2, "A little farther", "#3c6aa8"], [5, "Carries far", "#f0a33a"], [9, "Carries very far", "#ff5a6a"]];
  const ramp = d3.scaleLinear().domain([2, 5, 9, 14]).range(["#3c6aa8", "#f0a33a", "#ff5a6a", "#ffd0e0"]).clamp(true);
  const level = (th) => (th >= 9 ? 3 : th >= 5 ? 2 : th >= 2 ? 1 : 0);

  // ---------- data
  const nx = () => st.C.nx, ny = () => st.C.ny;
  function tile(fh) {
    if (st.tiles.has(fh)) return st.tiles.get(fh);
    const p = new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, a = new Uint8Array(img.width * img.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4];
        res(a);
      };
      img.onerror = rej;
      img.src = "data/" + st.C.pattern.replace("{fh:03d}", String(fh).padStart(3, "0")) + "?r=" + st.man.run;
    });
    st.tiles.set(fh, p);
    return p;
  }
  // theta (deg) at a 1-degree node of tile t (0-7 directions, 8 all around, 9 best)
  function at(a, t, i, j) {
    const W = st.C.cols * nx(), r = Math.floor(t / st.C.cols), c = t % st.C.cols;
    return a[(r * ny() + j) * W + c * nx() + i] * st.C.step_deg;
  }
  function sample(a, t, lon, lat) {        // bilinear, lon -180..180, lat -90..90
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % 360;
    return (at(a, t, i0, j0) * (1 - di) + at(a, t, i1, j0) * di) * (1 - dj) + (at(a, t, i0, j0 + 1) * (1 - di) + at(a, t, i1, j0 + 1) * di) * dj;
  }
  function sampleRaw(a, t, lon, lat) {
    const fi = ((lon + 180) % 360 + 360) % 360, fj = Math.min(180, Math.max(0, 90 - lat));
    const i0 = Math.floor(fi), j0 = Math.min(179, Math.floor(fj)), di = fi - i0, dj = fj - j0, i1 = (i0 + 1) % 360;
    const W = st.C.cols * nx(), r = Math.floor(t / st.C.cols), c = t % st.C.cols, A = (i, j) => a[(r * ny() + j) * W + c * nx() + i];
    return (A(i0, j0) * (1 - di) + A(i1, j0) * di) * (1 - dj) + (A(i0, j0 + 1) * (1 - di) + A(i1, j0 + 1) * di) * dj;
  }
  const fhs = () => st.C.fhs;
  const vt = (k) => new Date(st.man.valid_times[st.man.forecast_hours.indexOf(fhs()[k])]);
  const fmtT = (d) => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);

  // ---------- map: colour raster for the time (cross-faded while playing), coastlines, and the wind as streaks
  // (the band's mean wind, the same idea as the Wind flow style of the main map); everything below the streaks is
  // cached in a base layer, so an animation frame is three image copies plus the streak segments
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const base = document.createElement("canvas"), trail = document.createElement("canvas"), mixC = document.createElement("canvas");
  const rasters = new Map();                       // `${fh}|${mode}` -> canvas (360 x 181)
  let W = 0, H = 0, dpr = 1, proj = null, baseKey = "";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function size() {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    for (const c of [canvas, base, trail]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    baseKey = ""; parts.length = 0;
  }
  function baseProj() {
    const [x0, y0, x1, y1] = REGIONS[st.region][1];
    return d3.geoEquirectangular().fitExtent([[0, 0], [W, H]], { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[x0, y0], [x1, y1]] } });
  }
  function makeProj() {
    const b = baseProj(), k = st.t.k, [tx, ty] = b.translate();
    proj = d3.geoEquirectangular().scale(b.scale() * k).translate([st.t.x + tx * k, st.t.y + ty * k]).precision(0.5);
    baseKey = ""; clearTrail();
  }
  async function raster(fh) {
    const key = `${fh}|${st.mode}`;
    if (rasters.has(key)) return rasters.get(key);
    const a = await tile(fh), c = document.createElement("canvas"); c.width = nx(); c.height = ny();
    const g = c.getContext("2d"), img = g.createImageData(nx(), ny()), t = st.mode === "all" ? st.C.tile_min : st.C.tile_max;
    for (let j = 0; j < ny(); j++) for (let i = 0; i < nx(); i++) {
      const th = at(a, t, i, j), o = (j * nx() + i) * 4;
      if (th < 2) { img.data[o + 3] = 0; continue; }
      const col = d3.rgb(ramp(th));
      img.data[o] = col.r; img.data[o + 1] = col.g; img.data[o + 2] = col.b; img.data[o + 3] = Math.round(120 + 110 * Math.min(1, (th - 2) / 7));
    }
    g.putImageData(img, 0, 0);
    rasters.set(key, c); return c;
  }
  // the colours at a fractional time x: the two neighbouring forecasts mixed ("lighter" keeps colour and transparency exact)
  function rasterAt(x) {
    const k = Math.floor(x), f = x - k, A = rasters.get(`${fhs()[k]}|${st.mode}`), B = rasters.get(`${fhs()[Math.min(fhs().length - 1, k + 1)]}|${st.mode}`);
    if (!A) return null;
    if (!B || f < 0.01) return A;
    mixC.width = A.width; mixC.height = A.height;
    const g = mixC.getContext("2d");
    g.globalCompositeOperation = "copy"; g.globalAlpha = 1 - f; g.drawImage(A, 0, 0);
    g.globalCompositeOperation = "lighter"; g.globalAlpha = f; g.drawImage(B, 0, 0);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    return mixC;
  }
  function paintBase() {
    const key = `${st.x.toFixed(3)}|${st.mode}|${W}|${H}|${proj.scale()}|${proj.translate()}`;
    if (key === baseKey) return;
    const g = base.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#061029";
    g.fillRect(0, 0, W, H);
    const r = rasterAt(st.x);
    if (r) {
      const [ax, ay] = proj([-180.5, 90.5]), [bx, by] = proj([179.5, -90.5]);
      g.imageSmoothingEnabled = true; g.drawImage(r, ax, ay, bx - ax, by - ay);
    }
    if (st.land) { const path = d3.geoPath(proj, g); g.beginPath(); path(st.land); g.strokeStyle = "rgba(226,235,252,.55)"; g.lineWidth = 0.8; g.stroke(); }
    baseKey = key;
  }
  // ---------- wind streaks
  const hasWind = () => st.C && st.C.tile_u != null && st.wind;
  function windAt(lon, lat, x) {
    const k = Math.floor(x), f = x - k, a = st.raw[k], b = st.raw[Math.min(fhs().length - 1, k + 1)] || a;
    if (!a) return [0, 0];
    const s = (arr, t) => sampleRaw(arr, t, lon, lat) - st.C.wind_zero;
    const u = s(a, st.C.tile_u) * (1 - f) + s(b, st.C.tile_u) * f, v = s(a, st.C.tile_v) * (1 - f) + s(b, st.C.tile_v) * f;
    return [u * st.C.wind_step, v * st.C.wind_step];
  }
  const parts = [];
  function spawn(p) {
    const ll = proj.invert([Math.random() * W, Math.random() * H]);
    p.lon = ll ? ll[0] : 0; p.lat = ll ? Math.max(-80, Math.min(80, ll[1])) : 0; p.age = Math.floor(Math.random() * 80); return p;
  }
  function clearTrail() { const g = trail.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, trail.width, trail.height); }
  function stepWind() {
    const n = Math.min(2200, Math.round(W * H / 260));
    while (parts.length < n) parts.push(spawn({}));
    parts.length = n;
    const g = trail.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "destination-out"; g.fillStyle = "rgba(0,0,0,.075)"; g.fillRect(0, 0, trail.width, trail.height);
    g.globalCompositeOperation = "source-over";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 1.1; g.beginPath();
    const kk = 0.0042 / Math.sqrt(st.t.k);
    for (const p of parts) {
      if (++p.age > 90) { spawn(p); p.age = 0; continue; }
      const [u, v] = windAt(p.lon, p.lat, st.x), a = proj([p.lon, p.lat]);
      p.lon += u * kk / Math.max(0.2, Math.cos(p.lat * Math.PI / 180)); p.lat += v * kk;
      const b = proj([p.lon, p.lat]);
      if (!a || !b || b[0] < 0 || b[0] > W || b[1] < 0 || b[1] > H) { spawn(p); continue; }
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    }
    g.stroke();
  }
  // reduced motion: still arrows on a grid instead of moving streaks
  function windArrows(g) {
    const step = 46;
    g.save(); g.strokeStyle = "rgba(255,255,255,.75)"; g.fillStyle = "rgba(255,255,255,.75)"; g.lineWidth = 1.2;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const ll = proj.invert([x, y]); if (!ll || Math.abs(ll[1]) > 80) continue;
      const [u, v] = windAt(ll[0], ll[1], st.x), s = Math.hypot(u, v); if (s < 0.5) continue;
      const L = Math.min(20, 3 + s * 1.6), dx = u / s * L, dy = -v / s * L;
      g.beginPath(); g.moveTo(x - dx / 2, y - dy / 2); g.lineTo(x + dx / 2, y + dy / 2); g.stroke();
      const hx = x + dx / 2, hy = y + dy / 2, a = Math.atan2(dy, dx);
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - 5 * Math.cos(a - 0.45), hy - 5 * Math.sin(a - 0.45)); g.lineTo(hx - 5 * Math.cos(a + 0.45), hy - 5 * Math.sin(a + 0.45)); g.closePath(); g.fill();
    }
    g.restore();
  }
  function draw() {
    if (!proj) return;
    paintBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0);
    if (hasWind()) {
      if (reduced.matches) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); windArrows(ctx); }
      else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(trail, 0, 0); }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st.pt) {
      const [x, y] = proj([st.pt[0], st.pt[1]]);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.lineWidth = 2.5; ctx.strokeStyle = "#061029"; ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }
  // one loop for the streaks and the play clock; it sleeps when nothing moves or the page is hidden
  let raf = 0, last = 0;
  function loop(now) {
    raf = 0;
    if (document.hidden) return;
    const dt = last ? Math.min(100, now - last) : 16; last = now;
    if (st.play) {
      const n = fhs().length;
      let x = st.x + dt / STEP_MS;
      if (x > n - 0.6) x = 0;
      const k = Math.floor(x);
      if (!rasters.has(`${fhs()[Math.min(n - 1, k + 1)]}|${st.mode}`) || !rasters.has(`${fhs()[k]}|${st.mode}`)) {
        raster(fhs()[k]); raster(fhs()[Math.min(n - 1, k + 1)]);        // still loading: wait
      } else setClock(x);
    }
    if (hasWind() && !reduced.matches) stepWind();
    draw();
    if (st.play || (hasWind() && !reduced.matches)) raf = requestAnimationFrame(loop);
  }
  const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };
  document.addEventListener("visibilitychange", wake);
  const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", (e) => { st.t = e.transform; makeProj(); draw(); wake(); });
  d3.select(canvas).call(zoom).on("dblclick.zoom", null);
  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect(), ll = proj.invert([e.clientX - r.left, e.clientY - r.top]);
    if (!ll || Math.abs(ll[1]) > 89) return;
    pick(ll[0], ll[1], null);
  });

  // ---------- point panel
  function pick(lon, lat, name) { st.pt = [lon, lat, name]; draw(); point(); save(); }
  async function point() {
    if (!st.pt) return;
    const [lon, lat, name] = st.pt, box = $("pt");
    $("ptTitle").textContent = name || `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
    const all = await Promise.all(fhs().map(tile));
    const a = all[st.fi];
    const dirs = d3.range(8).map((t) => sample(a, t, lon, lat));
    const lo = sample(a, st.C.tile_min, lon, lat), hi = sample(a, st.C.tile_max, lon, lat), bd = dirs.indexOf(Math.max(...dirs));
    const L = level(lo), Lb = level(hi);
    const [wu, wv] = st.C.tile_u != null ? windAt(lon, lat, st.fi) : [0, 0], ws = Math.hypot(wu, wv);
    const toDir = DIRN[Math.round(((Math.atan2(wu, wv) * 180 / Math.PI + 360) % 360) / 45) % 8], fromDir = DIRN[(DIRN.indexOf(toDir) + 4) % 8];
    box.textContent = "";
    const v = document.createElement("p"); v.className = "sdverdict";
    v.textContent = L >= 1 ? `${LV[L][1]} in every direction` : Lb >= 1 ? `${LV[Lb][1]} toward the ${DIRN[bd]}` : "Sound bends up: it fades fast";
    box.appendChild(v);
    const s = document.createElement("p"); s.className = "sub";
    s.textContent = `${fmtT(vt(st.fi))}. ` + (L >= 2 ? "Air warmer above the ground (an inversion) traps the sound all around." :
      Lb >= 1 ? `Wind carries it toward the ${DIRN[bd]}; upwind it fades fast.` : "Typical of a sunny afternoon or a windy, mixed sky.") +
      (st.C.tile_u != null && ws >= 0.5 ? ` Wind near the ground: ${Math.round(ws * 1.944)} kt from the ${fromDir}.` : "");
    box.appendChild(s);
    box.appendChild(rose(dirs, ws >= 0.5 ? [wu / ws, wv / ws, ws] : null));
    // 48 h: all-around angle per forecast time, with the standard summary strip
    const series = all.map((x) => sample(x, st.C.tile_min, lon, lat));
    const best = all.map((x) => sample(x, st.C.tile_max, lon, lat));
    const h = document.createElement("h3"); h.className = "h3"; h.textContent = "Next 48 hours"; box.appendChild(h);
    const svg = timeline(series, best); box.appendChild(svg);
    MC_UI.stripFor(svg, { values: series, first: series[0], last: series[series.length - 1], up: "bad", hl: series[st.fi], hlLabel: fmtT(vt(st.fi)),
      ref: 5, refLabel: "carries far", unit: "°", dec: 1, period: "next 48 h", label: "Trapping angle, all around" });
  }
  function rose(dirs, wind) {
    const S = 220, c = S / 2, R = 84, mx = Math.max(10, ...dirs);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${S} ${S + 22}`).attr("class", "rose").attr("role", "img")
      .attr("aria-label", "Trapping angle by direction: " + dirs.map((d, i) => `${DIRN[i]} ${d.toFixed(1)} degrees`).join(", "));
    for (const f of [0.5, 1]) svg.append("circle").attr("cx", c).attr("cy", c).attr("r", R * f).attr("fill", "none").attr("stroke", "var(--rule)");
    dirs.forEach((d, i) => {
      const a = (i * 45 - 90) * Math.PI / 180, r = Math.max(2, d / mx * R), w = 0.32;
      const p = [[c, c], [c + r * Math.cos(a - w), c + r * Math.sin(a - w)], [c + r * Math.cos(a + w), c + r * Math.sin(a + w)]];
      svg.append("path").attr("d", `M${p[0]}L${p[1]}A${r},${r} 0 0,1 ${p[2]}Z`).attr("fill", d >= 2 ? ramp(d) : "var(--data-other)").attr("stroke", "var(--surface)");
      const lr = R + 14;
      svg.append("text").attr("x", c + lr * Math.cos(a)).attr("y", c + lr * Math.sin(a) + 4).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "var(--ink-2)").text(DIRN[i]);
    });
    if (wind) {                                    // the wind through the middle, pointing the way it blows
      const L = Math.min(R * 0.9, 18 + wind[2] * 4), dx = wind[0] * L, dy = -wind[1] * L, a = Math.atan2(dy, dx);
      svg.append("line").attr("x1", c - dx / 2).attr("y1", c - dy / 2).attr("x2", c + dx / 2).attr("y2", c + dy / 2).attr("stroke", "var(--ink)").attr("stroke-width", 2.2);
      svg.append("path").attr("d", `M${c + dx / 2},${c + dy / 2} l${-8 * Math.cos(a - 0.45)},${-8 * Math.sin(a - 0.45)} l${8 * Math.cos(a - 0.45) - 8 * Math.cos(a + 0.45)},${8 * Math.sin(a - 0.45) - 8 * Math.sin(a + 0.45)} z`).attr("fill", "var(--ink)");
    }
    svg.append("text").attr("x", c).attr("y", S + 18).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "var(--ink-3)").text(`outer ring ${mx.toFixed(0)}°${wind ? " · arrow: wind" : ""}`);
    return svg.node();
  }
  function timeline(lo, hi) {
    const Wd = 360, Hd = 150, m = { l: 34, r: 8, t: 10, b: 30 };
    const svg = d3.create("svg").attr("viewBox", `0 0 ${Wd} ${Hd}`).attr("class", "tlchart").attr("role", "img")
      .attr("aria-label", "All-around trapping angle over the next 48 hours: " + lo.map((v, i) => `${fmtT(vt(i))} ${v.toFixed(1)} degrees`).join(", "));
    const x = d3.scaleTime().domain([vt(0), vt(lo.length - 1)]).range([m.l, Wd - m.r]);
    const y = d3.scaleLinear().domain([0, Math.max(10, d3.max(hi))]).nice().range([Hd - m.b, m.t]);
    for (const [v, lab] of [[2, ""], [5, "carries far"], [9, "very far"]]) {
      svg.append("line").attr("x1", m.l).attr("x2", Wd - m.r).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "var(--grid)");
      if (lab) svg.append("text").attr("x", Wd - m.r).attr("y", y(v) - 3).attr("text-anchor", "end").attr("font-size", 9.5).attr("fill", "var(--ink-3)").text(lab);
    }
    svg.append("path").attr("d", d3.area().x((_, i) => x(vt(i))).y0((_, i) => y(lo[i])).y1((v) => y(v))(hi)).attr("fill", "var(--low-soft)");
    svg.append("path").attr("d", d3.line().x((_, i) => x(vt(i))).y((v) => y(v))(lo)).attr("fill", "none").attr("stroke", "var(--data-1)").attr("stroke-width", 2);
    svg.append("g").selectAll("circle").data(lo).join("circle").attr("cx", (_, i) => x(vt(i))).attr("cy", (v) => y(v)).attr("r", (_, i) => i === st.fi ? 4.5 : 2.5)
      .attr("fill", (_, i) => i === st.fi ? "var(--ink)" : "var(--data-1)");
    svg.append("g").attr("transform", `translate(0,${Hd - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric" }).format(d)))
      .call((g) => g.selectAll("text").attr("font-size", 9.5)).call((g) => g.select(".domain").attr("stroke", "var(--rule)"));
    svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((d) => d + "°"))
      .call((g) => g.selectAll("text").attr("font-size", 9.5)).call((g) => g.select(".domain").remove());
    svg.append("text").attr("x", m.l).attr("y", Hd - 2).attr("font-size", 9.5).attr("fill", "var(--ink-3)").text("Line: all around · band up to the downwind side");
    return svg.node();
  }

  // ---------- controls
  // the clock while playing: fractional; the panel and the summary follow the nearest forecast
  function setClock(x) {
    st.x = x; $("tSl").value = x;
    const k = Math.min(fhs().length - 1, Math.round(x)), d = new Date(vt(0).getTime() + (vt(1) - vt(0)) * x);
    $("tLbl").textContent = fmtT(new Date(Math.round(d / 36e5) * 36e5));
    if (k !== st.fi) { st.fi = k; landStrip(); if (st.pt) point(); }
  }
  function setTime(k) { st.fi = k; st.x = k; $("tSl").value = k; $("tLbl").textContent = fmtT(vt(k)); refresh(); }
  async function refresh() { await raster(fhs()[st.fi]); baseKey = ""; draw(); wake(); landStrip(); if (st.pt) point(); save(); }
  function setPlay(on) {
    st.play = on;
    const b = $("playBtn"); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Pause" : "Play the next 48 hours");
    b.querySelector("span").textContent = on ? "Pause" : "Play";
    $("tSl").step = on ? "any" : "1";
    if (on) { fhs().forEach(raster); if (st.x >= fhs().length - 1) st.x = 0; wake(); }
    else setTime(Math.min(fhs().length - 1, Math.round(st.x)));
  }
  function landStrip() {
    const sm = (st.C.summary || {})[String(fhs()[st.fi])];
    if (!sm) return;
    const s = sm[st.mode === "all" ? "all_around" : "best_dir"], sh = s.share_ge;
    MC_UI.stat($("landStrip"), { min: 0, med: s.median, max: s.p90, q1: 0, q3: s.p90, ref: 5, refLabel: "carries far", unit: "°", dec: 1,
      period: fmtT(vt(st.fi)), n: "land 60°S–75°N, max = P90",
      label: `${st.mode === "all" ? "All around" : "Downwind side"}: ${Math.round((sh["5.0"] || 0) * 100)}% of land carries far` });
  }
  function save() { try { localStorage.setItem("mc-sound", JSON.stringify({ mode: st.mode, region: st.region, pt: st.pt, wind: st.wind })); } catch (e) { /* private mode */ } }
  function load() { try { return JSON.parse(localStorage.getItem("mc-sound") || "{}"); } catch (e) { return {}; } }
  function keyLegend() {
    const k = $("key"); k.textContent = "";
    LV.forEach(([th, lab, col], i) => {
      const s = document.createElement("span"), sw = document.createElement("i");
      sw.style.background = i === 0 ? "var(--stage)" : ramp(th + 0.5);
      s.appendChild(sw); s.appendChild(document.createTextNode(`${lab}${i ? ` (${th}°+)` : ""}`)); k.appendChild(s);
    });
  }
  function segs() {
    document.querySelectorAll("#modeSeg button").forEach((b) => b.addEventListener("click", () => {
      st.mode = b.dataset.m; document.querySelectorAll("#modeSeg button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
      if (st.play) fhs().forEach(raster);
      refresh();
    }));
    const rs = $("regSeg");
    for (const [k, [lab]] of Object.entries(REGIONS)) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = lab; b.setAttribute("aria-pressed", String(k === st.region));
      if (k === st.region) b.classList.add("on");
      b.addEventListener("click", () => {
        st.region = k; rs.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
        d3.select(canvas).call(zoom.transform, d3.zoomIdentity); makeProj(); draw(); wake(); save();
      });
      rs.appendChild(b);
    }
    $("tSl").addEventListener("input", (e) => { if (st.play) setPlay(false); setTime(Math.round(+e.target.value)); });
    $("playBtn").addEventListener("click", () => setPlay(!st.play));
    $("windChk").addEventListener("change", (e) => { st.wind = e.target.checked; clearTrail(); draw(); wake(); save(); });
    $("geoBtn").addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((p) => pick(p.coords.longitude, p.coords.latitude, "Your location"), () => {}, { maximumAge: 6e5, timeout: 10000 });
    });
  }
  // the first forecast time that is night where the viewer is (22:00-05:00 local), else the first
  function tonight() {
    for (let k = 0; k < fhs().length; k++) { const h = vt(k).getHours(); if (h >= 22 || h <= 5) return k; }
    return 0;
  }

  async function main() {
    const [man, topo] = await Promise.all([
      fetch("data/manifest.json", { cache: "no-cache" }).then((r) => r.json()),
      fetch("vendor/countries-50m.json").then((r) => r.json()).catch(() => null),
    ]);
    st.man = man; st.C = man.carry;
    if (!st.C || !st.C.fhs || !st.C.fhs.length) {
      $("stage").insertAdjacentHTML("afterend", '<p class="empty">The sound forecast is not available in this update. It is rebuilt every 6 hours.</p>');
      return;
    }
    if (topo) st.land = topojson.mesh(topo, topo.objects.countries);
    const sv = load();
    if (sv.mode === "best") st.mode = "best";
    if (sv.region && REGIONS[sv.region]) st.region = sv.region;
    document.querySelectorAll("#modeSeg button").forEach((x) => { const on = x.dataset.m === st.mode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    $("tSl").max = fhs().length - 1;
    keyLegend(); segs(); size(); makeProj();
    if (Array.isArray(sv.pt)) st.pt = sv.pt;
    if (sv.wind === false) st.wind = false;
    $("windChk").checked = st.wind; $("windRow").hidden = st.C.tile_u == null;
    // all forecast times decoded up front (small): the wind streaks sample them every frame
    st.raw = await Promise.all(fhs().map(tile));
    setTime(tonight());
    window.addEventListener("resize", () => { size(); makeProj(); draw(); });
    reduced.addEventListener("change", () => { clearTrail(); draw(); wake(); });
  }
  main().catch((e) => { console.error(e); $("stage").insertAdjacentHTML("afterend", '<p class="empty">The sound forecast could not be loaded.</p>'); });
})();
