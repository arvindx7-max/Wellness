// Browser test (layout + core flows). Uses only the mock data ledger in CLAUDE.md.
// Run: npm test   (starts a local server; BROWSERS=chromium,webkit to choose engines)
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

// Mock data ledger
const PASS = 'test-passphrase-only';
const PERIODS = [['2026-06-24', '2026-06-28'], ['2026-07-25', '2026-07-29'], ['2026-08-24', '2026-08-28']];
const LAST = '2026-09-23', NOW = '2026-10-03T10:00:00';
const LINE = { name: 'Test Support Line', number: '+00 000 000' };

const SIZES = { phone: [390, 844], 'phone-landscape': [844, 390], laptop: [1470, 956] };
const ENGINES = { chromium, webkit };
const want = (process.env.BROWSERS || 'chromium').split(',');
let pass = 0, fail = 0; const errors = [];
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; if (!cond) console.log(`FAIL  ${name} ${info}`); };

async function setup(p) {
  await p.click('[data-act=start]');
  await p.fill('input[name=last]', LAST); await p.fill('input[name=usualCycle]', '30');
  await p.check('input[name=ageBand][value="26-41"]'); await p.check('input[name=diet][value=vegetarian]'); await p.check('input[name=accept]');
  await p.click('form[data-form=onboard] button:not(.pw-eye)');
  await p.fill('input[name=p1]', PASS); await p.fill('input[name=p2]', PASS); await p.check('input[name=saved]');
  await p.click('form[data-form=passphrase] button:not(.pw-eye)'); await p.waitForSelector('main.screen', { timeout: 15000 });
  for (const [s, e] of PERIODS) {
    await p.click('[data-tab=history]'); await p.click('[data-act=add-past] >> nth=0');
    await p.fill('#sheet input[name=start]', s); await p.fill('#sheet input[name=end]', e); await p.click('#sheet form button:not(.pw-eye)'); await p.waitForTimeout(150);
  }
}
const metrics = (p) => p.evaluate(() => {
  const m = document.querySelector('main').getBoundingClientRect(); const nav = document.querySelector('.tabs').getBoundingClientRect();
  return { hscroll: document.documentElement.scrollWidth > innerWidth + 1, main: m.width, vw: innerWidth, vh: innerHeight, navLeft: nav.left, navW: nav.width, navTop: nav.top };
});

for (const eng of want) {
  const browser = await ENGINES[eng].launch();
  for (const [size, [w, h]] of Object.entries(SIZES)) for (const scheme of ['light', 'dark']) {
    const tag = `${eng} ${size} ${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, serviceWorkers: 'block' });
    await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
    const p = await ctx.newPage(); await p.clock.install({ time: new Date(NOW) });
    p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    await p.goto(BASE); await setup(p);
    for (const tab of ['today', 'calendar', 'food', 'history', 'settings']) {
      await p.click(`.tabs [data-tab=${tab}]`); await p.waitForTimeout(120);
      const m = await metrics(p);
      ok(`${tag} ${tab}: no sideways scrolling`, !m.hscroll);
      if (size === 'laptop') {
        ok(`${tag} ${tab}: sidebar on the left`, m.navLeft === 0 && m.navTop === 0 && m.navW < 300, JSON.stringify(m));
        ok(`${tag} ${tab}: content uses ≥80% of the usable width`, m.main >= 0.8 * Math.min(m.vw - m.navW, 1200), JSON.stringify(m));
      } else ok(`${tag} ${tab}: tab bar at the bottom`, m.navTop > m.vh - 120, JSON.stringify(m));
      if (scheme === 'light' || tab === 'today') await p.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-${tab}.png`) });
    }
    // Today: in landscape the ring must leave room for other content
    await p.click('.tabs [data-tab=today]');
    const ring = await p.evaluate(() => document.querySelector('.ring-block').getBoundingClientRect().bottom);
    ok(`${tag} today: ring fits on the first screen`, ring < h, `ring bottom ${ring}`);
    // Food: three cards side by side on a laptop, one on a phone; vegetarian hides meat and fish
    await p.click('.tabs [data-tab=food]');
    const cards = await p.evaluate(() => [...document.querySelectorAll('.food-card')].filter((c) => getComputedStyle(c).display !== 'none').length);
    ok(`${tag} food: visible cards`, cards === (size === 'laptop' ? 3 : 1), `got ${cards}`);
    const food = await p.textContent('.food-grid');
    ok(`${tag} food: vegetarian filter`, !/Beef|Chicken|Oysters/.test(food) && /Lentils/.test(food));
    // Sheet: centred dialog on a laptop, bottom sheet on a phone
    await p.click('.tabs [data-tab=history]'); await p.click('[data-act=add-past] >> nth=0'); await p.waitForTimeout(450); // let the slide-in finish
    const sh = await p.evaluate(() => { const r = document.querySelector('.sheet-card').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    ok(`${tag} sheet position`, size === 'laptop' ? sh.top > 20 && sh.bottom < h - 20 : Math.abs(sh.bottom - h) < 2, JSON.stringify(sh));
    await p.click('#sheet .btn.wide[data-act=close-sheet]');
    await ctx.close();
  }
  // Core flows once per engine (phone size)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
  const p = await ctx.newPage(); await p.clock.install({ time: new Date(NOW) }); p.on('pageerror', (e) => errors.push(`${eng} flows: ${e.message}`));
  await p.goto(BASE); await setup(p);
  const st = await p.evaluate(() => window.__cycle.S.pred);
  ok(`${eng} flows: 3 past periods give Medium confidence`, st.confidence === 'Medium', st.confidence);
  await p.click('.tabs [data-tab=settings]'); await p.click('[data-act=lock-now]');
  await p.fill('form[data-form=unlock] input[name=p]', 'wrong-passphrase'); await p.click('form[data-form=unlock] button:not(.pw-eye)'); await p.waitForTimeout(1500);
  ok(`${eng} flows: wrong passphrase stays locked`, (await p.evaluate(() => window.__cycle.S.view)) === 'locked');
  await p.fill('form[data-form=unlock] input[name=p]', PASS); await p.click('form[data-form=unlock] button:not(.pw-eye)'); await p.waitForSelector('main.screen', { timeout: 15000 });
  await p.click('.tabs [data-tab=settings]'); await p.fill('form[data-form=helpline] input[name=name]', LINE.name); await p.fill('form[data-form=helpline] input[name=number]', LINE.number);
  await p.click('form[data-form=helpline] button'); await p.waitForTimeout(200);
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    await p.click('.tabs [data-tab=calendar]'); await p.click(`[data-date="${d}"]`); await p.click('#sheet [data-act=checkin]');
    if (!(await p.isVisible('#sheet input[name=s_low][value="3"] + span'))) await p.click('#sheet summary');
    await p.click('#sheet input[name=s_low][value="3"] + span'); await p.click('#sheet form button.primary'); await p.waitForTimeout(150);
  }
  await p.click('.tabs [data-tab=today]');
  ok(`${eng} flows: low-mood card calls the saved line`, (await p.getAttribute('.flag.support a.btn', 'href')) === 'tel:+00000000');
  const sealed = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('cycle-wellness'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('sealed'); g.onsuccess = () => res(JSON.stringify(g.result)); }; }));
  ok(`${eng} flows: stored data is encrypted`, !/2026-0|Test Support Line|vegetarian/.test(sealed));
  await ctx.close(); await browser.close();
}
server.close();
if (errors.length) { fail += errors.length; console.log('PAGE ERRORS', errors); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
