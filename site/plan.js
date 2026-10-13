/* Route drawer on the map: shift-click or airport codes → optimised route, KPIs, charts, every flight level. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let MC, ACS, RT, R = null, seq = 0;

  const E = () => ({ fuel: +$("fuelPrice").value || 1.47, vot: +$("vot").value || 85, lf: +$("lf").value || 0.8, margin: MC.S.auto && MC.sigmaReady ? MC.marginAt : MC.S.margin });
  const fmtT = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const fmtMin = h => { const m = Math.round(h * 60), a = Math.abs(m), sg = m > 0 ? "+" : m < 0 ? "−" : "";
    return a >= 90 ? `${sg}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${sg}${a} min`; };
  const money = x => "$" + Math.round(Math.abs(x)).toLocaleString();
  const dMoney = x => (x > 0 ? "+" : x < 0 ? "−" : "") + money(x);
  const ptName = p => { const a = Object.values(MC.APT).find(a => Math.abs(a[2] - p[1]) < 0.05 && Math.abs(a[3] - p[0]) < 0.05); return a ? a[0] : `${MC.fmtLat(p[1])} ${MC.fmtLon(p[0])}`; };
  const colors = () => ({ boomless: MC.css("--route-boomless"), super: MC.css("--route-super"), sub: MC.css("--route-sub"), climb: MC.css("--route-sub") });

  function drawOverlay(ctx, toScreen, worldW) {
    if (!R) return;
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

  async function planRoute(A, B, names) {
    const my = ++seq, ac = ACS.find(a => a.id === $("acSel").value), obj = $("objSel").value, e = { ...E(), obj };
    $("routeOut").hidden = false; $("routeSummary").innerHTML = "<span class='muted'>Finding the best route…</span>"; $("routeKpis").innerHTML = "";
    await new Promise(r => setTimeout(r, 15));
    const base = ACS.find(a => a.id === "b789");
    const [field, fieldB] = await Promise.all([RT.makeField(MC.S.fl, MC.S.fi), RT.makeField(RT.nearestFL(base.fl), MC.S.fi)]);
    if (my !== seq) return;
    const gc = [A, B];
    const r = { A, B, names, ac, obj, fl: MC.S.fl, fi: MC.S.fi,
      base: RT.evalPath(fieldB, base, gc, "ban", e), ban: RT.evalPath(field, ac, gc, "ban", e), gc: RT.evalPath(field, ac, gc, "corr", e) };
    r.opt = ac.supersonic ? RT.bestRoute(field, ac, A, B, obj, e) : r.gc;
    R = r; MC.fit && MC.fit([...r.opt.path, ...r.gc.path]); MC.schedule(); render(r); dirHint(); window.dispatchEvent(new Event("mc-route"));
    MC.hashExtra.r = [A, B].map((p, i) => MC.APT[names[i]] ? names[i] : `${p[1].toFixed(2)},${p[0].toFixed(2)}`).join("-");
    MC.hashExtra.ac = ac.id; MC.hashExtra.o = obj; MC.writeHash();
    const rows = [];
    for (const fl of MC.S.man.flight_levels) {
      const f = await RT.makeField(fl, MC.S.fi);
      if (my !== seq) return;
      rows.push({ fl, o: ac.supersonic ? RT.bestRoute(f, ac, A, B, obj, e, 500) : RT.evalPath(f, ac, gc, "corr", e), b: RT.evalPath(f, ac, gc, "ban", e) });
      renderFl(rows);
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
      ${sup && skip > 20 ? `<p class="fine">A corridor was available on ${skip.toLocaleString()} nm of land but subsonic was cheaper there for “${$("objSel").selectedOptions[0].text}”. Choose “Time” to fly every corridor at its full Mach.</p>` : ""}`;
    const k = (v, l, cls = "") => `<div><div class="kv ${cls}">${v}</div><div class="kl">${l}</div></div>`;
    const bm = sup ? BOOM.route(o, MC.S.fl) : null;
    if (sup) $("routeSummary").insertAdjacentHTML("beforeend", `<p class="fine">${bm.sea ? `Boom at sea ${bm.sea.toFixed(1)} psf. ` : ""}Flown supersonic over land it would be ${bm.overland.toFixed(1)} psf, ${Math.round(bm.overland / BOOM.LIMIT)}× the proposed FAA limit.</p>`);
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
    drawLadder(r); drawProfile(o);
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
        fail_closed_nm: Object.fromEntries(Object.entries(o.dHold || {}).map(([k, v]) => [k, Math.round(v)])), max_psf_on_land: r4(bm.land), max_psf_on_land_model: r4(bm.landModel), psf_upper_note: "boomless legs shown at the larger of the caustic model and FaINT's measured 0.10 psf envelope", secondary_psf_estimate: (sp => ({ typical: r4(sp.typical), upper: r4(sp.upper) }))(BOOM.secondaryPsf(r.ac, r.ac.design, r.fl)), p_exceed_011_flight: r4(o.pFlight || 0), slowed_for_secondary_booms_nm: Math.round(o.dSsb || 0), slowed_for_forward_reach_nm: Math.round(o.dReach || 0), fuel_kg: Math.round(o.fuel) },
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
      if (!cur || cur.key !== key) { cur = { key, type: s.type, mach: +s.M.toFixed(3), from_nm: Math.round(s.x0), coords: [[+s.p[0].toFixed(4), +s.p[1].toFixed(4)]], eto: new Date(dep + t * 3.6e6).toISOString().slice(0, 16) + "Z" }; out.push(cur); }
      cur.coords.push([+s.q[0].toFixed(4), +s.q[1].toFixed(4)]); cur.to_nm = Math.round(s.x1); t += s.t;
    }
    return out;
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
    $("efbNext").innerHTML = items.length ? items.slice(0, 6).map(t => `<li>${t}</li>`).join("") : "<li>No change in the next 300 nm.</li>";
  }
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
    svg.on("click", ev => { const [px] = d3.pointer(ev, g.node()); window.MC3D?.openRoute(Math.max(0, Math.min(e.dist, x.invert(px)))); });
  }

  function renderDep(rows, obj) {
    const metric = x => obj === "time" ? x.o.block : obj === "cost" ? x.o.op : x.o.gen;
    const best = rows.reduce((b, x) => (metric(x) < metric(b) ? x : b), rows[0]);
    $("depTable").innerHTML = `<tr><th>Departure (UTC)</th><th>Block</th><th>vs ban</th><th>Boomless</th><th>$/seat</th></tr>` +
      rows.map(x => `<tr class="${x === best ? "hl" : ""} ${x.k === MC.S.fi ? "cur" : ""}"><td>${d3.utcFormat("%a %H:%M")(new Date(x.t))}${x === best ? " (best)" : ""}</td><td>${fmtT(x.o.block)}</td>
        <td class="${x.o.block < x.b.block ? "pos" : ""}">${fmtMin(x.o.block - x.b.block)}</td><td>${x.o.dLand ? Math.round(100 * x.o.dBoomless / x.o.dLand) + "%" : "–"}</td><td>${money(x.o.perSeat)}</td></tr>`).join("");
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
    $("acSel").innerHTML = ACS.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
    $("acSel").value = "concorde";
    const p = ev.detail;
    if (p.get("ac") && ACS.some(a => a.id === p.get("ac"))) $("acSel").value = p.get("ac");
    if (["time", "cost", "gen"].includes(p.get("o"))) $("objSel").value = p.get("o");
    const go = () => {
      const a = MC.APT[$("fromIn").value.trim().toUpperCase()], b = MC.APT[$("toIn").value.trim().toUpperCase()];
      if (!a || !b) { $("routeOut").hidden = false; $("routeSummary").textContent = "Use airport codes from the list, or click a point and shift-click a second one."; return; }
      planRoute([a[3], a[2]], [b[3], b[2]], [a[0], b[0]]);
    };
    $("routeGo").onclick = go;
    $("fly3d").onclick = () => window.MC3D?.openRoute(0);
    $("evidenceBtn").onclick = exportEvidence;
    $("efbBtn").onclick = efbOpen;
    $("routeExportBtn").onclick = exportRoute;
    $("routeSummary").addEventListener("click", ev => {
      if (ev.target.id !== "staleBtn" || !R) return;
      MC.S.allowStale = !MC.S.allowStale; planRoute(R.A, R.B, R.names);
    });
    $("routeHd").onclick = matchMap;
    $("routeSwap").onclick = () => {
      const f = $("fromIn").value; $("fromIn").value = $("toIn").value; $("toIn").value = f;
      if (R) planRoute(R.B, R.A, [R.names[1], R.names[0]]); else if ($("fromIn").value && $("toIn").value) go();
    };
    MC.on("refresh", dirHint);
    for (const id of ["fromIn", "toIn"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    for (const id of ["acSel", "objSel"]) $(id).onchange = () => { if (R) planRoute(R.A, R.B, R.names); };
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
      $("fromIn").value = MC.APT[names[0]] ? names[0] : ""; $("toIn").value = MC.APT[names[1]] ? names[1] : "";
      planRoute(a, p.slice(), names);
    });
    MC.on("shiftSelect", (a, b) => {
      const names = [ptName(a), ptName(b)];
      $("fromIn").value = MC.APT[names[0]] ? names[0] : ""; $("toIn").value = MC.APT[names[1]] ? names[1] : "";
      planRoute(a, b, names);
    });
    MC.on("refresh", () => { if (R) planRoute(R.A, R.B, R.names); });
    const r = p.get("r");
    if (r) {
      const pts = r.split("-").map(s => MC.APT[s] ? [[MC.APT[s][3], MC.APT[s][2]], s] : (([la, lo]) => [[+lo, +la], `${la},${lo}`])(s.split(",")));
      if (pts.length === 2) { if (MC.APT[pts[0][1]]) $("fromIn").value = pts[0][1]; if (MC.APT[pts[1][1]]) $("toIn").value = pts[1][1]; planRoute(pts[0][0], pts[1][0], [pts[0][1], pts[1][1]]); }
    }
  });
  window.MCPLAN = { planRoute, getRoute: () => R, evidence: () => R && evidence(R), evidenceSigned: async () => { if (!R) return null; await MC.preloadDis(R.fl); return withIntegrity(evidence(R)); }, stretches: () => R && stretches(R) };
})();
