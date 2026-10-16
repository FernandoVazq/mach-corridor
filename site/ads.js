// Google AdSense, off unless MC_CONFIG.adsense is set (see docs/MONETIZATION.md).
//   "ca-pub-…"                  loads the AdSense script only (site verification, consent message); no ad unit.
//   { client: "ca-pub-…", slot } also fills ONE ad unit in the right-hand panel, below the route. Never over the map.
(function () {
  "use strict";
  const cfg = (window.MC_CONFIG || {}).adsense;
  if (!cfg) return;
  const client = typeof cfg === "string" ? cfg.trim() : String(cfg.client || "").trim();
  const slot = typeof cfg === "object" && cfg.slot != null ? String(cfg.slot).trim() : "";
  if (!/^ca-pub-\d{10,20}$/.test(client)) { console.warn("MC_CONFIG.adsense: not a publisher id (ca-pub-…), ads stay off"); return; }

  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
  document.head.appendChild(s);

  if (!/^\d{6,20}$/.test(slot)) return;
  const box = document.getElementById("adSlot");
  if (!box) return;
  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.setAttribute("data-ad-client", client);
  ins.setAttribute("data-ad-slot", slot);
  ins.setAttribute("data-ad-format", "auto");
  ins.setAttribute("data-full-width-responsive", "true");
  box.querySelector(".adbody").appendChild(ins);
  box.hidden = false;
  (window.adsbygoogle = window.adsbygoogle || []).push({});
})();
