// Optimiser benchmark: time bestRoute KJFK-EGLL with the secondary-boom check off and on. Usage: node bench.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
await p.goto('http://localhost:8765/#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man && window.ROUTE, null, { timeout: 60000 });
await p.waitForTimeout(4000);
console.log(await p.evaluate(async () => {
  const MC = window.MC, RT = window.ROUTE, ac = window.AIRCRAFT.find(a => a.id === 'overture'); MC.S.allowStale = true;
  const A = [MC.APT.KJFK[3], MC.APT.KJFK[2]], B = [MC.APT.EGLL[3], MC.APT.EGLL[2]];
  const E = { fuel: 1.47, vot: 85, lf: 0.8, margin: MC.marginAt, obj: 'time' };
  const out = [];
  for (const no of [true, false, true, false]) {
    window.__noSsb = no; const f = await RT.makeField(550, MC.S.fi);
    const t0 = performance.now(); const r = RT.bestRoute(f, ac, A, B, 'time', E); out.push(`${no ? 'off' : 'on '} ${Math.round(performance.now() - t0)} ms, slowed ${Math.round(r.dSsb || 0)} nm, block ${r.block.toFixed(3)} h`);
  }
  return out.join('\n');
}));
await b.close();
