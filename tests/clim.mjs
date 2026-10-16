// Climatology section: open the Physics tab, pick FL550 Dec-Feb, screenshot the figure and table.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: process.argv[3] || 'light' }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/gibs\.earthdata\.nasa\.gov|googlesyndication|doubleclick|google\.com\/(pagead|adsense)|adtrafficquality/.test((m.location() || {}).url || '')) errs.push(m.text()); });
await p.goto('http://localhost:8765/#fl=550');
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man, null, { timeout: 60000 });
await p.click('button[data-tab="physics"]'); await p.waitForTimeout(2500);
await p.click('#clSeason button[data-v="Dec-Feb"]'); await p.waitForTimeout(800);
const el = await p.$('.climfig'); await el.scrollIntoViewIfNeeded(); if (process.argv[2]) await el.screenshot({ path: process.argv[2] });
const t = await p.evaluate(() => document.getElementById('clTable').innerText); console.log(t);
await b.close();
const real = errs.filter(e => !/ERR_TUNNEL|ERR_NAME|fonts\.g/.test(e));
if (real.length || t.trim().split('\n').length < 8) { console.error('climatology test failed', real.join(' | ')); process.exit(1); }
console.log('climatology test passed');
