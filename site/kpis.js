/* Progress board on the Method page: kpis.json (updated at the end of every sprint). */
(async () => {
  const el = document.getElementById("kpiBoard"); if (!el) return;
  let K; try { K = await fetch("kpis.json", { cache: "no-cache" }).then(r => r.json()); } catch (e) { el.hidden = true; return; }
  const fmt = (v, u) => v == null ? "—" : `${v}${u === "%" ? "%" : " " + u}`;
  const phase = n => K.phases.find(p => p.n === n);
  document.getElementById("kpiMeta").innerHTML = `Sprint ${K.sprint || 1} · ${K.updated} · <a href="https://github.com/FernandoVazq/mach-corridor/blob/main/docs/ROADMAP.md">Roadmap</a> · <a href="https://github.com/FernandoVazq/mach-corridor/milestones">Milestones</a>`;
  el.innerHTML = K.kpis.map(k => {
    const lower = k.better === "lower", t = k.today, has = t != null;
    const met = v => has && v != null && (lower ? t <= v : t >= v);
    const st = k.status ? k.status : !has ? ["Not measured", "na"] : met(k.target) ? ["Target met", "ok"] : met(k.gate) ? ["Gate met", "gate"] : ["In progress", "wip"];
    const s0 = k.start ?? t, span = (k.target - s0) || 1;
    const f = has && s0 != null ? Math.max(0, Math.min(1, (t - s0) / span)) : 0;
    const g = k.gate != null && s0 != null ? Math.max(0, Math.min(1, (k.gate - s0) / span)) : null;
    const tip = [k.source, k.note].filter(Boolean).join(" · ");
    return `<div class="kb" title="${tip.replace(/"/g, "&quot;")}">
      <div class="kb-n">${k.name}<span>Phase ${k.phase} · ${phase(k.phase)?.name || ""}${k.note ? " · " + k.note : ""}</span></div>
      <div class="kb-v">${fmt(t, k.unit)}</div>
      <div class="kb-m" role="img" aria-label="${k.name}: ${fmt(t, k.unit)}, target ${fmt(k.target, k.unit)}">
        <i style="width:${(100 * f).toFixed(1)}%"></i>${g != null ? `<b style="left:${(100 * g).toFixed(1)}%" title="Phase gate ${fmt(k.gate, k.unit)}"></b>` : ""}
      </div>
      <div class="kb-t">${fmt(k.target, k.unit)}</div>
      <div class="kb-s ${st[1]}">${st[0]}</div>
    </div>`;
  }).join("");
})();
