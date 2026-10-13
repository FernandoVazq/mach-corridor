// Per-flight exceedance probability: plan a few overland routes; print the KPI text and the flight/leg probabilities.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
const out = [];
for (const r of ['KJFK-KLAX', 'KSEA-KMIA', 'EGLL-OMDB']) {
  await p.goto(`http://localhost:8765/#fl=550&mg=auto&r=${r}&ac=overture&o=time`);
  await p.reload();
  await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
  await p.waitForTimeout(800);
  const res = await p.evaluate(() => { const e = window.MCPLAN.evidence(); const legs = e.legs.filter(l => l.p_exceed_011 > 0); return JSON.stringify({ kpi: [...document.querySelectorAll('#routeKpis .kl')].map(x => x.innerText).find(t => /Boom on land/.test(t)), pFlight: e.summary.p_exceed_011_flight, legs: legs.length, maxLeg: Math.max(0, ...legs.map(l => l.p_exceed_011)) }); });
  console.log(r, res); out.push(JSON.parse(res));
}
await b.close();
const bad = out.filter(o => !(o.pFlight > 0.0005 && o.pFlight < 0.03));
if (errs.length || bad.length) { console.error('probability test failed', JSON.stringify(bad), errs.join(' | ')); process.exit(1); }
console.log('probability test passed');
