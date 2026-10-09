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
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.MeshBasicMaterial({ map: tex }));
    scene.add(globe);
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
      if (G.dirty) { paintTexture(cnv); tex.needsUpdate = true; G.dirty = false; }
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
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: css("--surface-2"), side: THREE.DoubleSide }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.set(60, 0, 0); grp.add(gnd);
  const grid = new THREE.GridHelper(size, 26, 0x888888, 0x888888); grid.position.set(60, 0.02, 0); grid.material.opacity = 0.25; grid.material.transparent = true; grp.add(grid);
  if (ground > 50) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(size, K(ground) * VE, size), new THREE.MeshLambertMaterial({ color: 0x8a6d4b, transparent: true, opacity: 0.35 }));
    t.position.set(60, K(ground) * VE / 2, 0); grp.add(t);
  }
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
    <div>Cruise ${Math.round(za)} m · terrain ${Math.round(ground)} m · buffer top ${Math.round(zf)} m</div>`;
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
  g.append("path").datum(pts).attr("fill", "none").attr("stroke", "var(--green)").attr("stroke-width", 2).attr("d", d3.line().x(p => x(p[0])).y(p => y(p[1])));
  g.append("line").attr("x1", x(Iv)).attr("x2", x(Iv)).attr("y1", 0).attr("y2", h).attr("stroke", "var(--text)").attr("stroke-dasharray", "4 3");
  g.append("text").attr("x", x(Iv) + 3).attr("y", 10).text("aircraft ground speed");
  g.append("text").attr("x", 2).attr("y", y(za) - 3).text("cruise");
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(za)).attr("y2", y(za)).attr("stroke", "var(--text-2)").attr("stroke-width", 0.6);
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
  Object.assign(state, { P, lon, lat, fl: MC.S.fl, hd });
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
