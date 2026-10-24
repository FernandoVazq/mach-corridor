// Google AdSense, off unless MC_CONFIG.adsense is set (see docs/MONETIZATION.md).
//   "ca-pub-…"                  loads the AdSense script only (site verification, consent message); no ad unit.
//   { client: "ca-pub-…", slot } also fills the page's ad sections (.adslot, at most 2 per page, the same slot),
//   which sit after the main text: never over or beside a map, button or control.
// No ad units for visitors who came from Fernando's CV site or LinkedIn, or with ?ref=cv in the address: the choice is
// kept in sessionStorage, so it holds for the rest of that visit.
(function () {
  "use strict";
  const cfg = (window.MC_CONFIG || {}).adsense;
  if (!cfg) return;
  const client = typeof cfg === "string" ? cfg.trim() : String(cfg.client || "").trim();
  const slot = typeof cfg === "object" && cfg.slot != null ? String(cfg.slot).trim() : "";
  if (!/^ca-pub-\d{10,20}$/.test(client)) { console.warn("MC_CONFIG.adsense: not a publisher id (ca-pub-…), ads stay off"); return; }

  // pages carry the tag statically (AdSense's site check reads the raw HTML); add it only if missing.
  if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
    document.head.appendChild(s);
  }

  const KEY = "mc-noads";
  const store = { get() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } },
                  set() { try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode: this page only */ } } };
  const fromCv = /fernandojvazquez\.com|linkedin\.com/i.test(document.referrer || "") || new URLSearchParams(location.search).get("ref") === "cv";
  if (fromCv) store.set();
  if (fromCv || store.get() === "1") return;

  if (!/^\d{6,20}$/.test(slot)) return;
  const boxes = [...document.querySelectorAll(".adslot")].slice(0, 2);
  for (const box of boxes) {
    const body = box.querySelector(".adbody"); if (!body) continue;
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", client);
    ins.setAttribute("data-ad-slot", slot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    body.appendChild(ins);
    box.hidden = false;
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }
})();
