// Physics tab: a side view of why the boom can stay in the sky. A standard atmosphere (warm at the ground, cold above
// 11 km) plus a wind that grows with height. The boom travels along rays that bend toward slower sound; in the
// ground frame a ray keeps c_eff(z) / cos(theta) = V (the aircraft's ground speed, Snell's law for a layered medium),
// so it turns back up where the effective sound speed c + wind reaches V. If V is faster than the sound near the
// ground everywhere below, the ray reaches the ground: the boom lands. Illustrative, not a forecast.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const KT = 0.514444, ZA = 16.76;                      // m/s per kt; FL550 in km
  const cAt = z => 20.05 * Math.sqrt(z < 11 ? 288.15 - 6.5 * z : 216.65);
  const shape = z => Math.min(1, 0.15 + 0.85 * z / 11); // wind grows to the tropopause, then holds
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";

  function model(M, Wkt) {
    const W = Wkt * KT, w = z => W * shape(z) / shape(ZA), ce = z => cAt(z) + w(z);
    const V = M * cAt(ZA) + W;                            // ground speed (tailwind positive)
    // the ray from the aircraft down: dx/dz = cot(theta), cos(theta) = c_eff / V; it trails behind the aircraft
    const pts = [[0, ZA]]; let x = 0, turn = null;
    for (let z = ZA; z > 0; z -= 0.02) {
      const cs = ce(z - 0.01) / V;
      if (cs >= 1) { turn = z; break; }
      x -= 0.02 * cs / Math.sqrt(1 - cs * cs); pts.push([x, z - 0.02]);
    }
    if (turn != null) { const n = pts.length; for (let i = n - 2; i >= 0; i--) pts.push([2 * pts[n - 1][0] - pts[i][0], pts[i][1]]); }
    let cmax = 0; for (let z = 0; z <= ZA; z += 0.05) cmax = Math.max(cmax, ce(z));
    return { pts, turn, V, ce, w, Mc: (cmax - W) / cAt(ZA), hitX: turn == null ? x : null };
  }

  function draw() {
    const M = +$("bdM").value, Wkt = +$("bdW").value, r = model(M, Wkt), svg = d3.select("#bdSvg");
    $("bdMl").textContent = `M ${M.toFixed(2)}`;
    $("bdWl").textContent = Wkt === 0 ? "calm" : `${Math.abs(Wkt)} kt ${Wkt > 0 ? "tailwind" : "headwind"}`;
    svg.selectAll("*").remove();
    const W = 760, H = 360, L = 46, R = 560, T = 18, B = 318;
    const span = Math.max(60, -d3.min(r.pts, p => p[0]) * 1.05, r.turn != null ? -(r.pts[Math.floor(r.pts.length / 2)][0]) * 1.1 : 0);
    const x = d3.scaleLinear([-span, 8], [L, R]), y = d3.scaleLinear([0, 18], [B, T]);
    const warm = css("--warn-soft"), cold = css("--surface-2");
    const defs = svg.append("defs");
    const gr = defs.append("linearGradient").attr("id", "bdAir").attr("x1", 0).attr("x2", 0).attr("y1", 1).attr("y2", 0);
    gr.append("stop").attr("offset", "0%").attr("stop-color", warm); gr.append("stop").attr("offset", "62%").attr("stop-color", cold); gr.append("stop").attr("offset", "100%").attr("stop-color", cold);
    svg.append("rect").attr("x", L).attr("y", T).attr("width", R - L).attr("height", B - T).attr("fill", "url(#bdAir)");
    // the tropopause and the altitude axis
    svg.append("line").attr("x1", L).attr("x2", R).attr("y1", y(11)).attr("y2", y(11)).attr("stroke", css("--rule")).attr("stroke-dasharray", "4 4");
    svg.append("text").attr("x", R - 4).attr("y", y(11) - 5).attr("text-anchor", "end").text("tropopause: the cooling stops");
    for (const k of [0, 5, 10, 15]) svg.append("text").attr("x", L - 6).attr("y", y(k) + 4).attr("text-anchor", "end").text(`${k} km`);
    svg.append("text").attr("x", L + 8).attr("y", B - 10).style("font-weight", 600).text("Warm air: sound is fast");
    svg.append("text").attr("x", L + 8).attr("y", y(12.6)).style("font-weight", 600).text("Cold air: sound is slow");
    // wind arrows, scaled to the wind at that height
    for (const z of [2, 6, 10, 14]) {
      const v = r.w(z) / KT, len = Math.max(-60, Math.min(60, v * 0.55)), x0 = L + 210, yy = y(z);
      if (Math.abs(len) < 3) continue;
      svg.append("line").attr("x1", x0).attr("x2", x0 + len).attr("y1", yy).attr("y2", yy).attr("stroke", css("--ink-3")).attr("stroke-width", 1.6);
      svg.append("path").attr("d", `M${x0 + len},${yy} l${len > 0 ? -6 : 6},-4 l0,8 z`).attr("fill", css("--ink-3"));
      svg.append("text").attr("x", x0 + len + (len > 0 ? 6 : -6)).attr("y", yy + 4).attr("text-anchor", len > 0 ? "start" : "end").text(`${Math.round(Math.abs(v))} kt`);
    }
    // the boom's path: four rays from successive aircraft positions (older ones fainter)
    const line = d3.line().x(p => x(p[0])).y(p => y(p[1])).curve(d3.curveBasis);
    const rayCol = r.turn == null ? css("--bad") : css("--data-1");
    const step = span / 6;
    for (let k = 3; k >= 0; k--) {
      const dx = -k * step;
      svg.append("path").attr("d", line(r.pts.map(p => [p[0] + dx, p[1]]).filter(p => x(p[0]) >= L - 2))).attr("fill", "none")
        .attr("stroke", rayCol).attr("stroke-width", k ? 1.4 : 2.6).attr("opacity", k ? 0.35 : 1);
    }
    // the ground, and what happens there
    svg.append("line").attr("x1", L).attr("x2", R).attr("y1", B).attr("y2", B).attr("stroke", css("--ink-2")).attr("stroke-width", 2);
    if (r.turn != null) {
      const mid = r.pts[Math.floor(r.pts.length / 2)];
      svg.append("circle").attr("cx", x(mid[0])).attr("cy", y(mid[1])).attr("r", 4.5).attr("fill", css("--surface")).attr("stroke", rayCol).attr("stroke-width", 2);
      svg.append("text").attr("x", x(mid[0])).attr("y", y(mid[1]) + 18).attr("text-anchor", "middle").style("font-weight", 600)
        .text(`turns back up ${r.turn.toFixed(1)} km above the ground`);
      svg.append("text").attr("x", x(mid[0])).attr("y", B + 18).attr("text-anchor", "middle").style("fill", css("--good")).style("font-weight", 600).text("quiet on the ground");
    } else {
      const hx = x(r.hitX);
      svg.append("path").attr("d", d3.symbol(d3.symbolStar, 160)()).attr("transform", `translate(${hx},${B})`).attr("fill", css("--bad"));
      svg.append("text").attr("x", hx).attr("y", B + 22).attr("text-anchor", "middle").style("fill", css("--bad")).style("font-weight", 600).text("boom on the ground");
    }
    // the aircraft
    const ax = x(0), ay = y(ZA);
    svg.append("path").attr("d", `M${ax + 14},${ay} L${ax - 12},${ay - 5} L${ax - 16},${ay - 11} L${ax - 18},${ay - 1} L${ax - 18},${ay + 1} L${ax - 12},${ay + 5} Z`).attr("fill", css("--ink"));
    svg.append("line").attr("x1", ax + 20).attr("x2", ax + 44).attr("y1", ay).attr("y2", ay).attr("stroke", css("--ink")).attr("stroke-width", 1.6);
    svg.append("path").attr("d", `M${ax + 48},${ay} l-7,-4 l0,8 z`).attr("fill", css("--ink"));
    svg.append("text").attr("x", ax - 6).attr("y", ay - 16).attr("text-anchor", "end").style("font-weight", 600).text(`M ${M.toFixed(2)} at 55,000 ft`);

    // right: the rule, as a profile of sound speed plus wind against the aircraft's ground speed
    const PL = 612, PR = 744, kt = v => v / KT;
    const zs = d3.range(0, ZA + 0.01, 0.25), lo = d3.min(zs, z => kt(r.ce(z))), hi = Math.max(d3.max(zs, z => kt(r.ce(z))), kt(r.V));
    const px = d3.scaleLinear([lo - 20, hi + 20], [PL, PR]);
    svg.append("text").attr("x", PL).attr("y", T + 2).style("font-weight", 600).text("Sound + wind, kt");
    svg.append("path").attr("d", d3.area().x0(PL).x1(z => px(Math.min(kt(r.ce(z)), hi + 20))).y(z => y(z))(zs.filter(z => r.ce(z) >= r.V)))
      .attr("fill", css("--good-soft"));
    svg.append("path").attr("d", d3.line().x(z => px(kt(r.ce(z)))).y(z => y(z))(zs)).attr("fill", "none").attr("stroke", css("--data-1")).attr("stroke-width", 2);
    const fast = zs.filter(z => r.ce(z) >= r.V);
    if (fast.length) svg.append("text").attr("x", PL + 4).attr("y", y(d3.max(fast)) + 14).style("fill", css("--good")).text("sound faster: turns back");
    svg.append("line").attr("x1", px(kt(r.V))).attr("x2", px(kt(r.V))).attr("y1", y(ZA)).attr("y2", B).attr("stroke", css("--ink")).attr("stroke-dasharray", "4 3").attr("stroke-width", 1.4);
    svg.append("text").attr("x", px(kt(r.V)) + (px(kt(r.V)) > (PL + PR) / 2 ? -4 : 4)).attr("y", y(ZA) + 12).attr("text-anchor", px(kt(r.V)) > (PL + PR) / 2 ? "end" : "start").text(`aircraft ${Math.round(kt(r.V))} kt`);
    svg.append("line").attr("x1", PL).attr("x2", PR).attr("y1", B).attr("y2", B).attr("stroke", css("--ink-2"));
    for (const v of px.ticks(3)) svg.append("text").attr("x", px(v)).attr("y", B + 14).attr("text-anchor", "middle").text(v);

    const near = Math.round(kt(r.ce(0.2)));
    $("bdRead").innerHTML = r.turn != null
      ? `At <b>M ${M.toFixed(2)}</b> the aircraft covers ${Math.round(kt(r.V))} kt over the ground; sound near the ground carries ${near} kt, so the boom bends back up before it lands. Here the limit is <b>M ${r.Mc.toFixed(2)}</b>.`
      : `At <b>M ${M.toFixed(2)}</b> the aircraft (${Math.round(kt(r.V))} kt over the ground) outruns the sound near the ground (${near} kt): nothing turns the boom back, and it lands. Slow to <b>M ${r.Mc.toFixed(2)}</b> or less.`;
  }

  function init() {
    if (!$("bdSvg")) return;
    $("bdM").oninput = draw; $("bdW").oninput = draw;
    draw();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
    window.addEventListener("mc-tab", e => { if (e.detail === "physics") draw(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
