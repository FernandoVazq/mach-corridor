// "Support this project" link (GitHub Sponsors). Rendered only when MC_CONFIG.sponsorsUrl is set.
(function () {
  "use strict";
  const cfg = window.MC_CONFIG || {};
  const url = typeof cfg.sponsorsUrl === "string" ? cfg.sponsorsUrl.trim() : "";
  if (!/^https:\/\/github\.com\/sponsors\/[A-Za-z0-9-]+\/?$/.test(url)) return;

  const heart = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 14s-6-3.8-6-8.2A3.3 3.3 0 0 1 8 4a3.3 3.3 0 0 1 6 1.8C14 10.2 8 14 8 14z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  // header, next to the Prototype badge
  const badge = document.getElementById("protoBadge");
  if (badge && badge.parentNode) {
    const a = document.createElement("a");
    a.className = "badge support";
    a.id = "supportLink";
    a.href = url;
    a.rel = "noopener";
    a.title = "Support this project on GitHub Sponsors";
    a.innerHTML = heart + '<span>Support</span><span class="sr"> this project on GitHub Sponsors</span>';
    badge.parentNode.insertBefore(a, badge);
  }

  // Method page, next to the data credits
  const note = document.getElementById("supportNote");
  if (note) {
    note.textContent = "Mach Corridor is free and open. If it is useful to you, you can ";
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.textContent = "support it on GitHub Sponsors";
    note.append(a, ".");
    note.hidden = false;
  }
})();
