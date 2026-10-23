// Shared UI pieces for every Mach Corridor page (Atlas FJV):
//  1. InfoTip: <button class="it" data-tip="…" aria-label="…">i</button> opens a small popover on tap or click
//     (hover too on a mouse); Esc, a second tap or a tap elsewhere closes it. Keeps detail off the screen until asked.
//  2. StatStrip: <div class="ss" data-min data-med data-max [data-q1 data-q3] [data-ref data-ref-label data-better="low|high"]
//     [data-lo data-hi] [data-dec] [data-unit] [data-n] [data-label]></div> draws the same summary under every chart:
//     range bar (min–max), typical value (median dot), middle half (q1–q3 band) and the reference tick, plus one line of
//     text with a verdict written out (never colour alone). MC_UI.stat(el, obj) does the same from script.
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

  // ---------- StatStrip
  const num = (v) => (v === undefined || v === null || v === "" || isNaN(+v) ? null : +v);
  function stat(el, o) {
    const g = (k) => num(o ? o[k] : el.dataset[k]);
    const s = (k) => (o ? o[k] : el.dataset[k]) || "";
    const mn = g("min"), md = g("med"), mx = g("max"), q1 = g("q1"), q3 = g("q3"), ref = g("ref");
    if (mn === null || mx === null) { el.textContent = ""; return; }
    const dec = g("dec") ?? 2, unit = s("unit"), better = s("better"), label = s("label"), n = s("n");
    const lo = g("lo") ?? Math.min(mn, ref ?? mn), hi = g("hi") ?? Math.max(mx, ref ?? mx);
    const span = hi - lo || 1, px = (v) => 4 + (v - lo) / span * 92;          // percent of width, 4 % margins
    const f = (v) => v.toLocaleString(ES ? "es-PR" : "en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    let verdict = "", tone = "";
    if (ref !== null && better) {
      const ok = better === "low" ? mx <= ref : mn >= ref;
      verdict = ok ? `✓ ${W.met} ${s("refLabel") || W.ref}` : `✗ ${W.miss} ${s("refLabel") || W.ref}`;
      tone = ok ? "good" : "crit";
    }
    const svg = `<svg viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${px(lo)}" x2="${px(hi)}" y1="11" y2="11" class="ax"/>
      <rect x="${px(mn)}" y="8" width="${Math.max(.6, px(mx) - px(mn))}" height="6" rx="1.5" class="rg"/>
      ${q1 !== null && q3 !== null ? `<rect x="${px(q1)}" y="8" width="${Math.max(.6, px(q3) - px(q1))}" height="6" rx="1.5" class="iq"/>` : ""}
      ${ref !== null ? `<line x1="${px(ref)}" x2="${px(ref)}" y1="3" y2="17" class="rf"/>` : ""}
    </svg>${md !== null ? `<i class="md" style="left:${px(md)}%"></i>` : ""}`;
    const txt = [`${W.range} ${f(mn)}–${f(mx)}${unit ? " " + unit : ""}`, md !== null ? `${W.typ} ${f(md)}` : "",
                 ref !== null ? `${s("refLabel") || W.ref} ${f(ref)}` : "", n ? `${W.n} = ${n}` : ""].filter(Boolean).join(" · ");
    el.innerHTML = `<div class="sshead"><span class="sslbl">${label || W.sum}</span>${verdict ? `<span class="d ${tone}">${verdict}</span>` : ""}</div>
      <div class="ssbar">${svg}</div><div class="sstxt">${txt}</div>`;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `${label || W.sum}: ${txt}${verdict ? ". " + verdict : ""}`);
  }
  function all() { document.querySelectorAll(".ss[data-min]").forEach((el) => stat(el)); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
  // the strip placed right before a chart's <svg> (one per chart, reused on redraw)
  function stripFor(svgEl, o) {
    if (!svgEl) return;
    let el = svgEl.previousElementSibling;
    if (!el || !el.classList || !el.classList.contains("ss")) { el = document.createElement("div"); el.className = "ss"; svgEl.parentNode.insertBefore(el, svgEl); }
    stat(el, o);
  }
  window.MC_UI = { stat, stripFor, closeTip: close };
})();
