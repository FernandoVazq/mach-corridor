// Cost of the forward-reach and turn rules (issue #44): block time and slowed distance per route, rules off vs on.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */
await p.goto('http://localhost:8765/#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man && window.ROUTE, null, { timeout: 60000 });
await p.waitForTimeout(4000);
console.log(await p.evaluate(async () => {
  const MC = window.MC, RT = window.ROUTE, ac = window.AIRCRAFT.find(a => a.id === 'overture');
  const E = { fuel: 1.47, vot: 85, lf: 0.8, margin: MC.marginAt, obj: 'time' }, out = [];
  const pairs = [['KJFK', 'EGLL'], ['KLAX', 'RJTT'], ['KSFO', 'PHNL'], ['KMIA', 'SBGR'], ['EGLL', 'OMDB'], ['KJFK', 'KLAX'], ['KSEA', 'KJFK']];
  for (const [a, bb] of pairs) {
    if (!MC.APT[a] || !MC.APT[bb]) { out.push(`${a}-${bb} missing`); continue; }
    const A = [MC.APT[a][3], MC.APT[a][2]], B = [MC.APT[bb][3], MC.APT[bb][2]], row = [];
    for (const off of [true, false]) {
      window.__noReach = off; window.__noTurn = off; const f = await RT.makeField(550, MC.S.fi);
      const r = RT.bestRoute(f, ac, A, B, 'time', E, 500);
      row.push({ block: r.block * 60, reach: r.dReach || 0, turn: r.segs.filter(s => s.turn).reduce((x, s) => x + s.d, 0) });
    }
    out.push(`${a}-${bb}: +${(row[1].block - row[0].block).toFixed(1)} min, approach-slowed ${Math.round(row[1].reach)} nm, turn legs ${Math.round(row[1].turn)} nm`);
  }
  return out.join('\n');
}));
await b.close();
