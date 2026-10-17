// Browser test (layout + core flows). Uses only the mock data ledger in CLAUDE.md.
// Run: npm test   (starts a local server; BROWSERS=chromium,webkit to choose engines)
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { contrast } from '../themes.js';

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
const CI = !!process.env.GITHUB_ACTIONS; // in GitHub Actions, failures also show as annotations on the run
let last = 'start';
const ok = (name, cond, info = '') => { last = name; cond ? pass++ : fail++; if (!cond) { console.log(`FAIL  ${name} ${info}`); if (CI) console.log(`::error::FAIL ${name} ${String(info).slice(0, 300)}`); } };
const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 10000 }).then(() => true, () => false);
// saved AND drawn again: the settings buttons show the new choice only after the app has re-rendered
const lookIs = (p, want) => until(p, (w) => { const l = (window.__cycle.S.data.settings.look) || {};
  return Object.entries(w).every(([k, v]) => { const b = document.querySelector(`[data-act=look-${k}][data-v="${v}"]`); return l[k] === v && !!b && b.getAttribute('aria-pressed') === 'true'; }); }, want);

async function setup(p) {
  await p.click('[data-act=start]');
  await p.fill('input[name=last]', LAST); await p.fill('input[name=usualCycle]', '30');
  await p.check('input[name=ageBand][value="26-41"]'); await p.check('input[name=diet][value=vegetarian]'); await p.check('input[name=accept]');
  await p.click('form[data-form=onboard] button:not(.pw-eye)');
  await p.fill('input[name=p1]', PASS); await p.fill('input[name=p2]', PASS); await p.check('input[name=saved]');
  await p.click('form[data-form=passphrase] button:not(.pw-eye)'); await p.waitForSelector('main.screen', { timeout: 45000 });
  for (const [s, e] of PERIODS) {
    await p.click('[data-tab=history]'); await p.click('[data-act=add-past] >> nth=0');
    await p.fill('#sheet input[name=start]', s); await p.fill('#sheet input[name=end]', e); await p.click('#sheet form button:not(.pw-eye)'); await p.waitForTimeout(150);
  }
}
const metrics = (p) => p.evaluate(() => {
  const m = document.querySelector('main').getBoundingClientRect(); const nav = document.querySelector('.tabs').getBoundingClientRect();
  return { hscroll: document.documentElement.scrollWidth > innerWidth + 1, main: m.width, vw: innerWidth, vh: innerHeight, navLeft: nav.left, navW: nav.width, navTop: nav.top };
});

