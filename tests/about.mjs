// Project page in the Atlas FJV system (about/ and es/): no JS errors, no horizontal scroll on a phone, WCAG 2.2 AA clean.
import { chromium } from 'playwright';
process.on('uncaughtException', (e) => { console.log(`::error title=about.mjs::${String(e && e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); });
import fs from 'fs';
const [, , base = 'http://localhost:8765/', exe] = process.argv;
const axe = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const fail = [];
const paths = ['about/', 'es/', 'sound.html', 'fireballs.html', 'x59.html', 'blast.html'].concat(fs.existsSync(new URL('../site/routes/index.html', import.meta.url)) ? ['routes/', 'routes/kjfk-klax.html'] : []);
for (const path of paths) for (const [w, h, scheme] of [[1280, 900, 'light'], [390, 844, 'dark']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  await p.route(/fernando-vazquez\.netlify\.app|googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)|fonts\.g/, r => r.abort());
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + path);
  if (path === 'fireballs.html') { await p.waitForTimeout(1500); const ev = await p.$('.ev'); if (ev) { await ev.click(); await p.waitForTimeout(800); } }
  if (path === 'sound.html') { await p.waitForTimeout(1500); const c = await p.$('#map'); const bb = await c.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1500); }
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > w) fail.push(`${path} ${w}: page scrolls sideways (${sw}px)`);
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
  if (r.length) fail.push(`${path} ${w}-${scheme} axe: ${r.join('; ')}`);
  if (errs.length) fail.push(`${path} ${w}-${scheme} errors: ${errs.join(' | ')}`);
  await p.close();
}
await b.close();
if (fail.length) { console.error(fail.join('\n')); for (const f of fail) console.log(`::error title=about.mjs::${String(f).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); }
console.log('project pages passed');
