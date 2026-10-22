// Cockpit view: plan JFK-LAX, open the cockpit view at 600 nm, screenshot; fail on page errors or empty tiles.
import { chromium } from 'playwright';
process.on('uncaughtException', (e) => { console.log(`::error title=${process.argv[1].split('/').pop()}::${String(e && e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); });   // readable CI annotation
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: process.argv[3] || 'dark' }); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */ const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
await p.click('#efbBtn'); await p.waitForTimeout(500);
await p.evaluate(() => { const e = document.getElementById('efbPos'); e.value = 600; e.dispatchEvent(new Event('input')); });
await p.waitForTimeout(500);
const tiles = await p.evaluate(() => document.getElementById('efbTiles').innerText);
const fs = await import('fs');
await p.addScriptTag({ content: fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8') });
const ax = await p.evaluate(async () => (await axe.run(document.getElementById('efb'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
if (ax.length) errs.push('axe: ' + ax.join('; '));
console.log(tiles.replace(/\n/g, ' | ')); console.log(await p.evaluate(() => document.getElementById('efbNext').innerText));
if (process.argv[2]) await (await p.$('#efb')).screenshot({ path: process.argv[2] });
await b.close();
if (errs.length || !/M\d\.\d{3}/.test(tiles)) { console.error('cockpit test failed', errs.join(' | ')); process.exit(1); }
console.log('cockpit test passed');
