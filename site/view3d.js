/* Mach Corridor — 3D views: rotatable globe + atmospheric column with traced boom rays. */
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const $ = id => document.getElementById(id);
const RAD = Math.PI / 180, FT = 0.3048, H_BUF = 1000, VE = 4;   // vertical exaggeration in column view

/* ======================= GLOBE ======================= */
let G = null;
function paintTexture(cnv) {
  const MC = window.MC, w = cnv.width, h = cnv.height, g = cnv.getContext("2d");
  g.fillStyle = MC.css("--ocean"); g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.drawImage(MC.off, -w / 720, -h / 362, w, h * 181 / 180);
  const proj = d3.geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]);
  const path = d3.geoPath(proj, g);
  g.beginPath(); path(d3.geoGraticule10()); g.strokeStyle = MC.css("--grat"); g.lineWidth = 1; g.stroke();
  if (MC.S.relief && MC.shade) { g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.6; g.drawImage(MC.shade, 0, 0, w, h); g.restore(); }
  if (MC.landMesh) { g.beginPath(); path(MC.landMesh); g.strokeStyle = MC.css("--coast"); g.lineWidth = 1.6; g.stroke(); }
  const R = window.MCPLAN?.getRoute?.();
  if (R && R.opt) {
    const col = { boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub") };
    for (const pass of [0, 1]) for (const s of R.opt.segs) {
      const a = proj([MC.normLon(s.p[0]), s.p[1]]), b = proj([MC.normLon(s.q[0]), s.q[1]]);
      if (Math.abs(a[0] - b[0]) > w / 2) continue;
      g.beginPath(); g.moveTo(...a); g.lineTo(...b);
      g.strokeStyle = pass ? col[s.type] : MC.css("--casing"); g.lineWidth = pass ? 5 : 9; g.lineCap = "round"; g.stroke();
    }
  }
}
function showGlobe(el) {
  const MC = window.MC;
  if (!G) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.9, 3.4);
    const cnv = document.createElement("canvas"); cnv.width = 2048; cnv.height = 1024;
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, displacementScale: 0 });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 720, 360), mat);
    scene.add(globe);
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-3, 3, 4); scene.add(sun);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x6aa9ff, transparent: true, opacity: 0.08, side: THREE.BackSide }));
    scene.add(halo);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.minDistance = 1.4; controls.maxDistance = 6; controls.rotateSpeed = 0.5;
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let down = null;
    const hit = e => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const h = ray.intersectObject(globe)[0];
      return h ? [h.uv.x * 360 - 180, h.uv.y * 180 - 90, e.clientX - r.left, e.clientY - r.top] : null;
    };
    renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", e => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const h = hit(e); if (h) MC.pick(h[0], h[1], e.shiftKey); }
      down = null;
    });
    renderer.domElement.addEventListener("pointermove", e => {
      if (e.buttons) return;
      const h = hit(e); if (h && MC.current) MC.showTip(MC.describe(MC.normLon(h[0]), h[1]), h[2], h[3]); else $("tip").hidden = true;
    });
    renderer.domElement.addEventListener("pointerleave", () => { $("tip").hidden = true; });
    G = { renderer, scene, camera, controls, tex, cnv, globe, el, dirty: true };
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(el); resize();
    // start looking at the selected point (or the Atlantic)
    const look = (lon, lat) => { const v = new THREE.Vector3().setFromSphericalCoords(3.4, (90 - lat) * RAD, (lon + 90) * RAD); camera.position.copy(v); };
    look(MC.S.sel ? MC.S.sel[0] : -40, MC.S.sel ? MC.S.sel[1] : 30);
    MC.on("texture", () => { G.dirty = true; });
    MC.on("refresh", () => { G.dirty = true; });
    MC.on("select", () => { G.dirty = true; });
    window.addEventListener("mc-route", () => { G.dirty = true; });
    const loop = () => {
      requestAnimationFrame(loop);
      if (el.hidden) return;
      if (G.dirty) {
        paintTexture(cnv); tex.needsUpdate = true; G.dirty = false;
        const T = MC.terrain;
        if (T && !mat.displacementMap) { const d = new THREE.Texture(T.img); d.needsUpdate = true; mat.displacementMap = d; mat.needsUpdate = true; }
        mat.displacementScale = MC.S.relief && T ? 0.035 : 0;   // ≈ ×35 vertical exaggeration
      }
      controls.update(); renderer.render(scene, camera);
    };
    loop();
  }
  G.dirty = true;
}
// SphereGeometry maps u=0 to lon=-180 when phi starts at -x; align by rotating so uv lon == geographic lon
// (uv-based picking above makes picking orientation-independent).

