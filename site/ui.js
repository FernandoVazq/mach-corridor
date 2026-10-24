// Shared UI pieces for every Mach Corridor page (Atlas FJV):
//  1. InfoTip: <button class="it" data-tip="…" aria-label="…">i</button> opens a small popover on tap or click
//     (hover too on a mouse); Esc, a second tap or a tap elsewhere closes it. Keeps detail off the screen until asked.
//  2. StatStrip: <div class="ss" data-values="…"> (or data-min/q1/med/mean/q3/max) under every chart: chips (n, period,
//     unit, change, verdict written out, never colour alone), the range bar and median, mean and range with InfoTips.
//     MC_UI.stat(el, obj) and MC_UI.stripFor(svg, obj) do the same from script (see below).
(function () {
  "use strict";
  const ES = (document.documentElement.lang || "en").startsWith("es");
  const W = ES ? { range: "rango", typ: "típico", ref: "ref.", met: "cumple", miss: "no cumple", n: "n", sum: "Resumen" }
               : { range: "range", typ: "typical", ref: "ref.", met: "meets", miss: "misses", n: "n", sum: "Summary" };

  // ---------- InfoTip
  let open = null;
  function close() { if (!open) return; open.btn.setAttribute("aria-expanded", "false"); open.pop.remove(); open = null; }
  function show(btn, how) {
    if (open && open.btn === btn) { if (how === "click" && open.how === "hover") { open.how = "click"; return; } close(); return; }
    close();
    const pop = document.createElement("div");
    pop.className = "itpop"; pop.setAttribute("role", "note"); pop.id = "itpop";
    pop.textContent = btn.getAttribute("data-tip");
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(), pw = Math.min(300, window.innerWidth - 24);
    pop.style.width = pw + "px";
    let x = r.left + r.width / 2 - pw / 2 + window.scrollX;
    x = Math.max(12 + window.scrollX, Math.min(x, window.scrollX + window.innerWidth - pw - 12));
    pop.style.left = x + "px";
    const below = r.bottom + 8 + window.scrollY;
    pop.style.top = below + "px";
    if (r.bottom + pop.offsetHeight + 16 > window.innerHeight && r.top > pop.offsetHeight + 16) pop.style.top = (r.top - pop.offsetHeight - 8 + window.scrollY) + "px";
    btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-controls", "itpop");
    open = { btn, pop, how: how || "click" };
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".it");
    if (b) { e.preventDefault(); show(b, "click"); return; }
    if (open && !open.pop.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("resize", close);
  const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (finePointer) {
    document.addEventListener("mouseover", (e) => { const b = e.target.closest && e.target.closest(".it"); if (b && (!open || open.btn !== b)) show(b, "hover"); });
    document.addEventListener("mouseout", (e) => { const b = e.target.closest && e.target.closest(".it"); if (b && open && open.btn === b && open.how === "hover" && !b.contains(e.relatedTarget)) close(); });
  }

  const num = (v) => (v === undefined || v === null || v === "" || isNaN(+v) ? null : +v);
  // ---------- StatStrip (Atlas FJV): the same summary under every chart
  //  chips: label · n · period · unit · change first→last (time series) · verdict against a reference
  //  bar: min–max range, P25–P75 box, median tick, mean dot, highlighted value, reference tick
  //  numbers: median, mean and range, each with an InfoTip saying what it means
  // Input: an object, or the element's data-* attributes: values (comma list; computes the rest) or
  // n/min/q1/med/mean/q3/max; period, unit, label; hl + hlLabel; ref + refLabel + better ("low"|"high");
  // first + last + up ("good"|"bad": is a rise good?); dec, lo, hi.
  const WS = ES ? { med: "Mediana", mean: "Media", range: "Rango",
                    tMed: "La mitad de los datos está por debajo y la mitad por encima.",
                    tMean: "El promedio: la suma de los datos dividida entre cuántos son.",
                    tRange: "Del valor más bajo al más alto. La caja marca el 50 % central (P25–P75)." }
                : { med: "Median", mean: "Mean", range: "Range",
                    tMed: "Half the data are below it and half above.",
                    tMean: "The average: the sum of the data divided by how many there are.",
                    tRange: "From the lowest to the highest value. The box marks the middle 50% (P25–P75)." };
  const quant = (a, q) => { const p = (a.length - 1) * q, i = Math.floor(p), f = p - i; return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i]; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function stat(el, o) {
    const raw = (k) => (o ? o[k] : el.dataset[k]);
    const g = (k) => num(raw(k));
    const s = (k) => { const v = raw(k); return v == null ? "" : String(v); };
    let vals = raw("values");
    if (typeof vals === "string") vals = vals.split(",").map(Number);
    vals = Array.isArray(vals) ? vals.filter((v) => v != null && isFinite(v)).map(Number).sort((a, b) => a - b) : null;
    let mn = g("min"), q1 = g("q1"), md = g("med"), mean = g("mean"), q3 = g("q3"), mx = g("max"), n = s("n");
    if (vals && vals.length) {
      mn = vals[0]; mx = vals[vals.length - 1]; q1 = quant(vals, 0.25); md = quant(vals, 0.5); q3 = quant(vals, 0.75);
      mean = vals.reduce((a, b) => a + b, 0) / vals.length; if (!n) n = String(vals.length);
    }
    if (mn === null || mx === null) { el.textContent = ""; return; }
    const ref = g("ref"), hl = g("hl"), first = g("first"), last = g("last");
    const dec = g("dec") ?? 2, unit = s("unit"), better = s("better"), label = s("label"), period = s("period");
    const lo = g("lo") ?? Math.min(mn, ref ?? mn, hl ?? mn), hi = g("hi") ?? Math.max(mx, ref ?? mx, hl ?? mx);
    const span = hi - lo || 1, px = (v) => 3 + (v - lo) / span * 94;          // percent of width, 3 % margins
    const f = (v) => v.toLocaleString(ES ? "es-PR" : "en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const u = unit ? (unit === "°" || unit === "%" ? unit : " " + unit) : "";
    const chips = [];
    chips.push(`<span class="sslbl">${esc(label || W.sum)}</span>`);
    if (n) chips.push(`<span class="chip">${esc(W.n)} = ${esc(n)}</span>`);
    if (period) chips.push(`<span class="chip">${esc(period)}</span>`);
    if (unit && unit.length > 1) chips.push(`<span class="chip">${esc(unit)}</span>`);
    if (first !== null && last !== null) {
      const up = s("up") || "good", d = last - first, rise = d > 0;
      const txt = first !== 0 ? `${Math.abs(d / first * 100).toLocaleString(ES ? "es-PR" : "en-US", { maximumFractionDigits: 0 })} %` : `${f(Math.abs(d))}${u}`;
      const tone = d === 0 ? "" : (rise === (up === "good") ? "good" : "crit");
      chips.push(`<span class="d ${tone}">${d === 0 ? (ES ? "sin cambio" : "no change") : `${rise ? "▲" : "▼"} ${txt}`}</span>`);
    }
    if (ref !== null && better) {
      const ok = better === "low" ? mx <= ref : mn >= ref;
      chips.push(`<span class="d ${ok ? "good" : "crit"}">${ok ? "✓" : "✗"} ${esc(ok ? W.met : W.miss)} ${esc(s("refLabel") || W.ref)}</span>`);
    }
    const svg = `<svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${px(lo)}" x2="${px(hi)}" y1="12" y2="12" class="ax"/>
      <rect x="${px(mn)}" y="10.5" width="${Math.max(.5, px(mx) - px(mn))}" height="3" rx="1" class="rg"/>
      ${q1 !== null && q3 !== null ? `<rect x="${px(q1)}" y="7" width="${Math.max(.6, px(q3) - px(q1))}" height="10" rx="1.5" class="iq"/>` : ""}
      ${md !== null ? `<line x1="${px(md)}" x2="${px(md)}" y1="5" y2="19" class="mdl"/>` : ""}
      ${ref !== null ? `<line x1="${px(ref)}" x2="${px(ref)}" y1="2" y2="20" class="rf"/>` : ""}
    </svg>${mean !== null ? `<i class="mn" style="left:${px(mean)}%"></i>` : ""}${hl !== null ? `<i class="hl" style="left:${px(hl)}%"></i><b class="hlt${px(hl) < 18 ? " l" : px(hl) > 82 ? " r" : ""}" style="left:${px(hl)}%">${esc(s("hlLabel") || f(hl))}</b>` : ""}`;
    const tip = (t, a) => `<button type="button" class="it" aria-label="${esc(a)}" data-tip="${esc(t)}"></button>`;
    const nums = [md !== null ? `<span>${WS.med} <b>${f(md)}${u}</b>${tip(WS.tMed, WS.med)}</span>` : "",
                  mean !== null ? `<span>${WS.mean} <b>${f(mean)}${u}</b>${tip(WS.tMean, WS.mean)}</span>` : "",
                  `<span>${WS.range} <b>${f(mn)}–${f(mx)}${u}</b>${tip(WS.tRange, WS.range)}</span>`].filter(Boolean).join("");
    el.innerHTML = `<div class="sshead">${chips.join("")}</div><div class="ssbar">${svg}</div><div class="ssnums">${nums}</div>`;
    const sum = [`${WS.range} ${f(mn)}–${f(mx)}${u}`, md !== null ? `${WS.med} ${f(md)}` : "", mean !== null ? `${WS.mean} ${f(mean)}` : "",
                 ref !== null ? `${s("refLabel") || W.ref} ${f(ref)}` : "", hl !== null ? `${s("hlLabel") || ""} ${f(hl)}`.trim() : "", n ? `${W.n} = ${n}` : ""].filter(Boolean).join(", ");
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", `${label || W.sum}: ${sum}`);
  }
  function all() { document.querySelectorAll(".ss[data-min], .ss[data-values]").forEach((el) => stat(el)); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
  // the strip placed right AFTER a chart's <svg> (Atlas FJV: under the chart; one per chart, reused on redraw)
  function stripFor(svgEl, o) {
    if (!svgEl) return;
    let el = svgEl.nextElementSibling;
    if (!el || !el.classList || !el.classList.contains("ss")) { el = document.createElement("div"); el.className = "ss"; svgEl.parentNode.insertBefore(el, svgEl.nextSibling); }
    stat(el, o);
  }
  window.MC_UI = { stat, stripFor, closeTip: close };
})();
