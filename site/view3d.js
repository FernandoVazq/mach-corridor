/* Mach Corridor — 3D views: rotatable globe + atmospheric column with traced boom rays. */
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const $ = id => document.getElementById(id);
const RAD = Math.PI / 180, FT = 0.3048, H_BUF = 1000;

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
  if (MC.S.relief && MC.shade) { g.save(); g.globalCompositeOperation = "soft-light"; g.globalAlpha = 0.95; g.drawImage(MC.shade, 0, 0, w, h); g.restore(); }
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
  scene.fog = new THREE.Fog(0x061029, 700, 1700);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000);
  camera.position.set(-190, 120, 230);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(30, 30, 0); controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(-80, 220, 120); scene.add(dl);
  const group = new THREE.Group(); scene.add(group);
  C = { el, renderer, scene, camera, controls, group };
  const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(el); resize();
  const loop = () => { requestAnimationFrame(loop); if (!$("col3d").open) return; controls.update(); renderer.render(scene, camera); };
  loop();
  return C;
}
const state = { ve: 4 };
const K = m => m / 1000;                       // metres -> km; scene: km horizontal, km × vertical exaggeration
const V3 = (x, y, z) => new THREE.Vector3(K(x), K(z) * state.ve, K(y));
function lineOf(pts, color, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => V3(...p)));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
}
function textSprite(text, color = "#e2ebfc", px = 26) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = `500 ${px}px 'IBM Plex Sans', system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 8; c.width = w; c.height = px + 10;
  g.font = `500 ${px}px 'IBM Plex Sans', system-ui, sans-serif`; g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, 4, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  const h = 7; sp.scale.set(h * w / c.height, h, 1); sp.center.set(0, 0.5);
  return sp;
}
function disposeGroup(g) { while (g.children.length) { const o = g.children.pop(); o.geometry?.dispose(); o.material?.map?.dispose?.(); o.material?.dispose?.(); } }
// diverging colour for the air layers: blue = sound slower than the aircraft (boom keeps descending),
// orange = faster (boom is refracted back up). Pale = neutral.
const layerColor = d => {
  const t = Math.max(-1, Math.min(1, d / 25));
  return t < 0 ? d3.interpolateRgb("#dfe8f6", "#1f57d6")(-t) : d3.interpolateRgb("#dfe8f6", "#ff7a2f")(t);
};

function renderColumn() {
  const MC = window.MC, { P, fl, hd, M } = state;
  const sc = ensureColumnScene(), grp = sc.group; disposeGroup(grp);
  const F = profileFns(P, hd), za = cruiseZ(P, fl), ground = Math.max(0, P.ground), zf = ground + H_BUF, VE = state.ve;
  if (state.framedVe !== VE) {
    state.framedVe = VE;
    const ty = K(za) * VE * 0.45;
    sc.controls.target.set(40, ty, 0);
    sc.camera.position.set(-300, ty + 150 + K(za) * VE * 0.5, 420);
  }
  const green = new THREE.Color("#2fbf71"), amber = new THREE.Color("#f2b33d"), red = new THREE.Color("#ff4d5e");
  const size = 260, X0 = -70, X1 = 190, Zs = -size / 2, zTop = Math.max(za + 3000, 16000);
  // ---- terrain (low poly, real DEM; water blue) ----
  const sH = Math.sin(hd * RAD), cH = Math.cos(hd * RAD);
  const toLL = (xk, yk) => { const east = xk * sH + yk * cH, north = xk * cH - yk * sH;
    const la = state.lat + north / 111.32; return [state.lon + east / (111.32 * Math.cos(state.lat * RAD)), la]; };
  const elev = (lo, la) => { const d = state.dem ? state.dem(lo, la) : null; return d != null ? d : (MC.terrain ? MC.elevAt(lo, la) : 0); };
  let demMax = 0, demMaxNear = 0;
  const hypso = d3.scaleLinear([0, 400, 1200, 2000, 3000, 4300], ["#4f7d3e", "#7d9a4f", "#b09e66", "#94714e", "#8a8580", "#f4f4f4"]).clamp(true);
  // 3 × 3 chunks of 260 km: the centre one solid, the 8 around it translucent for context
  const chunk = (ox, oz, n, opacity) => {
    const geo = new THREE.PlaneGeometry(size, size, n, n); geo.rotateX(-Math.PI / 2);
    const flat = geo.toNonIndexed(), pos = flat.attributes.position, cache = new Map(), cols = [], centre = !ox && !oz;
    const info = (x, z) => {
      const k = x.toFixed(2) + "," + z.toFixed(2);
      if (!cache.has(k)) {
        const xk = x + 60 + ox, zk = z + oz, [lo, la] = toLL(xk, zk), h = elev(lo, la);
        const water = h < -30 || (h <= 0 && MC.landAt(MC.current, MC.normLon(lo), la) < 0.5);
        const hh = water ? 0 : Math.max(0, h);
        if (centre) { demMax = Math.max(demMax, hh); if (Math.abs(zk) < 30) demMaxNear = Math.max(demMaxNear, hh); }
        cache.set(k, { xk, zk, h: hh, water });
      }
      return cache.get(k);
    };
    for (let i = 0; i < pos.count; i += 3) {
      const tri = [0, 1, 2].map(k => info(pos.getX(i + k), pos.getZ(i + k)));
      tri.forEach((t, k) => { pos.setX(i + k, t.xk); pos.setZ(i + k, t.zk); pos.setY(i + k, K(t.h) * VE + 0.05); });
      const wet = tri.filter(t => t.water).length >= 2, mean = (tri[0].h + tri[1].h + tri[2].h) / 3;
      const c = new THREE.Color(wet ? "#2a6fd0" : hypso(mean));
      for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
    }
    flat.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); flat.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    grp.add(new THREE.Mesh(flat, mat));
  };
  for (const ox of [-size, 0, size]) for (const oz of [-size, 0, size]) chunk(ox, oz, ox || oz ? 30 : 56, ox || oz ? 0.32 : 1);
  state.demMax = demMax; state.demMaxNear = demMaxNear;

  // ---- air layers: two walls painted with c_eff − aircraft trace speed (on-track ray) ----
  const A = F.at(za), Iv = M * A.c + A.wx;
  const tex = document.createElement("canvas"); tex.width = 4; tex.height = 512;
  const tg = tex.getContext("2d");
  for (let r = 0; r < 512; r++) {
    const z = zTop * (1 - r / 511), p = F.at(z);
    tg.fillStyle = z < ground || z > za ? "rgba(0,0,0,0)" : layerColor(p.c + p.wx - Iv);
    tg.fillRect(0, r, 4, 1);
  }
  const wallTex = new THREE.CanvasTexture(tex); wallTex.colorSpace = THREE.SRGBColorSpace;
  const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, K(zTop) * VE), wallMat);
  back.position.set((X0 + X1) / 2, K(zTop) * VE / 2, Zs); grp.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(size, K(zTop) * VE), wallMat.clone());
  side.rotation.y = Math.PI / 2; side.position.set(X1, K(zTop) * VE / 2, 0); grp.add(side);
  // layer lines on the walls at each GFS level
  for (const l of F.L) if (l.z > ground && l.z < zTop) {
    grp.add(lineOf([[X0 * 1000, Zs * 1000, l.z], [X1 * 1000, Zs * 1000, l.z]], 0xffffff, 0.12));
    grp.add(lineOf([[X1 * 1000, Zs * 1000, l.z], [X1 * 1000, -Zs * 1000, l.z]], 0xffffff, 0.12));
  }
  // buffer sheet
  const buf = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  buf.rotation.x = -Math.PI / 2; buf.position.set(60, K(zf) * VE, 0); grp.add(buf);

  // ---- altitude ruler with flight levels ----
  const step = VE >= 4 ? 2000 : VE >= 2 ? 4000 : 5000;
  grp.add(lineOf([[X0 * 1000, Zs * 1000, 0], [X0 * 1000, Zs * 1000, zTop]], 0xe2ebfc, 0.8));
  for (let z = 0; z <= zTop; z += step) {
    grp.add(lineOf([[X0 * 1000, Zs * 1000, z], [(X0 - 4) * 1000, Zs * 1000, z]], 0xe2ebfc, 0.8));
    const lbl = textSprite(z === 0 ? "0 km" : `${z / 1000} km  FL${Math.round(z / FT / 1000) * 10}`, "#c9d6ee");
    lbl.position.copy(V3((X0 - 3) * 1000, Zs * 1000, z)); lbl.center.set(1.05, 0.5); grp.add(lbl);
  }
  const cl = textSprite(`FL${fl}`, "#ffffff", 30); cl.position.copy(V3(-8000, 0, za + 1200)); grp.add(cl);

  // ---- aircraft, track, Mach cone, rays ----
  const ac = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 16), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  ac.rotation.z = -Math.PI / 2; ac.position.copy(V3(0, 0, za)); grp.add(ac);
  grp.add(lineOf([[-70000, 0, za], [190000, 0, za]], 0xe2ebfc, 0.35));
  let nTurn = 0, nLow = 0, nGround = 0, lowest = Infinity;
  if (M > 1.0005) {
    const mu = Math.asin(1 / M), Lc = Math.min(22000, 0.4 * (za - ground) / Math.sin(mu)), nA = 64, nL = 16, vs = [], idx = [];
    for (let i = 0; i <= nL; i++) for (let j = 0; j <= nA; j++) {
      const sDist = Lc * i / nL, ph = 2 * Math.PI * j / nA;
      vs.push(V3(-sDist * Math.cos(mu), sDist * Math.sin(mu) * Math.sin(ph), za - sDist * Math.sin(mu) * Math.cos(ph)));
    }
    for (let i = 0; i < nL; i++) for (let j = 0; j < nA; j++) { const a = i * (nA + 1) + j, b = a + nA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const cg = new THREE.BufferGeometry().setFromPoints(vs); cg.setIndex(idx); cg.computeVertexNormals();
    grp.add(new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })));
    for (const sD of [Lc / 3, 2 * Lc / 3, Lc]) {          // shock rings
      const ring = []; for (let j = 0; j <= nA; j++) { const ph = 2 * Math.PI * j / nA; ring.push([-sD * Math.cos(mu), sD * Math.sin(mu) * Math.sin(ph), za - sD * Math.sin(mu) * Math.cos(ph)]); }
      grp.add(lineOf(ring, 0xdbe7ff, 0.45));
    }
    const lc = textSprite("Mach cone (shock wave)", "#dbe7ff", 22); lc.position.copy(V3(-Lc * Math.cos(mu), 0, za + Lc * Math.sin(mu) * 0.55)); lc.center.set(1, 0.5); grp.add(lc);
    const r0 = trace(F, za, ground, M, 0), mid = r0.pts[Math.floor(r0.pts.length * 0.7)];
    if (mid) { const lr = textSprite("Boom rays", "#9ff0c4", 22); lr.position.copy(V3(mid[0] + 4000, mid[1], mid[2])); grp.add(lr); }
    for (let phi = -80; phi <= 80; phi += 10) {
      const r = trace(F, za, ground, M, phi);
      let col = green;
      if (r.outcome === "ground") { col = red; nGround++; }
      else if (r.zt < zf) { col = amber; nLow++; } else nTurn++;
      if (r.zt != null) lowest = Math.min(lowest, r.zt - ground);
      grp.add(lineOf(r.pts, col));
      if (r.ground) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshBasicMaterial({ color: red }));
        d.position.copy(V3(r.ground[0], r.ground[1], ground)); grp.add(d);
      }
    }
  }
  $("c3MachLbl").textContent = `M ${M.toFixed(3)}, ${Math.round(M * A.c * MC.KT)} kt`;
  $("c3HdLbl").textContent = `${String(Math.round(hd)).padStart(3, "0")}°`;
  const mb = state.mb;
  $("c3Stats").innerHTML = (M <= 1.0005 ? `<div><b>Subsonic here.</b> No shock wave, no boom.</div>` :
    `<div><b>${nTurn}</b> rays turn above the buffer, <b>${nLow}</b> inside it, <b class="${nGround ? "warn" : ""}">${nGround}</b> reach the ground</div>
     <div>Lowest turning point ${isFinite(lowest) ? (lowest / 1000).toFixed(1) + " km above terrain" : "–"}</div>`) +
    `<div>Boomless limit here <b>${mb ? "M " + mb.toFixed(3) : "none"}</b> (2° column, 1 km buffer); map <b>${state.mapM >= 1 ? "M " + state.mapM.toFixed(3) : "none"}</b> before margin</div>
     <div>Cruise ${(za / 1000).toFixed(1)} km, model terrain ${Math.round(ground)} m, buffer top ${(zf / 1000).toFixed(1)} km</div>
     <div>Real terrain in view (${state.dem ? "DEM" : "GFS"}) up to ${Math.round(state.demMax)} m${state.demMaxNear > ground + 300 ? `. <b class="warn">Peaks near the track reach ${Math.round(state.demMaxNear)} m, above the model terrain.</b>` : ""}</div>`;
  drawCeff(F, za, ground, zf, M);
  drawInset();
}
/* locator: orthographic globe centred on the view, route, scene footprint and heading */
function drawInset() {
  const MC = window.MC, svg = d3.select("#c3Inset"); svg.selectAll("*").remove();
  const proj = d3.geoOrthographic().rotate([-state.lon, -state.lat]).scale(250).translate([90, 90]).clipAngle(90).precision(0.5);
  const path = d3.geoPath(proj);
  svg.append("clipPath").attr("id", "insetClip").append("circle").attr("cx", 90).attr("cy", 90).attr("r", 89);
  const g = svg.append("g").attr("clip-path", "url(#insetClip)");
  g.append("path").datum(d3.geoGraticule10()).attr("d", path).attr("fill", "none").attr("stroke", "rgba(226,235,252,.08)");
  g.append("path").datum(MC.landGeo).attr("d", path).attr("fill", "#1c3266").attr("stroke", "rgba(226,235,252,.5)").attr("stroke-width", .6);
  const R = state.route;
  if (R) g.append("path").datum({ type: "LineString", coordinates: R.opt.path }).attr("d", path).attr("fill", "none").attr("stroke", MC.css("--route-boomless")).attr("stroke-width", 1.6);
  // 3D scene footprint (260 km square in track coordinates, x from −70 to 190 km)
  const sH = Math.sin(state.hd * RAD), cH = Math.cos(state.hd * RAD);
  const ll = (xk, yk) => { const e = xk * sH + yk * cH, n = xk * cH - yk * sH; return [state.lon + e / (111.32 * Math.cos(state.lat * RAD)), state.lat + n / 111.32]; };
  g.append("path").datum({ type: "Polygon", coordinates: [[ll(-70, -130), ll(-70, 130), ll(190, 130), ll(190, -130), ll(-70, -130)].reverse()] })
    .attr("d", path).attr("fill", "rgba(255,255,255,.12)").attr("stroke", "#fff").attr("stroke-width", .8);
  const [cx, cy] = proj([state.lon, state.lat]), [hx, hy] = proj(ll(260, 0));
  const a = Math.atan2(hy - cy, hx - cx);
  svg.append("path").attr("d", "M7,0 L-4,-4.5 L-1.5,0 L-4,4.5 Z").attr("fill", "#fff").attr("transform", `translate(${cx},${cy}) rotate(${a * 180 / Math.PI})`);
  svg.append("circle").attr("cx", 90).attr("cy", 90).attr("r", 89).attr("fill", "none").attr("stroke", "rgba(226,235,252,.25)");
}
function drawCeff(F, za, ground, zf, M) {
  let svg = d3.select("#c3Ceff");
  if (svg.empty()) svg = d3.select("#c3Stats").append("svg").attr("id", "c3Ceff").attr("viewBox", "0 0 260 210");
  else svg.selectAll("*").remove();
  const m = { l: 34, r: 8, t: 10, b: 26 }, w = 260 - m.l - m.r, h = 210 - m.t - m.b;
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
  const A = F.at(za), Iv = M * A.c + A.wx;
  const pts = []; for (let z = Math.max(0, ground); z <= za; z += 100) { const p = F.at(z); pts.push([p.c + p.wx, z]); }
  const x = d3.scaleLinear().domain(d3.extent([...pts.map(p => p[0]), Iv])).nice().range([0, w]), y = d3.scaleLinear([0, za + 1000], [h, 0]);
  const grad = svg.append("defs").append("linearGradient").attr("id", "ceffGrad").attr("x1", 0).attr("x2", 0).attr("y1", 1).attr("y2", 0);
  pts.filter((_, i) => i % 5 === 0).forEach(([c, z]) => grad.append("stop").attr("offset", z / (za + 1000)).attr("stop-color", layerColor(c - Iv)));
  g.append("rect").attr("x", 0).attr("width", 10).attr("y", y(za)).attr("height", y(ground) - y(za)).attr("fill", "url(#ceffGrad)");
  g.append("rect").attr("x", 12).attr("width", w - 12).attr("y", y(zf)).attr("height", y(ground) - y(zf)).attr("fill", "#e8a33d").attr("opacity", 0.18);
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(d => d / 1000 + " km").tickSize(0).tickPadding(3)).call(s => s.select(".domain").remove());
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(3)).call(s => s.select(".domain").attr("stroke", "var(--line)"));
  g.append("text").attr("x", w).attr("y", h + 22).attr("text-anchor", "end").text("sound speed + wind along track, m/s");
  g.append("path").datum(pts).attr("fill", "none").attr("stroke", "var(--mach)").attr("stroke-width", 2).attr("d", d3.line().x(p => x(p[0])).y(p => y(p[1])));
  g.append("line").attr("x1", x(Iv)).attr("x2", x(Iv)).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text)").attr("stroke-dasharray", "4 3");
  g.append("text").attr("x", Math.min(x(Iv) + 3, w - 70)).attr("y", -1).text("aircraft speed");
  g.append("text").attr("x", 14).attr("y", y(za) - 3).text("cruise");
}

/* real terrain: AWS Terrain Tiles (Terrarium encoding, CORS-enabled public bucket), zoom 8 ≈ 600 m/px */
const demTiles = new Map();
async function loadDEM(lat, lon) {
  const z = 8, N = 2 ** z, rLat = 4.2, rLon = Math.min(20, 4.2 / Math.cos(lat * RAD));
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


/* ---------- opening the view: a clicked point, or a position along the planned route ---------- */
async function loadAt(lon, lat, fhIndex) {
  const MC = window.MC, fh = MC.S.man.forecast_hours[fhIndex];
  const P = MC.profileAt(await MC.loadProfiles(fh), lon, lat);
  Object.assign(state, { P, lon, lat, fhIndex });
  const demP = loadDEM(lat, lon).catch(() => null);
  const F = profileFns(P, state.hd), za = cruiseZ(P, state.fl);
  state.mb = boomlessM(F, za, Math.max(0, P.ground) + H_BUF);
  const atl = await MC.loadAtlas(fh, state.fl);
  state.mapM = MC.mAt(atl, Math.round(state.hd / 10) % 36, lon, lat);
  return { demP };
}
function header() {
  const MC = window.MC;
  $("c3Loc").textContent = `${MC.fmtLat(state.lat)} ${MC.fmtLon(state.lon)}`;
  $("c3Sub").textContent = `GFS valid ${d3.utcFormat("%a %d %b, %H:%M UTC")(new Date(MC.S.man.valid_times[state.fhIndex]))}. Each line is one boom ray leaving the Mach cone. Wall colours: blue where sound is slower than the aircraft (the boom keeps descending), orange where it is faster (the boom turns back up).`;
}
async function openColumn() {
  const MC = window.MC; if (!MC.S.sel) return;
  state.route = null; $("c3Route").hidden = true;
  const [lon, lat] = MC.S.sel;
  state.fl = MC.S.fl;
  state.hd = MC.S.hd === "hd" ? MC.S.hdDeg : (() => {
    const ms = MC.S.man.headings.map((h, i) => MC.mAt(MC.current, i, lon, lat));
    const i = MC.S.hd === "max" ? ms.indexOf(Math.max(...ms)) : ms.indexOf(Math.min(...ms)); return MC.S.man.headings[i];
  })();
  $("col3d").showModal(); wireControls();
  const { demP } = await loadAt(lon, lat, MC.S.fi);
  state.M = state.mb ? +state.mb.toFixed(3) : 1.05; syncInputs(); header(); state.dem = null; renderColumn();
  state.dem = await demP; renderColumn();
}
/* along the route */
function routeAt(x) {
  const R = window.MCPLAN.getRoute(), segs = R.opt.segs;
  let i = segs.findIndex(s => x < s.x1); if (i < 0) i = segs.length - 1;
  const s = segs[i], f = Math.max(0, Math.min(1, (x - s.x0) / s.d)), p = d3.geoInterpolate(s.p, s.q)(f);
  let t = 0; for (let k = 0; k < i; k++) t += segs[k].t; t += s.t * f;
  const MC = window.MC, H = MC.S.man.forecast_hours, T = H[R.fi] + t;
  let fhIndex = 0; H.forEach((h, k) => { if (Math.abs(h - T) < Math.abs(H[fhIndex] - T)) fhIndex = k; });
  return { lon: MC.normLon(p[0]), lat: p[1], hd: s.brg, M: s.M, type: s.type, t, fhIndex, seg: s };
}
let posToken = 0;
async function setRoutePos(x, waitDem = false) {
  const my = ++posToken, q = routeAt(x), R = window.MCPLAN.getRoute();
  state.routeX = x; state.hd = q.hd; state.M = q.M; state.fl = R.fl;
  const { demP } = await loadAt(q.lon, q.lat, q.fhIndex);
  if (my !== posToken) return;
  state.dem = null;                      // keep the previous terrain only if it is for this spot
  const typeName = { boomless: "boomless over land", super: "supersonic over water", sub: "subsonic", climb: "climb or descent" }[q.type];
  $("c3PosLbl").textContent = `${Math.round(x).toLocaleString()} of ${Math.round(R.opt.dist).toLocaleString()} nm, ${Math.floor(q.t)}h ${String(Math.round((q.t % 1) * 60)).padStart(2, "0")}m after departure, ${typeName}`;
  $("c3Pos").value = x; drawStrip(); syncInputs(); header();
  const quick = state.lastDem && Math.abs(state.lastDem.lat - q.lat) < 0.8 && Math.abs(state.lastDem.lon - q.lon) < 0.8 ? state.lastDem.fn : null;
  state.dem = quick; renderColumn();
  const fn = waitDem ? await demP : null;
  if (!waitDem) demP.then(f => { if (my === posToken && f) { state.dem = f; state.lastDem = { lat: q.lat, lon: q.lon, fn: f }; renderColumn(); } });
  else if (my === posToken && fn) { state.dem = fn; state.lastDem = { lat: q.lat, lon: q.lon, fn }; renderColumn(); }
}
function drawStrip() {
  const R = window.MCPLAN.getRoute(); if (!R) return;
  const svg = d3.select("#c3Strip"); svg.selectAll("*").remove();
  const w = 280, x = d3.scaleLinear([0, R.opt.dist], [0, w]);
  const col = { boomless: window.MC.css("--route-boomless"), super: window.MC.css("--route-super"), sub: window.MC.css("--route-sub"), climb: window.MC.css("--route-sub") };
  svg.selectAll("rect").data(R.opt.segs).join("rect").attr("x", s => x(s.x0)).attr("width", s => Math.max(0.6, x(s.x1) - x(s.x0) + 0.3)).attr("y", 4).attr("height", 6).attr("fill", s => col[s.type]);
  svg.append("path").attr("d", `M${x(state.routeX || 0)},0 l-5,-0 l5,7 l5,-7 z`).attr("fill", "var(--ink)");
  svg.append("text").attr("x", 0).attr("y", 24).text(R.names[0]); svg.append("text").attr("x", w).attr("y", 24).attr("text-anchor", "end").text(R.names[1]);
}
let playing = false;
async function play() {
  const R = window.MCPLAN.getRoute(); if (!R) return;
  if (playing) { playing = false; $("c3Play").classList.remove("on"); return; }
  playing = true; $("c3Play").classList.add("on");
  let x = state.routeX >= R.opt.dist - 1 ? 0 : (state.routeX || 0);
  const stepNm = Math.max(15, R.opt.dist / 140);
  while (playing && x <= R.opt.dist) {
    const t0 = performance.now();
    await setRoutePos(x, false);
    await new Promise(r => setTimeout(r, Math.max(60, 260 - (performance.now() - t0))));
    x += stepNm;
  }
  playing = false; $("c3Play").classList.remove("on");
}
async function openRoute(x = 0) {
  const R = window.MCPLAN.getRoute(); if (!R) return;
  $("col3d").showModal(); wireControls();
  $("c3Route").hidden = false;
  $("c3Pos").max = R.opt.dist; $("c3Pos").step = Math.max(1, R.opt.dist / 400);
  state.route = R;
  await setRoutePos(x, true);
}
function syncInputs() {
  const MC = window.MC;
  $("c3Fl").innerHTML = MC.S.man.flight_levels.map(f => `<option value="${f}"${f === state.fl ? " selected" : ""}>FL${f}</option>`).join("");
  $("c3Mach").value = state.M; $("c3Hd").value = Math.round(state.hd / 10) * 10;
  $("c3Ve").value = String(state.ve);
}
let wired = false;
function wireControls() {
  if (wired) return; wired = true;
  $("c3Mach").oninput = e => { state.M = +e.target.value; renderColumn(); };
  $("c3Hd").oninput = async e => { state.hd = +e.target.value; await loadAt(state.lon, state.lat, state.fhIndex); renderColumn(); };
  $("c3Fl").onchange = async e => { state.fl = +e.target.value; await loadAt(state.lon, state.lat, state.fhIndex); if (!state.route) state.M = state.mb ? +state.mb.toFixed(3) : state.M; syncInputs(); renderColumn(); };
  $("c3Ve").onchange = e => { state.ve = +e.target.value; renderColumn(); };
  $("c3Pos").oninput = e => { playing = false; $("c3Play").classList.remove("on"); setRoutePos(+e.target.value); };
  $("c3Play").onclick = play;
  $("col3d").addEventListener("close", () => { playing = false; });
}

window.MC3D = { showGlobe, openColumn, openRoute };
const wire = () => {
  $("open3d").onclick = openColumn;
  if (window.MC?.S?.view === "3d" && window.MC.S.man) showGlobe($("globe"));
};
if (window.MC?.S?.man) wire(); else window.addEventListener("mc-ready", wire);
