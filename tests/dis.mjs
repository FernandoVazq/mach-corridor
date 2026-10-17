// Two-model check (model 2.9, issue #9): with a second model the run line names it, the "Model disagreement" layer
// draws, the inspector says how far GFS and ECMWF are apart and the evidence file carries it per boomless leg.
// Without one (IFS missing), the toggle stays hidden and the run line says GFS only. Usage: node dis.mjs [screenshot.png]
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); await p.route(/googlesyndication|doubleclick|adtrafficquality|adservice\.google|google\.com\/(pagead|adsense)/, r => r.abort()); /* adBlock: Google ad scripts are third-party and absent on localhost */
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#fl=550&mg=auto&r=KJFK-KLAX&ac=overture&o=time');
await p.waitForFunction(() => /psf/.test(document.getElementById('routeKpis')?.innerText || ''), null, { timeout: 60000 });
const fail = [];
const st = await p.evaluate(() => ({ models: window.MC.S.man.models || null, run: document.getElementById('runInfo').innerText,
  hidden: document.getElementById('disWrap').hidden }));
console.log(JSON.stringify({ ifs: st.models && st.models.ifs, lag: st.models && st.models.ifs_lag_h, note: st.models && st.models.ifs_note, run: st.run }));
if (st.models && st.models.ifs) {
  if (st.hidden) fail.push('disagreement toggle hidden although IFS is in the build');
  if (!/ECMWF/.test(st.run)) fail.push('run line does not name ECMWF');
  const d = await p.evaluate(async () => {
    const out = [];
    for (const [lon, lat] of [[-98, 39.5], [10, 50], [-105, 40], [135, -25]]) out.push(await window.MC.disagreementAt(lon, lat));
    return out;
  });
  console.log(JSON.stringify(d));
  if (!d.every(x => x && (x.none || x.one || (x.d >= 0 && x.d < 0.127)))) fail.push('disagreement lookup failed: ' + JSON.stringify(d));
  await p.evaluate(() => { document.getElementById('disShow').click(); });
  await p.waitForFunction(() => /Hatching/.test(document.getElementById('legendNote')?.innerText || ''), null, { timeout: 15000 }).catch(() => fail.push('legend does not explain the hatching'));
  const ev = await p.evaluate(async () => { const e = await window.MCPLAN.evidenceSigned(); return { data: e.data, legs: e.legs.filter(l => l.type === 'boomless').map(l => l.models_disagree) }; });
  console.log(JSON.stringify({ ifs_run: ev.data.ifs_run, combine: ev.data.combine, boomless: ev.legs.length, sample: ev.legs.slice(0, 6) }));
  if (ev.data.ifs_run !== st.models.ifs) fail.push('evidence lacks the IFS run');
  if (ev.legs.length && ev.legs.every(x => x == null)) fail.push('evidence: no per-leg disagreement on boomless legs');
  await p.evaluate(() => { window.MC.S.sel = [-98, 39.5]; });
  await p.mouse.click(700, 450);
  await p.waitForSelector('#inspDis', { timeout: 15000 }).catch(() => fail.push('inspector has no GFS vs ECMWF line'));
} else {
  if (!st.hidden) fail.push('disagreement toggle shown without a second model');
  if (/ECMWF/.test(st.run)) fail.push('run line names ECMWF without a second model');
}
if (process.argv[2]) await p.screenshot({ path: process.argv[2] });
if (errs.length) fail.push('page errors: ' + errs.join(' | '));
await b.close();
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('two-model test passed');
