// API parity: the site's own limit and margin at a point, to compare with engine/client.py.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */
await p.goto('http://localhost:8765/#fl=550&mg=auto');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man, null, { timeout: 60000 });
await p.waitForTimeout(5000);
console.log(await p.evaluate(async () => { const M = window.MC, a = await M.loadAtlas(M.S.man.forecast_hours[0], 550);
  await M.prepareGefs(550, 0);
  return JSON.stringify({ limit: M.mHeadingSafe(a, 270, -98, 39.5), margin: M.marginAt(-98, 39.5, 550, 270, Date.parse(M.S.man.run_time)), elev: M.elevAt(-98, 39.5) }); }));
await b.close();