/* ======================= COLUMN VIEW ======================= */
let C = null;
const isaP = h => h < 11000 ? 1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588) : 226.32 * Math.exp(-(h - 11000) / 6341.62);

function profileFns(P, hd) {
  // levels sorted by height ascending; along-track (x) and right (y) wind components
  const s = Math.sin(hd * RAD), c = Math.cos(hd * RAD);
  const L = P.z.map((z, k) => ({ z, c: P.c[k], wx: P.u[k] * s + P.v[k] * c, wy: P.u[k] * c - P.v[k] * s })).sort((a, b) => a.z - b.z);
  const at = z => {
    if (z <= L[0].z) return L[0];
    for (let k = 1; k < L.length; k++) if (z <= L[k].z) {
      const a = L[k - 1], b = L[k], f = (z - a.z) / (b.z - a.z);
      return { z, c: a.c + f * (b.c - a.c), wx: a.wx + f * (b.wx - a.wx), wy: a.wy + f * (b.wy - a.wy) };
    }
    return L[L.length - 1];
  };
  return { L, at };
}
function cruiseZ(P, fl) {
  const pa = isaP(fl * 100 * FT), lp = Math.log(pa);
  for (let k = 0; k < P.plev.length - 1; k++) if (P.plev[k] >= pa && P.plev[k + 1] <= pa) {
    const f = (Math.log(P.plev[k]) - lp) / (Math.log(P.plev[k]) - Math.log(P.plev[k + 1]));
    return P.z[k] + f * (P.z[k + 1] - P.z[k]);
  }
  return P.z[P.z.length - 1];
}
// trace one ray (cone azimuth phi) for Mach M; returns points in metres [x,y,z] and outcome
function trace(F, za, ground, M, phi) {
  const b = Math.sqrt(Math.max(0, 1 - 1 / (M * M)));
  const nx = 1 / M, ny = b * Math.sin(phi * RAD), nh = Math.hypot(nx, ny), ex = nx / nh, ey = ny / nh;
  const A = F.at(za), I = A.c / nh + A.wx * ex + A.wy * ey;
  const pts = [[0, 0, za]]; let x = 0, y = 0, z = za; const dz = 60;
  let outcome = "ground", zt = null;
  while (z > ground) {
    const p = F.at(z - dz / 2), den = I - (p.wx * ex + p.wy * ey), q = p.c / den;
    if (den <= 0 || q >= 1) { outcome = "turn"; zt = z; break; }
    const nzv = Math.sqrt(1 - q * q), vx = p.c * q * ex + p.wx, vy = p.c * q * ey + p.wy, dt = dz / (p.c * nzv);
    x += vx * dt; y += vy * dt; z -= dz; pts.push([x, y, z]);
  }
  if (outcome === "turn") {        // mirror: ascending branch continues forward
    const n = pts.length, up = [];
    for (let k = n - 2; k >= 0 && pts[k][2] - zt < 4000; k--) up.push([2 * x - pts[k][0], 2 * y - pts[k][1], pts[k][2]]);
    pts.push(...up);
  }
  return { pts, outcome, zt, ground: outcome === "ground" ? [x, y] : null };
}
function boomlessM(F, za, zf) {
  // largest M whose every ray turns at or above zf (bisection), using the ray invariant
  const ok = M => {
    for (let phi = -85; phi <= 85; phi += 2.5) {
      const b = Math.sqrt(Math.max(0, 1 - 1 / (M * M))), nx = 1 / M, ny = b * Math.sin(phi * RAD), nh = Math.hypot(nx, ny), ex = nx / nh, ey = ny / nh;
      const A = F.at(za), I = A.c / nh + A.wx * ex + A.wy * ey;
      let best = -Infinity;
      for (let z = zf; z < za; z += 50) { const p = F.at(z); best = Math.max(best, p.c + p.wx * ex + p.wy * ey); }
      if (best < I) return false;
    }
    return true;
  };
  if (!ok(1.0005)) return null;
  let lo = 1.0005, hi = 1.8;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

function ensureColumnScene() {
  if (C) return C;
  const el = $("c3Canvas");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(-170, 110, 190);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(30, 25, 0); controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(50, 200, 100); scene.add(dl);
  const group = new THREE.Group(); scene.add(group);
  C = { el, renderer, scene, camera, controls, group };
  const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(el); resize();
  const loop = () => { requestAnimationFrame(loop); if (!$("col3d").open) return; controls.update(); renderer.render(scene, camera); };
  loop();
  return C;
}
const K = m => m / 1000;                       // metres -> km (scene units: km horizontal, km*VE vertical)
const V3 = (x, y, z) => new THREE.Vector3(K(x), K(z) * VE, K(y));
function lineOf(pts, color, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => V3(...p)));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}
function disposeGroup(g) { while (g.children.length) { const o = g.children.pop(); o.geometry?.dispose(); o.material?.dispose?.(); } }

