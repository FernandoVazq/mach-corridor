// Margin check: the auto margin must be larger over mountains (Denver) than over low terrain (Kansas) at the same spread.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man, null, { timeout: 60000 });
await p.waitForTimeout(6000);
console.log(await p.evaluate(() => { const M = window.MC; return JSON.stringify({ rockies: [M.elevAt(-106, 39.5), M.marginAt(-106, 39.5, 550, 90)], kansas: [M.elevAt(-98, 38.5), M.marginAt(-98, 38.5, 550, 90)], alps: [M.elevAt(10, 46.5), M.marginAt(10, 46.5, 550, 90)] }); }), errs.join('|'));
await b.close();
