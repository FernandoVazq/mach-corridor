// Route export: plan JFK-LAX, check the stretches, the boom navlog and the ICAO Item 15 string are continuous and cover the route.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */ const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
const r = await p.evaluate(() => { const st = window.MCPLAN.stretches(), d = window.MCPLAN.getRoute().opt.dist; return { n: st.length, first: st[0], last: st.at(-1).to_nm, dist: Math.round(d), gaps: st.slice(1).filter((x, i) => x.from_nm !== st[i].to_nm).length }; });
console.log(JSON.stringify({ n: r.n, first: { type: r.first.type, mach: r.first.mach, eto: r.first.eto, pts: r.first.coords.length }, last: r.last, dist: r.dist, gaps: r.gaps }));
// navlog and ICAO Item 15: continuous, covers the route; Item 15 opens with a speed/level group
const nv = await p.evaluate(() => ({ rows: window.MCPLAN.navRows(), i15: window.MCPLAN.item15() }));
const nGaps = nv.rows.slice(1).filter((x, i) => x.from_nm !== nv.rows[i].to_nm).length;
console.log(JSON.stringify({ navlog_rows: nv.rows.length, item15: nv.i15.slice(0, 60) }));
await b.close();
if (errs.length || r.gaps || Math.abs(r.last - r.dist) > 1 || nGaps || !nv.rows.length || nv.rows.at(-1).to_nm !== r.last || !/^[MN]\d{3,4}F\d{3}( DCT|$)/.test(nv.i15)) { console.error('export test failed', errs.join(' | '), nGaps); process.exit(1); }
console.log('export test passed');
