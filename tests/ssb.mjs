// Secondary-boom check: plan a transatlantic route (study mode on old local data) and report slowed legs + timing.
// Usage: node ssb.mjs [ROUTE] [base]
import { chromium } from 'playwright';
const route = process.argv[2] || 'KJFK-EGLL', base = process.argv[3] || 'http://localhost:8765/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); await p.route(/fernando-vazquez\.netlify\.app|googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { if (location.hash.includes('nossb') || window.name === 'nossb') window.__noSsb = true; }); await p.goto(base + `#fl=550&mg=auto&r=${route}&ac=overture&o=time`);
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
if (await p.$('#staleBtn')) {
  const t0 = Date.now(); await p.click('#staleBtn');
  await p.waitForFunction(() => /Back to fail-closed/.test(document.getElementById('routeSummary')?.innerText || ''), null, { timeout: 120000 });
  console.log('replan ms', Date.now() - t0);
}
await p.waitForTimeout(1000);
console.log(await p.evaluate(() => { const e = window.MCPLAN.evidence(); return JSON.stringify({ ssbData: !!window.MC.ssbReady, sum: e.summary, checks: e.checks.filter(c => /secondary/.test(c.id)), sec: e.legs.map(l => l.secondary).filter(Boolean).reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}), txt: document.getElementById('routeSummary').innerText.slice(0, 600) }, null, 1); }));
await p.screenshot({ path: process.argv[4] || '/tmp/claude-0/-home-claude-mach-corridor/88445fbf-6ffb-512f-9c9c-a2c5435425a2/scratchpad/ssb.png' });
console.log(errs.join('\n')); await b.close();
