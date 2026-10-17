// Economics-tab cost: time one bestRoute (350 evals) for long routes with real stratosphere tables, check on/off.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */
await p.goto('http://localhost:8765/#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man && window.ROUTE, null, { timeout: 60000 });
await p.waitForTimeout(4000);
console.log(await p.evaluate(async () => {
  const MC = window.MC, RT = window.ROUTE, ac = window.AIRCRAFT.find(a => a.id === 'overture');
  const E = { fuel: 1.47, vot: 85, lf: 0.8, margin: MC.marginAt, obj: 'gen' }, out = [];
  for (const [a, bb] of [['KJFK', 'EGLL'], ['KLAX', 'RJTT'], ['OMDB', 'EGLL'], ['KJFK', 'KLAX']]) {
    if (!MC.APT[a] || !MC.APT[bb]) continue;
    const A = [MC.APT[a][3], MC.APT[a][2]], B = [MC.APT[bb][3], MC.APT[bb][2]];
    for (const no of [true, false]) {
      window.__noSsb = no; const f = await RT.makeField(550, MC.S.fi);
      const t0 = performance.now(); const r = RT.bestRoute(f, ac, A, B, 'gen', E, 350);
      out.push(`${a}-${bb} ${no ? 'off' : 'on '} ${Math.round(performance.now() - t0)} ms, slowed ${Math.round(r.dSsb || 0)} nm, block ${r.block.toFixed(3)} h, ssbData ${MC.ssbReady}`);
    }
  }
  return out.join('\n');
}));
await b.close();
