// Cycle — v2.2 (Phases 1–3, recovery, D1, B2 fixes, iOS-style UI). Spec v0.3: FR-01–FR-17, FR-27, FR-29; NFR-01–NFR-13.
import { predict, dayInfo, addDays, diff, localToday, livePeriods, periodLength, cycles, isDate, CONST } from './engine.js';
import * as K from './crypto.js';
import * as Lock from './lock.js';
import * as C from './cloud.js';
import * as T from './content.js';
import { evaluate, recsFor, heavyDays } from './rules.js';

export const VERSION = 'v2.2';
const cfg = window.CYCLE_CONFIG || {};
const AUTO_LOCK_MS = 5 * 60 * 1000; // NFR-05

// ---------------- storage (IndexedDB, own database name) ----------------
const DB = 'cycle-wellness';
let dbp;
const db = () => (dbp ||= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
async function kvGet(k, d = null) { const x = await db(); return new Promise((res) => { const r = x.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result ?? d); r.onerror = () => res(d); }); }
async function kvSet(k, v) { const x = await db(); return new Promise((res, rej) => { const t = x.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function kvClear() { const x = await db(); return new Promise((res) => { const t = x.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; }); }

// ---------------- state ----------------
const S = {
  view: 'boot', tab: 'today', meta: null, key: null, data: null, pred: null, month: null,
  sheet: null, draft: {}, faceIdOk: false, hiddenAt: 0,
  cloud: { token: null, status: 'off', msg: '', busy: false },
};
const fresh = () => ({ app: 'cycle', v: 1, settings: { updatedAt: Date.now() }, periods: [], days: {}, checkins: {}, acks: {} });
// v1 data has no check-ins or acknowledgements yet
const upgrade = (d) => ({ ...d, days: d.days || {}, checkins: d.checkins || {}, acks: d.acks || {} });
const today = () => localToday();
const uid = () => `p${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (q) => document.querySelector(q);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function fmt(d, withYear = false) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd} ${MONTHS[m - 1].slice(0, 3)}${withYear ? ` ${y}` : ''}`;
}
const weekday = (d) => WD[(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay() + 6) % 7];
const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;

function recompute() {
  S.pred = S.data ? predict(S.data.periods, S.data.settings, today(), S.data.days) : null;
  S.flags = S.data && S.pred && !S.pred.empty ? evaluate(S.data, S.pred, today()) : [];
}
// The phase a given day belongs to, for check-in questions and food cards.
function phaseOn(date) {
  if (!S.data || !livePeriods(S.data.periods).some((p) => diff(date, p.start) >= 0)) return 'other';
  const ps = livePeriods(S.data.periods).filter((p) => diff(date, p.start) >= 0);
  const id = predict(ps, S.data.settings, date, S.data.days).state.id;
  return ['menstruation', 'follicular', 'fertile', 'luteal', 'late'].includes(id) ? id : 'other';
}
async function persist() {
  S.data.updatedAt = Date.now();
  await kvSet('sealed', await K.seal(S.data, S.key));
  recompute(); markChanged();
}

// ---------------- toast & sheets ----------------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
function openSheet(name, data = {}) { S.sheet = { name, ...data }; render(); setTimeout(() => { const f = $('#sheet [autofocus]'); if (f) f.focus(); }, 50); }
function closeSheet() { S.sheet = null; render(); }

// ---------------- render ----------------
function render() {
  const app = $('#app');
  if (S.view === 'welcome') app.innerHTML = welcomeView();
  else if (S.view === 'onboard') app.innerHTML = onboardView();
  else if (S.view === 'passphrase') app.innerHTML = passphraseView();
  else if (S.view === 'faceid') app.innerHTML = faceIdOfferView();
  else if (S.view === 'restore') app.innerHTML = restoreView();
  else if (S.view === 'locked') app.innerHTML = lockedView();
  else if (S.view === 'forgot') app.innerHTML = forgotView();
  else if (S.view === 'import') app.innerHTML = importView();
  else if (S.view === 'erase') app.innerHTML = eraseView();
  else if (S.view === 'app') {
    app.innerHTML = `<main class="screen tab-${S.tab}">${{ today: todayView, calendar: calendarView, food: foodView, history: historyView, settings: settingsView }[S.tab]()}</main>${navBar()}`;
  } else app.innerHTML = '';
  const sh = $('#sheet');
  if (S.sheet && S.view === 'app') { sh.innerHTML = `<div class="sheet-scrim" data-act="close-sheet"></div><div class="sheet-card" role="dialog" aria-modal="true"><div class="grabber" aria-hidden="true"></div>${sheetBody()}</div>`; sh.hidden = false; }
  else { sh.hidden = true; sh.innerHTML = ''; }
}

// ---------------- passphrase fields ----------------
// A username field lets the iPhone save the passphrase in Passwords (iCloud Keychain) and fill it in later.
const USER = '<input class="sr-only" type="text" name="username" autocomplete="username" value="Cycle passphrase" readonly tabindex="-1" aria-hidden="true">';
function pw(name, labelText, ac, focus = false, min = 10) {
  return `<label>${labelText}<span class="pw"><input type="password" name="${name}" ${min ? `minlength="${min}"` : ''} required autocomplete="${ac}" ${focus ? 'autofocus' : ''}><button type="button" class="pw-eye" data-act="pw-toggle" aria-label="Show passphrase">Show</button></span></label>`;
}

// ---------------- first run ----------------
function welcomeView() {
  return `<section class="intro">
    ${ringMark()}
    <h1>Cycle</h1>
    <p class="lede">A private tracker for your periods and fertile days. Everything stays encrypted on your phone and, if you choose, in your own Google Drive.</p>
    <button class="btn primary wide" data-act="start">Set up on this phone</button>
    <button class="btn wide" data-act="restore-start" ${cfg.googleClientId ? '' : 'disabled'}>Restore from Google Drive</button>
    <div class="notice"><p><strong>Used Cycle before on this iPhone?</strong> The Home Screen app and Safari keep separate data. If you set Cycle up from the Home Screen icon, open it from there; if you used it in Safari, open it in Safari. Setting up here creates a new, empty Cycle.</p></div>
  </section>`;
}
function onboardView() {
  const d = S.draft;
  return `<section class="intro form-page">
    <h1>About your cycle</h1>
    <p class="lede">These answers give the first estimate. After a few logged periods, the app uses your own history instead.</p>
    <form class="stack" data-form="onboard">
      <label>First day of your last period
        <input type="date" name="last" max="${today()}" value="${h(d.last || '')}">
        <span class="fine">The first day of real bleeding, not spotting. Leave empty if you don't remember; you can log your next period instead.</span></label>
      <label>Usual cycle length, in days
        <input type="number" name="usualCycle" min="15" max="90" inputmode="numeric" placeholder="I don't know" value="${h(d.usualCycle || '')}">
        <span class="fine">From the first day of one period to the first day of the next.</span></label>
      <label>Usual period length, in days
        <input type="number" name="usualPeriod" min="1" max="15" inputmode="numeric" placeholder="I don't know" value="${h(d.usualPeriod || '')}"></label>
      <fieldset><legend>Your age</legend>
        ${[['18-25', '18–25'], ['26-41', '26–41'], ['42-45', '42–45'], ['other', 'Other']].map(([v, t]) => `<label class="choice"><input type="radio" name="ageBand" value="${v}" ${(d.ageBand || '26-41') === v ? 'checked' : ''}> ${t}</label>`).join('')}
        <span class="fine">Used later to judge whether cycles are regular (FIGO 2018).</span></fieldset>
      <div class="notice">
        <p><strong>Please read.</strong> Cycle is a wellness tracker, not medical advice. Its dates are estimates from your cycle lengths. It is not a reliable method of birth control.</p>
        <label class="choice"><input type="checkbox" name="accept" required> I understand</label>
      </div>
      <button class="btn primary wide">Continue</button>
    </form></section>`;
}
function passphraseView() {
  return `<section class="intro form-page">
    <h1>Choose a passphrase</h1>
    <p class="lede">It encrypts everything Cycle stores. Use at least 10 characters, for example three random words.</p>
    <form class="stack" data-form="passphrase">${USER}
      ${pw('p1', 'Passphrase', 'new-password', true)}
      ${pw('p2', 'Repeat it', 'new-password')}
      <p class="fine">When your iPhone offers to save it in Passwords, choose Save. Also write it down. It cannot be recovered: without it, your data cannot be opened by you or anyone else.</p>
      <label class="choice"><input type="checkbox" name="saved" required> I have saved my passphrase</label>
      <button class="btn primary wide">Encrypt and continue</button>
    </form></section>`;
}
function faceIdOfferView() {
  return `<section class="intro form-page">
    <h1>Open with Face ID?</h1>
    <p class="lede">Instead of typing the passphrase each time, unlock Cycle with Face ID or Touch ID. Your data stays encrypted; Face ID only unlocks the key.</p>
    <button class="btn primary wide" data-act="faceid-setup">Use Face ID</button>
    <button class="btn wide" data-act="faceid-skip">Not now</button>
  </section>`;
}
function restoreView() {
  const st = S.restore || {};
  let body;
  if (!st.token) body = `<p class="lede">Sign in with the Google account where Cycle keeps its encrypted vault.</p><button class="btn primary wide" data-act="restore-signin">Sign in with Google</button>`;
  else if (!st.fileId) body = `<p class="lede">No Cycle vault was found in this Google account. Set Cycle up on the other device first, with sync turned on.</p><button class="btn wide" data-act="restore-retry">Search again</button>`;
  else body = `<p class="lede">Vault found. Enter its passphrase to bring your data to this device.</p>
    <form class="stack" data-form="restore">${USER}${pw('p', 'Vault passphrase', 'current-password', true, 0)}<button class="btn primary wide">Unlock and restore</button></form>
    ${S.meta ? '<p class="fine">This replaces the Cycle data on this device with the data from the vault.</p>' : ''}`;
  return `<section class="intro form-page"><h1>Restore from Google Drive</h1>${body}<button class="link" data-act="restore-cancel">Back</button></section>`;
}
// ---------------- B1: forgot passphrase ----------------
function forgotView() {
  return `<section class="intro form-page"><h1>Forgot your passphrase?</h1>
    <p class="lede">The passphrase cannot be recovered or reset, by you or anyone else. That is what keeps your data private. You can still get going again:</p>
    <div class="notice"><p><strong>First, check the other place.</strong> If you set Cycle up from the Home Screen icon, open it from there; if you used Safari, open it in Safari. Your older data may be there, under your older passphrase.</p></div>
    ${cfg.googleClientId ? '<button class="btn wide" data-act="restore-start">Restore from Google Drive</button><p class="fine">Needs the passphrase of your Drive vault.</p>' : ''}
    <button class="btn wide" data-act="import-start">Start again from a backup file</button><p class="fine">Uses a backup you exported earlier; you choose a new passphrase.</p>
    <button class="btn danger wide" data-act="erase-start">Erase Cycle on this device and start over</button><p class="fine">Removes only Cycle's data on this device. Your Finances app and your Google Drive are not touched.</p>
    <button class="link" data-act="back-locked">Back</button></section>`;
}
function importView() {
  return `<section class="intro form-page"><h1>Start again from a backup</h1>
    <form class="stack" data-form="import-new">${USER}
      <label>Backup file<input type="file" name="file" accept="application/json,.json" required></label>
      ${pw('p1', 'New passphrase', 'new-password')}${pw('p2', 'Repeat it', 'new-password')}
      <label class="choice"><input type="checkbox" name="saved" required> I have saved my new passphrase</label>
      <p class="fine">This replaces the locked Cycle data on this device.</p>
      <button class="btn primary wide">Restore backup</button></form>
    <button class="link" data-act="forgot">Back</button></section>`;
}
function eraseView() {
  return `<section class="intro form-page"><h1>Erase Cycle on this device?</h1>
    <p class="lede">All Cycle data on this device is deleted for good. Your Finances app and your Google Drive vault stay as they are.</p>
    <form class="stack" data-form="erase"><label>Type ERASE to confirm<input type="text" name="confirm" autocomplete="off" autocapitalize="characters" required></label>
      <button class="btn danger wide">Erase and start over</button></form>
    <button class="link" data-act="forgot">Back</button></section>`;
}
function lockedView() {
  const fid = S.meta && S.meta.lock;
  return `<section class="intro form-page">
    ${ringMark()}
    <h1>Cycle is locked</h1>
    ${fid && S.faceIdOk ? '<button class="btn primary wide" data-act="unlock-faceid">Unlock with Face ID</button><p class="fine center">or use your passphrase</p>' : ''}
    <form class="stack" data-form="unlock">${USER}${pw('p', 'Passphrase', 'current-password', !fid, 0)}<button class="btn ${fid && S.faceIdOk ? '' : 'primary'} wide">Unlock</button></form>
    <button class="link" data-act="forgot">Forgot passphrase?</button>
  </section>`;
}
const ringMark = () => `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="var(--ring-base)" stroke-width="8"/><path d="M32 8 A24 24 0 0 1 52.8 20" fill="none" stroke="var(--period)" stroke-width="8" stroke-linecap="round"/><path d="M55 38 A24 24 0 0 1 44 52.8" fill="none" stroke="var(--fertile)" stroke-width="8" stroke-linecap="round"/></svg>`;

// ---------------- Today (FR-06, FR-27, FR-29) ----------------
function todayView() {
  const p = S.pred, t = today();
  if (!p || p.empty) {
    return `${topbar('Today')}<section class="empty"><p class="lede">No period logged yet. Log the first day of your next period, or add a past one.</p>
      <button class="btn primary wide" data-act="period-start" data-date="${t}">My period started today</button>
      <button class="btn wide" data-act="add-past">Add a past period</button></section>`;
  }
  const st = p.state;
  const wording = !!S.data.settings.wording;
  let sub;
  if (st.id === 'late') sub = `Period ${plural(st.daysLate, 'day')} late`;
  else if (st.daysToNext === 0) sub = 'Period expected today';
  else if (st.daysToNext > 0) sub = `Next period in ${plural(st.daysToNext, 'day')}`;
  else sub = 'Next period expected now';
  const fertileLine = st.id === 'fertile'
    ? `<p class="fertile-line ${st.peak ? 'peak' : ''}">${wording ? (st.peak ? 'High chance of pregnancy' : 'Higher chance of pregnancy') : (st.peak ? 'Peak fertile days (estimated)' : 'Possible fertile days (estimated)')}</p>` : '';
  const actions = st.id === 'menstruation' && st.periodOpen
    ? `<button class="btn primary" data-act="period-end" data-date="${t}">Period ended today</button><button class="btn" data-act="period-end-earlier">Ended on another day</button>`
    : st.id === 'menstruation' ? '' : `<button class="btn primary" data-act="period-start" data-date="${t}">Period started today</button><button class="btn" data-act="add-past">Started on another day</button>${openPeriodBefore(t) ? '<button class="btn" data-act="period-end-earlier">Log when my last period ended</button>' : ''}`;
  const flow = (S.data.days[t] || {}).flow || 'none';
  const est = `<p class="estimate">${st.id === 'late' ? `Your period was expected ${fmt(p.nextRange[0])} to ${fmt(p.nextRange[1])}. Forecasts pause until you log it.` : `Next period estimated ${fmt(p.nextRange[0])} to ${fmt(p.nextRange[1])}. ${confidenceText(p)}`}</p>`;
  // One list of blocks; on a phone they stack in this order, on a laptop they split into two columns.
  return `${topbar('Today', `${weekday(t)}, ${fmt(t, true)}`)}
  ${flagCards()}
  <div class="today-grid">
    <div class="col">
      <section class="ring-block o1">${cycleRing(p)}
        <div class="ring-center"><span class="cd">Day ${st.cycleDay}</span><span class="stl">${h(st.label)}</span><span class="sub">${sub}</span></div></section>
      <div class="o2">${fertileLine}${wording && st.id === 'fertile' ? `<p class="warning">${WARNING}</p>` : ''}${est}</div>
      <div class="o4">${weekStrip(p)}</div>
      <div class="actions o5">${actions}</div>
      <section class="card o6"><h2>Bleeding today</h2>
        <div class="chips" role="radiogroup" aria-label="Bleeding today">${FLOWS.map(([v, l]) => `<button class="chip ${flow === v ? 'on' : ''}" role="radio" aria-checked="${flow === v}" data-act="flow" data-date="${t}" data-flow="${v}">${l}</button>`).join('')}</div></section>
    </div>
    <div class="col">
      <div class="o2">${sharpenCard(p)}</div>
      <div class="o3">${checkinCard(t)}</div>
      <div class="o8">${phaseCard(st.id)}</div>
      <div class="o9">${foodTeaser()}</div>
      <div class="o10">${p.notes.filter((n) => n.kind !== 'doctor').map(noteCard).join('')}</div>
    </div>
  </div>`;
}
// B2 item 1: explain wide estimates and how to sharpen them
function sharpenCard(p) {
  if (p.usedCycles >= CONST.MEDIUM_FROM) return '';
  const need = CONST.MEDIUM_FROM - p.usedCycles;
  return `<section class="card sharpen"><h2>Sharpen your predictions</h2>
    <p class="fine">Cycle has ${p.usedCycles ? `${plural(p.usedCycles, 'complete cycle')} of yours` : 'no complete cycle of yours yet'}, so it relies on ${p.usedDefault ? 'a typical 29-day cycle' : 'the cycle length you entered'} with a ±${p.spread}-day margin. That is why the ranges are wide. Add ${need === 1 ? 'one more past period' : `${need} more past periods`} with their first and last days, and the estimates narrow to your own rhythm.</p>
    <button class="btn" data-act="add-past">Add a past period</button></section>`;
}
// B2 item 6: what is happening now
function phaseCard(id) {
  const info = T.PHASE_INFO[id]; if (!info) return '';
  return `<section class="card phase"><h2>${h(info.title)}</h2><p>${h(info.text)}</p>
    <p class="fine">Sources: ${info.src.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${h(n)}</a>`).join('; ')}</p></section>`;
}
const WARNING = 'Calendar-based estimate. With typical use, fertility-awareness methods lead to 12–24 pregnancies per 100 women in the first year. This is not a reliable method of birth control: use contraception on any day if you want to avoid pregnancy.';
const FLOWS = [['none', 'None'], ['spotting', 'Spotting'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']];
function confidenceText(p) {
  if (p.confidence === 'Medium') return `Medium confidence: based on your last ${p.usedCycles} cycles.`;
  if (p.usedCycles) return `Low confidence: based on ${plural(p.usedCycles, 'cycle')} so far.`;
  return p.usedDefault ? 'Low confidence: no cycle logged yet, so a typical 29-day cycle is assumed.' : 'Low confidence: based on the cycle length you entered.';
}
// ---------------- v2: warnings, check-in, suggestions, food ----------------
function flagCards() {
  const open = (S.flags || []).filter((f) => !S.data.acks[f.id]);
  const urgent = open.filter((f) => f.level === 'urgent');
  const one = urgent.length > 1 ? `<section class="flag urgent" role="alert"><h2>Seek medical care today</h2><ul>${urgent.map((f) => `<li>${h(f.text)}</li>`).join('')}</ul>
    <p class="fine">Source: <a href="${T.SRC.mayoHmb.url}" target="_blank" rel="noopener noreferrer">${h(T.SRC.mayoHmb.name)}</a></p>
    <button class="btn small" data-act="ack" data-id="${h(urgent.map((f) => f.id).join('|'))}">I have read this</button></section>` : '';
  return one + open.filter((f) => !(one && f.level === 'urgent')).map((f) => `<section class="flag ${f.level}" role="alert"><h2>${h(f.title)}</h2><p>${h(f.text)}</p>
    ${f.phone ? `<a class="btn primary" href="tel:${f.phone}">Call 0800 111 0 111</a>` : ''}
    ${f.src ? `<p class="fine">Source: <a href="${T.SRC[f.src].url}" target="_blank" rel="noopener noreferrer">${h(T.SRC[f.src].name)}</a></p>` : ''}
    <button class="btn small" data-act="ack" data-id="${h(f.id)}">I have read this</button></section>`).join('');
}
function checkinCard(date) {
  const ci = S.data.checkins[date];
  const recs = ci ? recsFor(ci, phaseOn(date)) : [];
  if (!ci) return `<section class="card checkin"><h2>How are you today?</h2><p class="fine">A few quick questions for this part of your cycle. Takes under 30 seconds.</p><button class="btn primary" data-act="checkin" data-date="${date}">Start check-in</button></section>`;
  const logged = Object.entries(ci.symptoms || {}).filter(([, s]) => s).map(([c, s]) => T.MOOD_GOOD.some((m) => m.code === c) ? T.label(c) : `${T.label(c)} (${T.SEVERITY[s].toLowerCase()})`);
  return `<section class="card checkin"><h2>Today's check-in</h2><p class="fine">${logged.length ? h(logged.join(', ')) : 'No symptoms logged.'}</p>
    ${recs.map(recBlock).join('')}
    <button class="btn small" data-act="checkin" data-date="${date}">Edit check-in</button></section>`;
}
function recBlock(r) {
  return `<div class="rec"><h3>${h(r.title)}</h3><p>${h(r.text)}</p>${r.escalate ? `<p class="esc">${h(r.escalate)}</p>` : ''}
    ${r.src ? `<p class="fine">Source: <a href="${T.SRC[r.src].url}" target="_blank" rel="noopener noreferrer">${h(T.SRC[r.src].name)}</a></p>` : ''}</div>`;
}
function foodTeaser() {
  const ph = S.pred && !S.pred.empty ? phaseKey(S.pred.state.id) : 'follicular'; const f = T.FOOD[ph];
  return `<section class="card food-teaser"><h2>Food for now: ${h(f.title.toLowerCase())}</h2><p class="fine">${h(f.why)}</p><button class="btn small" data-tab="food">See foods</button></section>`;
}
const phaseKey = (id) => (['menstruation', 'luteal', 'late', 'fertile', 'follicular'].includes(id) ? id : 'follicular');

function foodView() {
  const cur = S.pred && !S.pred.empty ? phaseKey(S.pred.state.id) : 'follicular';
  const show = S.foodTab || cur;
  const tabs = [['menstruation', 'During your period'], ['follicular', 'Rest of the cycle'], ['luteal', 'Before your period']];
  const f = T.FOOD[show];
  const heavy = show === 'menstruation' && heavyDays(S.data, S.pred) >= 2;
  return `${topbar('Food')}
  <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${show === k || (k === 'follicular' && ['fertile', 'late'].includes(show))}" data-act="foodtab" data-k="${k}">${l}${phaseKey(cur) === k || (k === 'follicular' && ['fertile'].includes(cur)) ? ' (now)' : ''}</button>`).join('')}</div>
  <section class="card"><h2>${h(f.title)}</h2><p>${h(f.why)}</p>
    ${heavy ? `<p class="esc">${h(T.HEAVY_IRON_NOTE)}</p>` : ''}
    ${f.groups.map((g) => `<h3>${h(g.name)}</h3><ul class="foods">${g.items.map(([n, v]) => `<li><span>${h(n)}</span>${v ? `<b>${h(v)}</b>` : ''}</li>`).join('')}</ul>`).join('')}
    ${f.tips.map((t) => `<p class="tip">${h(t)}</p>`).join('')}
    ${['follicular', 'fertile'].includes(show) || (show === 'follicular') ? comingUp() : ''}
    ${f.src.length ? `<p class="fine">Sources: ${f.src.map((s) => `<a href="${T.SRC[s].url}" target="_blank" rel="noopener noreferrer">${h(T.SRC[s].name)}</a>`).join('; ')}. Iron values per serving from the NIH table (USDA FoodData Central).</p>` : ''}
  </section>
  <p class="fine">Food lists leave out beef, pork and other red meat. Cycle gives no supplement doses; ask your doctor before taking any.</p>`;
}

// B2 item 7: mid-cycle, preview what comes next
function comingUp() {
  const p = S.pred; if (!p || p.empty) return '';
  const lutealStart = addDays(p.possible[1], 1); const n = diff(lutealStart, today());
  const when = n > 0 ? `in about ${plural(n, 'day')}` : 'soon';
  return `<div class="next"><h3>Coming up ${when}: before your period</h3><p class="fine">${h(T.FOOD.luteal.title)}. ${h(T.FOOD.luteal.why)}</p>
    <button class="btn small" data-act="foodtab" data-k="luteal">See those foods</button></div>`;
}
function checkinSheet(date) {
  const ph = phaseOn(date); const q = T.CHECKIN[ph]; const ci = S.data.checkins[date] || {}; const sy = ci.symptoms || {};
  const flow = (S.data.days[date] || {}).flow || 'none';
  const yesno = (name, text) => `<fieldset class="q"><legend>${text}</legend>${[['1', 'Yes'], ['', 'No']].map(([v, l]) => `<label class="pick"><input type="radio" name="${name}" value="${v}" ${(!!ci[name]) === (v === '1') && (name in ci || v === '') ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`;
  const scale = (code) => `<fieldset class="q scale"><legend>${h(T.label(code))}</legend>${[0, 1, 2, 3].map((v) => `<label class="pick"><input type="radio" name="s_${code}" value="${v}" ${(sy[code] || 0) === v ? 'checked' : ''}><span>${v ? T.SEVERITY[v] : 'None'}</span></label>`).join('')}</fieldset>`;
  const asks = { flow: `<fieldset class="q"><legend>Bleeding</legend>${FLOWS.map(([v, l]) => `<label class="pick"><input type="radio" name="flow" value="${v}" ${flow === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`,
    change: `<fieldset class="q col"><legend>How often did you need to change your pad, tampon or cup?</legend>${T.CHANGE.map(([v, l]) => `<label class="pick"><input type="radio" name="change" value="${v}" ${ci.change === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}<label class="pick"><input type="radio" name="change" value="" ${!ci.change ? 'checked' : ''}><span>Not sure / not today</span></label></fieldset>`,
    clots: yesno('clots', 'Any clots the size of a 2-euro coin (2.5 cm) or larger?'),
    dizzy: yesno('dizzy', 'Feeling dizzy, faint, or a racing heart?'),
    discharge: `<fieldset class="q"><legend>Discharge</legend>${T.DISCHARGE.map(([v, l]) => `<label class="pick"><input type="radio" name="discharge" value="${v}" ${ci.discharge === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}<label class="pick"><input type="radio" name="discharge" value="" ${!ci.discharge ? 'checked' : ''}><span>Not noted</span></label></fieldset>`,
    sidepain: yesno('sidepain', 'Pain on one side of your lower belly?') };
  const others = T.SYMPTOMS.filter((s) => !q.symptoms.includes(s.code));
  const extraOpen = others.some((s) => sy[s.code]);
  return `<h2>${h(q.title)}: ${date === today() ? 'today' : fmt(date)}</h2>
  <form class="stack checkin-form" data-form="checkin" data-date="${date}">
    ${q.ask.map((k) => asks[k]).join('')}
    ${q.symptoms.map(scale).join('')}
    <fieldset class="q"><legend>Mood</legend>${T.MOOD_GOOD.map((m) => `<label class="pick"><input type="checkbox" name="g_${m.code}" ${sy[m.code] ? 'checked' : ''}><span>${m.label}</span></label>`).join('')}</fieldset>
    <details ${extraOpen ? 'open' : ''}><summary>Log another symptom</summary>${others.map((s) => scale(s.code)).join('')}</details>
    <label>Pain relief or medicine taken<input type="text" name="meds" maxlength="80" value="${h(ci.meds || '')}" placeholder="Optional"></label>
    <label>Notes<textarea name="note" rows="2" maxlength="500" placeholder="Optional">${h(ci.note || '')}</textarea></label>
    <p class="fine">Severity: mild = noticeable, moderate = disrupts the day, severe = stops normal activities.</p>
    <button class="btn primary">Save check-in</button>
  </form><button class="btn wide" data-act="close-sheet">Cancel</button>`;
}

function noteCard(n) {
  const btn = n.kind === 'late' ? '<button class="btn" data-act="add-past">Add an earlier start date</button>'
    : n.kind === 'check' ? '<button class="btn" data-tab="history">Review in History</button>'
    : n.kind === 'missed' ? `<div class="row"><button class="btn" data-act="add-past">Add the missed period</button><button class="btn" data-act="confirm-long" data-id="${n.periodId}">The length is right</button></div>` : '';
  return `<section class="note ${n.kind}"><p>${h(n.text)}</p>${btn}</section>`;
}

// The ring: one arc per phase, proportional to the current cycle's predicted length; a marker for today.
function cycleRing(p) {
  const R = 104, W = 18, cx = 130, cy = 130, start = p.lastStart;
  const total = Math.max(diff(p.nextStart, start), 1);
  const ang = (d) => -90 + (360 * d) / total;
  const pt = (a, r = R) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const arc = (d0, d1, cls, w = W) => {
    d0 = Math.max(0, d0); d1 = Math.min(total, d1); if (d1 <= d0) return '';
    const a0 = ang(d0) + 0.8, a1 = ang(d1) - 0.8; const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `<path class="${cls}" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke-width="${w}"/>`;
  };
  const periodEnd = p.lastPeriod.end ? diff(p.lastPeriod.end, start) + 1 : p.periodLen;
  const off = (d) => diff(d, start);
  const day = Math.min(p.state.cycleDay - 0.5, total - 0.01);
  const [mx, my] = pt(ang(day));
  const [ox, oy] = pt(ang(off(p.ovulation.likely) + 0.5));
  return `<svg class="ring" viewBox="0 0 260 260" role="img" aria-label="Cycle day ${p.state.cycleDay} of about ${total}. ${h(p.state.label)}.">
    <circle cx="${cx}" cy="${cy}" r="${R}" class="arc-base" stroke-width="${W}"/>
    ${arc(0, periodEnd, 'arc-period')}
    ${arc(off(p.possible[0]), off(p.possible[1]) + 1, 'arc-possible')}
    ${arc(off(p.peak[0]), off(p.peak[1]) + 1, 'arc-peak')}
    <circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="5" class="ovu-dot"/>
    <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="13" class="today-dot"/>
  </svg>`;
}
function weekStrip(p) {
  const t = today(); const cells = [];
  for (let i = -3; i <= 3; i++) {
    const d = addDays(t, i); const info = dayInfo(d, p, S.data.periods, S.data.days);
    cells.push(`<button class="wk ${d === t ? 'is-today' : ''}" data-act="day" data-date="${d}" aria-label="${weekday(d)} ${fmt(d)}: ${h(describe(info))}">
      <span class="wd">${weekday(d).slice(0, 2)}</span><span class="dn ${dayClass(info)}">${+d.slice(8)}</span><span class="sym">${daySymbol(info)}</span></button>`);
  }
  return `<div class="week">${cells.join('')}</div>`;
}
function dayClass(i) {
  const c = [];
  if (i.logged) c.push('m-period'); else if (i.predictedPeriod) c.push('m-pred');
  if (!i.logged && i.fertile) c.push(i.fertile === 'peak' ? 'm-peak' : 'm-possible');
  if (i.horizon > 1) c.push('far');
  return c.join(' ');
}
function daySymbol(i) {
  if (i.ovulation && !i.logged) return '<span class="s-ovu" title="Likely ovulation">●</span>';
  if (i.flow && i.flow !== 'none' && !i.logged) return '<span class="s-flow" title="Bleeding logged">◆</span>';
  return '';
}
function describe(i) {
  const parts = [];
  if (i.logged) parts.push('period'); else if (i.predictedPeriod) parts.push('predicted period');
  if (i.fertile === 'peak') parts.push('peak fertile day'); else if (i.fertile) parts.push('possible fertile day');
  if (i.ovulation) parts.push('likely ovulation');
  if (i.flow && i.flow !== 'none') parts.push(`${i.flow} bleeding logged`);
  return parts.join(', ') || 'no marks';
}

// ---------------- Calendar (FR-07, FR-08) ----------------
function calendarView() {
  const t = today(); const ym = S.month || t.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`; const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-pad"></span>');
  for (let d = 1; d <= daysIn; d++) {
    const ds = addDays(first, d - 1); const info = dayInfo(ds, S.pred || { empty: true }, S.data.periods, S.data.days);
    cells.push(`<button class="cal-day ${ds === t ? 'is-today' : ''}" data-act="day" data-date="${ds}" aria-label="${fmt(ds)}: ${h(describe(info))}"><span class="dn ${dayClass(info)}">${d}</span><span class="sym">${daySymbol(info)}</span></button>`);
  }
  const wording = !!S.data.settings.wording;
  return `${topbar('Calendar')}
  <div class="month-nav"><button class="icon-btn" data-act="month" data-step="-1" aria-label="Previous month">‹</button><h2>${MONTHS[m - 1]} ${y}</h2><button class="icon-btn" data-act="month" data-step="1" aria-label="Next month">›</button></div>
  <div class="cal-grid">${WD.map((w) => `<span class="cal-wd">${w.slice(0, 2)}</span>`).join('')}${cells.join('')}</div>
  ${ym !== t.slice(0, 7) ? '<button class="link center" data-act="month-today">Back to this month</button>' : ''}
  <section class="legend">
    <span><i class="lg m-period"></i>Period</span><span><i class="lg m-pred"></i>Predicted period</span>
    <span><i class="lg m-peak"></i>${wording ? 'High chance of pregnancy' : 'Peak fertile days'}</span><span><i class="lg m-possible"></i>${wording ? 'Higher chance of pregnancy' : 'Possible fertile days'}</span>
    <span><b class="s-ovu">●</b>Likely ovulation</span><span><b class="s-flow">◆</b>Bleeding logged</span>
  </section>
  <p class="fine">${wording ? WARNING : 'All future days are estimates. Paler marks are further ahead and less certain.'}</p>`;
}

// ---------------- History (FR-05) ----------------
function historyView() {
  const ps = livePeriods(S.data.periods).slice().reverse();
  const cyc = cycles(S.data.periods); const cycBy = Object.fromEntries(cyc.map((c) => [c.start, c]));
  const suspects = new Set((S.pred && !S.pred.empty ? S.pred.notes : []).filter((n) => n.kind === 'missed').map((n) => n.cycleStart));
  const p = S.pred;
  const stats = p && !p.empty ? `<section class="card stats">
      <div><span class="big">${p.cycleLen}</span><span class="cap">days, average cycle</span></div>
      <div><span class="big">±${p.spread}</span><span class="cap">days, spread</span></div>
      <div><span class="big">${p.periodLen}</span><span class="cap">days, period</span></div>
      <p class="fine">${confidenceText(p)} The average uses your last ${CONST.WINDOW} cycles at most; cycles you mark as excluded are left out.</p></section>` : '';
  const rows = ps.map((x) => {
    const c = cycBy[x.start]; const len = periodLength(x);
    return `<li class="hist ${x.excluded ? 'excl' : ''}"><div><strong>${fmt(x.start, true)}${x.end ? ` to ${fmt(x.end)}` : ''}</strong>
      <span class="fine">${len ? `${plural(len, 'day')} of bleeding` : 'End not logged'}${c ? `; cycle ${c.length} days${!c.valid ? ' (not used: check this)' : suspects.has(c.start) ? ' (possible missed period, not used)' : ''}` : '; current cycle'}${x.excluded ? `; excluded${x.excludeReason ? ` (${h(x.excludeReason)})` : ''}` : ''}</span></div>
      <button class="btn small" data-act="edit-period" data-id="${x.id}">Edit</button></li>`;
  }).join('');
  return `${topbar('History')}${stats}
    <button class="btn wide" data-act="add-past">Add a past period</button>
    ${ps.length ? `<ul class="hist-list">${rows}</ul>` : '<p class="fine">No periods logged yet.</p>'}`;
}

// ---------------- Settings (FR-10, FR-11, FR-27, NFR-13) ----------------
function settingsView() {
  const s = S.data.settings;
  return `${topbar('Settings', `Cycle ${VERSION}`)}
  <section class="card"><h2>Your cycle</h2>
    <form class="stack" data-form="settings">
      <label>Usual cycle length, in days<input type="number" name="usualCycle" min="15" max="90" inputmode="numeric" placeholder="I don't know" value="${h(s.usualCycle || '')}"></label>
      <label>Usual period length, in days<input type="number" name="usualPeriod" min="1" max="15" inputmode="numeric" placeholder="I don't know" value="${h(s.usualPeriod || '')}"></label>
      <label>Age<select name="ageBand">${[['18-25', '18–25'], ['26-41', '26–41'], ['42-45', '42–45'], ['other', 'Other']].map(([v, t]) => `<option value="${v}" ${s.ageBand === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <p class="fine">Once you have 3 logged cycles, predictions use your own history and the usual lengths above no longer matter.</p>
      <button class="btn">Save</button></form></section>
  <section class="card"><h2>Pregnancy-chance wording</h2>
    <p class="fine">Shows fertile days as "High" or "Higher chance of pregnancy", with a warning. No day is ever shown as safe.</p>
    <label class="switch"><span>Show pregnancy-chance wording</span><input type="checkbox" role="switch" data-act="wording" ${s.wording ? 'checked' : ''}></label></section>
  <section class="card"><h2>App lock</h2>
    ${S.meta.lock ? '<p class="fine">Face ID unlock is on for this device.</p><button class="btn" data-act="faceid-off">Turn off Face ID</button>'
      : S.faceIdOk ? '<p class="fine">Unlock with Face ID instead of typing your passphrase.</p><button class="btn" data-act="faceid-setup">Turn on Face ID</button>'
        : '<p class="fine">Face ID is not available in this browser. Cycle opens with your passphrase.</p>'}
    <p class="fine">Cycle locks itself after 5 minutes in the background.</p>
    <button class="btn" data-act="lock-now">Lock now</button></section>
  <section class="card"><h2>Change passphrase</h2>
    <form class="stack" data-form="change-pass">${USER}${pw('cur', 'Current passphrase', 'current-password', false, 0)}${pw('p1', 'New passphrase', 'new-password')}${pw('p2', 'Repeat new passphrase', 'new-password')}
      <p class="fine">Changes it on this device${S.meta.cloud && S.meta.cloud.fileId ? ' and in your Google Drive vault. Your other devices will ask for the new passphrase once' : ''}.${S.meta.lock ? ' Face ID needs to be turned on again afterwards.' : ''}</p>
      <button class="btn">Change passphrase</button></form></section>
  ${syncCard()}
  <section class="card"><h2>Your data</h2>
    <p class="fine">A backup file is not encrypted. Keep it somewhere private.</p>
    <div class="row"><button class="btn" data-act="export-json">Export backup</button><button class="btn" data-act="export-csv">Export periods as CSV</button></div>
    <label class="btn file">Import a backup<input type="file" accept="application/json,.json" data-act="import-json" hidden></label>
    <button class="btn danger" data-act="wipe">Delete all data on this device</button></section>
  <section class="card about"><h2>About</h2>
    <p class="fine">Cycle ${VERSION}. A wellness tracker, not medical advice and not a method of birth control. Predictions, suggestions and food lists follow these sources:</p>
    <ul class="fine sources">
      <li>Bull et al. 2019, 612,613 cycles (npj Digital Medicine): luteal phase 12.4 ± 2.4 days, mean cycle 29.3 days, bleed 4.0 days</li>
      <li>Wilcox 2000 and ACOG: fertile window from 5 days before to 1 day after ovulation</li>
      <li>FIGO 2018: normal cycle 24–38 days, normal variation about ±4 days</li>
      <li>ACOG: 12–24 pregnancies per 100 women in the first year of typical fertility-awareness use</li>
      <li>ACOG, Mayo Clinic and CDC: suggestions for symptoms and the warning signs for heavy or unusual bleeding</li>
      <li>NIH Office of Dietary Supplements: iron needs, iron in foods, and what helps or reduces its absorption</li>
    </ul></section>`;
}
function syncCard() {
  if (!cfg.googleClientId) return '<section class="card"><h2>Google Drive sync</h2><p class="fine">Not set up yet. Add the Google sign-in ID to config.js to keep an encrypted copy in your Google Drive and use Cycle on more than one device.</p></section>';
  const c = S.cloud, m = S.meta.cloud;
  let body;
  if (c.existing) body = `<p class="fine">A Cycle vault already exists in this Google Drive. Join it instead of creating a second one: enter that vault's passphrase. The data on this device is merged into it, and this device switches to the vault's passphrase.</p>
    <form class="stack" data-form="vault-join">${USER}${pw('p', "Vault's passphrase", 'current-password', false, 0)}<button class="btn primary">Join vault</button></form>
    <p class="fine">Don't know that passphrase any more? Delete ${C.VAULT_NAME} in Google Drive first, then create a new vault here.</p><button class="link" data-act="vault-join-cancel">Cancel</button>`;
  else if (m && m.fileId && c.status === 'newpass') body = `<p class="fine">The vault passphrase was changed on another device. Enter the new passphrase to keep syncing.</p>
    <form class="stack" data-form="vault-newpass">${USER}${pw('p', 'New vault passphrase', 'current-password', false, 0)}<button class="btn primary">Unlock vault</button></form>`;
  else if (!m || !m.fileId) body = tokenOk()
    ? '<p class="fine">Signed in. Create the encrypted vault in your Google Drive. It uses your Cycle passphrase.</p><button class="btn primary" data-act="vault-create">Create vault</button>'
    : '<p class="fine">Keep an encrypted copy in your own Google Drive, so your data survives a lost phone and appears on your other devices.</p><button class="btn primary" data-act="gsignin">Sign in with Google</button>';
  else if (!tokenOk()) body = `<p class="fine">Google sign-in lasts about an hour. Sign in again to sync${m.dirty ? '; your latest changes are waiting' : ''}.</p><button class="btn primary" data-act="gsignin">Sign in again</button>`;
  else body = `<p class="fine">${c.status === 'error' ? `<span class="bad">${h(c.msg)}</span> ` : ''}Encrypted vault in your Google Drive (${C.VAULT_NAME}). Changes sync automatically.${m.lastSync ? ` Last sync ${fmtTime(m.lastSync)}.` : ''}</p>
    <div class="row"><button class="btn primary" data-act="sync-now">Sync now</button><button class="btn danger" data-act="disconnect">Disconnect</button></div>`;
  return `<section class="card"><h2>Google Drive sync</h2>${body}</section>`;
}
const fmtTime = (iso) => { const d = new Date(iso); return `${fmt(localToday(d))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function topbar(title, sub = '') {
  return `<header class="topbar"><div><h1>${h(title)}</h1>${sub ? `<p class="date">${h(sub)}</p>` : ''}</div>${syncPill()}</header>`;
}
function syncPill() {
  if (!cfg.googleClientId || !S.meta || !S.meta.cloud || !S.meta.cloud.fileId) return '';
  const c = S.cloud; const txt = c.busy ? 'Syncing' : !tokenOk() ? 'Sign in to sync' : c.status === 'error' ? 'Sync problem' : S.meta.cloud.dirty ? 'Saving' : 'Synced';
  return `<button class="pill ${c.status === 'error' ? 'bad' : tokenOk() && !c.busy ? 'ok' : ''}" data-tab="settings">${txt}</button>`;
}
function navBar() {
  const tabs = [['today', 'Today', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="2.2" class="f"/>'], ['calendar', 'Calendar', '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'], ['food', 'Food', '<path d="M12 21c-4.5 0-7-3.5-7-7.5C5 9 8 6 12 6s7 3 7 7.5c0 4-2.5 7.5-7 7.5z"/><path d="M12 6c0-1.6 1-3 2.5-3.5"/>'],
    ['history', 'History', '<path d="M5 6h14M5 12h14M5 18h9"/>'], ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>']];
  return `<nav class="tabs">${tabs.map(([id, l, ic]) => `<button data-tab="${id}" class="${S.tab === id ? 'on' : ''}" aria-current="${S.tab === id ? 'page' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${l}</span></button>`).join('')}</nav>`;
}

// ---------------- sheets ----------------
function sheetBody() {
  const s = S.sheet; const t = today();
  if (s.name === 'day') {
    const d = s.date; const info = S.pred && !S.pred.empty ? dayInfo(d, S.pred, S.data.periods, S.data.days) : { flow: (S.data.days[d] || {}).flow };
    const future = diff(d, t) > 0; const flow = (S.data.days[d] || {}).flow || 'none';
    const per = info.periodId ? S.data.periods.find((x) => x.id === info.periodId) : null;
    const open = !per ? openPeriodBefore(d) : null;
    let acts = '';
    if (!future) {
      if (open) acts = `<button class="btn" data-act="period-end" data-date="${d}">Period ended on this day</button><button class="btn" data-act="period-start" data-date="${d}">A new period started on this day</button>`;
      else if (per) acts = `${diff(d, per.start) >= 0 ? `<button class="btn" data-act="period-end" data-date="${d}">Period ended on this day</button>` : ''}<button class="btn" data-act="edit-period" data-id="${per.id}">Edit this period</button>`;
      else acts = `<button class="btn primary" data-act="period-start" data-date="${d}">Period started on this day</button>`;
    }
    return `<h2>${weekday(d)}, ${fmt(d, true)}</h2><p class="fine">${h(describe(info)).replace(/^./, (c) => c.toUpperCase())}.${future ? ' Future days show estimates only.' : ''}</p>
      ${future ? '' : `<h3>Bleeding</h3><div class="chips">${FLOWS.map(([v, l]) => `<button class="chip ${flow === v ? 'on' : ''}" data-act="flow" data-date="${d}" data-flow="${v}">${l}</button>`).join('')}</div>`}
      ${future ? '' : daySymptoms(d)}
      <div class="stack-btns">${acts}<button class="btn" data-act="close-sheet">Close</button></div>`;
  }
  if (s.name === 'checkin') return checkinSheet(s.date);
  if (s.name === 'confirm-start') {
    const cd = S.pred && !S.pred.empty ? diff(s.date, S.pred.lastStart) + 1 : null;
    const mid = cd && cd >= 10 && cd <= 18;
    return `<h2>${mid ? 'Is this your period or spotting?' : 'Did your period start?'}</h2>
      <p class="fine">${mid ? `This is cycle day ${cd}. Light bleeding in mid-cycle is often spotting rather than a new period.` : `You logged ${h(s.flow)} bleeding on ${fmt(s.date)}.`}</p>
      <div class="stack-btns"><button class="btn ${mid ? '' : 'primary'}" data-act="period-start" data-date="${s.date}">Yes, my period started ${s.date === t ? 'today' : `on ${fmt(s.date)}`}</button>
      <button class="btn ${mid ? 'primary' : ''}" data-act="close-sheet">No, just log the bleeding</button></div>`;
  }
  if (s.name === 'add-past' || s.name === 'edit') {
    const p = s.name === 'edit' ? S.data.periods.find((x) => x.id === s.id) : { start: '', end: '' };
    return `<h2>${s.name === 'edit' ? 'Edit period' : 'Add a period'}</h2>
      <form class="stack" data-form="period" data-id="${s.name === 'edit' ? p.id : ''}">
        <label>First day of bleeding<input type="date" name="start" max="${t}" required value="${h(p.start)}" autofocus></label>
        <label>Last day of bleeding<input type="date" name="end" max="${t}" value="${h(p.end || '')}"><span class="fine">Leave empty if it hasn't ended or you don't remember.</span></label>
        ${s.name === 'edit' ? `<label class="choice"><input type="checkbox" name="excluded" ${p.excluded ? 'checked' : ''}> Leave this cycle out of predictions</label>
        <label>Reason<select name="excludeReason">${['', 'Illness', 'Travel', 'Stopped hormonal contraception', 'Missed logging', 'Other'].map((r) => `<option ${p.excludeReason === r ? 'selected' : ''} value="${r}">${r || 'None'}</option>`).join('')}</select></label>` : ''}
        <button class="btn primary">Save</button>
      </form>
      ${s.name === 'edit' ? `<button class="btn danger wide" data-act="delete-period" data-id="${p.id}">Delete this period</button>` : ''}
      <button class="btn wide" data-act="close-sheet">Cancel</button>`;
  }
  if (s.name === 'period-end-earlier') {
    const lp = S.pred.lastPeriod;
    return `<h2>When did your period end?</h2><form class="stack" data-form="end-earlier"><label>Last day of bleeding<input type="date" name="end" min="${lp.start}" max="${t}" required autofocus></label><button class="btn primary">Save</button></form><button class="btn wide" data-act="close-sheet">Cancel</button>`;
  }
  if (s.name === 'wording') {
    return `<h2>Before you turn this on</h2><p class="warning">${WARNING}</p>
      <p class="fine">Fertile days will be labelled "High" or "Higher chance of pregnancy". No day is ever labelled safe, because a wrong "safe" day can lead to an unplanned pregnancy.</p>
      <div class="stack-btns"><button class="btn primary" data-act="wording-accept">I understand, turn it on</button><button class="btn" data-act="close-sheet">Cancel</button></div>`;
  }
  if (s.name === 'confirm') {
    return `<h2>${h(s.title)}</h2><p class="fine">${h(s.text)}</p><div class="stack-btns"><button class="btn ${s.danger ? 'danger' : 'primary'}" data-act="confirm-yes">${h(s.yes)}</button><button class="btn" data-act="close-sheet">Cancel</button></div>`;
  }
  return '';
}
function daySymptoms(d) {
  const ci = S.data.checkins[d];
  const logged = ci ? Object.entries(ci.symptoms || {}).filter(([, s]) => s).map(([c, s]) => T.MOOD_GOOD.some((m) => m.code === c) ? T.label(c) : `${T.label(c)} (${T.SEVERITY[s].toLowerCase()})`) : [];
  return `<h3>Check-in</h3><p class="fine">${ci ? (logged.length ? h(logged.join(', ')) : 'No symptoms logged.') + (ci.note ? ` Note: ${h(ci.note)}` : '') : 'No check-in for this day.'}</p>
    <button class="btn small" data-act="checkin" data-date="${d}">${ci ? 'Edit check-in' : 'Add a check-in for this day'}</button>`;
}
function confirmSheet(title, text, yes, fn, danger = false) { S.confirmFn = fn; openSheet('confirm', { title, text, yes, danger }); }

// ---------------- data changes ----------------
// A period with no logged end that started up to 15 days before d (so its end can still be logged).
function openPeriodBefore(d) {
  const p = livePeriods(S.data.periods).filter((x) => diff(d, x.start) > 0).pop();
  return p && !p.end && diff(d, p.start) <= 15 ? p : null;
}
function overlapping(start, end, ignoreId) {
  const e = end || start;
  return livePeriods(S.data.periods).find((p) => {
    if (p.id === ignoreId) return false;
    const pe = p.end || p.start;
    return diff(start, pe) <= 0 && diff(e, p.start) >= 0;
  });
}
async function startPeriod(date) {
  if (diff(date, today()) > 0) { toast('A period cannot start in the future.'); return; }
  const o = overlapping(date, null);
  if (o) { toast(`That day is already part of the period starting ${fmt(o.start)}.`); return; }
  S.data.periods.push({ id: uid(), start: date, updatedAt: Date.now() });
  await persist(); S.sheet = null; render(); toast(`Period start saved: ${fmt(date)}`);
}
async function endPeriod(date) {
  const lp = livePeriods(S.data.periods).filter((p) => diff(date, p.start) >= 0).pop();
  if (!lp) { toast('No period starts before that day.'); return; }
  const next = livePeriods(S.data.periods).find((p) => diff(p.start, lp.start) > 0);
  if (next && diff(date, next.start) >= 0) { toast('That day is after the next period started.'); return; }
  Object.assign(lp, { end: date, updatedAt: Date.now() });
  await persist(); S.sheet = null; render(); toast(`Period end saved: ${fmt(date)}`);
}
async function setFlow(date, flow) {
  S.data.days[date] = { flow, updatedAt: Date.now() };
  await persist();
  const info = S.pred && !S.pred.empty ? dayInfo(date, S.pred, S.data.periods, S.data.days) : {};
  if (['light', 'medium', 'heavy'].includes(flow) && !info.logged) { openSheet('confirm-start', { date, flow }); return; }
  render();
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { S.tab = tabBtn.dataset.tab; S.sheet = null; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.act, d = b.dataset.date;
  try {
    if (a === 'start') { S.view = 'onboard'; render(); }
    else if (a === 'restore-start') { S.restore = {}; S.view = 'restore'; render(); }
    else if (a === 'restore-cancel') { S.view = S.meta ? 'forgot' : 'welcome'; render(); }
    else if (a === 'forgot') { S.view = 'forgot'; render(); }
    else if (a === 'back-locked') { S.view = 'locked'; render(); }
    else if (a === 'import-start') { S.view = 'import'; render(); }
    else if (a === 'erase-start') { S.view = 'erase'; render(); }
    else if (a === 'pw-toggle') { const inp = b.parentElement.querySelector('input'); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide passphrase' : 'Show passphrase'); }
    else if (a === 'confirm-long') { const p = S.data.periods.find((x) => x.id === b.dataset.id); Object.assign(p, { confirmedLong: true, updatedAt: Date.now() }); await persist(); render(); toast('Cycle length confirmed'); }
    else if (a === 'vault-join-cancel') { S.cloud.existing = null; render(); }
    else if (a === 'restore-signin') await signIn('restore');
    else if (a === 'restore-retry') await findForRestore();
    else if (a === 'faceid-skip') { S.view = 'app'; render(); }
    else if (a === 'faceid-setup') await faceIdSetup();
    else if (a === 'unlock-faceid') await unlockFaceId();
    else if (a === 'close-sheet') closeSheet();
    else if (a === 'period-start') await startPeriod(d);
    else if (a === 'period-end') await endPeriod(d);
    else if (a === 'period-end-earlier') openSheet('period-end-earlier');
    else if (a === 'add-past') openSheet('add-past');
    else if (a === 'edit-period') openSheet('edit', { id: b.dataset.id });
    else if (a === 'delete-period') confirmSheet('Delete this period?', 'Predictions will be recalculated without it.', 'Delete', async () => {
      const p = S.data.periods.find((x) => x.id === b.dataset.id); Object.assign(p, { deleted: true, updatedAt: Date.now() }); await persist(); closeSheet(); toast('Period deleted');
    }, true);
    else if (a === 'confirm-yes') { const fn = S.confirmFn; S.confirmFn = null; if (fn) await fn(); }
    else if (a === 'flow') await setFlow(d, b.dataset.flow);
    else if (a === 'day') openSheet('day', { date: d });
    else if (a === 'checkin') openSheet('checkin', { date: d });
    else if (a === 'foodtab') { S.foodTab = b.dataset.k; render(); }
    else if (a === 'ack') { for (const id of b.dataset.id.split('|')) S.data.acks[id] = { at: new Date().toISOString(), updatedAt: Date.now() }; await persist(); render(); }
    else if (a === 'month') { const [y, m] = (S.month || today().slice(0, 7)).split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + Number(b.dataset.step), 1)); S.month = dt.toISOString().slice(0, 7); render(); }
    else if (a === 'month-today') { S.month = null; render(); }
    else if (a === 'wording-accept') { S.data.settings = { ...S.data.settings, wording: true, wordingAcceptedAt: new Date().toISOString(), updatedAt: Date.now() }; await persist(); closeSheet(); toast('Pregnancy-chance wording is on'); }
    else if (a === 'faceid-off') { S.meta.lock = null; await kvSet('meta', S.meta); render(); toast('Face ID unlock is off'); }
    else if (a === 'lock-now') lockApp();
    else if (a === 'export-json') download(`cycle-backup-${today()}.json`, JSON.stringify(S.data, null, 1), 'application/json');
    else if (a === 'export-csv') download(`cycle-periods-${today()}.csv`, csv(), 'text/csv');
    else if (a === 'wipe') confirmSheet('Delete all data on this device?', 'Everything Cycle stores on this device is removed. Your Google Drive vault, if any, is not touched.', 'Delete everything', async () => {
      await kvClear(); Object.assign(S, { meta: null, key: null, data: null, pred: null, sheet: null, view: 'welcome', cloud: { token: null, status: 'off', msg: '', busy: false } }); render();
    }, true);
    else if (a === 'gsignin') await signIn('sync');
    else if (a === 'vault-create') {
      busy(true, 'Checking Google Drive');
      try { const files = await C.findVault(S.cloud.token.token); busy(false);
        if (files.length) { S.cloud.existing = files[0]; render(); return; } }
      catch (e) { busy(false); throw e; }
      await cloudAction('Vault created', createVaultFlow);
    }
    else if (a === 'sync-now') await syncNow();
    else if (a === 'disconnect') confirmSheet('Stop syncing this device?', 'Your data stays on this device and in Google Drive.', 'Disconnect', async () => {
      S.meta.cloud = null; await kvSet('meta', S.meta); closeSheet(); toast('Sync is off on this device');
    });
  } catch (err) { console.error(err); toast(err.message || 'Something went wrong.'); }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'wording') {
    if (el.checked) { el.checked = false; openSheet('wording'); }
    else { S.data.settings = { ...S.data.settings, wording: false, updatedAt: Date.now() }; await persist(); render(); toast('Pregnancy-chance wording is off'); }
  } else if (el.dataset.act === 'import-json' && el.files[0]) {
    try {
      const inc = JSON.parse(await el.files[0].text());
      if (inc.app !== 'cycle' || !Array.isArray(inc.periods)) throw new Error('This file is not a Cycle backup.');
      S.data = upgrade(C.merge(S.data, inc)); await persist(); render(); toast(`Backup imported: ${livePeriods(inc.periods).length} periods`);
    } catch (err) { toast(err.message); }
    el.value = '';
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f); const kind = f.dataset.form;
  try {
    if (kind === 'onboard') {
      const num = (k, lo, hi) => { const v = Number(fd.get(k)); return v >= lo && v <= hi ? v : null; };
      S.draft = { last: fd.get('last'), usualCycle: num('usualCycle', 15, 90), usualPeriod: num('usualPeriod', 1, 15), ageBand: fd.get('ageBand') };
      if (S.draft.last && diff(S.draft.last, today()) > 0) { toast('The last period cannot be in the future.'); return; }
      S.view = 'passphrase'; render();
    } else if (kind === 'passphrase') {
      if (fd.get('p1') !== fd.get('p2')) { toast('The two passphrases are different.'); return; }
      busy(true, 'Encrypting');
      const salt = K.newSalt(); S.key = await K.deriveKey(fd.get('p1'), salt);
      const d = S.draft; S.data = fresh();
      S.data.settings = { usualCycle: d.usualCycle, usualPeriod: d.usualPeriod, ageBand: d.ageBand, accepted: new Date().toISOString(), wording: false, updatedAt: Date.now() };
      if (d.last) S.data.periods.push({ id: uid(), start: d.last, updatedAt: Date.now() });
      S.meta = { salt, iter: K.ITER, created: new Date().toISOString(), lock: null, cloud: null };
      await kvSet('meta', S.meta); await persist(); S.draft = {};
      busy(false); S.view = S.faceIdOk ? 'faceid' : 'app'; render();
    } else if (kind === 'unlock') {
      busy(true, 'Unlocking');
      const key = await K.deriveKey(fd.get('p'), S.meta.salt, S.meta.iter);
      S.data = upgrade(await K.open(await kvGet('sealed'), key)); S.key = key; afterUnlock();
    } else if (kind === 'erase') {
      if ((fd.get('confirm') || '').trim().toUpperCase() !== 'ERASE') { toast('Type ERASE to confirm.'); return; }
      await kvClear(); Object.assign(S, { meta: null, key: null, data: null, pred: null, view: 'welcome', cloud: { token: null, status: 'off', msg: '', busy: false } }); render(); toast('Cycle was erased on this device');
    } else if (kind === 'import-new') {
      if (fd.get('p1') !== fd.get('p2')) { toast('The two passphrases are different.'); return; }
      const inc = JSON.parse(await fd.get('file').text());
      if (inc.app !== 'cycle' || !Array.isArray(inc.periods)) throw new Error('This file is not a Cycle backup.');
      busy(true, 'Restoring');
      const salt = K.newSalt(); S.key = await K.deriveKey(fd.get('p1'), salt); S.data = upgrade(inc);
      S.meta = { salt, iter: K.ITER, created: new Date().toISOString(), lock: null, cloud: null };
      await kvSet('meta', S.meta); await persist(); busy(false); S.view = S.faceIdOk ? 'faceid' : 'app'; render(); toast('Backup restored');
    } else if (kind === 'change-pass') {
      if (fd.get('p1') !== fd.get('p2')) { toast('The two new passphrases are different.'); return; }
      busy(true, 'Changing passphrase'); await changePassphrase(fd.get('cur'), fd.get('p1')); busy(false); render(); toast('Passphrase changed');
    } else if (kind === 'vault-join') {
      busy(true, 'Joining vault'); await joinVault(fd.get('p')); busy(false); render(); toast('Joined your existing vault');
    } else if (kind === 'vault-newpass') {
      busy(true, 'Unlocking vault'); await joinVault(fd.get('p'), S.meta.cloud.fileId); busy(false); render(); toast('Sync is working again');
    } else if (kind === 'restore') {
      busy(true, 'Restoring');
      await restoreFlow(fd.get('p'));
    } else if (kind === 'period') {
      const start = fd.get('start'), end = fd.get('end') || null, id = f.dataset.id;
      if (!isDate(start)) { toast('Choose the first day of bleeding.'); return; }
      if (diff(start, today()) > 0 || (end && diff(end, today()) > 0)) { toast('Dates cannot be in the future.'); return; }
      if (end && diff(end, start) < 0) { toast('The last day is before the first day.'); return; }
      const o = overlapping(start, end, id);
      if (o) { toast(`These days overlap the period starting ${fmt(o.start)}.`); return; }
      if (id) { const p = S.data.periods.find((x) => x.id === id); Object.assign(p, { start, end, excluded: !!fd.get('excluded'), excludeReason: fd.get('excluded') ? fd.get('excludeReason') : '', confirmedLong: p.start === start ? !!p.confirmedLong : false, updatedAt: Date.now() }); }
      else S.data.periods.push({ id: uid(), start, end, updatedAt: Date.now() });
      await persist(); closeSheet(); toast('Period saved');
    } else if (kind === 'checkin') {
      const date = f.dataset.date; const symptoms = {};
      for (const [k, v] of fd.entries()) {
        if (k.startsWith('s_') && Number(v) > 0) symptoms[k.slice(2)] = Number(v);
        if (k.startsWith('g_')) symptoms[k.slice(2)] = 1;
      }
      const ci = { symptoms, updatedAt: Date.now() };
      for (const k of ['change', 'discharge']) if (fd.get(k)) ci[k] = fd.get(k);
      for (const k of ['clots', 'dizzy', 'sidepain']) if (fd.has(k)) ci[k] = fd.get(k) === '1';
      if ((fd.get('meds') || '').trim()) ci.meds = fd.get('meds').trim();
      if ((fd.get('note') || '').trim()) ci.note = fd.get('note').trim();
      S.data.checkins[date] = ci;
      if (fd.has('flow') && fd.get('flow') !== ((S.data.days[date] || {}).flow || 'none')) S.data.days[date] = { flow: fd.get('flow'), updatedAt: Date.now() };
      await persist(); S.sheet = null; render(); window.scrollTo(0, 0); toast('Check-in saved');
    } else if (kind === 'end-earlier') await endPeriod(fd.get('end'));
    else if (kind === 'settings') {
      const num = (k, lo, hi) => { const v = Number(fd.get(k)); return v >= lo && v <= hi ? v : null; };
      S.data.settings = { ...S.data.settings, usualCycle: num('usualCycle', 15, 90), usualPeriod: num('usualPeriod', 1, 15), ageBand: fd.get('ageBand'), updatedAt: Date.now() };
      await persist(); render(); toast('Saved');
    }
  } catch (err) { busy(false); toast(err.message || 'Something went wrong.'); }
});

function busy(on, msg = '') { const b = $('#busy'); b.hidden = !on; b.querySelector('span').textContent = msg; }
function afterUnlock() { busy(false); recompute(); S.view = 'app'; render(); if (cloudReady()) syncNow(true); }
function lockApp() { S.key = null; S.data = null; S.pred = null; S.sheet = null; S.view = 'locked'; render(); }

// ---------------- Face ID ----------------
async function faceIdSetup() {
  busy(true, 'Waiting for Face ID');
  try { S.meta.lock = await Lock.setup(S.key); await kvSet('meta', S.meta); busy(false); toast('Face ID unlock is on'); S.view = 'app'; render(); }
  catch (e) { busy(false); toast(e.message); }
}
async function unlockFaceId() {
  busy(true, 'Waiting for Face ID');
  try { const key = await Lock.unlock(S.meta.lock); S.data = upgrade(await K.open(await kvGet('sealed'), key)); S.key = key; afterUnlock(); }
  catch (e) { busy(false); toast(e.message); }
}

// ---------------- Google Drive sync ----------------
const cloudReady = () => !!(cfg.googleClientId && S.meta && S.meta.cloud && S.meta.cloud.fileId && S.key);
const tokenOk = () => !!(S.cloud.token && S.cloud.token.exp > Date.now());
async function signIn(next) {
  if (!cfg.googleClientId) { toast('Google sync is not set up in config.js.'); return; }
  if (C.isStandalone()) { C.signInRedirect(cfg.googleClientId, next); return; }
  const tok = await C.signInWindow(cfg.googleClientId);
  S.cloud.token = tok; await kvSet('gtoken', tok);
  if (next === 'restore') { S.restore = { token: tok }; await findForRestore(); }
  else { render(); if (cloudReady()) await syncNow(); }
}
async function findForRestore() {
  const files = await C.findVault(S.restore.token.token);
  S.restore.fileId = files.length ? files[0].id : null; render();
}
async function restoreFlow(pass) {
  const tok = S.restore.token.token; const text = await C.download(tok, S.restore.fileId);
  const head = C.vaultHeader(text); const key = await K.deriveKey(pass, head.salt, head.iter);
  const data = await C.openVault(text, key);
  const meta = await C.fileMeta(tok, S.restore.fileId);
  S.key = key; S.data = upgrade(data);
  S.meta = { salt: head.salt, iter: head.iter, created: new Date().toISOString(), lock: null, cloud: { fileId: S.restore.fileId, remoteModified: meta.modifiedTime, lastSync: new Date().toISOString(), dirty: false } };
  S.cloud.token = S.restore.token; await kvSet('gtoken', S.cloud.token);
  await kvSet('meta', S.meta); await kvSet('sealed', await K.seal(S.data, S.key)); S.restore = null;
  busy(false); recompute(); S.view = S.faceIdOk ? 'faceid' : 'app'; render(); toast('Your data is on this device');
}
// Join an existing vault (B1) or follow a passphrase change made on another device.
async function joinVault(pass, fileId) {
  const tok = S.cloud.token.token; const id = fileId || S.cloud.existing.id;
  const text = await C.download(tok, id); const head = C.vaultHeader(text);
  const key = await K.deriveKey(pass, head.salt, head.iter);
  const remote = await C.openVault(text, key);
  S.data = upgrade(C.merge(S.data, remote)); S.key = key;
  S.meta.salt = head.salt; S.meta.iter = head.iter; S.meta.lock = null;
  S.meta.cloud = { fileId: id, remoteModified: null, lastSync: null, dirty: true };
  S.cloud.existing = null; S.cloud.status = 'ok';
  await kvSet('meta', S.meta); await persist(); await syncNow(true);
}
async function changePassphrase(cur, next) {
  const oldKey = await K.deriveKey(cur, S.meta.salt, S.meta.iter);
  await K.open(await kvGet('sealed'), oldKey, 'The current passphrase is not right.');
  const salt = K.newSalt(); S.key = await K.deriveKey(next, salt);
  S.meta.salt = salt; S.meta.iter = K.ITER; S.meta.lock = null;
  await kvSet('meta', S.meta); await kvSet('sealed', await K.seal(S.data, S.key));
  if (S.meta.cloud && S.meta.cloud.fileId && tokenOk()) {
    const res = await C.updateVault(S.cloud.token.token, S.meta.cloud.fileId, await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter));
    S.meta.cloud.remoteModified = res.modifiedTime; S.meta.cloud.dirty = false; await kvSet('meta', S.meta);
  } else if (S.meta.cloud && S.meta.cloud.fileId) { S.meta.cloud.dirty = true; await kvSet('meta', S.meta); }
}
async function createVaultFlow() {
  const res = await C.createVault(S.cloud.token.token, await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter));
  S.meta.cloud = { fileId: res.id, remoteModified: res.modifiedTime, lastSync: new Date().toISOString(), dirty: false };
  await kvSet('meta', S.meta);
}
async function cloudAction(done, fn) {
  busy(true, 'Talking to Google Drive');
  try { await fn(); toast(done); } catch (e) { if (e.code === 401) { S.cloud.token = null; await kvSet('gtoken', null); } toast(e.message); }
  finally { busy(false); render(); }
}
let pushTimer;
function markChanged() {
  if (!S.meta || !S.meta.cloud || !S.meta.cloud.fileId) return;
  S.meta.cloud.dirty = true; kvSet('meta', S.meta);
  clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(true), 1500);
}
async function syncNow(quiet = false) {
  if (!cloudReady() || S.cloud.busy || S.cloud.status === 'newpass') return;
  if (!tokenOk()) { if (!quiet) toast('Sign in with Google to sync.'); render(); return; }
  S.cloud.busy = true; if (!quiet) render();
  const tok = S.cloud.token.token, m = S.meta.cloud;
  try {
    const fm = await C.fileMeta(tok, m.fileId);
    if (fm.modifiedTime !== m.remoteModified) {
      const text = await C.download(tok, m.fileId); const head = C.vaultHeader(text);
      if (head.salt !== S.meta.salt) { S.cloud.status = 'newpass'; S.cloud.msg = ''; return; } // passphrase changed elsewhere
      const remote = await C.openVault(text, S.key);
      const merged = upgrade(C.merge(S.data, remote));
      const changedHere = JSON.stringify(merged) !== JSON.stringify(upgrade(C.merge(remote, remote)));
      S.data = merged; await kvSet('sealed', await K.seal(S.data, S.key)); recompute();
      m.remoteModified = fm.modifiedTime;
      if (changedHere) m.dirty = true;
    }
    if (m.dirty) { const res = await C.updateVault(tok, m.fileId, await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter)); m.remoteModified = res.modifiedTime; }
    m.dirty = false; m.lastSync = new Date().toISOString(); S.cloud.status = 'ok'; S.cloud.msg = '';
  } catch (e) {
    if (e.code === 401) { S.cloud.token = null; await kvSet('gtoken', null); }
    S.cloud.status = e.code === 401 ? 'signin' : 'error'; S.cloud.msg = e.message;
  } finally { S.cloud.busy = false; await kvSet('meta', S.meta); if (S.view === 'app') render(); }
}

// ---------------- export ----------------
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function csv() {
  const cyc = Object.fromEntries(cycles(S.data.periods).map((c) => [c.start, c.length]));
  const rows = [['start', 'end', 'period_days', 'cycle_days', 'excluded', 'reason']];
  for (const p of livePeriods(S.data.periods)) rows.push([p.start, p.end || '', periodLength(p) || '', cyc[p.start] || '', p.excluded ? 'yes' : 'no', p.excludeReason || '']);
  return rows.map((r) => r.join(',')).join('\n');
}

// ---------------- boot ----------------
(async () => {
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !S.key) location.reload(); else if (had) toast('Cycle was updated. Lock and reopen to load the new version.'); });
  }
  try { S.faceIdOk = await Lock.available(); } catch { S.faceIdOk = false; }
  S.meta = await kvGet('meta');
  S.cloud.token = await kvGet('gtoken');
  const red = C.readRedirect();
  if (red && red.token) { S.cloud.token = { token: red.token, exp: red.exp }; await kvSet('gtoken', S.cloud.token); }
  if (!S.meta || (red && red.next === 'restore')) {
    if (red && red.next === 'restore') { S.restore = { token: red.token ? S.cloud.token : null }; S.view = 'restore'; if (red.token) { try { await findForRestore(); } catch (e) { toast(e.message); } } }
    else S.view = 'welcome';
  } else { S.view = 'locked'; if (red && red.next === 'sync') S.tab = 'settings'; }
  if (red && red.error) toast(red.error);
  render();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') S.hiddenAt = Date.now();
    else if (S.view === 'app') {
      if (S.hiddenAt && Date.now() - S.hiddenAt > AUTO_LOCK_MS) lockApp();
      else { recompute(); render(); if (cloudReady()) syncNow(true); }
    }
  });
})();
window.__cycle = { S, predict, VERSION };
