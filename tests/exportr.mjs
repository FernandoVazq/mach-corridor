// Route export: plan JFK-LAX, check the stretches, the boom navlog and the ICAO Item 15 string are continuous and cover the route.
import { chromium } from 'playwright';
process.on('uncaughtException', (e) => { console.log(`::error title=${process.argv[1].split('/').pop()}::${String(e && e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 900)}`); process.exit(1); });   // readable CI annotation
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage(); await p.route(/fernando-vazquez\.netlify\.app|googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */ const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
const r = await p.evaluate(() => { const st = window.MCPLAN.stretches(), d = window.MCPLAN.getRoute().opt.dist; return { n: st.length, first: st[0], last: st.at(-1).to_nm, dist: Math.round(d), gaps: st.slice(1).filter((x, i) => x.from_nm !== st[i].to_nm).length }; });
console.log(JSON.stringify({ n: r.n, first: { type: r.first.type, mach: r.first.mach, eto: r.first.eto, pts: r.first.coords.length }, last: r.last, dist: r.dist, gaps: r.gaps }));
// navlog and ICAO Item 15: continuous, covers the route; Item 15 opens with a speed/level group
const nv = await p.evaluate(() => ({ rows: window.MCPLAN.navRows(), i15: window.MCPLAN.item15() }));
const nGaps = nv.rows.slice(1).filter((x, i) => x.from_nm !== nv.rows[i].to_nm).length;
console.log(JSON.stringify({ navlog_rows: nv.rows.length, item15: nv.i15.slice(0, 60) }));
// flight simulator files: well-formed MSFS XML with airports at both ends, X-Plane v1100 with NUMENR matching
const sim = await p.evaluate(() => { const f = window.MCPLAN.simFiles(); const x = new DOMParser().parseFromString(f.pln, 'application/xml');
  const wps = [...x.querySelectorAll('ATCWaypoint')]; const lines = f.fms.trim().split('\n');
  return { err: !!x.querySelector('parsererror'), n: wps.length, first: wps[0]?.getAttribute('id'), last: wps.at(-1)?.getAttribute('id'), alt: x.querySelector('CruisingAlt')?.textContent,
           pos: wps[1]?.querySelector('WorldPosition')?.textContent, numenr: +lines[5].split(' ')[1], enr: lines.length - 6, head: lines[1] }; });
console.log(JSON.stringify(sim));
const simBad = sim.err || sim.first !== 'KJFK' || sim.last !== 'KLAX' || sim.alt !== '55000' || sim.n < 3 || sim.numenr !== sim.enr || sim.head !== '1100 Version' || !/^[NS]\d+° \d+' [\d.]+",[EW]\d+° \d+' [\d.]+",\+\d{6}\.\d{2}$/.test(sim.pos || '');
await b.close();
if (simBad) { console.error('flight sim export failed'); process.exit(1); }
if (errs.length || r.gaps || Math.abs(r.last - r.dist) > 1 || nGaps || !nv.rows.length || nv.rows.at(-1).to_nm !== r.last || !/^[MN]\d{3,4}F\d{3}( DCT|$)/.test(nv.i15)) { console.error('export test failed', errs.join(' | '), nGaps); process.exit(1); }
console.log('export test passed');