const state = {};
function renderColumn() {
  const MC = window.MC, { P, fl, hd, M } = state;
  const sc = ensureColumnScene(), grp = sc.group; disposeGroup(grp);
  const F = profileFns(P, hd), za = cruiseZ(P, fl), ground = Math.max(0, P.ground), zf = ground + H_BUF;
  const css = n => new THREE.Color(MC.css(n) || "#888");
  const green = new THREE.Color("#1a9850"), amber = new THREE.Color("#e8a33d"), red = new THREE.Color("#c62d36");
  // ground + terrain + buffer planes
  const size = 260;
  // low-poly terrain of the real area: AWS Terrain Tiles DEM (fallback: GFS 0.25° orography); water in blue
  const sH = Math.sin(hd * RAD), cH = Math.cos(hd * RAD);
  const toLL = (xk, yk) => { const east = xk * sH + yk * cH, north = xk * cH - yk * sH;
    const la = state.lat + north / 111.32; return [state.lon + east / (111.32 * Math.cos(state.lat * RAD)), la]; };
  const elev = (lo, la) => { const d = state.dem ? state.dem(lo, la) : null; return d != null ? d : (MC.terrain ? MC.elevAt(lo, la) : 0); };
  const n = 56, geo = new THREE.PlaneGeometry(size, size, n, n); geo.rotateX(-Math.PI / 2);
  const flat = geo.toNonIndexed(), pos = flat.attributes.position, cache = new Map(), cols = [];
  let demMax = 0, demMaxNear = 0;
  const hypso = d3.scaleLinear([0, 400, 1200, 2000, 3000, 4300], ["#5f8f4a", "#86a457", "#b8a56c", "#9a7652", "#8f8a85", "#f4f4f4"]).clamp(true);
  const info = (x, z) => {
    const k = x.toFixed(2) + "," + z.toFixed(2);
    if (!cache.has(k)) {
      const xk = x + 60, [lo, la] = toLL(xk, z), h = elev(lo, la);
      const water = h < -30 || (h <= 0 && MC.landAt(MC.current, MC.normLon(lo), la) < 0.5);
      const hh = water ? 0 : Math.max(0, h);
      demMax = Math.max(demMax, hh); if (Math.abs(z) < 30) demMaxNear = Math.max(demMaxNear, hh);
      cache.set(k, { xk, h: hh, water });
    }
    return cache.get(k);
  };
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [0, 1, 2].map(k => info(pos.getX(i + k), pos.getZ(i + k)));
    tri.forEach((t, k) => { pos.setX(i + k, t.xk); pos.setY(i + k, K(t.h) * VE + 0.05); });
    const wet = tri.filter(t => t.water).length >= 2, mean = (tri[0].h + tri[1].h + tri[2].h) / 3;
    const c = new THREE.Color(wet ? "#2f74d0" : hypso(mean));
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  flat.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); flat.computeVertexNormals();
  grp.add(new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  state.demMax = demMax; state.demMaxNear = demMaxNear;
  const buf = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  buf.rotation.x = -Math.PI / 2; buf.position.set(60, K(zf) * VE, 0); grp.add(buf);
  // atmosphere column: horizontal discs at each level coloured by c_eff along track
  const ceffs = F.L.map(l => l.c + l.wx), cmin = Math.min(...ceffs), cmax = Math.max(...ceffs);
  for (const l of F.L) {
    if (l.z < ground || l.z > za + 2000) continue;
    const f = (l.c + l.wx - cmin) / Math.max(1, cmax - cmin);
    const col = new THREE.Color().setHSL(0.62 - 0.62 * f, 0.7, 0.55);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0, 6, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(-40, K(l.z) * VE, 0); grp.add(ring);
  }
  grp.add(lineOf([[-40000, 0, ground], [-40000, 0, za]], css("--text-2"), 0.5));
  // aircraft + track
  const ac = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 16), new THREE.MeshLambertMaterial({ color: css("--text") }));
  ac.rotation.z = -Math.PI / 2; ac.position.copy(V3(0, 0, za)); grp.add(ac);
  grp.add(lineOf([[-60000, 0, za], [180000, 0, za]], css("--text-2"), 0.6));
  // rays
  let nTurn = 0, nLow = 0, nGround = 0, lowest = Infinity;
  for (let phi = -80; phi <= 80; phi += 10) {
    const r = trace(F, za, ground, M, phi);
    let col = green;
    if (r.outcome === "ground") { col = red; nGround++; }
    else if (r.zt < zf) { col = amber; nLow++; } else nTurn++;
    if (r.zt != null) lowest = Math.min(lowest, r.zt - ground);
    grp.add(lineOf(r.pts, col));
    if (r.ground) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: red }));
      d.position.copy(V3(r.ground[0], r.ground[1], ground)); grp.add(d);
    }
  }
  const mb = state.mb;
  $("c3MachLbl").textContent = `M ${M.toFixed(3)} · ${Math.round(M * F.at(za).c * MC.KT)} kt`;
  $("c3HdLbl").textContent = `${String(hd).padStart(3, "0")}°`;
  $("c3Stats").innerHTML = `
    <div><b>${nTurn}</b> rays turn above the buffer · <b>${nLow}</b> inside it · <b class="${nGround ? "warn" : ""}">${nGround}</b> reach the ground</div>
    <div>Lowest turning point: ${isFinite(lowest) ? (lowest / 1000).toFixed(1) + " km above terrain" : "—"}</div>
    <div>Boomless limit here (2° column, 1 km buffer): <b>${mb ? "M " + mb.toFixed(3) : "none"}</b>; map value (1°): <b>${state.mapM >= 1 ? "M " + (state.mapM).toFixed(3) : "none"}</b> before the ${MC.S.margin.toFixed(3)} margin</div>
    <div>Cruise ${Math.round(za)} m · model terrain (footprint max) ${Math.round(ground)} m · buffer top ${Math.round(zf)} m</div>
    <div>Real terrain in view (${state.dem ? "DEM" : "GFS"}): highest ${Math.round(state.demMax)} m${state.demMaxNear > ground + 300 ? ` · <b class="warn">peaks within 30 km of track reach ${Math.round(state.demMaxNear)} m, above the model terrain</b>` : ""}</div>`;
  drawCeff(F, za, ground, zf, M);
}
function drawCeff(F, za, ground, zf, M) {
  let svg = d3.select("#c3Ceff");
  if (svg.empty()) svg = d3.select("#c3Stats").append("svg").attr("id", "c3Ceff").attr("viewBox", "0 0 260 200");
  else svg.selectAll("*").remove();
  const m = { l: 34, r: 8, t: 8, b: 26 }, w = 260 - m.l - m.r, h = 200 - m.t - m.b;
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
  const A = F.at(za), Iv = M * A.c + A.wx;
  const pts = []; for (let z = Math.max(0, ground); z <= za + 500; z += 100) { const p = F.at(z); pts.push([p.c + p.wx, z]); }
  const x = d3.scaleLinear().domain(d3.extent([...pts.map(p => p[0]), Iv])).nice().range([0, w]), y = d3.scaleLinear([0, za + 1000], [h, 0]);
  g.append("rect").attr("x", 0).attr("width", w).attr("y", y(zf)).attr("height", y(ground) - y(zf)).attr("fill", "#e8a33d").attr("opacity", 0.18);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(d => d / 1000 + " km").tickSize(0).tickPadding(3)).call(s => s.select(".domain").remove());
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(3)).call(s => s.select(".domain").attr("stroke", "var(--line)"));
  g.append("text").attr("x", w).attr("y", h + 22).attr("text-anchor", "end").text("sound speed + wind along track (m/s)");
  g.append("path").datum(pts).attr("fill", "none").attr("stroke", "var(--mach)").attr("stroke-width", 2).attr("d", d3.line().x(p => x(p[0])).y(p => y(p[1])));
  g.append("line").attr("x1", x(Iv)).attr("x2", x(Iv)).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text)").attr("stroke-dasharray", "4 3");
  g.append("text").attr("x", x(Iv) + 3).attr("y", 10).text("aircraft ground speed");
  g.append("text").attr("x", 2).attr("y", y(za) - 3).text("cruise");
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(za)).attr("y2", y(za)).attr("stroke", "var(--text-2)").attr("stroke-width", 0.6);
}

