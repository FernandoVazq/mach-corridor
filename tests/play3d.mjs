// Regression check for the 3D route view: play a route twice, the position must stay finite. Usage: node play3d.mjs <shot.png> [ROUTE]
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1580, height: 1080 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGE ' + e.message));
await p.goto('http://localhost:8765/#fl=350&r=' + (process.argv[3] || 'KJFK-KBOS') + '&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 60000 });
const labels = [];
for (let k = 0; k < 2; k++) {
  await p.click('#fly3d'); await p.waitForTimeout(2500);
  await p.click('#c3Play');
  for (let j = 0; j < 4; j++) { await p.waitForTimeout(2500); labels.push(await p.evaluate(() => document.getElementById('c3PosLbl').textContent + ' | x=' + document.getElementById('c3Pos').value + ' fps-ish=' + (window.__perf.dyn.length))); }
  if (k < 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
}
await p.screenshot({ path: process.argv[2] || 'shot.png' });
console.log(labels.join('\n')); console.log(errs.join('\n'));
await b.close();
if (labels.some(l => /NaN/.test(l))) { console.error('NaN in position'); process.exit(1); }
