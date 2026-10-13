// Route export: plan JFK-LAX, check the stretches are continuous and cover the route.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
const r = await p.evaluate(() => { const st = window.MCPLAN.stretches(), d = window.MCPLAN.getRoute().opt.dist; return { n: st.length, first: st[0], last: st.at(-1).to_nm, dist: Math.round(d), gaps: st.slice(1).filter((x, i) => x.from_nm !== st[i].to_nm).length }; });
console.log(JSON.stringify({ n: r.n, first: { type: r.first.type, mach: r.first.mach, eto: r.first.eto, pts: r.first.coords.length }, last: r.last, dist: r.dist, gaps: r.gaps }));
await b.close();
if (errs.length || r.gaps || Math.abs(r.last - r.dist) > 1) { console.error('export test failed', errs.join(' | ')); process.exit(1); }
console.log('export test passed');
