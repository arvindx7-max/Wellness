// Browser test (layout + core flows). Uses only the mock data ledger in CLAUDE.md.
// Run: npm test   (starts a local server; BROWSERS=chromium,webkit to choose engines)
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { contrast } from '../themes.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.woff': 'font/woff', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

// CI fix: a slow start-up is tried once more on a clean page before it counts as a failure (WebKit on shared runners)
// v4: Settings is a list of pages
async function goSet(p, page) { await p.click('.tabs [data-tab=settings]'); await p.click(`[data-act=set-page][data-v=${page}]`); }
async function setup(p) {
  try { await setupOnce(p); } catch (e) {
    if (!/Timeout/.test(String(e.message))) throw e;
    await p.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('cycle-wellness'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
    await p.goto(BASE);
    try { await setupOnce(p); } catch (e2) {
      // say what the screen showed, so a failure on GitHub can be read without screenshots
      const seen = await p.evaluate(() => `view=${window.__cycle && window.__cycle.S.view} busy=${!document.getElementById('busy').hidden} toast=${(document.getElementById('toast') || {}).textContent || ''} text=${document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)}`).catch(() => 'page not readable');
      throw new Error(`${e2.message.split('\n')[0]} | screen: ${seen}`);
    }
  }
}
async function setupOnce(p) {
  await p.click('[data-act=start]');
  await p.fill('input[name=last]', LAST); await p.fill('input[name=usualCycle]', '30');
  await p.fill('input[name=birthYear]', '1990'); await p.check('input[name=diet][value=vegetarian]'); await p.check('input[name=accept]');
  await p.click('form[data-form=onboard] button:not(.pw-eye)');
  await p.fill('input[name=p1]', PASS); await p.fill('input[name=p2]', PASS); await p.check('input[name=saved]');
  // F20: in WebKit on GitHub the submit sometimes does not register: if neither the "Encrypting" indicator nor the app
  // appears within 20 s, submit once more; while encrypting, wait up to 150 s
  await p.click('form[data-form=passphrase] button:not(.pw-eye)');
  const started = () => p.waitForFunction(() => !!document.querySelector('main.screen') || !document.getElementById('busy').hidden, null, { timeout: 20000 }).then(() => true, () => false);
  if (!(await started())) await p.click('form[data-form=passphrase] button:not(.pw-eye)');
  await p.waitForSelector('main.screen', { timeout: 150000 });
  for (const [s, e] of PERIODS) {
    await p.click('[data-tab=history]'); await p.click('[data-act=add-past] >> nth=0');
    await p.fill('#sheet input[name=start]', s); await p.fill('#sheet input[name=end]', e); await p.click('#sheet form button:not(.pw-eye)'); await p.waitForTimeout(150);
  }
}
// v5 (U8): a page change slides in; measure only after the motion has finished
const settle = (p) => p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
const metrics = async (p) => { await settle(p); return p.evaluate(() => {
  const m = document.querySelector('main').getBoundingClientRect(); const nav = document.querySelector('.tabs').getBoundingClientRect();
  return { hscroll: document.documentElement.scrollWidth > innerWidth + 1, main: m.width, vw: innerWidth, vh: innerHeight, navLeft: nav.left, navW: nav.width, navTop: nav.top };
}); };

try {
for (const eng of want) {
  const browser = await ENGINES[eng].launch();
  // F20: in WebKit every test page gets a fresh browser (GitHub's WebKit stalls the passphrase step after many pages in one browser)
  const extra = [];
  const fresh = async () => { if (eng !== 'webkit') return browser; const b = await ENGINES[eng].launch(); extra.push(b); return b; };
  for (const [size, [w, h]] of Object.entries(SIZES)) for (const scheme of ['light', 'dark']) {
    const tag = `${eng} ${size} ${scheme}`;
    // WebKit on GitHub's shared runners can stall after many pages in one browser: give each WebKit page its own browser
    const own = eng === 'webkit' ? await ENGINES[eng].launch() : null;
    const ctx = await (own || browser).newContext({ locale: 'en-GB', viewport: { width: w, height: h }, colorScheme: scheme, serviceWorkers: 'block' });
    await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
    const p = await ctx.newPage(); await p.clock.install({ time: new Date(NOW) });
    p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    await p.goto(BASE); await setup(p);
    for (const tab of ['today', 'calendar', 'food', 'history', 'settings']) {
      await p.click(`.tabs [data-tab=${tab}]`); await p.waitForTimeout(120);
      const m = await metrics(p);
      ok(`${tag} ${tab}: no sideways scrolling`, !m.hscroll);
      if (size === 'laptop') {
        ok(`${tag} ${tab}: floating side rail on the left (U5)`, m.navLeft > 0 && m.navLeft < 40 && m.navW < 100, JSON.stringify(m));
        ok(`${tag} ${tab}: content uses ≥80% of the usable width`, m.main >= 0.8 * Math.min(m.vw - m.navW, 1200), JSON.stringify(m));
      } else if (size === 'phone-landscape') ok(`${tag} ${tab}: floating side rail in landscape (U5)`, m.navLeft > 0 && m.navLeft < 40 && m.navW < 100, JSON.stringify(m));
      else ok(`${tag} ${tab}: floating tab bar at the bottom (U5)`, m.navTop > m.vh - 120 && m.navLeft >= 12, JSON.stringify(m));
      if (scheme === 'light' || tab === 'today') await p.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-${tab}.png`) });
    }
    // Today: in landscape the ring must leave room for other content
    await p.click('.tabs [data-tab=today]'); await settle(p);
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
    await p.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-sheet.png`) });
    ok(`${tag} sheet position`, size === 'laptop' ? sh.top > 20 && sh.bottom < h - 20 : Math.abs(sh.bottom - h) < 2, JSON.stringify(sh));
    await p.click('#sheet .btn.wide[data-act=close-sheet]');
    // v3.2: a long gap shows "No period logged since", the review list with ticks fits, no sideways scrolling
    await p.evaluate(() => { const c = window.__cycle; const old = c.S.pred; window.__oldPred = old; c.S.pred = c.predict(c.S.data.periods.filter((x) => !x.deleted), {}, '2027-03-03', {}); c.S.tab = 'today'; c.render(); });
    const stale = await p.evaluate(() => { const e = document.querySelector('.hero'); return { lead: e.querySelector('.lead').textContent, big: e.querySelector('.big').textContent, bottom: e.getBoundingClientRect().bottom, bigRight: e.querySelector('.big').getBoundingClientRect().right, vw: innerWidth }; });
    ok(`${tag} v3.2 today: long gap says no period logged since a date`, stale.lead === 'No period logged since' && /^\d{1,2} \w{3}/.test(stale.big) && stale.bottom < h && stale.bigRight <= stale.vw, JSON.stringify(stale));
    await p.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v32-stale.png`) });
    await p.evaluate(() => { const c = window.__cycle; c.S.pred = window.__oldPred; c.S.tab = 'settings'; c.S.imp = { kind: 'found', source: 'dummy_metric_A', rows: [{ start: '2026-06-24', end: '2026-06-28' }, { start: '2026-07-25', end: '2026-07-29', off: true }, { start: '2026-08-24', end: '' }], order: 'dmy', ambiguous: false, skipped: 0, replace: true }; c.S.sheet = { name: 'import-review' }; c.render(); });
    await p.waitForTimeout(450);
    const rv = await p.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > innerWidth + 1, rows: document.querySelectorAll('#sheet .irow').length, ticks: document.querySelectorAll('#sheet .irow input[data-act=row-tick]').length, replace: !!document.querySelector('#sheet [data-act=import-replace]') }));
    ok(`${tag} v3.2 review: ticks and replace option, no sideways scrolling`, !rv.hscroll && rv.rows === 3 && rv.ticks === 3 && rv.replace, JSON.stringify(rv));
    await p.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v32-review.png`) });
    await ctx.close(); if (own) await own.close();
  }
  // Core flows once per engine (phone size)
  const ctx = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
  const p = await ctx.newPage(); await p.clock.install({ time: new Date(NOW) }); p.on('pageerror', (e) => errors.push(`${eng} flows: ${e.message}`));
  await p.goto(BASE); await setup(p);
  const st = await p.evaluate(() => window.__cycle.S.pred);
  ok(`${eng} flows: 3 past periods give Medium confidence`, st.confidence === 'Medium', st.confidence);
  await goSet(p, 'privacy'); await p.click('[data-act=lock-now]');
  await p.fill('form[data-form=unlock] input[name=p]', 'wrong-passphrase'); await p.click('form[data-form=unlock] button:not(.pw-eye)'); await p.waitForTimeout(1500);
  ok(`${eng} flows: wrong passphrase stays locked`, (await p.evaluate(() => window.__cycle.S.view)) === 'locked');
  await p.fill('form[data-form=unlock] input[name=p]', PASS); await p.click('form[data-form=unlock] button:not(.pw-eye)'); await p.waitForSelector('main.screen', { timeout: 45000 });
  await goSet(p, 'cycle'); await p.fill('form[data-form=helpline] input[name=name]', LINE.name); await p.fill('form[data-form=helpline] input[name=number]', LINE.number);
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
    const c2 = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
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
    await goSet(q, 'backup');
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
    await q.setInputFiles('input[data-act=import-json]', file('b.json', backup([['2026-04-12', '2026-04-16']]))); await q.waitForSelector('#sheet [data-act=import-cancel]');
    await q.click('#sheet [data-act=import-cancel]');
    ok(`${eng} v3: cancel imports nothing`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 4);
    // Look: appearance, theme, companion, cards, one-time note
    await q.click('.tabs [data-tab=today]');
    ok(`${eng} v3: companion note shown once`, await q.isVisible('.companion-note'));
    await q.click('[data-act=note-seen]'); ok(`${eng} v3: companion note dismissed`, await until(q, () => !document.querySelector('.companion-note')));
    await goSet(q, 'look');
    await q.click('[data-act=look-mode][data-v=dark]'); await lookIs(q, { mode: 'dark' }); await q.click('[data-act=look-theme][data-v=petal]'); await lookIs(q, { mode: 'dark', theme: 'petal' });
    const lk = await q.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { mode: document.documentElement.dataset.mode, bg: cs.getPropertyValue('--bg').trim(), h1: cs.getPropertyValue('--h1').trim(), body: getComputedStyle(document.body).backgroundColor }; });
    ok(`${eng} v3: forced dark with Petal`, lk.mode === 'dark' && lk.bg === '#0B0A14' && lk.h1 === '#8C2E52' && lk.body === 'rgb(11, 10, 20)', JSON.stringify(lk));
    await q.click('[data-act=look-companion][data-v=sprout]'); await lookIs(q, { companion: 'sprout' }); await q.click('.tabs [data-tab=today]');
    ok(`${eng} v3: sprout companion`, (await q.getAttribute('.companion', 'data-stage')).startsWith('sprout-'));
    await goSet(q, 'look'); await q.click('[data-act=look-companion][data-v=off]'); await lookIs(q, { companion: 'off' }); await q.click('label.switch:has([data-k=week]) input'); await until(q, () => window.__cycle.S.data.settings.look.cards.week === false); await q.click('label.switch:has([data-k=food]) input'); await until(q, () => window.__cycle.S.data.settings.look.cards.food === false);
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
    const c3 = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c3.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:'test-client-id.apps.googleusercontent.com'};" }));
    const r3 = await c3.newPage(); await r3.clock.install({ time: new Date(NOW) }); r3.on('pageerror', (e) => errors.push(`${eng} v3.1: ${e.message}`));
    await r3.goto(BASE); await r3.waitForSelector('[data-act=restore-start]:not([disabled])', { timeout: 45000 });
    await r3.click('[data-act=restore-start]');
    await r3.evaluate(() => { window.__cycle.S.restore = { token: 'dummy_token_A' }; window.__cycle.render(); });
    ok(`${eng} v3.1: no-vault screen explains why`, /No Cycle vault was found/.test(await r3.textContent('.intro')) && /only after Cycle sync has been turned on/.test(await r3.textContent('.intro')));
    ok(`${eng} v3.1: no-vault screen gives four numbered steps`, (await r3.locator('ol.steps li').count()) === 4);
    ok(`${eng} v3.1: no-vault screen offers set up and backup start`, (await r3.isVisible('.intro [data-act=start]')) && (await r3.isVisible('.intro [data-act=import-start]')));
    await r3.evaluate(() => { window.__cycle.S.restore = { token: { token: 'dummy_token_A', email: 'alice@example.com' }, fileId: 'dummy_file_A' }; window.__cycle.render(); });
    ok(`${eng} v3.2: restore screen shows the signed-in Google account and a way to change it`, /Signed in as alice@example\.com/.test(await r3.textContent('.intro')) && (await r3.isVisible('.intro [data-act=restore-switch]')));
    await r3.evaluate(() => { window.__cycle.S.restore = { token: { token: 'dummy_token_A', email: 'alice@example.com' } }; window.__cycle.render(); });
    ok(`${eng} v3.2: no-vault screen also shows the account and the switch`, /Signed in as alice@example\.com/.test(await r3.textContent('.intro')) && (await r3.isVisible('.intro [data-act=restore-switch]')));
    await r3.evaluate(() => { window.__cycle.S.restore = { token: 'dummy_token_A' }; window.__cycle.render(); });
    await r3.click('.intro [data-act=start]');
    ok(`${eng} v3.1: Set up on this phone starts the questions`, await r3.waitForSelector('form[data-form=onboard]', { timeout: 10000 }).then(() => true, () => false));
    await c3.close();

    // B7 at start-up: paste, review list, edit, continue
    const c4 = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
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
    await q.locator('.irow input[data-act=row-start]').nth(1).fill('2026-07-01'); await q.locator('.irow input[data-act=row-start]').nth(1).dispatchEvent('change');
    ok(`${eng} v3.1: the 15-day note appears at once after editing a date (I2)`, await until(q, () => document.querySelectorAll('.irow')[1].querySelector('.warn') !== null));
    await q.locator('.irow input[data-act=row-start]').nth(1).fill('2026-07-25'); await q.locator('.irow input[data-act=row-start]').nth(1).dispatchEvent('change');
    ok(`${eng} v3.1: the note goes away when the date is fixed`, await until(q, () => document.querySelectorAll('.irow')[1].querySelector('.warn') === null));
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
    await goSet(q, 'backup');
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
    // Safari's engine has no stream loop: take it away here and check that the PDF is still read (v3.1 WebKit fix)
    const noLoop = await q.evaluate(async (bytes) => { delete ReadableStream.prototype[Symbol.asyncIterator]; delete ReadableStream.prototype.values; const { pdfToText } = await import('./importer.js'); return pdfToText(new Uint8Array(bytes).buffer); }, [...pdfBytes(['25 May 2026 - 29 May 2026'])]);
    ok(`${eng} v3.1: a PDF is read without stream looping`, /25 May 2026 - 29 May 2026/.test(noLoop), String(noLoop).slice(0, 100));
    // fallback: the same PDF read on the main thread (no background worker)
    const mainThread = await q.evaluate(async (bytes) => { const { pdfToText } = await import('./importer.js'); globalThis.pdfjsWorker = await import('./vendor/pdfjs/pdf.worker.min.mjs'); return pdfToText(new Uint8Array(bytes).buffer); }, [...pdfBytes(['25 May 2026 - 29 May 2026'])]);
    ok(`${eng} v3.1: a PDF is also read on the main thread (fallback)`, /25 May 2026 - 29 May 2026/.test(mainThread), String(mainThread).slice(0, 100));
    await q.setInputFiles('input[data-act=import-json]', upload('scan.pdf', 'application/pdf', pdfBytes([])));
    ok(`${eng} v3.1: a PDF without text is refused`, await until(q, () => /no readable text/.test(document.querySelector('#toast').textContent)));
    await q.setInputFiles('input[data-act=import-json]', upload('periods.csv', 'text/csv', Buffer.from('start,end\n2026-04-12,2026-04-16\n')));
    await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: a CSV is read`, (await rowsOf(q, '#sheet')).join() === '2026-04-12>2026-04-16');
    await q.click('#sheet [data-act=import-reset]');
    ok(`${eng} v3.1: cancel leaves the data as it was`, (await q.evaluate(() => window.__cycle.S.data.periods.length)) === 4 && !(await q.isVisible('#sheet .irow')));
    await q.click('[data-act=paste-open]'); await q.fill('#sheet textarea[name=text]', '05/06/2026'); await q.click('#sheet form[data-form=import-paste] button');
    await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: day/month is assumed and the other reading is offered`, (await rowsOf(q, '#sheet')).join() === '2026-06-05>' && (await q.isVisible('#sheet [data-act=import-order]')));
    await q.click('#sheet [data-act=import-order]'); await q.waitForSelector('#sheet .irow');
    ok(`${eng} v3.1: switching to month/day rereads the list`, (await rowsOf(q, '#sheet')).join() === '2026-05-06>');
    await q.click('#sheet [data-act=import-reset]');

    // ---- v3.2: report PDF (B9), replace list, zoom lock (B12), bar colour (B13), no redraw while typing (B14) ----
    await goSet(q, 'backup');
    await q.setInputFiles('input[data-act=import-json]', upload('report.pdf', 'application/pdf', pdfBytes(['Cycle report', 'History', '24/06 - 23/07 5 Days 30 Days', '24/07 - 23/08 5 Days 31 Days', '24/08 - 22/09 5 Days 30 Days', 'Jun 24 Jun 25 Jun 26 Jun 27', '24/06 - 23/07 (30 Days) Next 25/07'])));
    await q.waitForSelector('#sheet .irow', { timeout: 30000 });
    ok(`${eng} v3.2: report rows are read from the history table only`, (await rowsOf(q, '#sheet')).join() === '2026-06-24>2026-06-28,2026-07-24>2026-07-28,2026-08-24>2026-08-28', (await rowsOf(q, '#sheet')).join());
    ok(`${eng} v3.2: every row has a tick and the replace option is offered`, (await q.locator('#sheet .irow input[data-act=row-tick]:checked').count()) === 3 && (await q.isVisible('#sheet [data-act=import-replace]')));
    await q.uncheck('#sheet .irow:nth-child(3) input[data-act=row-tick]');
    await q.check('#sheet [data-act=import-replace]');
    await q.click('#sheet [data-act=review-continue]');
    await q.waitForSelector('#sheet [data-act=import-confirm]');
    ok(`${eng} v3.2: replace shows how many periods go before anything changes`, /4 current periods will be removed/.test(await q.textContent('#sheet')) && /2 periods/.test(await q.textContent('#sheet')), await q.textContent('#sheet'));
    ok(`${eng} v3.2: nothing is changed until Import`, (await q.evaluate(() => window.__cycle.S.data.periods.filter((p) => !p.deleted).length)) === 4);
    await q.click('#sheet [data-act=import-confirm]');
    ok(`${eng} v3.2: the list replaced the periods (unticked row left out, old ones kept as deletions)`, await until(q, () => { const a = window.__cycle.S.data.periods; return a.filter((p) => !p.deleted).map((p) => p.start).sort().join() === '2026-06-24,2026-07-24' && a.filter((p) => p.deleted).length === 4; }));
    ok(`${eng} v3.2: zoom is locked`, /user-scalable=no/.test(await q.getAttribute('meta[name=viewport]', 'content')) && (await q.evaluate(() => getComputedStyle(document.body).touchAction)) === 'manipulation');
    await goSet(q, 'look'); await q.click('[data-act=look-mode][data-v=dark]');
    ok(`${eng} v3.2: the browser bar colour follows Dark`, await until(q, () => document.getElementById('tc-dark').content === '#000000' && !document.getElementById('tc-light').hasAttribute('media') && document.getElementById('tc-light').content === '#000000'));
    await q.click('[data-act=look-mode][data-v=light]');
    ok(`${eng} v3.2: the browser bar colour follows Light`, await until(q, () => document.getElementById('tc-dark').content === '#F2F2F7' && !document.getElementById('tc-dark').hasAttribute('media')));
    await q.click('[data-act=look-mode][data-v=auto]');
    ok(`${eng} v3.2: Automatic gives the choice back to the phone`, await until(q, () => document.getElementById('tc-dark').getAttribute('media') === '(prefers-color-scheme: dark)'));
    await goSet(q, 'backup'); await q.click('[data-act=paste-open]'); await q.fill('#sheet textarea[name=text]', 'dummy_metric_A typed text'); await q.focus('#sheet textarea[name=text]');
    await q.evaluate(() => window.__cycle.softRender());
    ok(`${eng} v3.2: a background refresh does not wipe a form that is being filled`, (await q.inputValue('#sheet textarea[name=text]')) === 'dummy_metric_A typed text' && await q.evaluate(() => window.__cycle.S.redrawLater === true));
    await q.click('#sheet .sheet-card button[data-act=close-sheet]');
    const fid = await q.evaluate(async () => {
      const Lock = await import('./lock.js'); const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const real = navigator.credentials; let creates = 0, gets = 0; const out = {};
      const stub = { create: async () => { creates++; return { rawId: new Uint8Array([1, 2, 3]).buffer }; },
        get: async () => { gets++; if (gets <= 2) throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); return { getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).buffer } } }) }; } };
      Object.defineProperty(navigator, 'credentials', { value: stub, configurable: true });
      try { await Lock.setup(key); } catch (e) { out.first = { retry: !!e.retryOnTap, msg: e.message }; }
      try { out.second = !!(await Lock.setup(key)).wrapped; } catch (e) { out.second = String(e.message); }
      out.creates = creates; Object.defineProperty(navigator, 'credentials', { value: real, configurable: true }); return out;
    });
    ok(`${eng} v3.2: Face ID setup refused once asks for a tap, the next try finishes it without a second passkey`, fid.first && fid.first.retry && /click or tap anywhere/.test(fid.first.msg) && fid.second === true && fid.creates === 1, JSON.stringify(fid));
    await goSet(q, 'cycle');
    ok(`${eng} v3.2: a held-back redraw is done when the field loses focus (I3)`, await q.evaluate(async () => {
      const c = window.__cycle; const f = document.querySelector('#app input:not([type=checkbox]):not([type=radio]):not([type=file]), #app textarea');
      if (!f) return true; f.focus(); c.softRender(); const held = c.S.redrawLater === true; f.blur();
      await new Promise((r) => setTimeout(r, 500)); return held && c.S.redrawLater === false; }));
    ok(`${eng} v3.2: with nothing open the refresh redraws`, await q.evaluate(() => { window.__cycle.S.redrawLater = true; document.activeElement && document.activeElement.blur(); window.__cycle.softRender(); return window.__cycle.S.redrawLater === false; }));
    // G5-2/G5-3: saving a check-in with moods hidden keeps the hidden mood and fields the form does not know
    const kept = await q.evaluate(async () => {
      const c = window.__cycle, d = '2026-10-02';
      c.S.data.checkins[d] = { symptoms: { calm: 1, cramps: 2 }, futureField: 'dummy_metric_A', updatedAt: 1 };
      c.S.data.settings = { ...c.S.data.settings, hide: { ...(c.S.data.settings.hide || {}), moods: true, updatedAt: Date.now() } };
      c.S.sheet = { name: 'checkin', date: d }; c.render();
      await new Promise((r) => setTimeout(r, 300));
      const f = document.querySelector('#sheet form[data-form=checkin]'); if (!f) return 'no form';
      f.requestSubmit(); await new Promise((r) => setTimeout(r, 500));
      const ci = c.S.data.checkins[d];
      c.S.data.settings = { ...c.S.data.settings, hide: { ...c.S.data.settings.hide, moods: false, updatedAt: Date.now() } };
      return JSON.stringify(ci);
    });
    ok(`${eng} v4: a check-in saved with moods hidden keeps the hidden mood and unknown fields (G5-2, G5-3)`, /"calm":1/.test(kept) && /futureField/.test(kept), kept);
    await c4.close();

    // ---- v4: ovulation tests, sex life, hide and display options, report, late check, history, pregnancy, B16, word budget ----
    const c5 = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c5.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
    const v = await c5.newPage(); await v.clock.install({ time: new Date(NOW) }); v.on('pageerror', (e) => errors.push(`${eng} v4: ${e.message}`));
    await v.goto(BASE); await setup(v);
    const T0 = '2026-10-03';
    await v.click('.tabs [data-tab=today]'); await v.click('.wk.is-today'); await v.waitForSelector('#sheet [data-act=ovu-add]');
    ok(`${eng} v4: the day sheet offers ovulation tests and sex life, marked New`, (await v.isVisible('#sheet [data-act=sex]')) && (await v.locator('#sheet .badge-new').count()) === 2);
    await v.click('#sheet [data-act=ovu-add][data-r=pos]');
    ok(`${eng} v4: a positive test is logged with its time and a remove button`, await until(v, () => { const d = window.__cycle.S.data.days['2026-10-03']; return d && d.ovu.length === 1 && d.ovu[0].r === 'pos' && d.ovuAt > 0 && !!document.querySelector('#sheet [data-act=ovu-del]'); }));
    ok(`${eng} v4: the positive test sharpens this cycle (start never later)`, await v.evaluate(() => { const p = window.__cycle.S.pred; return p.cycles[0].testAnchor === '2026-10-03' && p.ovulation.likely === '2026-10-04' && p.possible[1] === '2026-10-06'; }));
    await v.click('#sheet [data-act=sex][data-kind=protected]'); await v.waitForSelector('#sheet [data-act=sex-note]');
    await v.screenshot({ path: path.join(OUT, `${eng}-v4-daysheet.png`) });
    await v.fill('#sheet [data-act=sex-note]', 'dummy_metric_A'); await v.press('#sheet [data-act=sex-note]', 'Tab');
    ok(`${eng} v4: sex life is stored with its own time and note`, await until(v, () => { const d = window.__cycle.S.data.days['2026-10-03']; return d.sex.kind === 'protected' && d.sex.note === 'dummy_metric_A' && d.sexAt > 0 && d.flow === undefined; }));
    await v.click('#sheet .sheet-card button[data-act=close-sheet]');
    await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v4: the calendar marks the test and the sex entry`, (await v.locator('.cal-day .s-test').count()) === 1 && (await v.locator('.cal-day .s-sex').count()) === 1);
    // hide options
    await goSet(v, 'display');
    await v.click('label.switch:has([data-k=sex]) input');
    ok(`${eng} v4: hiding sex life offers to delete it`, await until(v, () => window.__cycle.S.data.settings.hide.sex === true && !!document.querySelector('[data-act=del-cat][data-k=sex]')));
    await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v4: hidden sex life is gone from the calendar`, (await v.locator('.cal-day .s-sex').count()) === 0);
    await goSet(v, 'report');
    ok(`${eng} v4: a hidden category is not offered in the export (G4-5)`, (await v.locator('[data-act=rep-tog][data-k=sex]').count()) === 0 && (await v.locator('[data-act=rep-tog][data-k=tests]').count()) === 1);
    // report: a real PDF, made on the device
    const [dlr] = await Promise.all([v.waitForEvent('download'), v.click('[data-act=rep-make]')]);
    const pdf = fs.readFileSync(await dlr.path());
    const pdfText = await v.evaluate(async (bytes) => { const { pdfToText } = await import('./importer.js'); return pdfToText(new Uint8Array(bytes).buffer); }, [...pdf]);
    ok(`${eng} v4: the report PDF opens and holds the chosen sections`, /Cycle report/.test(pdfText) && /Periods and cycle lengths/.test(pdfText) && /Ovulation tests/.test(pdfText) && /Positive/.test(pdfText) && !/Days logged: /.test(pdfText) && /Left out by choice:[\s\S]*sex life/.test(pdfText), JSON.stringify(pdfText).slice(0, 900));
    ok(`${eng} v4: the report file is named by date`, /^cycle-report-2026-10-03\.pdf$/.test(dlr.suggestedFilename()));
    await goSet(v, 'display');
    await v.click('[data-act=del-cat][data-k=sex]'); await v.click('#sheet [data-act=confirm-yes]');
    ok(`${eng} v4: deleting a category clears it everywhere`, await until(v, () => Object.values(window.__cycle.S.data.days).every((d) => !d.sex || d.sex.kind === 'none')));
    // display options
    await v.click('[data-act=disp-date][data-v=num]'); await v.click('[data-act=disp-week][data-v=sun]');
    await v.click('.tabs [data-tab=today]');
    ok(`${eng} v4: the chosen date format is used`, /03\/10\/2026/.test(await v.textContent('.hero h1')), await v.textContent('.hero h1'));
    await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v4: the week can start on Sunday`, (await v.textContent('.cal-wd')) === 'Su');
    await goSet(v, 'display'); await v.click('[data-act=disp-date][data-v=dmy]'); await v.click('[data-act=disp-week][data-v=mon]');
    // history
    await v.click('.tabs [data-tab=history]');
    await v.screenshot({ path: path.join(OUT, `${eng}-v4-history.png`) });
    ok(`${eng} v4: history shows one bar per cycle with filters`, (await v.locator('.hist-row .cbar').count()) >= 4 && (await v.isVisible('[data-act=hist-filter][data-v=last3]')));
    await v.click('[data-act=hist-filter][data-v=last3]');
    ok(`${eng} v4: the Last 3 filter shows 3 cycles`, (await v.locator('.hist-row').count()) === 3);
    // late period check (a later "today" for this check only)
    await v.evaluate(() => { const c = window.__cycle; c.S.pred = c.predict(c.S.data.periods, c.S.data.settings, '2026-11-02', c.S.data.days); c.S.tab = 'today'; c.render(); });
    await v.click('[data-act=late-check]'); await v.waitForSelector('#sheet .cmp');
    ok(`${eng} v4: the late check starts by comparing this cycle with the others`, (await v.locator('#sheet .cmp').count()) >= 2);
    await v.click('#sheet [data-act=late-next]'); await v.click('#sheet [data-act=late-preg][data-v=no]');
    await v.click('#sheet [data-act=late-tog][data-k=changes][data-v=stress]'); await v.click('#sheet [data-act=late-next]'); await v.click('#sheet [data-act=late-next]');
    await v.screenshot({ path: path.join(OUT, `${eng}-v4-late-result.png`), fullPage: false });
    const res = await v.textContent('#sheet');
    ok(`${eng} v4: the result lists the reason and always the urgent warnings (G4-8)`, /Stress can delay a period/.test(res) && /Get advice today/.test(res) && /Call emergency services/.test(res) && !/home pregnancy test/.test(res), res.slice(0, 200));
    await v.click('#sheet [data-act=late-save]');
    ok(`${eng} v4: the result is added to today's note`, await until(v, () => /Late check/.test((window.__cycle.S.data.checkins['2026-10-03'] || {}).note || '')));
    await v.click('#sheet button[data-act=close-sheet].btn');
    // U4: word budget for Today's first screen, after the one-time note
    await v.evaluate(() => { const c = window.__cycle; c.recompute(); c.S.tab = 'today'; c.render(); });
    await v.waitForSelector('main.screen'); const ns = v.locator('[data-act=note-seen]'); if (await ns.count()) { await ns.first().click(); await until(v, () => !document.querySelector('[data-act=note-seen]')); }
    const words = await v.evaluate(() => { const vh = innerHeight; let n = 0; const walk = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) { const el = t.parentElement; if (!el || el.closest('.tabs, #toast')) continue; const r = el.getBoundingClientRect(); if (r.bottom > 0 && r.top < vh && getComputedStyle(el).visibility !== 'hidden') n += (t.textContent.match(/[A-Za-z]{3,}/g) || []).length; } return n; });
    await v.screenshot({ path: path.join(OUT, `${eng}-v4-today-words.png`) });
    ok(`${eng} v4: Today's first screen stays short (U4, at most 40 words)`, words <= 40, `words: ${words}`);
    // pregnancy pause
    await v.evaluate(async () => { const c = window.__cycle; const ps = c.S.data.periods.filter((x) => !x.deleted).sort((a, b) => (a.start < b.start ? -1 : 1)); Object.assign(ps[ps.length - 1], { excluded: true, excludeReason: 'Pregnancy', updatedAt: Date.now() }); await c.persist(); c.S.tab = 'today'; c.render(); });
    ok(`${eng} v4: a cycle marked as pregnancy pauses predictions`, /Predictions paused since/.test(await v.textContent('.hero')) && (await v.locator('[data-act=late-check]').count()) === 0);
    await c5.close();

    // B16: a vault search that finishes after she went back must not leave a signed-out "Vault found" screen
    const c6 = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c6.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:'test-client-id.apps.googleusercontent.com'};" }));
    await c6.route('https://www.googleapis.com/drive/v3/files?**', async (r) => { await new Promise((x) => setTimeout(x, 400)); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'dummy_file_A', name: 'cycle-vault.json' }] }) }); });
    const w = await c6.newPage(); w.on('pageerror', (e) => errors.push(`${eng} v4 B16: ${e.message}`));
    await w.goto(BASE); await w.waitForSelector('[data-act=restore-start]:not([disabled])', { timeout: 45000 }); await w.click('[data-act=restore-start]');
    ok(`${eng} v4: B16 root cause: before sign-in the restore screen asks to sign in, never "Vault found"`, (await w.isVisible('[data-act=restore-signin]')) && !/Vault found/.test(await w.textContent('#app')));
    const race = await w.evaluate(async () => {
      const c = window.__cycle; c.S.restore = { token: { token: 'dummy_token_A', exp: Date.now() + 3600e3 } };
      const run = c.findForRestore(); c.S.restore = {}; c.render(); await run; return { fileId: c.S.restore.fileId, found: /Vault found/.test(document.querySelector("#app").textContent), view: c.S.view, app: document.querySelector("#app").textContent.slice(0, 200) };
    });
    ok(`${eng} v4: B16 a late search result goes only to the attempt that started it`, race.fileId === undefined && !race.found, JSON.stringify(race));
    const lost = await w.evaluate(async () => { const c = window.__cycle; c.S.restore = { fileId: 'dummy_file_A' }; try { await c.restoreFlow('test-passphrase-only'); return 'no error'; } catch (e) { return e.code + ' ' + e.message; } });
    ok(`${eng} v4: B16 restore without a sign-in asks to sign in again (no program error)`, /^signin Your Google sign-in was lost/.test(lost), lost);
    const found = await w.evaluate(async () => { const c = window.__cycle; c.S.restore = { token: { token: 'dummy_token_A', exp: Date.now() + 3600e3 } }; await c.findForRestore(); return { id: c.S.restore.fileId, text: document.body.textContent }; });
    ok(`${eng} v4: B16 the switch account option shows even without the account name`, found.id === 'dummy_file_A' && /Signed in to Google/.test(found.text) && /Use a different Google account/.test(found.text));
    await c6.close();
  }
  // ---- v5: swipe and scroll lock (B18), no selection (B19), duplicate periods (B20), Review (U7), motion (U8), Theme and Halloween (U9), switches (U10), icons (B17) ----
  {
    const mk = async (w, h, scheme, extra = {}) => {
      const cx = await (await fresh()).newContext({ locale: 'en-GB', viewport: { width: w, height: h }, colorScheme: scheme, serviceWorkers: 'block', ...extra });
      await cx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.CYCLE_CONFIG={googleClientId:''};" }));
      const pg = await cx.newPage(); await pg.clock.install({ time: new Date(NOW) }); pg.on('pageerror', (e) => errors.push(`${eng} v5: ${e.message}`));
      await pg.goto(BASE); await setup(pg); return [cx, pg];
    };
    const [c7, v] = await mk(390, 844, 'light', eng === 'chromium' ? { hasTouch: true, isMobile: true } : {});
    // B17: icon files exist under the new names and the page and manifest point at them
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const refs = [...html.matchAll(/href="(icons\/[^"]+)"/g)].map((m) => m[1]).concat(man.icons.map((i) => i.src.replace(/^\.\//, '')));
    ok(`${eng} v5 B17: every icon the page and manifest name exists`, refs.length >= 6 && refs.every((f) => fs.existsSync(path.join(ROOT, f))) && refs.every((f) => /cycle-/.test(f)), refs.join(', '));
    ok(`${eng} v5 B17: Safari tab icon sizes 16, 32 and 48 are offered`, ['16x16', '32x32', '48x48'].every((s) => html.includes(`sizes="${s}"`)));
    // B19: nothing in the app can be selected; typing fields still can
    await v.click('.tabs [data-tab=today]'); await settle(v);
    const sel = await v.evaluate(() => ({ btn: getComputedStyle(document.querySelector('.hero-btn')).userSelect, main: getComputedStyle(document.querySelector('main')).userSelect, touch: getComputedStyle(document.body).webkitTouchCallout }));
    ok(`${eng} v5 B19: buttons and text are not selectable`, sel.btn === 'none' && sel.main === 'none', JSON.stringify(sel));
    await v.click('.tabs [data-tab=history]'); await v.click('[data-act=add-past] >> nth=0'); await v.waitForSelector('#sheet input[name=start]');
    ok(`${eng} v5 B19: date and text fields stay editable`, (await v.evaluate(() => getComputedStyle(document.querySelector('#sheet input[name=start]')).userSelect)) === 'text');
    await v.click('#sheet .btn.wide[data-act=close-sheet]');
    // check-in title wording
    await v.click('.tabs [data-tab=today]'); await v.click('[data-act=checkin] >> nth=0'); await v.waitForSelector('#sheet h2');
    ok(`${eng} v5: check-in pop-up title reads "Check-in · Today"`, (await v.textContent('#sheet h2')) === 'Check-in · Today', await v.textContent('#sheet h2'));
    await v.click('#sheet .btn.wide[data-act=close-sheet]');
    // B18: the page behind a pop-up is pinned and comes back to the same place
    await v.click('.tabs [data-tab=today]'); await settle(v);
    await v.evaluate(() => { document.querySelector('main').style.paddingBottom = '900px'; window.scrollTo(0, 220); });
    const y0 = await v.evaluate(() => scrollY);
    await v.click('[data-act=add-past] >> nth=0'); await v.waitForSelector('#sheet input[name=start]'); await v.waitForTimeout(450);
    const lock = await v.evaluate(() => ({ cls: document.body.classList.contains('scroll-locked'), pos: getComputedStyle(document.body).position, top: document.body.style.top }));
    ok(`${eng} v5 B18: the page behind an open pop-up is pinned`, lock.cls && lock.pos === 'fixed' && lock.top === `-${y0}px`, JSON.stringify({ lock, y0 }));
    await v.mouse.wheel(0, 300).catch(() => {});
    ok(`${eng} v5 B18: scrolling does not move the page behind`, (await v.evaluate(() => Math.abs(parseFloat(document.body.style.top)))) === y0);
    if (eng === 'chromium') {
      const cdp = await c7.newCDPSession(v);
      const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }] });
      const top = await v.evaluate(() => document.querySelector('.sheet-card').getBoundingClientRect().top);
      await touch('touchStart', top + 12); for (const dy of [20, 60, 110, 150]) await touch('touchMove', top + 12 + dy); await touch('touchEnd', 0);
      ok(`${eng} v5 B18: swiping the pop-up down closes it`, await until(v, () => !window.__cycle.S.sheet));
      // a short pull springs back and keeps it open
      await v.click('[data-act=add-past] >> nth=0'); await v.waitForSelector('#sheet input[name=start]'); await v.waitForTimeout(450);
      const top2 = await v.evaluate(() => document.querySelector('.sheet-card').getBoundingClientRect().top);
      await touch('touchStart', top2 + 12); for (const dy of [10, 25, 35]) await touch('touchMove', top2 + 12 + dy); await touch('touchEnd', 0); await v.waitForTimeout(400);
      ok(`${eng} v5 B18: a short pull springs back and the pop-up stays open`, await v.evaluate(() => !!window.__cycle.S.sheet && Math.abs(document.querySelector('.sheet-card').getBoundingClientRect().top - (innerHeight - document.querySelector('.sheet-card').getBoundingClientRect().height)) < 2));
      // a second finger during a swipe puts the pop-up back
      const top3 = await v.evaluate(() => document.querySelector('.sheet-card').getBoundingClientRect().top);
      await touch('touchStart', top3 + 12); await touch('touchMove', top3 + 40); await touch('touchMove', top3 + 70);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: top3 + 70, id: 0 }, { x: 250, y: top3 + 90, id: 1 }] });
      await v.waitForTimeout(400);
      ok(`${eng} v5 B18: a second finger puts the pop-up back, nothing stays pulled down`, await v.evaluate(() => { const c = document.querySelector('.sheet-card'); return !!window.__cycle.S.sheet && !c.classList.contains('dragging') && c.style.transform === ''; }));
      await touch('touchEnd', 0);
      await v.click('#sheet .btn.wide[data-act=close-sheet]');
    } else await v.click('#sheet .btn.wide[data-act=close-sheet]');
    await v.waitForTimeout(100);
    ok(`${eng} v5 B18: closing puts the page back where it was`, Math.abs((await v.evaluate(() => scrollY)) - y0) <= 1 && !(await v.evaluate(() => document.body.classList.contains('scroll-locked'))), `y0 ${y0} now ${await v.evaluate(() => scrollY)}`);
    await v.evaluate(() => { document.querySelector('main').style.paddingBottom = ''; window.scrollTo(0, 0); });

    // B20: the same start saved twice is merged when Cycle opens
    await v.evaluate(async () => { const c = window.__cycle; const a = c.S.data.periods.find((x) => !x.deleted && x.start === '2026-08-24');
      c.S.data.periods.push({ id: 'dup_test_1', start: a.start, end: null, updatedAt: Date.now() }, { id: 'dup_test_2', start: a.start, end: a.end, updatedAt: Date.now() }); await c.persist(); });
    await goSet(v, 'privacy'); await v.click('[data-act=lock-now]'); await v.fill('form[data-form=unlock] input[name=p]', PASS); await v.click('form[data-form=unlock] button:not(.pw-eye)'); await v.waitForSelector('main.screen', { timeout: 45000 });
    const dup = await v.evaluate(() => { const live = window.__cycle.S.data.periods.filter((x) => !x.deleted); return { n: live.length, same: live.filter((x) => x.start === '2026-08-24').length, note: /0 days? long/.test(document.body.textContent) }; });
    ok(`${eng} v5 B20: duplicate same-start periods are merged on opening`, dup.n === 4 && dup.same === 1 && !dup.note, JSON.stringify(dup));

    // U7: Review. A short gap in the history is a check note: Today shows one line, the Review page shows the note.
    await v.click('.tabs [data-tab=history]'); await v.click('[data-act=add-past] >> nth=0');
    await v.fill('#sheet input[name=start]', '2026-09-05'); await v.fill('#sheet input[name=end]', '2026-09-09'); await v.click('#sheet form button:not(.pw-eye)'); await v.waitForTimeout(200);
    await v.click('.tabs [data-tab=today]'); await settle(v);
    const rl = await v.evaluate(() => ({ line: (document.querySelector('.review-line') || {}).textContent || '', notes: document.querySelectorAll('main .note.check, main .note.missed, main .note.info, main .flag.doctor').length }));
    ok(`${eng} v5 U7: Today shows one "things to review" line and no check notes`, /\d things? to review/.test(rl.line) && rl.notes === 0, JSON.stringify(rl));
    await v.click('.review-line'); await settle(v);
    const rv2 = await v.evaluate(() => ({ title: document.querySelector('.topbar h1').textContent, notes: document.querySelectorAll('.tab-review .note, .tab-review .flag').length, sec: [...document.querySelectorAll('.tab-review .sec')].map((e) => e.textContent), on: document.querySelector('.tabs button.on').dataset.tab }));
    ok(`${eng} v5 U7: Review page lists the notes and keeps Today lit in the tab bar`, rv2.title === 'Review' && rv2.notes >= 1 && rv2.sec.length >= 1 && rv2.on === 'today', JSON.stringify(rv2));
    await v.click('.tab-review .back'); await settle(v);
    ok(`${eng} v5 U7: Back returns to Today`, (await v.evaluate(() => window.__cycle.S.tab)) === 'today');

    // U8: motion
    await goSet(v, 'look'); await settle(v);
    ok(`${eng} v5 U8: Motion offers Automatic, Full, Reduced and Off`, (await v.locator('[data-act=look-motion]').allTextContents()).join() === 'Automatic,Full,Reduced,Off');
    ok(`${eng} v5 U8: Automatic is the starting choice`, (await v.getAttribute('[data-act=look-motion][data-v=auto]', 'aria-pressed')) === 'true');
    await v.click('[data-act=look-motion][data-v=full]'); await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v5 U8: Full slides a page in`, await v.evaluate(() => /anim-tab/.test(document.querySelector('main').className) && document.documentElement.dataset.motion === 'full'));
    await settle(v);
    await goSet(v, 'look'); await v.click('[data-act=look-motion][data-v=reduced]'); await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v5 U8: Reduced only fades`, await v.evaluate(() => /anim-fade/.test(document.querySelector('main').className)));
    await settle(v);
    await goSet(v, 'look'); await v.click('[data-act=look-motion][data-v=off]'); await v.click('.tabs [data-tab=calendar]');
    ok(`${eng} v5 U8: Off shows pages at once`, await v.evaluate(() => !/anim-/.test(document.querySelector('main').className) && document.documentElement.dataset.motion === 'off'));
    await goSet(v, 'look'); await v.click('[data-act=look-motion][data-v=auto]');
    ok(`${eng} v5 U8: Automatic can be chosen again after Off`, await until(v, () => window.__cycle.S.data.settings.look.motion === 'auto' && document.querySelector('[data-act=look-motion][data-v=auto]').getAttribute('aria-pressed') === 'true'));
    ok(`${eng} v5: every Look option group has a name for screen readers`, await v.evaluate(() => [...document.querySelectorAll('.look-card [role=group]')].every((g) => !!g.getAttribute('aria-label'))));

    // U9 and U10: Theme, Colour only for Classic, Halloween, switches in the theme colour
    await goSet(v, 'look'); await settle(v);
    const lk = await v.evaluate(() => ({ cards: [...document.querySelectorAll('[data-act=look-style]')].map((b) => b.querySelector('strong').textContent + ':' + b.getAttribute('aria-pressed')), colour: document.querySelectorAll('.swatches').length, h3: [...document.querySelectorAll('.look-card h3')].map((e) => e.textContent) }));
    ok(`${eng} v5 U9: Classic is selected and shows Colour`, lk.cards.join() === 'Classic:true,Halloween:false' && lk.colour === 1 && lk.h3.includes('Colour') && lk.h3.includes('Theme'), JSON.stringify(lk));
    const sw = (pg) => pg.evaluate(() => { const i = document.querySelector('input[role=switch]:checked'); const d = document.createElement('div'); d.style.background = 'var(--accent)'; document.body.append(d); const a = getComputedStyle(d).backgroundColor; d.remove(); return { sw: i ? getComputedStyle(i).backgroundColor : null, accent: a }; });
    const s1 = await sw(v); ok(`${eng} v5 U10: switches use the theme colour in Classic, not iOS green`, s1.sw === s1.accent && s1.sw !== 'rgb(52, 199, 89)', JSON.stringify(s1));
    await v.click('[data-act=look-style][data-v=halloween]'); await until(v, () => document.documentElement.dataset.style === 'halloween'); await settle(v);
    const hw = await v.evaluate(() => ({ colour: document.querySelectorAll('.swatches').length, back: !!document.querySelector('[data-act=look-autoback]'), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), stored: window.__cycle.S.data.settings.look.style, set: window.__cycle.S.data.settings.look.styleSet, pumpkin: document.querySelectorAll('.tabs [data-tab=food] svg path').length }));
    ok(`${eng} v5 U9: Halloween hides Colour, offers "back to Classic", and is stored in her settings`, hw.colour === 0 && hw.back && hw.stored === 'halloween' && hw.set === '2026-10-03' && /^#(B4470C|FF8A2A)$/i.test(hw.accent), JSON.stringify(hw));
    ok(`${eng} v5 U9: the Food tab icon becomes a pumpkin`, hw.pumpkin === 3, String(hw.pumpkin));
    const s2 = await sw(v); ok(`${eng} v5 U10: switches turn orange in Halloween`, s2.sw === s2.accent && /^rgb\((180, 71, 12|255, 138, 42)\)$/.test(s2.sw), JSON.stringify(s2));
    const sk = {};
    for (const tab of ['today', 'calendar', 'food', 'settings']) { await v.click(`.tabs [data-tab=${tab}]`); await settle(v); sk[tab] = await v.evaluate(() => ({ sketches: document.querySelectorAll('main svg.sk, main svg.sky').length, hidden: [...document.querySelectorAll('main svg.sk, main svg.sky')].every((s) => s.getAttribute('aria-hidden') === 'true'), h: document.documentElement.scrollWidth > innerWidth + 1 })); }
    ok(`${eng} v5 U9: sketches appear on Today, Calendar, Food and Settings, hidden from screen readers, no sideways scrolling`, Object.values(sk).every((x) => x.sketches >= 1 && x.hidden && !x.h), JSON.stringify(sk));
    // Back to Classic on 1 November (a date rule, nothing is written)
    await v.clock.setSystemTime(new Date('2026-10-31T23:00:00')); await v.evaluate(() => window.__cycle.render());
    const d31 = await v.evaluate(() => document.documentElement.dataset.style);
    await v.clock.setSystemTime(new Date('2026-11-01T00:30:00')); await v.evaluate(() => window.__cycle.render());
    const d1 = await v.evaluate(() => ({ s: document.documentElement.dataset.style, stored: window.__cycle.S.data.settings.look.style }));
    ok(`${eng} v5 U9: Halloween ends on 1 November without changing her saved choice`, d31 === 'halloween' && d1.s === 'classic' && d1.stored === 'halloween', JSON.stringify({ d31, d1 }));
    await v.clock.setSystemTime(new Date(NOW)); await v.evaluate(() => window.__cycle.render());
    await c7.close();

    // Halloween screenshots and layout, phone and laptop, light and dark (also the Review page and Look)
    for (const [size, w, h] of [['phone', 390, 844], ['laptop', 1470, 956]]) for (const scheme of ['light', 'dark']) {
      const [cx, q] = await mk(w, h, scheme);
      await q.click('.tabs [data-tab=history]'); await q.click('[data-act=add-past] >> nth=0'); await q.fill('#sheet input[name=start]', '2026-09-05'); await q.fill('#sheet input[name=end]', '2026-09-09'); await q.click('#sheet form button:not(.pw-eye)'); await q.waitForTimeout(200);
      await goSet(q, 'look'); await q.click('[data-act=look-style][data-v=halloween]'); await until(q, () => document.documentElement.dataset.style === 'halloween');
      await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-halloween-look.png`), fullPage: true });
      for (const tab of ['today', 'calendar', 'food', 'history', 'settings']) {
        await q.click(`.tabs [data-tab=${tab}]`); const m = await metrics(q);
        ok(`${eng} ${size} ${scheme} Halloween ${tab}: no sideways scrolling`, !m.hscroll);
        await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-halloween-${tab}.png`) });
      }
      await q.click('.tabs [data-tab=today]'); await settle(q); await q.click('.review-line'); await settle(q);
      await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-halloween-review.png`) });
      const texts = await q.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { h1: cs.getPropertyValue('--h1').trim(), h2: cs.getPropertyValue('--h2').trim() }; });
      ok(`${eng} ${size} ${scheme} Halloween: header text readable (≥4.5:1)`, contrast('#FFFFFF', texts.h1) >= 4.5 && contrast('#FFFFFF', texts.h2) >= 4.5, JSON.stringify(texts));
      // Classic again: the Review page, Calendar and Settings in the normal look
      await goSet(q, 'look'); await q.click('[data-act=look-style][data-v=classic]'); await until(q, () => document.documentElement.dataset.style === 'classic'); await settle(q);
      await q.click('.tabs [data-tab=calendar]'); await settle(q); await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-classic-calendar.png`) });
      await q.click('.tabs [data-tab=today]'); await settle(q); await q.click('.review-line'); await settle(q); await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-classic-review.png`) });
      await goSet(q, 'look'); await settle(q); await q.screenshot({ path: path.join(OUT, `${eng}-${size}-${scheme}-v5-classic-look.png`), fullPage: true });
      await cx.close();
    }
  }
  for (const b of extra) await b.close().catch(() => {});
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
