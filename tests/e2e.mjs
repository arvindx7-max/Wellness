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

  // ---- v3.1: flexible import (B7: PDF, CSV, pasted text, review list) and the clearer restore screen (B8) ----
  {
    const pdfBytes = (lines) => {
      const stream = `BT /F1 12 Tf 14 TL 50 780 Td ${lines.map((l) => `(${l.replace(/[\\()]/g, '')}) Tj T*`).join(' ')} ET`;
      const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
      let out = '%PDF-1.4\n'; const off = [];
      objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const x = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
      return Buffer.from(out, 'latin1');
    };
    const upload = (name, mimeType, buffer) => ({ name, mimeType, buffer });
    const rowsOf = (p, sel) => p.evaluate((s2) => [...document.querySelectorAll(`${s2} .irow`)].map((r) => [r.querySelector('input[data-act=row-start]').value, r.querySelector('input[data-act=row-end]').value].join('>')), sel);
    const toastText = (p) => p.evaluate(() => document.querySelector('#toast').textContent);

    // B8: restore screen on a first start
    const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c3.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:'test-client-id.apps.googleusercontent.com'};" }));
    const r3 = await c3.newPage(); await r3.clock.install({ time: new Date(NOW) }); r3.on('pageerror', (e) => errors.push(`${eng} v3.1: ${e.message}`));
    await r3.goto(BASE); await r3.waitForSelector('[data-act=restore-start]:not([disabled])', { timeout: 45000 });
    await r3.click('[data-act=restore-start]');
    await r3.evaluate(() => { window.__cycle.S.restore = { token: 'dummy_token_A' }; window.__cycle.render(); });
    ok(`${eng} v3.1: no-vault screen explains why`, /No Cycle vault was found/.test(await r3.textContent('.intro')) && /only after Cycle sync has been turned on/.test(await r3.textContent('.intro')));
    ok(`${eng} v3.1: no-vault screen gives four numbered steps`, (await r3.locator('ol.steps li').count()) === 4);
    ok(`${eng} v3.1: no-vault screen offers set up and backup start`, (await r3.isVisible('.intro [data-act=start]')) && (await r3.isVisible('.intro [data-act=import-start]')));
    await r3.click('.intro [data-act=start]');
    ok(`${eng} v3.1: Set up on this phone starts the questions`, await r3.waitForSelector('form[data-form=onboard]', { timeout: 10000 }).then(() => true, () => false));
    await c3.close();

    // B7 at start-up: paste, review list, edit, continue
    const c4 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c4.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
    const q = await c4.newPage(); await q.clock.install({ time: new Date(NOW) }); q.on('pageerror', (e) => errors.push(`${eng} v3.1: ${e.message}`));
    const seen = []; q.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') seen.push(m.text().slice(0, 160)); }); q.on('requestfailed', (r) => seen.push(`request failed ${r.url().slice(-40)}`)); q.on('worker', () => seen.push('worker started'));
    await q.goto(BASE); await q.waitForSelector('[data-act=import-start]', { timeout: 45000 }); await q.click('[data-act=import-start]');
    const accept = await q.getAttribute('input[data-act=import-pick]', 'accept');
    ok(`${eng} v3.1: the file picker also offers PDF, CSV and text`, /pdf/.test(accept) && /csv/.test(accept) && /txt/.test(accept) && /json/.test(accept), accept);
    ok(`${eng} v3.1: picker screen has numbered steps`, (await q.locator('ol.steps li').count()) >= 6);
    await q.fill('textarea[name=text]', 'hello'); await q.click('form[data-form=import-paste] button');
    ok(`${eng} v3.1: text without dates is refused with a next step`, (await until(q, () => /No period dates were found/.test(document.querySelector('#toast').textContent))) && !(await q.isVisible('.irow')));
    await q.fill('textarea[name=text]', '2026-06-24 to 2026-06-28\n2026-07-25 to 2026-07-29\nExported 2026-10-01\n2026-08-24 - 2026-08-28\nOvulation 2026-07-08');
    await q.click('form[data-form=import-paste] button');
    await q.waitForSelector('.irow');
    ok(`${eng} v3.1: pasted dates become a list, exported and ovulation lines left out`, (await rowsOf(q, '.intro')).join() === '2026-06-24>2026-06-28,2026-07-25>2026-07-29,2026-08-24>2026-08-28');
    ok(`${eng} v3.1: nothing stored while checking`, (await q.evaluate(() => new Promise((res) => { const r = indexedDB.open('cycle-wellness'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').count(); g.onsuccess = () => res(g.result); }; }))) === 0);
    await q.click('[data-act=row-del][data-i="1"]');
    ok(`${eng} v3.1: a row can be removed`, (await q.locator('.irow').count()) === 2);
    await q.click('[data-act=row-add]'); await q.locator('.irow input[data-act=row-start]').nth(2).fill('2026-05-25');
    await q.locator('.irow input[data-act=row-end]').nth(2).fill('2026-05-20'); await q.click('[data-act=review-continue]');
    ok(`${eng} v3.1: an end before the start is refused`, (await until(q, () => /before its start/.test(document.querySelector('#toast').textContent))) && !(await q.isVisible('form[data-form=import-new]')));
    await q.locator('.irow input[data-act=row-end]').nth(2).fill('2026-05-29'); await q.click('[data-act=review-continue]');
    await q.waitForSelector('form[data-form=import-new]');
    ok(`${eng} v3.1: checked list goes on to the passphrase step`, /3 periods, from 25 May 2026 to 24 Aug 2026/.test(await q.textContent('.notice')));
    await q.fill('input[name=p1]', PASS); await q.fill('input[name=p2]', PASS); await q.check('input[name=saved]'); await q.click('form[data-form=import-new] button:not(.pw-eye)');
    await q.waitForSelector('main.screen', { timeout: 45000 });
    ok(`${eng} v3.1: pasted start keeps 3 periods`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 3);

    // B7 in Settings: PDF, CSV, scan, month/day choice, paste
    await q.click('[data-tab=settings]');
    ok(`${eng} v3.1: Settings import also offers PDF and has a Paste dates button`, /pdf/.test(await q.getAttribute('input[data-act=import-json]', 'accept')) && (await q.isVisible('[data-act=paste-open]')));
    await q.setInputFiles('input[data-act=import-json]', upload('report.pdf', 'application/pdf', pdfBytes(['Cycle report', 'Period history', '29 Jun 2026 - 02 Jul 2026', '25 May 2026 - 29 May 2026', '25 Jun 2026', 'Ovulation 12 Jul 2026'])));
    const pdfRead = await q.waitForSelector('#sheet .irow', { timeout: 30000 }).then(() => true, () => false);
    ok(`${eng} v3.1: a PDF is read on the device`, pdfRead, `toast: ${await toastText(q)} | console: ${seen.slice(-6).join(' | ')}`);
    ok(`${eng} v3.1: PDF rows are found in order`, (await rowsOf(q, '#sheet')).join() === '2026-05-25>2026-05-29,2026-06-25>,2026-06-29>2026-07-02', (await rowsOf(q, '#sheet')).join());
    await q.click('#sheet [data-act=review-continue]');
    await q.waitForSelector('#sheet [data-act=import-confirm]');
    ok(`${eng} v3.1: periods already in Cycle are left out`, /1 period, from 29 Jun 2026/.test(await q.textContent('#sheet')) && /2 periods already in Cycle/.test(await q.textContent('#sheet')), await q.textContent('#sheet'));
    await q.click('#sheet [data-act=import-confirm]');
    ok(`${eng} v3.1: PDF import merged`, await until(q, () => window.__cycle.S.data.periods.length === 4));
    await q.setInputFiles('input[data-act=import-json]', upload('scan.pdf', 'application/pdf', pdfBytes([])));
    ok(`${eng} v3.1: a PDF without text is refused`, await until(q, () => /no readable text/.test(document.querySelector('#toast').textContent)));
    await q.setInputFiles('input[data-act=import-json]', upload('periods.csv', 'text/csv', Buffer.from('start,end\n2026-04-25,2026-04-29\n')));
    await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: a CSV is read`, (await rowsOf(q, '#sheet')).join() === '2026-04-25>2026-04-29');
    await q.click('#sheet [data-act=import-reset]');
    ok(`${eng} v3.1: cancel leaves the data as it was`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 4 && !(await q.isVisible('#sheet .irow')));
    await q.click('[data-act=paste-open]'); await q.fill('#sheet textarea[name=text]', '05/06/2026'); await q.click('#sheet form[data-form=import-paste] button');
    await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: day/month is assumed and the other reading is offered`, (await rowsOf(q, '#sheet')).join() === '2026-06-05>' && (await q.isVisible('#sheet [data-act=import-order]')));
    await q.click('#sheet [data-act=import-order]'); await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: switching to month/day rereads the list`, (await rowsOf(q, '#sheet')).join() === '2026-05-06>');
    await q.click('#sheet [data-act=import-reset]');
    await c4.close();
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
