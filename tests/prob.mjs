// Per-flight exceedance probability: plan a few overland routes; print the KPI text and the flight/leg probabilities.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
for (const r of ['KJFK-KLAX', 'KSEA-KMIA', 'EGLL-OMDB']) {
  await p.goto(`http://localhost:8765/#fl=550&mg=auto&r=${r}&ac=overture&o=time`);
  await p.reload();
  await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 90000 });
  await p.waitForTimeout(800);
  console.log(r, await p.evaluate(() => { const e = window.MCPLAN.evidence(); const legs = e.legs.filter(l => l.p_exceed_011 > 0); return JSON.stringify({ kpi: [...document.querySelectorAll('#routeKpis .kl')].map(x => x.innerText).find(t => /Boom on land/.test(t)), pFlight: e.summary.p_exceed_011_flight, legs: legs.length, maxLeg: Math.max(0, ...legs.map(l => l.p_exceed_011)) }); }));
}
console.log(errs.join('\n')); await b.close();
