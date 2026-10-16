// Site smoke test, run in CI before every deploy: no JS errors, map renders, a route plans with psf,
// and the automated WCAG 2.2 AA audit is clean on every tab. Usage: node smoke.mjs <base url> [chromium path]
import { chromium } from 'playwright';
import fs from 'fs';
const [, , base = 'http://localhost:8765/', exe] = process.argv;
const axe = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const fail = [], report = {};
for (const [w, h, scheme] of [[1400, 900, 'light'], [1400, 900, 'dark'], [390, 844, 'light']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|fonts\.g/.test(m.text()) && !/gibs\.earthdata\.nasa\.gov|googlesyndication|doubleclick|google\.com\/(pagead|adsense)|adtrafficquality/.test((m.location() || {}).url || '')) errs.push(m.text()); });   // NASA imagery is third-party: its outages must not block a deploy
  const t0 = Date.now();
  await p.goto(base + '#fl=550&mg=auto&r=OMDB-EGLL&ac=overture&o=time');
  await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man, null, { timeout: 30000 });
  const tReady = Date.now() - t0;
  await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 60000 });
  const key = `${w}-${scheme}`;
  report[key] = { ready_ms: tReady, route_ms: Date.now() - t0 };
  // performance budget (issue #29): the map must be interactive within 15 s even on a slow CI runner
  if (tReady > 15000) fail.push(`${key}: map ready in ${tReady} ms (budget 15000)`);
  for (const tab of ['map', 'econ', 'physics', 'method']) {
    if (tab !== 'map') { await p.click(`button[data-tab="${tab}"]`); await p.waitForTimeout(tab === 'econ' ? 15000 : 1500); }
    await p.addScriptTag({ content: axe });
    const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
    report[key][tab] = r.length;
    if (r.length) fail.push(`${key} ${tab}: ${r.join('; ')}`);
  }
  if (errs.length) fail.push(`${key} errors: ${errs.join(' | ')}`);
  await p.close();
}
await b.close();
console.log(JSON.stringify(report));
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('smoke test passed');
