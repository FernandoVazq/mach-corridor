// Fail-closed and evidence-file check: plan on the local (old) data, corridors must be off, then on in study mode. Usage: node evid.mjs
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 60000 });
const sum = async () => p.evaluate(() => { const e = window.MCPLAN.evidence(); return { txt: document.getElementById('routeSummary').innerText.slice(0, 400), sum: e.summary, checks: e.checks.map(c => c.id + ':' + c.pass), leg: e.legs[40] }; });
console.log(JSON.stringify(await sum(), null, 1));
await p.click('#staleBtn');
await p.waitForFunction(() => /Back to fail-closed/.test(document.getElementById('routeSummary')?.innerText || ''), null, { timeout: 60000 });
await p.waitForTimeout(1500);
console.log(JSON.stringify(await sum(), null, 1));
console.log(errs.join('\n'));
await b.close();
