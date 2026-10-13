// Fail-closed and evidence-file check: plan on the local (old) data, corridors must be off, then on in study mode. Usage: node evid.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { const n = Date.now; Date.now = () => n() + 2 * 86400e3; });   // pretend the data is 2 days old
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 60000 });
const sum = async () => p.evaluate(() => { const e = window.MCPLAN.evidence(); return { txt: document.getElementById('routeSummary').innerText.slice(0, 400), sum: e.summary, checks: e.checks.map(c => c.id + ':' + c.pass), leg: e.legs[40] }; });
const a = await sum(); console.log(JSON.stringify(a.sum));
const fail = [];
if (a.sum.boomless_nm !== 0) fail.push('stale data: corridors not switched off');
if (!a.checks.includes('forecast_fresh:false')) fail.push('stale data: forecast_fresh check not false');
await p.click('#staleBtn');
await p.waitForFunction(() => /Back to fail-closed/.test(document.getElementById('routeSummary')?.innerText || ''), null, { timeout: 60000 });
await p.waitForTimeout(1500);
const c = await sum(); console.log(JSON.stringify(c.sum));
if (!(c.sum.boomless_nm > 0)) fail.push('study mode: no corridors');
if (!c.checks.includes('study_mode_off:false')) fail.push('study mode not recorded');
const signed = await p.evaluate(() => window.MCPLAN.evidenceSigned());
const { integrity, ...rest } = signed;
const recomputed = (await import('crypto')).createHash('sha256').update(JSON.stringify(rest)).digest('hex');
if (!integrity || integrity.value !== recomputed) fail.push(`integrity hash mismatch: ${integrity && integrity.value} vs ${recomputed}`);
if (!rest.model_version) fail.push('no model_version in evidence');
if (!(typeof rest.summary.max_pldb_on_land === 'number' && rest.summary.max_pldb_on_land <= 75)) fail.push('evidence: boomless loudness missing or above 75 PLdB: ' + rest.summary.max_pldb_on_land);
if (!rest.legs.some(l => l.type === 'boomless' && typeof l.pldb_ground === 'number')) fail.push('evidence: no per-leg PLdB');
if (errs.length) fail.push('page errors: ' + errs.join(' | '));
await b.close();
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('evidence test passed');
