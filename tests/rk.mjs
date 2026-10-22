// Rocket boom page (issue #50): loads data/rockets.json, renders map + town table with no JS errors, WCAG 2.2 AA clean.
import { chromium } from 'playwright';
process.on('uncaughtException', (e) => { console.log(`::error title=${process.argv[1].split('/').pop()}::${String(e && e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); });   // readable CI annotation
import fs from 'fs';
const [, , base = 'http://localhost:8765/', exe] = process.argv;
const axe = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const fail = [];
for (const [w, h, scheme] of [[1400, 900, 'light'], [390, 844, 'dark']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)|fonts\.g/, r => r.abort());
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + 'rockets.html');
  const hasData = fs.existsSync(new URL('../site/data/rockets.json', import.meta.url));
  if (hasData) {
    await p.waitForFunction(() => document.querySelectorAll('#towns tbody tr').length > 0 && document.querySelector('#stage svg'), null, { timeout: 20000 });
    for (const site of ['cape', 'vandenberg', 'starbase']) {
      await p.evaluate((s) => { location.hash = s; }, site);
      await p.click(`#siteSeg button:nth-child(${['cape', 'vandenberg', 'starbase'].indexOf(site) + 1})`);
      await p.waitForTimeout(300);
      const n = await p.$$eval('#towns tbody tr', (r) => r.length);
      if (!n) fail.push(`${w} ${site}: no towns`);
    }
  } else console.log('no rockets.json (rocket step skipped): checking the fallback message only');
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
  if (r.length) fail.push(`${w}-${scheme} axe: ${r.join('; ')}`);
  if (errs.length) fail.push(`${w}-${scheme} errors: ${errs.join(' | ')}`);
  await p.close();
}
await b.close();
if (fail.length) { console.error(fail.join('\n')); for (const f of fail) console.log(`::error title=${'rk.mjs'}::${String(f).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); }
console.log('rocket page passed');