try {
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
    const ringBlock = await p.evaluate(() => { const e = document.querySelector('.ring-block'); return { shown: getComputedStyle(e).display !== 'none', bottom: e.getBoundingClientRect().bottom }; });
    ok(`${tag} today: ring only on the laptop layout`, ringBlock.shown === (size === 'laptop'), JSON.stringify(ringBlock));
    if (ringBlock.shown) ok(`${tag} today: ring fits on the first screen`, ringBlock.bottom < h, `ring bottom ${ringBlock.bottom}`);
    const hero = await p.evaluate(() => { const e = document.querySelector('.hero'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(document.documentElement);
      return { bottom: r.bottom, right: r.right, text: e.querySelector('.big').textContent, h1: cs.getPropertyValue('--h1').trim(), h2: cs.getPropertyValue('--h2').trim(), comp: !!e.querySelector('.companion svg'), bigRight: e.querySelector('.big').getBoundingClientRect().right, compLeft: e.querySelector('.companion') ? e.querySelector('.companion').getBoundingClientRect().left : 9999 }; });
    ok(`${tag} today: header readout on the first screen`, hero.bottom < h, JSON.stringify(hero));
    ok(`${tag} today: readout text`, /^(\d+ days?|today|now)$/.test(hero.text), hero.text);
    ok(`${tag} today: moon shown, clear of the readout`, hero.comp && hero.bigRight <= hero.compLeft + 2, JSON.stringify(hero));
    ok(`${tag} today: white header text readable (≥4.5:1)`, contrast('#FFFFFF', hero.h1) >= 4.5 && contrast('#FFFFFF', hero.h2) >= 4.5, `${hero.h1} ${hero.h2}`);
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
  await p.fill('form[data-form=unlock] input[name=p]', PASS); await p.click('form[data-form=unlock] button:not(.pw-eye)'); await p.waitForSelector('main.screen', { timeout: 45000 });
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
  await ctx.close();

  // ---- v3: welcome screen, backup start (B6), vault-file detection, preview (I1), look (U2) ----
  {
    const backup = (periods) => JSON.stringify({ app: 'cycle', v: 1, settings: { updatedAt: 1 }, periods: periods.map(([s, e], i) => ({ id: `t${i}`, start: s, end: e, updatedAt: 1 })), days: {}, checkins: {}, acks: {} });
    const file = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c2.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
    const q = await c2.newPage(); await q.clock.install({ time: new Date(NOW) }); q.on('pageerror', (e) => errors.push(`${eng} v3: ${e.message}`));
    await q.goto(BASE);
    ok(`${eng} v3: welcome offers a backup start`, await q.waitForSelector('[data-act=import-start]', { timeout: 45000 }).then(() => true, () => false));
    ok(`${eng} v3: greyed Drive button is explained`, (await q.isDisabled('[data-act=restore-start]')) && /not available in this copy/.test(await q.textContent('.intro')));
    await q.click('[data-act=import-start]');
    await q.setInputFiles('input[data-act=import-pick]', file('notes.json', '{"hello":1}'));
    ok(`${eng} v3: a wrong file is refused`, (await until(q, () => /not a Cycle backup/.test(document.querySelector('#toast').textContent))) && !(await q.isVisible('form[data-form=import-new]')));
    ok(`${eng} v3: the file field is cleared after a refusal (G-3)`, (await q.evaluate(() => document.querySelector('input[data-act=import-pick]').value)) === '');
    await q.setInputFiles('input[data-act=import-pick]', file('b.json', backup(PERIODS))); await q.waitForSelector('form[data-form=import-new]');
    ok(`${eng} v3: preview before anything is stored`, /3 periods, from 24 Jun 2026 to 24 Aug 2026/.test(await q.textContent('.notice')) && (await q.evaluate(() => new Promise((res) => { const r = indexedDB.open('cycle-wellness'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').count(); g.onsuccess = () => res(g.result); }; }))) === 0);
    await q.fill('input[name=p1]', PASS); await q.fill('input[name=p2]', PASS); await q.check('input[name=saved]'); await q.click('form[data-form=import-new] button:not(.pw-eye)');
    await q.waitForSelector('main.screen', { timeout: 45000 });
    ok(`${eng} v3: backup start keeps 3 periods`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 3);
    // Settings import with a Drive vault file: asks for the vault passphrase, then previews
    const vault = await q.evaluate(async (pass) => { const K = await import('./crypto.js'); const C = await import('./cloud.js'); const salt = K.newSalt(); const key = await K.deriveKey(pass, salt);
      return C.sealVault({ app: 'cycle', v: 1, settings: { updatedAt: 1 }, periods: [{ id: 'v1', start: '2026-05-25', end: '2026-05-29', updatedAt: 1 }], days: {}, checkins: {}, acks: {} }, key, salt, K.ITER); }, PASS);
    await q.click('.tabs [data-tab=settings]');
    await q.setInputFiles('input[data-act=import-json]', file('cycle-vault.json', vault)); await q.waitForSelector('#sheet form[data-form=import-open]');
    await q.fill('#sheet input[name=p]', 'wrong-passphrase'); await q.click('#sheet form[data-form=import-open] button:not(.pw-eye)'); await q.waitForTimeout(1500);
    ok(`${eng} v3: vault file with a wrong passphrase stays closed`, await q.isVisible('#sheet form[data-form=import-open]'));
    await q.fill('#sheet input[name=p]', PASS); await q.click('#sheet form[data-form=import-open] button:not(.pw-eye)'); await q.waitForSelector('#sheet [data-act=import-confirm]', { timeout: 45000 });
    ok(`${eng} v3: vault preview`, /1 period, from 25 May 2026 to 25 May 2026/.test(await q.textContent('#sheet')));
    await q.click('#sheet [data-act=import-confirm]');
    ok(`${eng} v3: vault import merged`, await until(q, () => window.__cycle.S.data.periods.length === 4));
    // Encrypted export: not readable, and it comes back through the same import path
    const [dl] = await Promise.all([q.waitForEvent('download'), q.click('[data-act=export-enc]')]);
    const encText = fs.readFileSync(await dl.path(), 'utf8');
    ok(`${eng} v3: encrypted export is not readable`, JSON.parse(encText).app === 'cycle-wellness-vault' && !/2026-0|"periods"/.test(encText) && /\.encrypted\.json$/.test(dl.suggestedFilename()));
    await q.setInputFiles('input[data-act=import-json]', file('enc.json', encText)); await q.waitForSelector('#sheet form[data-form=import-open]');
    await q.fill('#sheet input[name=p]', PASS); await q.click('#sheet form[data-form=import-open] button:not(.pw-eye)'); await q.waitForSelector('#sheet [data-act=import-confirm]', { timeout: 45000 });
    ok(`${eng} v3: encrypted export previews with all 4 periods`, /4 periods/.test(await q.textContent('#sheet')));
    await q.click('#sheet [data-act=import-cancel]');
    await q.setInputFiles('input[data-act=import-json]', file('b.json', backup([['2026-04-25', '2026-04-29']]))); await q.waitForSelector('#sheet [data-act=import-cancel]');
    await q.click('#sheet [data-act=import-cancel]');
    ok(`${eng} v3: cancel imports nothing`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 4);
    // Look: appearance, theme, companion, cards, one-time note
    await q.click('.tabs [data-tab=today]');
    ok(`${eng} v3: companion note shown once`, await q.isVisible('.companion-note'));
    await q.click('[data-act=note-seen]'); ok(`${eng} v3: companion note dismissed`, await until(q, () => !document.querySelector('.companion-note')));
    await q.click('.tabs [data-tab=settings]');
    await q.click('[data-act=look-mode][data-v=dark]'); await lookIs(q, { mode: 'dark' }); await q.click('[data-act=look-theme][data-v=petal]'); await lookIs(q, { mode: 'dark', theme: 'petal' });
    const lk = await q.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { mode: document.documentElement.dataset.mode, bg: cs.getPropertyValue('--bg').trim(), h1: cs.getPropertyValue('--h1').trim(), body: getComputedStyle(document.body).backgroundColor }; });
    ok(`${eng} v3: forced dark with Petal`, lk.mode === 'dark' && lk.bg === '#000000' && lk.h1 === '#8C2E52' && lk.body === 'rgb(0, 0, 0)', JSON.stringify(lk));
    await q.click('[data-act=look-companion][data-v=sprout]'); await lookIs(q, { companion: 'sprout' }); await q.click('.tabs [data-tab=today]');
    ok(`${eng} v3: sprout companion`, (await q.getAttribute('.companion', 'data-stage')).startsWith('sprout-'));
    await q.click('.tabs [data-tab=settings]'); await q.click('[data-act=look-companion][data-v=off]'); await lookIs(q, { companion: 'off' }); await q.click('label.switch:has([data-k=week]) input'); await until(q, () => window.__cycle.S.data.settings.look.cards.week === false); await q.click('label.switch:has([data-k=food]) input'); await until(q, () => window.__cycle.S.data.settings.look.cards.food === false);
    await q.click('.tabs [data-tab=today]');
    ok(`${eng} v3: companion off and cards hidden`, !(await q.isVisible('.companion')) && !(await q.isVisible('.week')) && !(await q.isVisible('.food-teaser')));
    ok(`${eng} v3: look is stored in the encrypted data`, (await q.evaluate(() => window.__cycle.S.data.settings.look.theme)) === 'petal');
    const sealed2 = await q.evaluate(() => new Promise((res) => { const r = indexedDB.open('cycle-wellness'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('sealed'); g.onsuccess = () => res(JSON.stringify(g.result)); }; }));
    ok(`${eng} v3: look and imported data are not stored in clear text`, !/petal|sprout|2026-0/.test(sealed2));
    await c2.close();
  }
  await browser.close();
}
} catch (e) {
  // a crash (for example a timeout) names the last check that ran, so it can be read on GitHub
  fail++; console.log(`CRASH after "${last}": ${e.message}`);
  if (CI) console.log(`::error::CRASH after "${last}": ${String(e.message).split('\n').slice(0, 3).join(' | ').slice(0, 500)}`);
}
server.close();
if (errors.length) { fail += errors.length; console.log('PAGE ERRORS', errors); if (CI) for (const e of errors) console.log(`::error::PAGE ERROR ${e.slice(0, 300)}`); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
