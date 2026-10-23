// Cover / hero capture for the Atlas FJV hub: the live map at FL550 (any direction), controls hidden, legend kept.
// Usage: copy into tests/ (where playwright is installed), serve site/ on :8767, then: node cover_shot.mjs '#fl=550&d=min' /path/cover_raw.png
// then crop the dark bands and save 1200x750 cover.webp and 1600x1000 img/hero-map.webp (see tools/project_page.py header).
import { chromium } from 'playwright';
const [, , hash = '#fl=550&d=min', out = 'cover_raw.png', W = '1200', H = '750'] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: +W + 400, height: +H + 52 }, colorScheme: 'light', deviceScaleFactor: 2 });
await p.route(/googlesyndication|gibs\.earthdata/, r => r.abort());
await p.goto('http://localhost:8767/' + hash);
await p.waitForFunction(() => window.MC && window.MC.S && window.MC.S.man, null, { timeout: 60000 });
await p.addStyleTag({ content: '#mapControls,#lens,.timeline,#routeMode,#hint,#layersToggle{display:none!important} #legend{bottom:48px!important;left:66px!important}' });
await p.waitForTimeout(7000);
await p.screenshot({ path: out, clip: { x: 0, y: 52, width: +W, height: +H } });
await b.close();