/* real terrain: AWS Terrain Tiles (Terrarium encoding, CORS-enabled public bucket), zoom 8 ≈ 600 m/px */
const demTiles = new Map();
async function loadDEM(lat, lon) {
  const z = 8, N = 2 ** z, rLat = 1.6, rLon = 1.6 / Math.cos(lat * RAD);
  const tx = lo => (lo + 180) / 360 * N, ty = la => { const p = la * RAD; return (1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2 * N; };
  const x0 = Math.floor(tx(lon - rLon)), x1 = Math.floor(tx(lon + rLon)), y0 = Math.floor(ty(Math.min(85, lat + rLat))), y1 = Math.floor(ty(Math.max(-85, lat - rLat)));
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const xx = ((x % N) + N) % N, key = `${xx}/${y}`;
    if (demTiles.has(key)) continue;
    demTiles.set(key, new Promise(res => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0); res(g.getImageData(0, 0, 256, 256).data); };
      img.onerror = () => res(null);
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${xx}/${y}.png`;
    }));
    jobs.push(demTiles.get(key));
  }
  await Promise.all([...demTiles.values()]);
  const data = new Map(); for (const [k, p] of demTiles) data.set(k, await p);
  if (![...data.values()].some(Boolean)) return null;
  return (lo, la) => {
    const fx = tx(lo), fy = ty(la), X = ((Math.floor(fx) % N) + N) % N, Y = Math.floor(fy);
    const d = data.get(`${X}/${Y}`); if (!d) return null;
    const px = Math.min(255, Math.floor((fx - Math.floor(fx)) * 256)), py = Math.min(255, Math.floor((fy - Y) * 256)), o = (py * 256 + px) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
}

async function openColumn() {
  const MC = window.MC; if (!MC.S.sel) return;
  const [lon, lat] = MC.S.sel, fh = MC.S.man.forecast_hours[MC.S.fi];
  $("col3d").showModal();
  $("c3Loc").textContent = `· ${MC.fmtLat(lat)} ${MC.fmtLon(lon)}`;
  $("c3Sub").textContent = `GFS valid ${d3.utcFormat("%a %d %b %HZ")(new Date(MC.S.man.valid_times[MC.S.fi]))}. Each line is one boom ray leaving the Mach cone; they bend upward in the warmer, faster air below.`;
  const arr = await MC.loadProfiles(fh);
  const P = MC.profileAt(arr, lon, lat);
  const hd = MC.S.hd === "hd" ? MC.S.hdDeg : (() => { // worst/best direction at this point
    const ms = MC.S.man.headings.map((h, i) => MC.mAt(MC.current, i, lon, lat));
    const i = MC.S.hd === "max" ? ms.indexOf(Math.max(...ms)) : ms.indexOf(Math.min(...ms)); return MC.S.man.headings[i];
  })();
  $("c3Fl").innerHTML = MC.S.man.flight_levels.map(f => `<option value="${f}"${f === MC.S.fl ? " selected" : ""}>FL${f}</option>`).join("");
  Object.assign(state, { P, lon, lat, fl: MC.S.fl, hd, dem: null });
  try { state.dem = await loadDEM(lat, lon); } catch (e) { state.dem = null; }
  const recompute = async () => {
    const F = profileFns(state.P, state.hd), za = cruiseZ(state.P, state.fl);
    state.mb = boomlessM(F, za, Math.max(0, state.P.ground) + H_BUF);
    const atl = await MC.loadAtlas(fh, state.fl);
    state.mapM = MC.mAt(atl, Math.round(state.hd / 10) % 36, lon, lat);
  };
  await recompute();
  state.M = state.mb ? +state.mb.toFixed(3) : 1.05;
  $("c3Mach").value = state.M; $("c3Hd").value = state.hd;
  $("c3Mach").oninput = e => { state.M = +e.target.value; renderColumn(); };
  $("c3Hd").oninput = async e => { state.hd = +e.target.value; await recompute(); renderColumn(); };
  $("c3Fl").onchange = async e => { state.fl = +e.target.value; await recompute(); state.M = state.mb ? +state.mb.toFixed(3) : state.M; $("c3Mach").value = state.M; renderColumn(); };
  renderColumn();
}

window.MC3D = { showGlobe, openColumn };
const wire = () => {
  $("open3d").onclick = openColumn;
  if (window.MC?.S?.view === "3d" && window.MC.S.man) showGlobe($("globe"));
};
if (window.MC?.S?.man) wire(); else window.addEventListener("mc-ready", wire);
