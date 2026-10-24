/* Route drawer on the map: shift-click or airport codes → optimised route, KPIs, charts, every flight level. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let MC, ACS, RT, R = null, seq = 0;

  // the aircraft as chosen, with the top-speed slider as its design Mach (cruise Mach over open water, cap over land)
  function chosenAc() {
    const base = ACS.find(a => a.id === $("acSel").value), m = +$("machMax").value;
    if (!base.supersonic || !Number.isFinite(m) || Math.abs(m - base.design) < 1e-6) return base;
    return Object.assign(Object.create(Object.getPrototypeOf(base)), base, { design: m, name: `${base.name.replace(/ \(.*\)$/, "")} at up to M${m.toFixed(2)}` });
  }
  function syncMachMax(reset) {
    const base = ACS.find(a => a.id === $("acSel").value), sl = $("machMax");
    sl.disabled = !base.supersonic;
    if (reset || !base.supersonic) sl.value = base.supersonic ? base.design : 1.0;
    const v = +sl.value, kts = Math.round(v * 573.6).toLocaleString("en-US");
    $("machMaxLbl").textContent = base.supersonic ? `M ${v.toFixed(2)} · ${kts} kt${Math.abs(v - base.design) < 1e-6 ? " (design)" : ` (design M${base.design.toFixed(2)})`}` : `subsonic, M${base.design.toFixed(2)}`;
  }
  // over the ocean: "full" = design Mach beyond the regulated zone; a detour cap keeps the route from running far out to
  // sea for it; "boomless" = open water flown like land
  const SEA = { full: { sea: "full", maxDetour: Infinity }, full10: { sea: "full", maxDetour: 0.10 }, boomless: { sea: "boomless", maxDetour: 0.10 } };
  const E = () => ({ fuel: +$("fuelPrice").value || 1.47, vot: +$("vot").value || 85, lf: +$("lf").value || 0.8, margin: MC.S.auto && MC.sigmaReady ? MC.marginAt : MC.S.margin,
                     ...(SEA[$("seaSel") ? $("seaSel").value : "full10"] || SEA.full10) });
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const fmtMin = h => { const m = Math.round(h * 60), a = Math.abs(m), sg = m > 0 ? "+" : m < 0 ? "−" : "";
    return a >= 90 ? `${sg}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${sg}${a} min`; };
  const money = x => "$" + Math.round(Math.abs(x)).toLocaleString();
  const dMoney = x => (x > 0 ? "+" : x < 0 ? "−" : "") + money(x);
  // "KJFK", "45.3°N 64.1°W", "45.3N 64.1W" or "45.3, -64.1" -> {p: [lon, lat], name}
  function parsePt(str) {
    const t = (str || "").trim(), a = MC.APT[t.toUpperCase()];
    if (a) return { p: [a[3], a[2]], name: a[0] };
    let m = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])[\s,]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])$/i);
    if (m) { const lat = +m[1] * (/s/i.test(m[2]) ? -1 : 1), lon = +m[3] * (/w/i.test(m[4]) ? -1 : 1); return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { p: [lon, lat], name: ptName([lon, lat]) } : null; }
    m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return { p: [+m[2], +m[1]], name: ptName([+m[2], +m[1]]) };
    return null;
  }
  const ptName = p => { const a = Object.values(MC.APT).find(a => Math.abs(a[2] - p[1]) < 0.05 && Math.abs(a[3] - p[0]) < 0.05); return a ? a[0] : `${MC.fmtLat(p[1])} ${MC.fmtLon(p[0])}`; };
  const colors = () => ({ boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub") });

  // ---------- picking a route on the map: Plan button -> click start -> click destination; drag the ends ----------
  const pickS = { mode: null, A: null, drag: null, hover: null, justDragged: false };
  const SNAP_PX = 18;
  // screen point -> {p: [lon, lat], name}: the nearest airport within SNAP_PX, else the clicked point
  function snapAt(sx, sy) {
    const worldW = MC.view.k * MC.view.W0;
    let best = null, bd = SNAP_PX;
    for (const a of MC.AIRPORTS) {
      const [x, y] = MC.toScreen(a[3], a[2]);
      for (const dx of [-worldW, 0, worldW]) { const d = Math.hypot(x + dx - sx, y - sy); if (d < bd) { bd = d; best = a; } }
    }
    if (best) return { p: [best[3], best[2]], name: best[0] };
    const [lon, lat] = MC.toLonLat(sx, sy), p = [MC.normLon(lon), Math.max(-89, Math.min(89, lat))];
    return { p, name: ptName(p) };
  }
  function endAt(sx, sy) {          // 0 = start, 1 = destination, under the pointer (within 14 px)
    if (!R) return null;
    const worldW = MC.view.k * MC.view.W0;
    for (const k of [1, 0]) {
      const q = k ? R.B : R.A, [x, y] = MC.toScreen(q[0], q[1]);
      for (const dx of [-worldW, 0, worldW]) if (Math.hypot(x + dx - sx, y - sy) < 14) return k;
    }
    return null;
  }
  function drawPickLayer(ctx, toScreen, worldW) {
    if (!pickS.mode && !pickS.drag) return;
    ctx.save(); ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif";
    for (const a of MC.AIRPORTS) for (const dx of [-worldW, 0, worldW]) {
      const [x0, y] = toScreen(a[3], a[2]), x = x0 + dx;
      if (x < -20 || x > MC.view.W + 20 || y < -20 || y > MC.view.H + 20) continue;
      const hot = pickS.hover && pickS.hover.name === a[0];
      ctx.beginPath(); ctx.arc(x, y, hot ? 5 : 3.2, 0, 2 * Math.PI); ctx.fillStyle = hot ? "#fff" : "rgba(255,255,255,.75)"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(3,11,38,.9)"; ctx.stroke();
      if (hot || MC.view.k >= 2) { ctx.lineWidth = 3; ctx.strokeText(a[0], x + 7, y - 6); ctx.fillStyle = "#fff"; ctx.fillText(a[0], x + 7, y - 6); }
    }
    const mark = (q, label, filled) => {
      const [x, y] = toScreen(q.p[0], q.p[1]);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fillStyle = filled ? "#fff" : "#061029"; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = filled ? "#061029" : "#fff"; ctx.stroke();
      ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "#061029";
      ctx.strokeText(`${label} ${q.name}`, x + 10, y - 9); ctx.fillStyle = "#fff"; ctx.fillText(`${label} ${q.name}`, x + 10, y - 9);
      return [x, y];
    };
    if (pickS.mode === "B" && pickS.A) {
      const a = mark(pickS.A, "From", true);
      if (pickS.hover) { const [bx, by] = toScreen(pickS.hover.p[0], pickS.hover.p[1]); ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]); }
    }
    if (pickS.drag && pickS.drag.q) {
      const other = pickS.drag.k ? R.A : R.B, [ox, oy] = toScreen(other[0], other[1]), [bx, by] = toScreen(pickS.drag.q.p[0], pickS.drag.q.p[1]);
      ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(bx, by); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
      mark(pickS.drag.q, pickS.drag.k ? "To" : "From", !pickS.drag.k);
    }
    ctx.restore();
  }
  function setPickMode(m) {
    pickS.mode = m; pickS.hover = null;
    const on = !!m;
    $("routeMode").setAttribute("aria-pressed", on); $("routeModeLbl").textContent = on ? "Cancel" : "Plan a route";
    $("pickHint").hidden = !on;
    if (on) $("pickHint").textContent = m === "A" ? "Click the start. Airports snap." : "Now click the destination";
    MC.canvas.style.cursor = on ? "copy" : "";
    $("hint").style.visibility = on ? "hidden" : "visible";
    MC.schedule();
  }
  function wirePicking() {
    const wrap = $("mapWrap"), cv = MC.canvas;
    const local = e => { const r = cv.getBoundingClientRect(), t = e.touches ? e.touches[0] || e.changedTouches[0] : e; return [t.clientX - r.left, t.clientY - r.top]; };
    $("routeMode").onclick = () => setPickMode(pickS.mode ? null : "A");
    window.addEventListener("keydown", e => { if (e.key === "Escape" && (pickS.mode || pickS.drag)) { pickS.drag = null; setPickMode(null); } });
    // clicks in pick mode go to the route, not to the point inspector
    wrap.addEventListener("click", e => {
      if (pickS.justDragged) { pickS.justDragged = false; e.stopPropagation(); return; }
      if (!pickS.mode || e.target !== cv) return;
      e.stopPropagation();
      const q = snapAt(...local(e));
      if (pickS.mode === "A") { pickS.A = q; setPickMode("B"); return; }
      const a = pickS.A; pickS.A = null; setPickMode(null);
      planRoute(a.p, q.p, [a.name, q.name]);
      if (matchMedia("(max-width: 900px)").matches) $("routePanel").scrollIntoView({ behavior: "smooth" });
    }, true);
    // drag a route end: grab within 14 px, drop to re-plan (airports snap); the map does not pan meanwhile
    const down = e => {
      if (pickS.mode || !R || MC.S.view === "3d" || e.target !== cv) return;
      const k = endAt(...local(e)); if (k == null) return;
      e.stopPropagation(); e.preventDefault();
      pickS.drag = { k, q: null }; cv.style.cursor = "grabbing";
    };
    wrap.addEventListener("mousedown", down, true);
    wrap.addEventListener("touchstart", down, { capture: true, passive: false });
    const move = e => {
      if (pickS.drag) { if (e.cancelable) e.preventDefault(); pickS.drag.q = snapAt(...local(e)); MC.schedule(); return; }
      if (e.touches || e.target !== cv) return;
      const [sx, sy] = local(e);
      if (pickS.mode) { pickS.hover = snapAt(sx, sy); MC.schedule(); return; }
      cv.style.cursor = endAt(sx, sy) != null ? "grab" : "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    const up = () => {
      const d = pickS.drag; if (!d) return;
      pickS.drag = null; cv.style.cursor = ""; pickS.justDragged = true; setTimeout(() => { pickS.justDragged = false; }, 300);
      if (!d.q) { MC.schedule(); return; }
      const A = d.k ? { p: R.A, name: R.names[0] } : d.q, B = d.k ? d.q : { p: R.B, name: R.names[1] };
      planRoute(A.p, B.p, [A.name, B.name], { keepView: true });
    };
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  }

  function drawOverlay(ctx, toScreen, worldW) {
    if (!R) { drawPickLayer(ctx, toScreen, worldW); return; }
    const col = colors();
    const line = (segs, w, dash, color) => {
      for (const pass of [0, 1]) for (const s of segs) {
        const [ax, ay] = toScreen(MC.normLon(s.p[0]), s.p[1]), [bx, by] = toScreen(MC.normLon(s.q[0]), s.q[1]);
        if (Math.abs(bx - ax) > worldW / 2) continue;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineCap = "round";
        if (!pass) { ctx.setLineDash([]); ctx.strokeStyle = "rgba(3,11,38,.85)"; ctx.lineWidth = w + 3; }
        else { ctx.setLineDash(dash || []); ctx.strokeStyle = color || col[s.type]; ctx.lineWidth = w; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    // secondary booms: where the stratosphere would bring each supersonic leg's boom back down (dots; red on land)
    if (R.opt && R.ac.supersonic && MC.S.showSsb !== false) {
      for (const sg of R.opt.segs) if (sg.ssb && sg.ssb.pts.length) for (const [lo, la, on] of sg.ssb.pts) {
        const [x, y] = toScreen(MC.normLon(lo), la);
        ctx.beginPath(); ctx.arc(x, y, on ? 2.6 : 1.6, 0, 2 * Math.PI);
        ctx.fillStyle = on ? "rgba(255,92,92,.9)" : "rgba(226,235,252,.35)"; ctx.fill();
      }
    }
    if (R.gc) line(R.gc.segs, 1.4, [5, 5], "rgba(226,235,252,.75)");
    if (R.opt) line(R.opt.segs, 3);
    // direction: chevrons every ~90 px along the flown route
    if (R.opt) {
      let acc = 45;
      for (const sg of R.opt.segs) {
        const [ax, ay] = toScreen(MC.normLon(sg.p[0]), sg.p[1]), [bx, by] = toScreen(MC.normLon(sg.q[0]), sg.q[1]);
        const L = Math.hypot(bx - ax, by - ay); if (L > worldW / 2 || !L) continue;
        while (acc < L) {
          const f = acc / L, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, a = Math.atan2(by - ay, bx - ax);
          ctx.save(); ctx.translate(x, y); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, -4.5); ctx.lineTo(-1.5, 0); ctx.lineTo(-3.5, 4.5); ctx.closePath();
          ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(3,11,38,.9)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fill(); ctx.restore();
          acc += 90;
        }
        acc -= L;
      }
    }
    drawPickLayer(ctx, toScreen, worldW);
    for (const [p, name, k] of [[R.A, R.names[0], 0], [R.B, R.names[1], 1]]) {
      const [sx, sy] = toScreen(p[0], p[1]);
      ctx.beginPath(); ctx.arc(sx, sy, k ? 6.5 : 5, 0, 2 * Math.PI); ctx.fillStyle = k ? "#061029" : "#fff"; ctx.fill();
      ctx.lineWidth = k ? 3 : 2; ctx.strokeStyle = k ? "#fff" : "#061029"; ctx.stroke();
      if (k) { ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill(); }
      const txt = `${k ? "To" : "From"} ${name}`;
      ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "#061029";
      ctx.strokeText(txt, sx + 10, sy - 8); ctx.fillStyle = "#fff"; ctx.fillText(txt, sx + 10, sy - 8);
    }
  }


  // mean heading of the land legs (where the map colours matter), rounded to 10°
  function routeBrg(r = R) {
    if (!r) return null;
    const segs = r.opt.segs.filter(s => s.landish).length ? r.opt.segs.filter(s => s.landish) : r.opt.segs;
    const sx = segs.reduce((a, s) => a + Math.sin(s.brg * Math.PI / 180) * s.d, 0), cy = segs.reduce((a, s) => a + Math.cos(s.brg * Math.PI / 180) * s.d, 0);
    return ((Math.round(Math.atan2(sx, cy) * 180 / Math.PI / 10) * 10) % 360 + 360) % 360;
  }
  const compass = b => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];
  function matchMap() {
    const brg = routeBrg(); if (brg == null) return;
    document.querySelector('#hdSeg [data-v="hd"]').click();
    const sl = $("hdSlider"); sl.value = brg; sl.dispatchEvent(new Event("input"));
  }
  // the colours are only meaningful for the route when the map is drawn for the route's own heading
  function dirHint() {
    const el = $("dirHint"), brg = routeBrg();
    $("hint").style.visibility = "visible";
    if (brg == null || !R.ac.supersonic) { el.hidden = true; return; }
    const S = MC.S, off = S.hd === "hd" ? Math.abs(((S.hdDeg - brg + 540) % 360) - 180) : 180;
    if (off <= 30) { el.hidden = true; return; }
    const what = S.hd === "max" ? "each point's <b>best</b> direction" : S.hd === "min" ? "each point's <b>worst</b> direction" : `<b>${String(S.hdDeg).padStart(3, "0")}°</b>`;
    el.innerHTML = `<span>Colours show ${what}; this route flies <b>${String(brg).padStart(3, "0")}°</b> (${compass(brg)}).</span><button class="btn">Show for this route</button>`;
    el.querySelector("button").onclick = matchMap; el.hidden = false; $("hint").style.visibility = "hidden";
  }

  async function planRoute(A, B, names, opts = {}) {
    $("fromIn").value = names[0]; $("toIn").value = names[1];      // the form always shows what the map shows
    const my = ++seq, ac = chosenAc(), obj = $("objSel").value, e = { ...E(), obj };
    $("routeOut").hidden = false; $("routeSummary").innerHTML = "<span class='muted'>Finding the best route…</span>"; $("routeKpis").innerHTML = "";
    await new Promise(r => setTimeout(r, 15));
    const base = ACS.find(a => a.id === "b789");
    const [field, fieldB] = await Promise.all([RT.makeField(MC.S.fl, MC.S.fi), RT.makeField(RT.nearestFL(base.fl), MC.S.fi)]);
    if (my !== seq) return;
    const gc = [A, B];
    const r = { A, B, names, ac, obj, fl: MC.S.fl, fi: MC.S.fi,
      base: RT.evalPath(fieldB, base, gc, "ban", e), ban: RT.evalPath(field, ac, gc, "ban", e), gc: RT.evalPath(field, ac, gc, "corr", e) };
    r.opt = ac.supersonic ? RT.bestRoute(field, ac, A, B, obj, e) : r.gc;
    const fresh = !R || R.A !== A || R.B !== B;
    R = r; if (fresh && !opts.keepView) MC.fit && MC.fit([...r.opt.path, ...r.gc.path]);
    // a new route: colour the map for the direction it flies, so the map and the plan show the same Mach
    if (fresh && ac.supersonic && MC.S.hd !== "hd" || fresh && ac.supersonic && Math.abs(((MC.S.hdDeg - routeBrg(r) + 540) % 360) - 180) > 30) { matchMap(); return; }
    MC.schedule(); render(r); dirHint(); window.dispatchEvent(new Event("mc-route"));
    MC.hashExtra.r = [A, B].map((p, i) => MC.APT[names[i]] ? names[i] : `${p[1].toFixed(2)},${p[0].toFixed(2)}`).join("-");
    MC.hashExtra.ac = ac.id; MC.hashExtra.o = obj; MC.hashExtra.sea = $("seaSel").value === "full10" ? null : $("seaSel").value; MC.writeHash();
    const rows = [];
    for (const fl of MC.S.man.flight_levels) {
      const f = await RT.makeField(fl, MC.S.fi);
      if (my !== seq) return;
      rows.push({ fl, o: ac.supersonic ? RT.bestRoute(f, ac, A, B, obj, e, 500) : RT.evalPath(f, ac, gc, "corr", e), b: RT.evalPath(f, ac, gc, "ban", e),
                  same: ac.supersonic ? RT.evalPath(f, ac, r.opt.path, "corr", e) : null });
      renderFl(rows);
      levelAdvice(r, rows);
      await new Promise(res => setTimeout(res, 0));
    }
    // departure-time advice: the corridor moves with the weather, so the same flight can be faster at another hour
    const deps = [], H = MC.S.man.forecast_hours, est = r.opt.block;
    $("depTable").innerHTML = "<tr><td class='muted'>Computing departures…</td></tr>";
    for (let k = 0; k < H.length; k++) {
      if (H[k] + est > H[H.length - 1] + 3) break;          // the flight must end inside the forecast
      const f = await RT.makeField(MC.S.fl, k);
      if (my !== seq) return;
      deps.push({ k, t: MC.S.man.valid_times[k], o: ac.supersonic ? RT.bestRoute(f, ac, A, B, obj, e, 300) : RT.evalPath(f, ac, gc, "corr", e), b: RT.evalPath(f, ac, gc, "ban", e) });
      renderDep(deps, obj);
      await new Promise(res => setTimeout(res, 0));
    }
  }

  function render(r) {
    const o = r.opt, sup = r.ac.supersonic;
    const dBan = { t: o.block - r.ban.block, s: o.perSeat - r.ban.perSeat };
    const good = dBan.t < -1 / 60;
    const brg = routeBrg(r), skip = Math.round(o.dSkip || 0);
    $("routeSummary").innerHTML = `<b>${r.names[0]} → ${r.names[1]}</b>, flying ${compass(brg)} (${String(brg).padStart(3, "0")}°). ${r.ac.name}, FL${MC.S.fl}.
      ${Math.round(o.dist).toLocaleString()} nm (${o.dist >= r.gc.dist ? "+" : ""}${Math.round(o.dist - r.gc.dist)} nm vs great circle), ${Math.round(100 * o.dLand / o.dist)}% over land or coast.
      ${!o.inRange ? `<br><span class="warn">Longer than the ${r.ac.rangeNm.toLocaleString()} nm range: needs a fuel stop.</span>` : ""}
      ${sup && !(o.dHold && o.dHold.stale) ? `<div class="verdict ${good ? "" : "neg"}">${good ? `Boomless corridors save <b>${fmtMin(-dBan.t).replace("+", "")}</b> against today's overland ban and change the cost per seat by <b>${dMoney(dBan.s)}</b>.` : "Boomless corridors add nothing on this route at this altitude and time."}</div>` : ""}
      ${sup && o.path.info && o.path.info.subBetter ? `<p class="fine">Flying subsonic over land on the direct line beats every corridor route here for “${$("objSel").selectedOptions[0].text}”, so that is what is shown. Choose “Time” to see the fastest corridor route.</p>` : ""}
      ${sup ? holdNote(o) : ""}
      ${sup && MC.S.thresh > 1.05 ? `<p class="fine">The map lights up M ${MC.S.thresh.toFixed(2)} and above only; the plan flies every corridor from M 1.05.</p>` : ""}
      ${sup && skip > 20 ? `<p class="fine">A corridor was available on ${skip.toLocaleString()} nm of land but subsonic was cheaper there for “${$("objSel").selectedOptions[0].text}”. Choose “Time” to fly every corridor at its full Mach.</p>` : ""}`;
    const k = (v, l, cls = "") => `<div><div class="kv ${cls}">${v}</div><div class="kl">${l}</div></div>`;
    const bm = sup ? BOOM.route(o, MC.S.fl) : null;
    if (sup) $("routeSummary").insertAdjacentHTML("beforeend", `<p class="fine">${bm.sea ? `Boom at sea ${bm.sea.toFixed(1)} psf. ` : ""}Flown supersonic over land it would be ${bm.overland.toFixed(1)} psf, ${Math.round(bm.overland / BOOM.LIMIT)}× the proposed FAA limit (about ${Math.round(bm.overlandPldb)} PLdB).${bm.landPldb ? ` Loudest boomless leg on the ground: ${bm.landPldb <= 45.05 ? "model 45 PLdB or less" : `model about ${Math.round(bm.landPldb)} PLdB`}; NASA's X-59 aims for ${BOOM.X59_GOAL}, and FaINT measured up to 69 dB PLSEL below the turning point (turbulence, background).` : ""}</p>`);
    const tv = o.block - r.base.block, sv = o.perSeat - r.base.perSeat;
    $("routeKpis").innerHTML = [
      k(fmtT(o.block), "Block time"),
      k(fmtMin(tv), "Versus 787-9", tv < 0 ? "pos" : "neg"),
      k(dMoney(sv), "Cost per seat vs 787-9", sv <= 0 ? "pos" : "neg"),
      k(`${Math.round(Math.abs(o.windAvg))} kt`, o.windAvg >= 0 ? "Average tailwind" : "Average headwind", o.windAvg >= 0 ? "pos" : "neg"),
      k(o.dLand ? Math.round(100 * o.dBoomless / o.dLand) + "%" : "–", "Land legs flown boomless"),
      sup ? k(bm.land ? `${bm.land <= BOOM.SHADOW_ENVELOPE + 1e-9 && bm.landModel < BOOM.SHADOW_ENVELOPE ? "≤ " : ""}${bm.land.toFixed(2)} psf` : "0 psf", `Boom on land · limit ${BOOM.LIMIT}${o.pFlight > 0 ? ` · ${o.pFlight < 0.001 ? "< 0.1" : (100 * o.pFlight).toFixed(1)}% chance over` : ""}`, bm.land <= BOOM.LIMIT ? "pos" : "neg")
          : k(`${Math.round(o.tAcc * 60)} min`, "Spent accelerating or slowing"),
    ].join("");
    drawLadder(r); drawProfile(o); navlog();
    $("flTable").innerHTML = "<tr><td class='muted'>Computing the other altitudes…</td></tr>";
    const inf = o.path.info;
    $("optNote").textContent = sup && inf ? `Route search: time-dependent grid search, then continuous refinement from two starting routes${inf.startsAgree < 0.002 ? ", which agree" : ` (they differ by ${(100 * inf.startsAgree).toFixed(1)}%; the better is shown)`}. Best for this forecast and cost model; not a proof of the global optimum. Weather is taken at the time the aircraft reaches each point.` : "";
  }

  const HOLD = { stale: "the forecast is too old", beyond: "the flight runs past the end of the forecast", nomargin: "no forecast-error margin was available" };
  function holdNote(o) {
    const h = Object.entries(o.dHold || {}).filter(([, d]) => d > 1);
    let ssbTxt = "";
    if (o.dReach > 1) ssbTxt += `<p class="fine">Approach: ${Math.round(o.dReach).toLocaleString()} nm over water flown at the cutoff Mach because a boom just above it would land up to ${RT.REACH_KM} km ahead, on regulated ground.</p>`;
    const sp = window.BOOM ? BOOM.secondaryPsf(o.ac, o.ac.design, MC.S.fl) : null;
    if (o.dSsb > 1 && sp) ssbTxt += `<p class="fine">Each secondary boom would be about ${sp.typical.toFixed(2)} psf, up to ${sp.upper.toFixed(2)} psf (Concorde measurements scaled to this aircraft), so landing on land is avoided.</p>`;
    if (o.dSsb > 1) ssbTxt += `<p class="fine">Secondary booms: ${Math.round(o.dSsb).toLocaleString()} nm over water flown at the cutoff Mach because the stratosphere would bring the boom down on land ${o.ssbNoData ? "(no stratosphere data: assumed 125–420 km in every direction)" : "(red dots on the map)"}.</p>`;
    const age = RT.dataAgeH();
    let out = "";
    if (age > RT.STALE_H) out += `<div class="verdict neg">Forecast run is ${Math.round(age)} h old (limit ${RT.STALE_H} h). ${MC.S.allowStale
      ? "Corridors are shown anyway because you chose a <b>study with old data</b>; not for flight."
      : "Corridors are switched off (fail-closed)."} <button class="btn" id="staleBtn">${MC.S.allowStale ? "Back to fail-closed" : "Use it anyway (study only)"}</button></div>`;
    for (const [k, d] of h) if (k !== "stale") out += `<p class="fine warn">Fail-closed: ${Math.round(d).toLocaleString()} nm over land flown subsonic because ${HOLD[k]}.</p>`;
    return out + ssbTxt;
  }

  // ---- evidence file: everything behind the plan, leg by leg (operational assurance, issue #43) ----
  function evidence(r) {
    const o = r.opt, man = MC.S.man, gm = MC.gefsMeta, dep = Date.parse(man.valid_times[r.fi]);
    const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
    const r4 = x => x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4;
    let t = 0;
    const legs = o.segs.map((s, i) => {
      const row = { i, from_nm: Math.round(s.x0 * 10) / 10, to_nm: Math.round(s.x1 * 10) / 10, lat: Math.round(s.lat * 1e3) / 1e3, lon: Math.round(s.lon * 1e3) / 1e3,
        heading_deg: Math.round(s.brg), time_utc: iso(dep + t * 3.6e6), lead_h: Math.round(s.leadH * 10) / 10, type: s.type, over_land: !!s.landish,
        mach: r4(s.M), psf_ground_upper: s.type === "boomless" ? Math.max(r4(BOOM.legPsf(s, r.ac, r.fl)), BOOM.SHADOW_ENVELOPE) : null, boomless_limit_after_margin: r4(s.mcut), margin: r4(s.margin), fail_closed: s.hold || null,
        wind_along_kt: Math.round(s.along * RT.KT), psf_ground: r4(BOOM.legPsf(s, r.ac, r.fl)), caustic_above_terrain_m: s.type === "boomless" ? Math.round(BOOM.legCausticHeight(s, r.ac, r.fl)) : null,
        models_disagree: s.type === "boomless" ? (q => q == null ? null : q.one ? "one model only" : q.none ? null : r4(q.d))(MC.disagreementSync(s.lon, s.lat, s.leadH, r.fl)) : null,
        pldb_ground: s.M > 1 ? Math.round(BOOM.legPldb(s, r.ac, r.fl) * 10) / 10 : null,
        approach_limited: !!s.approach, p_exceed_011: s.pExceed ? Math.round(s.pExceed * 1e6) / 1e6 : 0,
        secondary: s.ssb ? (s.ssb.hit ? "would land on regulated land: leg slowed to cutoff" : s.ssb.pts.length ? "lands at sea" : "none") + (s.ssb.nodata ? " (no stratosphere data)" : "") : null };
      t += s.t; return row;
    });
    const bm = BOOM.route(o, r.fl), age = RT.dataAgeH();
    const checks = [
      ["forecast_fresh", age <= RT.STALE_H, `run ${man.run_time}, ${age.toFixed(1)} h old at export (limit ${RT.STALE_H} h)`],
      ["inside_forecast", !(o.dHold && o.dHold.beyond), `flight ends ${iso(dep + o.air * 3.6e6)}, forecast ends ${man.valid_times[man.valid_times.length - 1]}`],
      ["margin_available", !(o.dHold && o.dHold.nomargin), MC.S.auto ? (gm ? `ensemble spread, GEFS ${gm.run_time}` : "static error map (ensemble unavailable)") : `fixed ${MC.S.margin}`],
      ["boom_on_land_within_limit", bm.land <= BOOM.LIMIT, `${bm.land.toFixed(3)} psf vs ${BOOM.LIMIT} psf (primary)`],
      ["secondary_booms_off_land", !o.segs.some(s => s.type === "super" && s.ssb && s.ssb.hit), o.ssbNoData ? "checked with the 125–420 km fallback (no stratosphere data)" : `stratosphere tables for GFS ${man.run_time}`],
      ["no_supersonic_over_land_above_limit", !o.segs.some(s => s.landish && s.M > 1 && s.type !== "boomless"), "every supersonic land leg is a cutoff leg"],
      ["study_mode_off", !MC.S.allowStale, MC.S.allowStale ? "old data used on purpose: not for flight" : "fail-closed rules active"],
    ].map(([id, pass, note]) => ({ id, pass, note }));
    return {
      kind: "Mach Corridor flight evidence", disclaimer: "Research prototype. Not certified for flight planning.",
      exported_utc: iso(Date.now()), site: location.origin + location.pathname, link: location.href,
      code_version: man.code_version || null, model_version: man.model_version || null, method: "docs/METHOD.md", changelog: "docs/CHANGELOG.md", data: { gfs_run: man.run_time, ifs_run: (man.models && man.models.ifs) || null, ifs_lag_h: (man.models && man.models.ifs_lag_h) ?? null,
        combine: (man.models && man.models.combine) || "GFS only", built: man.generated, source: man.source, physics: man.physics,
        gefs_run: gm ? gm.run_time : null },
      route: { from: r.names[0], to: r.names[1], A: r.A, B: r.B, departure_utc: iso(dep), aircraft: { id: r.ac.id, name: r.ac.name, design_mach: r.ac.design, subsonic_mach: r.ac.sub },
        flight_level: r.fl, objective: r.obj, margin_mode: MC.S.auto ? "auto" : "fixed" },
      summary: { distance_nm: Math.round(o.dist), block_h: r4(o.block), land_nm: Math.round(o.dLand), boomless_nm: Math.round(o.dBoomless),
        fail_closed_nm: Object.fromEntries(Object.entries(o.dHold || {}).map(([k, v]) => [k, Math.round(v)])), max_psf_on_land: r4(bm.land), max_psf_on_land_model: r4(bm.landModel), max_pldb_on_land: Math.round(bm.landPldb * 10) / 10, pldb_note: "Stevens Mark VII; boomless legs from the caustic model (45 = 'or less'), primary booms with a turbulent rise time (Method 3.4); FaINT measured up to 69 dB PLSEL below the turning point", psf_upper_note: "boomless legs shown at the larger of the caustic model and FaINT's measured 0.10 psf envelope", secondary_psf_estimate: (sp => ({ typical: r4(sp.typical), upper: r4(sp.upper) }))(BOOM.secondaryPsf(r.ac, r.ac.design, r.fl)), p_exceed_011_flight: r4(o.pFlight || 0), slowed_for_secondary_booms_nm: Math.round(o.dSsb || 0), slowed_for_forward_reach_nm: Math.round(o.dReach || 0), fuel_kg: Math.round(o.fuel) },
      checks, all_checks_pass: checks.every(c => c.pass), legs,
    };
  }
  function download(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  // integrity (issue #25): SHA-256 of the compact JSON of the evidence without its "integrity" field; anyone can
  // recompute it to check the file was not edited after export
  async function withIntegrity(ev) {
    const body = JSON.stringify(ev);
    let hex = null;
    try { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)); hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); } catch (e) { /* insecure context */ }
    return { ...ev, integrity: { algorithm: "SHA-256", over: "JSON.stringify of this object without the integrity field (compact, key order as written)", value: hex } };
  }
  async function exportEvidence() {
    if (!R) return;
    await MC.preloadDis(R.fl);                           // per-leg GFS vs ECMWF disagreement (model 2.9)
    const ev = await withIntegrity(evidence(R)), base = `mach-corridor_${R.names.join("-")}_${ev.route.departure_utc.slice(0, 13).replace(/[-:T]/g, "")}Z_FL${R.fl}`;
    download(base + ".json", JSON.stringify(ev, null, 1), "application/json");
    const cols = Object.keys(ev.legs[0]);
    download(base + "_legs.csv", [cols.join(","), ...ev.legs.map(l => cols.map(c => l[c] ?? "").join(","))].join("\n"), "text/csv");
  }

  // ---------- route export (issue #23): GeoJSON and KML, one feature per constant-Mach stretch ----------
  function stretches(r) {
    const o = r.opt, dep = Date.parse(MC.S.man.valid_times[r.fi]), out = [];
    let t = 0, cur = null;
    for (const s of o.segs) {
      const key = `${s.type}|${s.M.toFixed(3)}`;
      if (!cur || cur.key !== key) { cur = { key, type: s.type, mach: +s.M.toFixed(3), from_nm: Math.round(s.x0), coords: [[+s.p[0].toFixed(4), +s.p[1].toFixed(4)]], eto: new Date(dep + t * 3.6e6).toISOString().slice(0, 16) + "Z" }; out.push(cur);
        Object.defineProperty(cur, "agg", { value: { lim: Infinity, margin: 0, psf: 0, pl: 0, p: 0, land: false, flags: new Set() }, enumerable: false }); }
      const g = cur.agg;
      if (s.mcut != null && Number.isFinite(s.margin)) { g.lim = Math.min(g.lim, s.mcut + s.margin); g.margin = Math.max(g.margin, s.margin); }
      if (s.M > 1) { g.psf = Math.max(g.psf, s.type === "boomless" ? Math.max(BOOM.legPsf(s, r.ac, r.fl), BOOM.SHADOW_ENVELOPE) : BOOM.legPsf(s, r.ac, r.fl)); g.pl = Math.max(g.pl, BOOM.legPldb(s, r.ac, r.fl)); }
      g.p = Math.max(g.p, s.pExceed || 0); g.land = g.land || !!s.landish;
      if (s.approach) g.flags.add("coast ahead"); if (s.turn) g.flags.add("turn"); if (s.ssb && s.ssb.hit) g.flags.add("secondary boom"); if (s.hold) g.flags.add("fail-closed: " + s.hold);
      cur.coords.push([+s.q[0].toFixed(4), +s.q[1].toFixed(4)]); cur.to_nm = Math.round(s.x1); t += s.t;
    }
    return out;
  }
  // ---------- boom navlog and ICAO Item 15 (deep-study feature scan: ForeFlight Navlog, SkyDemon plan, filing) ----------
  const LEG = { boomless: "Boomless", super: "Supersonic", sub: "Subsonic", climb: "Climb / descent" };
  // acceleration and deceleration ramps come out as many short stretches: merge runs of the same leg type shorter
  // than 20 nm each into one line "M a -> b"
  function mergeRamps(st) {
    const out = [];
    for (const x of st) {
      const p = out[out.length - 1], short = x.to_nm - x.from_nm < 20;
      if (p && p.type === x.type && short && (p.ramp || p.to_nm - p.from_nm < 20)) {
        p.ramp = p.ramp || [p.mach]; p.ramp.push(x.mach); p.to_nm = x.to_nm; p.coords = p.coords.concat(x.coords.slice(1));
        const a = p.agg, b = x.agg; a.lim = Math.min(a.lim, b.lim); a.margin = Math.max(a.margin, b.margin); a.psf = Math.max(a.psf, b.psf); a.pl = Math.max(a.pl, b.pl);
        a.p = Math.max(a.p, b.p); a.land = a.land || b.land; b.flags.forEach(f => a.flags.add(f));
      } else {
        const c = { ...x, coords: x.coords.slice() }; Object.defineProperty(c, "agg", { value: { ...x.agg, flags: new Set(x.agg.flags) }, enumerable: false }); out.push(c);
      }
    }
    return out;
  }
  function navRows(r) {
    return mergeRamps(stretches(r)).map(x => { const g = x.agg; return { from_nm: x.from_nm, to_nm: x.to_nm, eto_utc: x.eto, leg: LEG[x.type] || x.type, over_land: g.land ? "yes" : "no",
      mach: x.ramp ? `${x.ramp[0].toFixed(2)}->${x.ramp[x.ramp.length - 1].toFixed(2)}` : x.mach, boomless_limit: Number.isFinite(g.lim) && x.type === "boomless" ? +g.lim.toFixed(3) : "", margin: x.type === "boomless" && g.margin ? +g.margin.toFixed(3) : "",
      psf_ground: g.psf ? +g.psf.toFixed(2) : 0, pldb: g.pl ? (x.type === "boomless" && g.pl <= 45.05 ? "<=45" : Math.round(g.pl)) : "", p_exceed_011: g.p ? +g.p.toExponential(1) : 0,
      notes: [...g.flags].join("; "), lat: x.coords[0][1], lon: x.coords[0][0] }; });
  }
  function navlog() {
    if (!R) return;
    const rows = navRows(R);
    $("navlog").innerHTML = `<tr><th>nm</th><th>ETO UTC</th><th>Leg</th><th>Mach</th><th>Limit</th><th>Margin</th><th>psf</th><th>PLdB</th><th>P(&gt;0.11)</th><th>Notes</th></tr>` +
      rows.map(x => `<tr class="${x.leg === "Boomless" ? "bl" : ""}"><td>${x.from_nm.toLocaleString()}–${x.to_nm.toLocaleString()}</td><td>${x.eto_utc.slice(11, 16)}</td><td>${x.leg}${x.over_land === "yes" && x.leg !== "Boomless" ? " (land)" : ""}</td>
        <td>${typeof x.mach === "string" ? x.mach.replace("->", "→") : x.mach.toFixed(2)}</td><td>${x.boomless_limit === "" ? "–" : x.boomless_limit.toFixed(3)}</td><td>${x.margin === "" ? "–" : x.margin.toFixed(3)}</td><td>${x.psf_ground ? x.psf_ground.toFixed(2) : "–"}</td>
        <td>${x.pldb === "" ? "–" : x.pldb}</td><td>${x.p_exceed_011 ? (x.p_exceed_011 < 1e-4 ? "<0.01%" : (100 * x.p_exceed_011).toFixed(2) + "%") : "–"}</td><td>${x.notes || ""}</td></tr>`).join("");
    $("item15").textContent = item15(R);
  }
  const dm = (v, pos, neg, w) => { const a = Math.abs(v), d = Math.floor(a), m = Math.round((a - d) * 60), dd = m === 60 ? d + 1 : d, mm = m === 60 ? 0 : m;
    return String(dd).padStart(w, "0") + String(mm).padStart(2, "0") + (v >= 0 ? pos : neg); };
  const spd = M => M >= 1 || M >= 0.8 ? "M" + String(Math.round(M * 100)).padStart(3, "0") : "N" + String(Math.round(M * 573)).padStart(4, "0");
  // Item 15 route: initial speed/level, then a coordinate with the new speed/level at every change point (DCT
  // between). Mach to the hundredth, as ICAO Doc 4444 allows: a nearer value is flown with ATC agreement.
  function item15(r) {
    const st = stretches(r).filter(x => x.type !== "climb"), lvl = "F" + String(r.fl).padStart(3, "0");
    if (!st.length) return "";
    const parts = [spd(st[0].mach) + lvl];
    let last = st[0].mach;
    for (const x of st.slice(1)) {
      if (Math.round(x.mach * 100) === Math.round(last * 100)) continue;
      const [lon, lat] = x.coords[0];
      parts.push("DCT", `${dm(lat, "N", "S", 2)}${dm(lon, "E", "W", 3)}/${spd(x.mach)}${lvl}`); last = x.mach;
    }
    return parts.join(" ") + " DCT";
  }
  // ---------- flight simulators (issue #63): MSFS .pln and X-Plane 11/12 .fms v1100 ----------
  // One user waypoint at every change of leg or Mach (merged ramps), at least 30 nm apart; the waypoint name carries
  // the Mach to hold from there (B118 = boomless M1.18, S170 = supersonic M1.70, U085 = subsonic M0.85).
  function simPoints(r) {
    const st = mergeRamps(stretches(r)), nl = (v) => ((v + 540) % 360) - 180, pts = [];
    const tag = { boomless: "B", super: "S", sub: "U", climb: "C" };
    let lastNm = -1e9;
    st.forEach((x, i) => {
      if (i === 0 || x.from_nm - lastNm < 30) return;
      const M = x.ramp ? x.ramp[x.ramp.length - 1] : x.mach;
      pts.push({ id: `${tag[x.type] || "W"}${String(Math.round(M * 100)).padStart(3, "0")}`.slice(0, 5) + String(pts.length + 1).padStart(2, "0"),
                 lat: x.coords[0][1], lon: nl(x.coords[0][0]) });
      lastNm = x.from_nm;
    });
    const a = st[0].coords[0], lastSt = st[st.length - 1], b = lastSt.coords[lastSt.coords.length - 1];
    return { dep: { id: r.names[0], lat: a[1], lon: nl(a[0]) }, arr: { id: r.names[1], lat: b[1], lon: nl(b[0]) }, wps: pts.slice(0, 98) };
  }
  function msfsPos(lat, lon, altFt) {
    const f = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = ((mf - m) * 60).toFixed(2);
      return `${v >= 0 ? pos : neg}${d}° ${m}' ${sec}"`; };
    return `${f(lat, "N", "S")},${f(lon, "E", "W")},${altFt >= 0 ? "+" : "-"}${Math.abs(altFt).toFixed(2).padStart(9, "0")}`;
  }
  function simFiles(r) {
    const R = r, P = simPoints(R), alt = R.fl * 100;
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const wp = (id, type, lat, lon, a, icao) => `    <ATCWaypoint id="${esc(id)}">\n      <ATCWaypointType>${type}</ATCWaypointType>\n      <WorldPosition>${msfsPos(lat, lon, a)}</WorldPosition>\n${icao ? `      <ICAO>\n        <ICAOIdent>${esc(id)}</ICAOIdent>\n      </ICAO>\n` : ""}    </ATCWaypoint>`;
    const pln = `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0">
  <Descr>AceXML Document</Descr>
  <FlightPlan.FlightPlan>
    <Title>${esc(`${P.dep.id} to ${P.arr.id}, Mach Corridor FL${R.fl}`)}</Title>
    <FPType>IFR</FPType>
    <RouteType>Direct</RouteType>
    <CruisingAlt>${alt}</CruisingAlt>
    <DepartureID>${esc(P.dep.id)}</DepartureID>
    <DepartureLLA>${msfsPos(P.dep.lat, P.dep.lon, 0)}</DepartureLLA>
    <DestinationID>${esc(P.arr.id)}</DestinationID>
    <DestinationLLA>${msfsPos(P.arr.lat, P.arr.lon, 0)}</DestinationLLA>
    <Descr>${esc(`Boomless supersonic route from today's forecast (GFS ${MC.S.man.run_time}). Waypoint names give the Mach to hold: B = boomless, S = supersonic over water, U = subsonic. Research prototype, not for real flight.`)}</Descr>
    <AppVersion>
      <AppVersionMajor>11</AppVersionMajor>
      <AppVersionBuild>282174</AppVersionBuild>
    </AppVersion>
${[wp(P.dep.id, "Airport", P.dep.lat, P.dep.lon, 0, true), ...P.wps.map((w) => wp(w.id, "User", w.lat, w.lon, alt)), wp(P.arr.id, "Airport", P.arr.lat, P.arr.lon, 0, true)].join("\n")}
  </FlightPlan.FlightPlan>
</SimBase.Document>
`;
    const n6 = (v) => v.toFixed(6);
    const fms = ["I", "1100 Version", "CYCLE 2610", `ADEP ${P.dep.id}`, `ADES ${P.arr.id}`, `NUMENR ${P.wps.length + 2}`,
      `1 ${P.dep.id} ADEP 0.000000 ${n6(P.dep.lat)} ${n6(P.dep.lon)}`,
      ...P.wps.map((w) => `28 ${w.id} DRCT ${alt.toFixed(6)} ${n6(w.lat)} ${n6(w.lon)}`),
      `1 ${P.arr.id} ADES 0.000000 ${n6(P.arr.lat)} ${n6(P.arr.lon)}`].join("\n") + "\n";
    return { pln, fms, n: P.wps.length };
  }
  function exportSim() {
    if (!R) return;
    const f = simFiles(R), base = `mach-corridor_${R.names.join("-")}_FL${R.fl}`;
    download(base + ".pln", f.pln, "application/xml");
    download(base + ".fms", f.fms, "text/plain");
  }
  function exportNavlog() {
    if (!R) return;
    const rows = navRows(R), cols = Object.keys(rows[0]), man = MC.S.man;
    const head = `# Mach Corridor boom navlog, ${R.names.join("-")}, ${R.ac.name}, FL${R.fl}; GFS ${man.run_time}${man.models && man.models.ifs ? " + ECMWF " + man.models.ifs : ""}; model ${man.model_version}; research prototype, not for flight`;
    download(`mach-corridor_${R.names.join("-")}_FL${R.fl}_navlog.csv`, [head, cols.join(","), ...rows.map(x => cols.map(c => /[,;]/.test(String(x[c])) ? `"${x[c]}"` : x[c]).join(","))].join("\n"), "text/csv");
  }

  function exportRoute() {
    if (!R) return;
    const st = stretches(R), man = MC.S.man, base = `mach-corridor_${R.names.join("-")}_FL${R.fl}`;
    const props = { from: R.names[0], to: R.names[1], aircraft: R.ac.name, flight_level: R.fl, gfs_run: man.run_time, model_version: man.model_version || null,
      note: "Research prototype, not for flight. Not an ARINC 633 flight plan: a waypoint list for display and analysis." };
    const gj = { type: "FeatureCollection", properties: props, features: st.map(x => ({ type: "Feature",
      properties: { type: x.type, mach: x.mach, from_nm: x.from_nm, to_nm: x.to_nm, eto_utc: x.eto }, geometry: { type: "LineString", coordinates: x.coords } })) };
    download(base + ".geojson", JSON.stringify(gj, null, 1), "application/geo+json");
    const col = { boomless: "ff4fb8e8", super: "ffd47a2b", sub: "ff9aa3b5", climb: "ff9aa3b5" };   // KML colours are aabbggrr
    const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(`${R.names[0]} - ${R.names[1]} FL${R.fl}`)}</name><description>${esc(props.note + " GFS " + props.gfs_run)}</description>` +
      st.map(x => `<Placemark><name>${esc(`${x.type} M${x.mach}`)}</name><description>${esc(`${x.from_nm}-${x.to_nm} nm, from ${x.eto}`)}</description><Style><LineStyle><color>${col[x.type] || "ffffffff"}</color><width>4</width></LineStyle></Style><LineString><altitudeMode>absolute</altitudeMode><coordinates>${x.coords.map(c => `${c[0]},${c[1]},${Math.round(R.fl * 30.48)}`).join(" ")}</coordinates></LineString></Placemark>`).join("") + `</Document></kml>`;
    download(base + ".kml", kml, "application/vnd.google-earth.kml+xml");
  }

  // ---------- cockpit (EFB) view, issue #24: the next 300 nm from a point of the planned route ----------
  const AHEAD = 300;
  function efbOpen() {
    if (!R) return;
    const o = R.opt, dlg = $("efb");
    $("efbRoute").textContent = `${R.names[0]} → ${R.names[1]}, FL${R.fl}`;
    $("efbPos").max = Math.round(o.dist); $("efbPos").value = 0;
    $("efbPos").oninput = () => efbDraw(+$("efbPos").value);
    dlg.showModal(); efbDraw(0);
  }
  function efbDraw(x0) {
    const o = R.opt, segs = o.segs, at = x => segs.find(s => x >= s.x0 && x < s.x1) || segs[segs.length - 1];
    const s0 = at(x0), tAt = x => { let t = 0; for (const s of segs) { if (s.x1 <= x) t += s.t; else { t += s.t * Math.max(0, x - s.x0) / s.d; break; } } return t; };
    const dep = Date.parse(MC.S.man.valid_times[R.fi]), when = new Date(dep + tAt(x0) * 3.6e6);
    $("efbPosLbl").textContent = `${Math.round(x0).toLocaleString()} nm · ${d3.utcFormat("%H:%MZ")(when)}`;
    const lim = s => s.mcut != null && Number.isFinite(s.margin) ? s.mcut + s.margin - BOOM.bufferPenalty(R.ac, R.fl) : null;
    const typeName = { boomless: "Boomless (cutoff)", super: "Supersonic, over water", sub: "Subsonic", climb: "Climb / descent" };
    const CHG = 0.01;                                  // a Mach change the crew acts on
    const next = segs.find(s => s.x0 > x0 && (s.type !== s0.type || Math.abs(s.M - s0.M) > CHG));
    const tile = (v, l, cls = "") => `<div class="${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $("efbTiles").innerHTML = [
      tile(`M${s0.M.toFixed(3)}`, `Fly now · ${typeName[s0.type] || s0.type}`),
      tile(lim(s0) ? `M${lim(s0).toFixed(3)}` : "—", "Forecast boomless limit here"),
      tile(Number.isFinite(s0.margin) && s0.margin ? `${s0.margin.toFixed(3)}` : "—", "Margin kept (Mach)"),
      tile(next ? `${Math.round(next.x0 - x0)} nm` : "—", next ? `To next change: ${typeName[next.type] || next.type}, M${next.M.toFixed(2)}` : "No change ahead", next && next.x0 - x0 < 30 ? "warn" : ""),
    ].join("");
    // chart: the next 300 nm
    const svg = d3.select("#efbChart"); svg.selectAll("*").remove();
    const W = 1000, H = 360, m = { l: 64, r: 40, t: 34, b: 40 };
    const win = segs.filter(s => s.x1 > x0 && s.x0 < x0 + AHEAD);
    const vals = win.flatMap(s => [s.M, lim(s)].filter(v => v != null && v > 0.9 && v < 2.5));
    const y = d3.scaleLinear([Math.min(0.9, d3.min(vals) - 0.02), Math.max(1.3, d3.max(vals) + 0.02)], [H - m.b, m.t]).nice();
    const x = d3.scaleLinear([0, AHEAD], [m.l, W - m.r]), X = s => [x(Math.max(0, s.x0 - x0)), x(Math.min(AHEAD, s.x1 - x0))];
    const g = svg.append("g");
    g.append("g").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d + " nm")).call(axisLight);
    g.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(".2f"))).call(axisLight);
    g.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", "var(--ink-3)").attr("stroke-dasharray", "3 4");
    g.append("text").attr("x", W - m.r).attr("y", y(1) - 6).attr("text-anchor", "end").attr("fill", "var(--ink-3)").style("font-size", "13px").text("Mach 1");
    // margin band between the forecast limit and what is flown, then the limit and the flown Mach
    for (const s of win) {
      const L = lim(s), [a, b] = X(s);
      if (L != null && s.type === "boomless") g.append("rect").attr("x", a).attr("width", Math.max(1, b - a)).attr("y", y(L)).attr("height", Math.max(0, y(s.M) - y(L))).attr("fill", "var(--accent)").attr("opacity", 0.14);
      if (L != null) g.append("line").attr("x1", a).attr("x2", b).attr("y1", y(L)).attr("y2", y(L)).attr("stroke", "var(--ink-2)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
      g.append("line").attr("x1", a).attr("x2", b).attr("y1", y(s.M)).attr("y2", y(s.M)).attr("stroke", colors()[s.type]).attr("stroke-width", 4).attr("stroke-linecap", "round")
        .append("title").text(`${Math.round(s.x0)}–${Math.round(s.x1)} nm: M${s.M.toFixed(3)}${L ? `, limit M${L.toFixed(3)}` : ""}`);
      if (s.approach || (s.ssb && s.ssb.hit)) g.append("rect").attr("x", a).attr("width", Math.max(1, b - a)).attr("y", m.t).attr("height", 6).attr("fill", "var(--warn)");
    }
    g.append("text").attr("x", m.l).attr("y", 16).attr("fill", "var(--ink-2)").style("font-size", "13px").text("Thick: Mach to fly · dashed: forecast boomless limit · shaded: margin · orange bar: slowed for approach or secondary booms");
    // the next changes, in words
    const items = []; let prev = s0;
    for (const s of segs) {
      if (s.x0 <= x0 || s.x0 > x0 + AHEAD) continue;
      if (s.type !== prev.type || Math.abs(s.M - prev.M) > CHG) {
        items.push(`${Math.round(s.x0 - x0)} nm (${d3.utcFormat("%H:%MZ")(new Date(dep + tAt(s.x0) * 3.6e6))}): ${typeName[s.type] || s.type}, M${s.M.toFixed(3)}${s.approach ? " — slowed: regulated ground within 90 km ahead" : s.ssb && s.ssb.hit ? " — slowed: secondary booms would land on land" : s.turn ? " — turn" : ""}`);
        prev = s;
      }
    }
    const fl = win.map(s => s.M).filter(Number.isFinite);
    if (fl.length) strip("efbChart", { values: fl, unit: "Mach", dec: 3, ref: 1, refLabel: "Mach 1", n: `${fl.length} stretches`, period: `next ${AHEAD} nm`,
      hl: s0.M, hlLabel: "now", label: "Mach to fly" });
    $("efbNext").innerHTML = items.length ? items.slice(0, 6).map(t => `<li>${t}</li>`).join("") : "<li>No change in the next 300 nm.</li>";
  }
  // Atlas FJV StatStrip under each chart (site/ui.js)
  const strip = (id, o) => { const el = document.getElementById(id); if (el && window.MC_UI) window.MC_UI.stripFor(el, o); };
  function axisLight(g) { g.select(".domain").attr("stroke", "var(--rule)"); g.selectAll("text").style("font-size", "13px").style("fill", "var(--ink-2)"); g.selectAll("line").attr("stroke", "var(--rule)"); }

  function drawLadder(r) {
    const rows = [["787-9 today", r.base, MC.css("--ink-3")]];
    if (r.ac.supersonic) rows.push(["Overland ban, direct", r.ban, MC.css("--route-sub")], ["Corridors, direct", r.gc, MC.css("--route-super")], ["Corridors, optimised", r.opt, MC.css("--route-boomless")]);
    const svg = d3.select("#rLadder").attr("viewBox", `0 0 340 ${rows.length * 28 + 6}`); svg.selectAll("*").remove();
    const x = d3.scaleLinear([0, d3.max(rows, d => d[1].block)], [128, 290]);
    rows.forEach(([lbl, e, c], i) => {
      const y = i * 28 + 4;
      svg.append("text").attr("x", 0).attr("y", y + 13).text(lbl).style("font-size", "11px");
      svg.append("rect").attr("x", 128).attr("y", y + 3).attr("height", 14).attr("rx", 3).attr("width", x(e.block) - 128).attr("fill", c);
      svg.append("text").attr("x", x(e.block) + 6).attr("y", y + 14).text(fmtT(e.block)).style("font-size", "11px").style("fill", "var(--ink)");
    });
    strip("rLadder", { values: rows.map(d => d[1].block * 60), unit: "min", dec: 0, lo: 0, n: `${rows.length} options`,
      hl: rows[rows.length - 1][1].block * 60, hlLabel: rows.length > 1 ? "optimised" : "787-9", label: "Block time" });
  }

  function drawProfile(e) {
    const svg = d3.select("#rprof"); svg.selectAll("*").remove();
    const m = { l: 34, r: 8 }, w = 340 - m.l - m.r, h1 = 110, h2 = 50, gap = 14;
    const x = d3.scaleLinear([0, e.dist], [0, w]);
    const g = svg.append("g").attr("transform", `translate(${m.l},6)`);
    const yMax = Math.max(e.ac.design, 1.3) + 0.05, y = d3.scaleLinear([0.7, yMax], [h1, 0]);
    g.append("g").selectAll("rect").data(e.segs.filter(s => s.landish)).join("rect")
      .attr("x", s => x(s.x0)).attr("width", s => Math.max(0.5, x(s.x1) - x(s.x0) + 0.3)).attr("y", 0).attr("height", h1).attr("fill", "var(--surface-2)");
    g.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridl").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(5).tickFormat(d3.format(".1f"))).call(s => s.select(".domain").remove());
    g.append("text").attr("x", 0).attr("y", -1).text("Mach (shaded: over land or coast)");
    const mc = e.segs.filter(s => s.landish && s.mcut != null);
    g.append("g").selectAll("line").data(mc).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", s => y(Math.max(0.7, Math.min(s.mcut, yMax)))).attr("y2", s => y(Math.max(0.7, Math.min(s.mcut, yMax))))
      .attr("stroke", "var(--ink-3)").attr("stroke-width", 1).attr("stroke-dasharray", "2 2");
    const col = colors();
    g.append("g").selectAll("line").data(e.segs).join("line").attr("x1", s => x(s.x0)).attr("x2", s => x(s.x1))
      .attr("y1", (s, i) => y(i ? e.segs[i - 1].M : s.M)).attr("y2", s => y(s.M)).attr("stroke", s => col[s.type]).attr("stroke-width", 2.4).attr("stroke-linecap", "round");
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(1)).attr("y2", y(1)).attr("stroke", "var(--ink-3)").attr("stroke-width", .8);
    // wind panel: tailwind positive (good), headwind negative (bad)
    const g2 = svg.append("g").attr("transform", `translate(${m.l},${6 + h1 + gap})`);
    const wv = e.segs.map(s => ({ x: (s.x0 + s.x1) / 2, w: s.along * RT.KT }));
    const wm = Math.max(40, d3.max(wv, d => Math.abs(d.w)));
    const yw = d3.scaleLinear([-wm, wm], [h2, 0]);
    g2.append("path").datum(wv).attr("fill", "var(--good)").attr("opacity", .35).attr("d", d3.area().x(d => x(d.x)).y0(yw(0)).y1(d => yw(Math.max(0, d.w))));
    g2.append("path").datum(wv).attr("fill", "var(--bad)").attr("opacity", .35).attr("d", d3.area().x(d => x(d.x)).y0(yw(0)).y1(d => yw(Math.min(0, d.w))));
    g2.append("line").attr("x1", 0).attr("x2", w).attr("y1", yw(0)).attr("y2", yw(0)).attr("stroke", "var(--ink-3)").attr("stroke-width", .8);
    g2.append("g").attr("class", "axis").call(d3.axisLeft(yw).ticks(3).tickSize(0).tickPadding(5)).call(s => s.select(".domain").remove());
    g2.append("text").attr("x", 0).attr("y", -3).text("Wind along track, kt (green tailwind, red headwind)");
    g2.append("g").attr("class", "axis").attr("transform", `translate(0,${h2})`).call(d3.axisBottom(x).ticks(5).tickSize(3).tickFormat(d => d3.format(",")(d) + (d === 0 ? " nm" : ""))).call(s => s.select(".domain").attr("stroke", "var(--rule)"));
    svg.attr("viewBox", `0 0 340 ${6 + h1 + gap + h2 + 22}`);
    strip("rprof", { values: e.segs.map(s => s.M), unit: "Mach", dec: 2, ref: 1, refLabel: "Mach 1",
      n: `${e.segs.length} stretches`, period: `${Math.round(e.dist).toLocaleString()} nm`, label: "Flown Mach along the route" });
    svg.on("click", ev => { const [px] = d3.pointer(ev, g.node()); window.MC3D?.openRoute(Math.max(0, Math.min(e.dist, x.invert(px)))); });
  }

  function renderDep(rows, obj) {
    const metric = x => obj === "time" ? x.o.block : obj === "cost" ? x.o.op : x.o.gen;
    const best = rows.reduce((b, x) => (metric(x) < metric(b) ? x : b), rows[0]);
    $("depTable").innerHTML = `<tr><th>Departure (UTC)</th><th>Block</th><th>vs ban</th><th>Boomless</th><th>$/seat</th></tr>` +
      rows.map(x => `<tr class="${x === best ? "hl" : ""} ${x.k === MC.S.fi ? "cur" : ""}"><td>${d3.utcFormat("%a %H:%M")(new Date(x.t))}${x === best ? " (best)" : ""}</td><td>${fmtT(x.o.block)}</td>
        <td class="${x.o.block < x.b.block ? "pos" : ""}">${fmtMin(x.o.block - x.b.block)}</td><td>${x.o.dLand ? Math.round(100 * x.o.dBoomless / x.o.dLand) + "%" : "–"}</td><td>${money(x.o.perSeat)}</td></tr>`).join("");
  }

  // Level advisory (deep study 4, study/fl_choice.py): along this route, 300 nm blocks where another level allows a
  // faster boomless Mach. In the hindcast the forecast picked FL450 over FL550 in about a third of blocks (+0.007 Mach before margin on average,
  // +0.01 or more on a quarter of flights). A descent at the cutoff Mach costs ~0.03 Mach per -3 deg while it lasts
  // (results/flight_path_angle.json), so the change itself is flown subsonic or before the boomless block.
  const BLOCK_NM = 300, MIN_GAIN = 0.01;
  function blockMach(o) {
    const out = new Map();
    for (const s of o.segs) {
      if (!s.landish) continue;                            // every land leg: boomless, or subsonic where no corridor
      const k = Math.floor((s.x0 + s.x1) / 2 / BLOCK_NM), v = out.get(k) || { m: 0, d: 0 };
      v.m += s.M * s.d; v.d += s.d; out.set(k, v);
    }
    return new Map([...out].filter(([, v]) => v.d >= 100).map(([k, v]) => [k, v.m / v.d]));
  }
  function levelAdvice(r, rows) {
    const el = $("lvlNote"); if (!el) return;
    const cur = rows.find(x => x.fl === r.fl && x.same);
    if (!r.ac.supersonic || !cur) { el.textContent = ""; return; }
    const base = blockMach(cur.same), adv = [];
    for (const [k, m0] of base) {
      let best = null;
      for (const x of rows) {
        if (!x.same || x.fl === r.fl || x.fl > r.fl + 50 || x.fl < r.fl - 100) continue;
        const m = blockMach(x.same).get(k);
        if (m != null && m - m0 >= MIN_GAIN && (!best || m > best.m)) best = { fl: x.fl, m };
      }
      if (best) adv.push({ k, fl: best.fl, gain: best.m - m0 });
    }
    el.innerHTML = adv.length ? `<b>Level advisory.</b> On this route another level allows a faster Mach over land in ${adv.length} of ${base.size} 300 nm blocks: ` +
      adv.map(a => `nm ${(a.k * BLOCK_NM).toLocaleString()}–${((a.k + 1) * BLOCK_NM).toLocaleString()} at FL${a.fl} (+${a.gain.toFixed(3)})`).join("; ") +
      `. Change level before the block or while subsonic: a 3° descent at the cutoff Mach lowers the limit about 0.03 Mach while it lasts.`
      : rows.length === MC.S.man.flight_levels.length ? `Level advisory: FL${r.fl} is within ${MIN_GAIN} Mach of the best level on every overland block of this route.` : "";
  }

  function renderFl(rows) {
    const best = rows.reduce((b, x) => (x.o.gen < b.o.gen ? x : b), rows[0]);
    $("flTable").innerHTML = `<tr><th>Altitude</th><th>Block</th><th>vs ban</th><th>Boomless</th><th>Fuel</th><th>$/seat</th></tr>` +
      rows.map(x => `<tr class="${x === best ? "hl" : ""} ${x.fl === MC.S.fl ? "cur" : ""}"><td>FL${x.fl}${x === best ? " (best)" : ""}</td><td>${fmtT(x.o.block)}</td>
        <td class="${x.o.block < x.b.block ? "pos" : ""}">${fmtMin(x.o.block - x.b.block)}</td><td>${x.o.dLand ? Math.round(100 * x.o.dBoomless / x.o.dLand) + "%" : "–"}</td>
        <td>${(x.o.fuel / 1000).toFixed(1)} t</td><td>${money(x.o.perSeat)}</td></tr>`).join("");
  }

  window.addEventListener("mc-ready", ev => {
    MC = window.MC; ACS = window.AIRCRAFT; RT = window.ROUTE;
    MC.overlays.push(drawOverlay);
    wirePicking();
    // each aircraft with its top speed: Mach and true airspeed in the standard stratosphere (573.6 kt per Mach)
    const kt = m => Math.round(m * 573.6).toLocaleString("en-US");
    $("acSel").innerHTML = ACS.map(a => `<option value="${a.id}">${a.name} · M${a.design.toFixed(2)}, ${kt(a.design)} kt</option>`).join("");
    $("acSel").value = "concorde";
    const p = ev.detail;
    if (p.get("ac") && ACS.some(a => a.id === p.get("ac"))) $("acSel").value = p.get("ac");
    if (["time", "cost", "gen"].includes(p.get("o"))) $("objSel").value = p.get("o");
    const go = () => {
      const a = parsePt($("fromIn").value), b = parsePt($("toIn").value);
      if (!a || !b) { $("routeOut").hidden = false; $("routeSummary").textContent = "Use an airport code from the list or coordinates like 45.3N 64.1W, or press Plan on the map and click two points."; return; }
      planRoute(a.p, b.p, [a.name, b.name]);
    };
    $("routeGo").onclick = go;
    $("fly3d").onclick = () => window.MC3D?.openRoute(0);
    $("evidenceBtn").onclick = exportEvidence;
    $("efbBtn").onclick = efbOpen;
    $("routeExportBtn").onclick = exportRoute;
    $("navlogBtn").onclick = exportNavlog;
    $("simBtn").onclick = exportSim;
    $("item15Copy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText($("item15").textContent).then(() => { $("item15Copy").textContent = "Copied"; setTimeout(() => $("item15Copy").textContent = "Copy", 1500); }).catch(() => {}); };
    $("routeSummary").addEventListener("click", ev => {
      if (ev.target.id !== "staleBtn" || !R) return;
      MC.S.allowStale = !MC.S.allowStale; planRoute(R.A, R.B, R.names);
    });
    $("routeHd").onclick = matchMap;
    $("routeSwap").onclick = () => {
      if (R) planRoute(R.B, R.A, [R.names[1], R.names[0]], { keepView: true });
      else { const f = $("fromIn").value; $("fromIn").value = $("toIn").value; $("toIn").value = f; if ($("fromIn").value && $("toIn").value) go(); }
    };
    MC.on("refresh", dirHint);
    for (const id of ["fromIn", "toIn"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    if (SEA[p.get("sea")]) $("seaSel").value = p.get("sea");
    syncMachMax(true);
    if (p.get("mx") && +p.get("mx") >= 1 && +p.get("mx") <= 2.4) { $("machMax").value = +p.get("mx"); syncMachMax(false); }
    $("machMax").oninput = () => syncMachMax(false);
    $("machMax").onchange = () => { MC.hashExtra.mx = Math.abs(+$("machMax").value - ACS.find(a => a.id === $("acSel").value).design) < 1e-6 ? null : $("machMax").value; if (R) planRoute(R.A, R.B, R.names, { keepView: true }); else MC.writeHash(); };
    $("acSel").addEventListener("change", () => { syncMachMax(true); MC.hashExtra.mx = null; }, true);
    for (const id of ["acSel", "objSel", "seaSel"]) $(id).onchange = () => { MC.hashExtra.sea = $("seaSel").value === "full10" ? null : $("seaSel").value; if (R) planRoute(R.A, R.B, R.names, { keepView: true }); else MC.writeHash(); };
    // tap-friendly routing: start here / end here (works without a keyboard)
    let pendingStart = null;
    $("routeFromHere").onclick = () => {
      pendingStart = MC.S.sel.slice(); $("pickHint").hidden = false;
      $("pickHint").textContent = "Now tap the destination on the map";
      document.getElementById("mapWrap").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("routeToHere").onclick = () => {
      const start = pendingStart || (R ? R.A : null);
      if (!start) { pendingStart = null; $("pickHint").hidden = false; $("pickHint").textContent = "Pick a start first: tap a point, then Start route here"; setTimeout(() => $("pickHint").hidden = true, 2500); return; }
      const b = MC.S.sel.slice(); pendingStart = null; $("pickHint").hidden = true;
      const names = [ptName(start), ptName(b)]; planRoute(start, b, names);
      document.getElementById("routePanel").scrollIntoView({ behavior: "smooth" });
    };
    MC.on("select", p => {
      if (!pendingStart) return;
      const a = pendingStart; pendingStart = null; $("pickHint").hidden = true;
      const names = [ptName(a), ptName(p)];
      planRoute(a, p.slice(), names);
    });
    MC.on("shiftSelect", (a, b) => {
      const names = [ptName(a), ptName(b)];
      planRoute(a, b, names);
    });
    MC.on("refresh", () => { if (R) planRoute(R.A, R.B, R.names, { keepView: true }); });
    const r = p.get("r");      // "KJFK-KLAX" or "45.28,-62.60-32.39,-102.25": only a dash after a digit or letter separates
    if (r) {
      const pts = r.split(/(?<=[0-9A-Za-z])-/).map(s => MC.APT[s] ? [[MC.APT[s][3], MC.APT[s][2]], s] : (([la, lo]) => [[+lo, +la], `${la},${lo}`])(s.split(",")));
      if (pts.length === 2) planRoute(pts[0][0], pts[1][0], [ptName(pts[0][0]), ptName(pts[1][0])]);
    }
  });
  window.MCPLAN = { navRows: () => R && navRows(R), item15: () => R && item15(R), planRoute, getRoute: () => R, evidence: () => R && evidence(R), evidenceSigned: async () => { if (!R) return null; await MC.preloadDis(R.fl); return withIntegrity(evidence(R)); }, stretches: () => R && stretches(R), simFiles: () => R && simFiles(R) };
})();
