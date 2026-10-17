// Cycle — v3.1 (flexible import B7, clearer restore B8). v3: backup start B6, wider range R1, history import FR-26, new look U2. Spec v0.3: FR-01–FR-17, FR-26, FR-27, FR-29; NFR-01–NFR-13.
import { predict, dayInfo, addDays, diff, localToday, livePeriods, periodLength, cycles, isDate, CONST } from './engine.js';
import * as K from './crypto.js';
import * as Lock from './lock.js';
import * as C from './cloud.js';
import * as T from './content.js';
import { evaluate, recsFor, heavyDays, lateResult } from './rules.js';
import * as TH from './themes.js';
import { moon, sprout } from './companion.js';
import { findPeriods, pdfToText } from './importer.js';

export const VERSION = 'v4';
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
  sheet: null, draft: {}, faceIdOk: false, hiddenAt: 0, imp: null,
  cloud: { token: null, status: 'off', msg: '', busy: false },
};
const fresh = () => ({ app: 'cycle', v: 1, schema: C.SCHEMA, settings: { updatedAt: Date.now() }, periods: [], days: {}, checkins: {}, acks: {} });
// v1 data has no check-ins or acknowledgements yet
const upgrade = (d) => ({ ...d, schema: Math.max(C.SCHEMA, d.schema || 0), days: d.days || {}, checkins: d.checkins || {}, acks: d.acks || {} });
// v4: one field of a day (flow, ovu = ovulation tests, sex) changes on its own, with its own time, so sync can merge per field
function setDay(date, field, value) {
  const now = Date.now(); S.data.days[date] = { ...(S.data.days[date] || {}), [field]: value, [field + 'At']: now, updatedAt: now };
}
// v4 (R5): date format and first day of the week; neutral defaults from the device's language
const usLocale = () => /^en-US/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '');
function display() { const d = (S.data && S.data.settings && S.data.settings.display) || {}; return { dateFmt: d.dateFmt || (usLocale() ? 'mdy' : 'dmy'), weekStart: d.weekStart || (usLocale() ? 'sun' : 'mon') }; }
// v4 (R6): what she chose to hide; hiding never deletes anything
function hidden(k) { const x = (S.data && S.data.settings && S.data.settings.hide) || {}; return !!x[k]; }
// v4 (R10): age from the birth year, always current; only used for age-dependent notes
function age() { const y = S.data && S.data.settings && +S.data.settings.birthYear; return y ? +today().slice(0, 4) - y : null; }
const today = () => localToday();
const uid = () => `p${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (q) => document.querySelector(q);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function fmt(d, withYear = false) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number); const f = display().dateFmt;
  if (f === 'num') return `${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}${withYear ? `/${y}` : ''}`;
  if (f === 'mdy') return `${MONTHS[m - 1].slice(0, 3)} ${dd}${withYear ? `, ${y}` : ''}`;
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

// ---------------- U2: look (appearance, theme, companion, cards). Stored only in her encrypted settings. ----------------
function look() {
  const l = (S.data && S.data.settings && S.data.settings.look) || {};
  return { ...TH.LOOK_DEFAULT, ...l, cards: { ...TH.LOOK_DEFAULT.cards, ...(l.cards || {}) } };
}
async function setLook(patch) {
  const now = Date.now(); S.data.settings = { ...S.data.settings, look: { ...look(), ...patch, updatedAt: now }, updatedAt: now };
  await persist(); render();
}
const sysDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
function applyLook() {
  const l = look(), r = document.documentElement;
  const dark = l.mode === 'dark' || (l.mode === 'auto' && sysDark());
  const t = TH.THEMES[l.theme] || TH.THEMES.tide; const [a, b] = dark ? t.dark : t.light; const ac = dark ? t.accent[1] : t.accent[0];
  r.dataset.mode = l.mode;
  // B13: the browser bar follows the chosen Light/Dark, not only the phone's setting
  const bar = l.mode === 'auto' ? null : (dark ? '#000000' : '#F2F2F7');
  for (const id of ['tc-light', 'tc-dark']) { const m = document.getElementById(id); if (m) { m.content = bar || (id === 'tc-dark' ? '#000000' : '#F2F2F7'); if (bar) m.removeAttribute('media'); else m.setAttribute('media', id === 'tc-dark' ? '(prefers-color-scheme: dark)' : '(prefers-color-scheme: light)'); } }
  for (const [k, v] of [['--h1', a], ['--h2', b], ['--accent', ac], ['--accent-tint', TH.tint(ac, dark ? 0.22 : 0.12)], ['--on-accent', dark ? TH.ON_ACCENT.dark : TH.ON_ACCENT.light]]) r.style.setProperty(k, v);
}

// B14: a background refresh (sync finished, app came back) must never redraw while she is typing or a sheet is open
function busyEditing() {
  const a = document.activeElement;
  return !!S.sheet || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || S.view !== 'app';
}
function softRender() {
  if (!busyEditing()) { render(); return; }
  S.redrawLater = true;
  for (const el of document.querySelectorAll('.pill[data-tab="settings"]')) el.outerHTML = syncPill();
}

// ---------------- render ----------------
function render() {
  S.redrawLater = false;
  document.body.classList.toggle('sheet-open', !!S.sheet);
  applyLook();
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
  if (S.sheet && S.view === 'app') {
    // v4: a sheet that is already open is redrawn in place, without playing the slide-in again (no flicker on each tap)
    const still = !sh.hidden && sh.dataset.name === S.sheet.name; const top = still ? (sh.querySelector('.sheet-card') || {}).scrollTop || 0 : 0;
    sh.innerHTML = `<div class="sheet-scrim ${still ? 'still' : ''}" data-act="close-sheet"></div><div class="sheet-card ${still ? 'still' : ''}" role="dialog" aria-modal="true"><div class="grabber" aria-hidden="true"></div>${sheetBody()}</div>`;
    sh.hidden = false; sh.dataset.name = S.sheet.name; if (top) sh.querySelector('.sheet-card').scrollTop = top;
  }
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
    <button class="btn wide" data-act="import-start">Start from a backup file</button>
    <button class="btn wide" data-act="restore-start" ${cfg.googleClientId ? '' : 'disabled'}>Restore from Google Drive</button>
    ${cfg.googleClientId ? '' : '<p class="fine">Restoring from Google Drive is not available in this copy of Cycle, because Google sign-in is not set up.</p>'}
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
      <label>Year of birth (optional)
        <input type="number" name="birthYear" min="1940" max="${+today().slice(0, 4) - 10}" inputmode="numeric" placeholder="For example 1990" value="${h(d.birthYear || '')}">
        <span class="fine">Only the year, stored encrypted. Used for notes that depend on age, not for the predictions.</span></label>
      <fieldset><legend>Your diet</legend>
        ${T.DIETS.map(([v, t]) => `<label class="choice"><input type="radio" name="diet" value="${v}" ${d.diet === v ? 'checked' : ''} required> ${t}</label>`).join('')}
        <span class="fine">Only changes which foods the Food tab lists. You can change it in Settings.</span></fieldset>
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
    <ol class="steps"><li>Tap <strong>Use Face ID</strong>.</li><li>Approve Face ID or Touch ID when your device asks.</li><li>If nothing appears, click or tap the page once and tap <strong>Use Face ID</strong> again.</li></ol>
    <button class="btn primary wide" data-act="faceid-setup">Use Face ID</button>
    <button class="btn wide" data-act="faceid-skip">Not now</button>
  </section>`;
}
function restoreView() {
  const st = S.restore || {};
  let body;
  const who = st.token && st.token.token ? `<p class="fine">${st.token.email ? `Signed in as <strong>${h(st.token.email)}</strong>` : 'Signed in to Google'}. <button class="link" data-act="restore-switch">Use a different Google account</button></p>` : '';
  if (!st.token) body = `<ol class="steps"><li>Tap <strong>Sign in with Google</strong>.</li><li>Choose the Google account where Cycle keeps its encrypted vault. It is the account used when sync was turned on.</li><li>Enter the vault passphrase.</li></ol><button class="btn primary wide" data-act="restore-signin">Sign in with Google</button>`;
  else if (!st.fileId) body = `<div class="notice"><p><strong>No Cycle vault was found in this Google account.</strong></p>
      <p class="fine">A vault exists only after Cycle sync has been turned on once, on a device that already has your data. Until then there is nothing to restore.</p></div>
    <h2>To create the vault</h2>
    <ol class="steps"><li>${S.meta ? 'Tap <strong>Back</strong>, then <strong>Start again from a backup file</strong>.' : 'Tap <strong>Set up on this phone</strong> below (or <strong>Start from a backup file</strong> if you have one).'}</li>
      <li>When Cycle is open, tap <strong>Settings</strong>, then find <strong>Google Drive sync</strong>.</li>
      <li>Tap <strong>Sign in with Google</strong>, then <strong>Create vault</strong>.</li>
      <li>On any other device, tap <strong>Restore from Google Drive</strong>.</li></ol>
    ${S.meta ? '' : '<button class="btn primary wide" data-act="start">Set up on this phone</button>'}
    <button class="btn wide" data-act="import-start">Start from a backup file</button>
    <p class="fine">Wrong Google account? Tap <strong>Use a different Google account</strong> above and choose the other one.</p>
    <button class="btn small" data-act="restore-retry">Search again</button>`;
  // B16 root cause (from v3.2): this "else" used to belong to the line above, so with no sign-in at all the
  // screen said "Vault found". Now "Vault found" needs both a sign-in and a found file.
  if (st.token && !st.fileId) body = who + body;
  else if (st.token && st.fileId) body = `${who}<p class="lede">Vault found in this account. Enter its passphrase to bring your data to this device.</p>
    <form class="stack" data-form="restore">${USER}${pw('p', 'Vault passphrase', 'current-password', true, 0)}<button class="btn primary wide">Unlock and restore</button></form>
    ${S.meta ? '<p class="fine">This replaces the Cycle data on this device with the data from the vault.</p>' : ''}
    <p class="fine">Not your vault, or the passphrase is lost? Tap <strong>Use a different Google account</strong> above. If the passphrase is lost for good, the vault cannot be opened; set Cycle up again from a backup file, then start a new vault in Settings.</p>`;
  return `<section class="intro form-page"><h1>Restore from Google Drive</h1>${body}<button class="link" data-act="restore-cancel">Back</button></section>`;
}
// ---------------- B1: forgot passphrase ----------------
function forgotView() {
  return `<section class="intro form-page"><h1>Forgot your passphrase?</h1>
    <p class="lede">The passphrase cannot be recovered or reset, by you or anyone else. That is what keeps your data private. You can still get going again. Try these in order:</p>
    <div class="notice"><p><strong>First, check the other place.</strong> If you set Cycle up from the Home Screen icon, open it from there; if you used Safari, open it in Safari. Your older data may be there, under your older passphrase.</p></div>
    ${cfg.googleClientId ? '<button class="btn wide" data-act="restore-start">Restore from Google Drive</button><p class="fine">Needs the passphrase of your Drive vault.</p>' : ''}
    <button class="btn wide" data-act="import-start">Start again from a backup file</button><p class="fine">Uses a backup you exported earlier; you choose a new passphrase.</p>
    <button class="btn danger wide" data-act="erase-start">Erase Cycle on this device and start over</button><p class="fine">Removes only Cycle's data on this device. Other apps on this device and your Google Drive are not touched.</p>
    <button class="link" data-act="back-locked">Back</button></section>`;
}
const PICK = 'application/json,.json,application/pdf,.pdf,text/csv,.csv,text/plain,.txt';
const pasteForm = () => `<form class="stack" data-form="import-paste"><textarea name="text" rows="5" required placeholder="For example: 2026-06-24 to 2026-06-28" aria-label="Dates to find"></textarea><button class="btn wide">Find dates</button></form>`;
const pasteSteps = () => `<ol class="steps"><li>In the other app or file, select the dates and tap <strong>Copy</strong>.</li><li>Tap the box below and choose <strong>Paste</strong>.</li><li>Tap <strong>Find dates</strong>.</li></ol>`;
function importPicker() {
  return `<ol class="steps"><li>Tap <strong>Choose a file</strong> and pick a Cycle backup, a PDF, a CSV or a text file. A file from your Google Drive vault also works.</li>
      <li>Check the periods Cycle found. Fix or remove any that are wrong.</li>
      <li>Choose a new passphrase. Cycle then stores everything encrypted on this device.</li></ol>
    <label class="btn primary file wide">Choose a file<input type="file" accept="${PICK}" data-act="import-pick" hidden></label>
    <p class="fine">Files are read on this device. Nothing is uploaded. A scanned PDF (a photo of a page) has no text to read; use Paste dates for that.</p>
    <h2>Or paste dates</h2>${pasteSteps()}${pasteForm()}`;
}
// B7: dates found in a PDF, CSV or text, shown as a list to check before anything is stored
const closeToPrev = (rows, i) => { const a = rows[i - 1], b = rows[i]; return !!(a && isDate(a.start) && isDate(b.start) && diff(b.start, a.start) >= 0 && diff(b.start, a.start) < 15); };
const CLOSE_NOTE = '<p class="fine warn">Less than 15 days after the row above. Remove it if it is the same period.</p>';
// I2: after a date is edited, the notes are updated in place (a redraw would drop the keyboard focus)
function refreshCloseNotes() {
  document.querySelectorAll('.irow').forEach((li, i) => {
    const has = li.querySelector('.warn'), want = S.imp && S.imp.rows && closeToPrev(S.imp.rows, i);
    if (want && !has) li.insertAdjacentHTML('beforeend', CLOSE_NOTE); else if (!want && has) has.remove();
  });
}
function reviewBody() {
  const m = S.imp; const inPage = S.view === 'import';
  const rows = m.rows.map((r, i) => {
    const close = closeToPrev(m.rows, i);
    return `<li class="irow ${r.off ? 'off' : ''}"><label class="tick"><input type="checkbox" data-act="row-tick" data-i="${i}" ${r.off ? '' : 'checked'}> Use this period</label><label>Start<input type="date" name="s${i}" value="${h(r.start)}" max="${today()}" data-act="row-start" data-i="${i}"></label>
      <label>End (optional)<input type="date" name="e${i}" value="${h(r.end)}" max="${today()}" data-act="row-end" data-i="${i}"></label>
      <button type="button" class="link" data-act="row-del" data-i="${i}" aria-label="Remove this period">Remove</button>
      ${r.preg ? '<p class="fine pregnote">The report marks this cycle as a pregnancy. Untick it if this was not a period.</p>' : ''}${close ? CLOSE_NOTE : ''}</li>`;
  }).join('');
  return `<div class="notice"><p><strong>${plural(m.rows.length, 'period')} found</strong> in ${h(m.source)}.</p>
      <p class="fine">Nothing is stored yet. The list is a suggestion: dates in other apps are laid out differently, so look at every row.</p></div>
    <ol class="steps"><li>Check each Start and End date. Tap a date to change it.</li><li>Untick <strong>Use this period</strong>, or tap <strong>Remove</strong>, on rows that are not a period.</li><li>Tap <strong>Add a period</strong> for any that are missing.</li><li>Tap <strong>${inPage ? 'Continue' : 'Next'}</strong>.</li></ol>
    ${m.ambiguous ? `<p class="fine">Dates such as 05/06/2026 can be read two ways. Cycle read them as ${m.order === 'mdy' ? 'month/day' : 'day/month'}. <button class="btn small" data-act="import-order" data-order="${m.order === 'mdy' ? 'dmy' : 'mdy'}">Read as ${m.order === 'mdy' ? 'day/month' : 'month/day'} instead</button> (this starts the list again)</p>` : ''}
    ${m.skipped ? `<p class="fine">${plural(m.skipped, 'date')} without a year or with an impossible day ${m.skipped === 1 ? 'was' : 'were'} skipped.</p>` : ''}
    ${!inPage && livePeriods(S.data.periods).length ? `<label class="replace-opt"><input type="checkbox" data-act="import-replace" ${m.replace ? 'checked' : ''}> <span><strong>Replace my periods with this list</strong><br><span class="fine">Use this when Cycle already holds wrong or extra periods. Your ${plural(livePeriods(S.data.periods).length, 'current period')} will be removed first (you will see the count before anything changes).</span></span></label>` : ''}
    <ul class="irows">${rows}</ul>
    <div class="stack-btns"><button class="btn" data-act="row-add">Add a period</button><button class="btn primary" data-act="review-continue">${inPage ? 'Continue' : 'Next'}</button>
      <button class="btn" data-act="import-reset">${inPage ? 'Choose another file' : 'Cancel'}</button></div>`;
}
function importView() {
  const m = S.imp; let body;
  if (!m) body = importPicker();
  else if (m.kind === 'found') body = reviewBody();
  else if (m.kind === 'vault' && !m.data) body = vaultOpenForm();
  else body = `<div class="notice"><p><strong>${h(backupSummary(m.data))}</strong></p><p class="fine">Nothing is stored yet. Choose a passphrase to encrypt it on this device.</p></div>
    <form class="stack" data-form="import-new">${USER}
      ${pw('p1', 'New passphrase', 'new-password', true)}${pw('p2', 'Repeat it', 'new-password')}
      <label class="choice"><input type="checkbox" name="saved" required> I have saved my new passphrase</label>
      ${S.meta ? '<p class="fine">This replaces the locked Cycle data on this device.</p>' : ''}
      <button class="btn primary wide">Restore backup</button></form>`;
  return `<section class="intro form-page"><h1>${S.meta ? 'Start again from a backup' : 'Start from a backup file'}</h1>${body}
    <button class="link" data-act="${S.meta ? 'forgot' : 'import-back'}">Back</button></section>`;
}
const vaultOpenForm = () => `<p class="lede">This file is encrypted: an encrypted backup or a Google Drive vault file. Enter the passphrase it was made with to read it.</p>
  <form class="stack" data-form="import-open">${USER}${pw('p', 'Passphrase of this file', 'current-password', true, 0)}<button class="btn primary wide">Open the file</button></form>`;
// FR-26 + B7: read a chosen file. A Cycle backup is plain JSON; a Drive vault file is encrypted and needs its passphrase first;
// a PDF, CSV or text file from another app is searched for period dates, which the person then checks.
async function readBackup(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'; let text;
  if (isPdf) {
    try { text = await pdfToText(await file.arrayBuffer()); } catch { throw new Error('This PDF could not be read. Tap Back, then use Paste dates.'); }
    if (text.replace(/\s/g, '').length < 20) throw new Error('This PDF has no readable text, so it may be a scan. Use Paste dates instead.');
  } else text = await file.text();
  let obj = null;
  if (!isPdf) { try { obj = JSON.parse(text); } catch { /* not JSON: searched for dates below */ } }
  const okPeriods = (d) => d && d.app === 'cycle' && Array.isArray(d.periods) && d.periods.every((x) => x && typeof x === 'object' && isDate(x.start));
  if (okPeriods(obj)) return { kind: 'plain', data: obj };
  if (obj && obj.app === 'cycle-wellness-vault') return { kind: 'vault', head: C.vaultHeader(text), text };
  if (obj && typeof obj === 'object') throw new Error('This file is not a Cycle backup. Use Paste dates instead.');
  return foundFrom(text, file.name);
}
function foundFrom(text, source, order) {
  const r = findPeriods(text, { today: today(), order });
  if (!r.rows.length) throw new Error('No period dates were found. Use Paste dates and type or paste them in.');
  return { kind: 'found', text, source, rows: r.rows.map((x) => ({ ...x })), order: r.order, ambiguous: r.ambiguous, skipped: r.skipped };
}
// I1: what a file holds, shown before anything is imported
function backupSummary(d) {
  const ps = livePeriods(d.periods).slice().sort((x, y) => (x.start < y.start ? -1 : 1));
  return ps.length ? `${plural(ps.length, 'period')}, from ${fmt(ps[0].start, true)} to ${fmt(ps[ps.length - 1].start, true)}` : 'This file holds no periods';
}
function eraseView() {
  return `<section class="intro form-page"><h1>Erase Cycle on this device?</h1>
    <p class="lede">All Cycle data on this device is deleted for good. Other apps on this device and your Google Drive vault stay as they are.</p>
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
// L1 (v3): the Cycle logo, a sun over three waves (the same drawing as the app icon)
const ringMark = () => `<svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22.5" fill="#F8F0E3"/><path d="M49.51 16.81C49.19 16.83 48.85 16.84 48.53 16.87C48.20 16.90 47.87 16.94 47.54 16.99C47.21 17.04 46.89 17.12 46.56 17.19C46.23 17.27 45.90 17.35 45.58 17.44C45.25 17.53 44.92 17.62 44.59 17.73C44.26 17.84 43.94 17.97 43.61 18.12C43.28 18.27 42.95 18.43 42.63 18.60C42.30 18.77 41.97 18.96 41.64 19.15C41.32 19.35 40.99 19.56 40.66 19.79C40.33 20.02 39.99 20.28 39.68 20.55C39.36 20.82 39.06 21.10 38.76 21.40C38.46 21.69 38.16 22.01 37.88 22.33C37.60 22.65 37.33 22.99 37.08 23.31C36.84 23.64 36.63 23.97 36.42 24.30C36.22 24.63 36.04 24.95 35.86 25.28C35.69 25.61 35.52 25.94 35.37 26.26C35.22 26.59 35.10 26.92 34.97 27.25C34.84 27.57 34.72 27.90 34.62 28.23C34.51 28.56 34.43 28.89 34.35 29.21C34.26 29.54 34.17 29.87 34.11 30.20C34.05 30.52 34.04 30.85 34.00 31.18C33.95 31.51 33.90 31.84 33.86 32.16C33.83 32.49 33.80 32.82 33.80 33.15C33.80 33.47 33.83 33.80 33.86 34.13C33.89 34.46 33.95 34.78 33.99 35.11C34.03 35.44 34.05 35.77 34.11 36.10C34.16 36.42 34.23 36.76 34.32 37.08C34.42 37.40 34.46 37.79 34.67 38.03C34.89 38.26 35.28 38.34 35.60 38.48C35.92 38.63 36.26 38.74 36.59 38.89C36.91 39.04 37.24 39.23 37.57 39.40C37.90 39.58 38.23 39.76 38.55 39.93C38.88 40.11 39.21 40.28 39.54 40.46C39.86 40.64 40.19 40.83 40.52 41.01C40.85 41.20 41.18 41.39 41.50 41.57C41.83 41.76 42.16 41.95 42.49 42.13C42.81 42.32 43.14 42.50 43.47 42.69C43.80 42.88 44.12 43.08 44.45 43.25C44.78 43.43 45.11 43.59 45.44 43.75C45.76 43.91 46.09 44.08 46.42 44.23C46.75 44.37 47.07 44.50 47.40 44.63C47.73 44.76 48.06 44.89 48.38 45.00C48.71 45.12 49.04 45.23 49.37 45.33C49.70 45.43 50.02 45.52 50.35 45.61C50.68 45.70 51.01 45.79 51.33 45.85C51.66 45.91 51.99 45.94 52.32 45.97C52.65 46.01 52.97 46.03 53.30 46.06C53.63 46.08 53.96 46.13 54.28 46.13C54.61 46.13 54.94 46.09 55.27 46.05C55.59 46.02 55.92 45.98 56.25 45.93C56.58 45.88 56.91 45.83 57.23 45.75C57.56 45.68 57.89 45.57 58.22 45.47C58.54 45.36 58.87 45.26 59.20 45.13C59.53 45.00 59.85 44.85 60.18 44.69C60.51 44.53 60.84 44.38 61.17 44.18C61.49 43.98 61.84 43.73 62.15 43.48C62.46 43.24 62.78 42.97 63.03 42.69C63.29 42.41 63.48 42.10 63.70 41.78C63.91 41.47 64.11 41.13 64.30 40.80C64.48 40.47 64.66 40.15 64.81 39.82C64.97 39.49 65.11 39.16 65.24 38.83C65.37 38.51 65.49 38.18 65.59 37.85C65.69 37.52 65.77 37.20 65.85 36.87C65.92 36.54 65.99 36.21 66.05 35.88C66.11 35.56 66.15 35.23 66.19 34.90C66.24 34.57 66.29 34.25 66.32 33.92C66.35 33.59 66.37 33.26 66.36 32.94C66.35 32.61 66.30 32.28 66.26 31.95C66.23 31.62 66.20 31.30 66.15 30.97C66.11 30.64 66.04 30.31 65.98 29.99C65.92 29.66 65.87 29.33 65.80 29.00C65.72 28.68 65.62 28.35 65.51 28.02C65.41 27.69 65.29 27.36 65.16 27.04C65.03 26.71 64.90 26.38 64.74 26.05C64.58 25.73 64.40 25.40 64.21 25.07C64.02 24.74 63.81 24.41 63.60 24.09C63.38 23.76 63.16 23.42 62.92 23.10C62.67 22.79 62.41 22.49 62.13 22.19C61.85 21.88 61.55 21.56 61.23 21.27C60.92 20.98 60.58 20.70 60.25 20.45C59.93 20.19 59.60 19.96 59.27 19.73C58.94 19.51 58.61 19.29 58.29 19.08C57.96 18.88 57.63 18.69 57.30 18.52C56.98 18.35 56.65 18.20 56.32 18.06C55.99 17.93 55.66 17.82 55.34 17.71C55.01 17.60 54.68 17.50 54.35 17.40C54.03 17.31 53.70 17.23 53.37 17.16C53.04 17.08 52.72 16.99 52.39 16.95C52.06 16.90 51.73 16.90 51.40 16.88C51.08 16.85 50.74 16.80 50.42 16.79C50.11 16.78 49.82 16.80 49.51 16.81Z" fill="#E84C7D"/><path d="M23.95 38.87C23.64 38.89 23.29 38.94 22.96 38.99C22.64 39.04 22.31 39.10 21.98 39.16C21.65 39.23 21.32 39.29 21.00 39.37C20.67 39.46 20.34 39.57 20.01 39.68C19.69 39.78 19.36 39.89 19.03 40.01C18.70 40.14 18.38 40.29 18.05 40.44C17.72 40.59 17.39 40.75 17.06 40.92C16.74 41.10 16.41 41.28 16.08 41.47C15.75 41.66 15.43 41.86 15.10 42.08C14.77 42.30 14.43 42.55 14.12 42.80C13.80 43.05 13.51 43.29 13.20 43.56C12.89 43.84 12.55 44.16 12.24 44.46C11.94 44.76 11.66 45.06 11.38 45.37C11.09 45.67 10.79 46.00 10.53 46.32C10.28 46.63 10.06 46.94 9.83 47.26C9.61 47.58 9.41 47.92 9.20 48.24C9.00 48.57 8.80 48.90 8.61 49.23C8.42 49.56 8.23 49.88 8.07 50.21C7.90 50.54 7.75 50.87 7.61 51.19C7.47 51.52 7.33 51.85 7.21 52.18C7.10 52.50 6.98 52.83 6.90 53.16C6.83 53.49 6.68 53.86 6.75 54.14C6.83 54.42 7.11 54.78 7.37 54.83C7.64 54.88 8.04 54.64 8.36 54.45C8.68 54.26 8.98 53.93 9.29 53.69C9.61 53.45 9.93 53.23 10.25 52.99C10.58 52.76 10.91 52.51 11.24 52.28C11.56 52.06 11.89 51.86 12.22 51.66C12.55 51.46 12.87 51.27 13.20 51.09C13.53 50.92 13.86 50.77 14.19 50.62C14.51 50.47 14.84 50.33 15.17 50.19C15.50 50.06 15.82 49.94 16.15 49.83C16.48 49.71 16.81 49.61 17.13 49.51C17.46 49.41 17.79 49.32 18.12 49.24C18.45 49.16 18.77 49.11 19.10 49.05C19.43 48.98 19.76 48.91 20.08 48.87C20.41 48.83 20.74 48.82 21.07 48.80C21.40 48.77 21.72 48.76 22.05 48.74C22.38 48.72 22.71 48.68 23.03 48.68C23.36 48.68 23.69 48.72 24.02 48.73C24.34 48.75 24.67 48.74 25.00 48.75C25.33 48.76 25.66 48.78 25.98 48.81C26.31 48.85 26.64 48.91 26.97 48.96C27.29 49.01 27.62 49.06 27.95 49.12C28.28 49.18 28.60 49.26 28.93 49.33C29.26 49.41 29.59 49.48 29.92 49.57C30.24 49.65 30.57 49.74 30.90 49.83C31.23 49.92 31.55 50.00 31.88 50.10C32.21 50.20 32.54 50.30 32.87 50.41C33.19 50.53 33.52 50.65 33.85 50.78C34.18 50.90 34.50 51.03 34.83 51.17C35.16 51.31 35.49 51.46 35.81 51.60C36.14 51.74 36.47 51.87 36.80 52.02C37.13 52.17 37.45 52.33 37.78 52.49C38.11 52.65 38.44 52.80 38.76 52.96C39.09 53.11 39.42 53.28 39.75 53.44C40.07 53.60 40.40 53.76 40.73 53.93C41.06 54.10 41.39 54.28 41.71 54.45C42.04 54.63 42.37 54.81 42.70 54.98C43.02 55.15 43.35 55.32 43.68 55.49C44.01 55.66 44.34 55.84 44.66 56.00C44.99 56.17 45.32 56.33 45.65 56.50C45.97 56.66 46.30 56.84 46.63 57.01C46.96 57.18 47.28 57.36 47.61 57.53C47.94 57.69 48.27 57.85 48.60 57.99C48.92 58.14 49.25 58.26 49.58 58.40C49.91 58.53 50.23 58.66 50.56 58.79C50.89 58.93 51.22 59.06 51.54 59.19C51.87 59.31 52.20 59.42 52.53 59.54C52.86 59.65 53.18 59.77 53.51 59.87C53.84 59.97 54.17 60.06 54.49 60.15C54.82 60.24 55.15 60.32 55.48 60.41C55.81 60.49 56.13 60.56 56.46 60.63C56.79 60.71 57.12 60.78 57.44 60.85C57.77 60.92 58.10 61.00 58.43 61.06C58.75 61.11 59.08 61.16 59.41 61.21C59.74 61.26 60.07 61.31 60.39 61.35C60.72 61.39 61.05 61.43 61.38 61.45C61.70 61.47 62.03 61.47 62.36 61.48C62.69 61.49 63.01 61.50 63.34 61.52C63.67 61.54 64.00 61.58 64.33 61.59C64.65 61.60 64.98 61.60 65.31 61.59C65.64 61.58 65.96 61.54 66.29 61.53C66.62 61.51 66.95 61.53 67.28 61.52C67.60 61.50 67.93 61.47 68.26 61.45C68.59 61.43 68.91 61.41 69.24 61.39C69.57 61.36 69.90 61.32 70.22 61.28C70.55 61.24 70.88 61.20 71.21 61.16C71.54 61.12 71.86 61.07 72.19 61.03C72.52 60.98 72.85 60.93 73.17 60.87C73.50 60.81 73.83 60.74 74.16 60.68C74.49 60.61 74.81 60.55 75.14 60.48C75.47 60.41 75.80 60.33 76.12 60.26C76.45 60.18 76.78 60.10 77.11 60.02C77.43 59.94 77.76 59.85 78.09 59.76C78.42 59.67 78.75 59.58 79.07 59.48C79.40 59.38 79.73 59.28 80.06 59.17C80.38 59.07 80.71 58.95 81.04 58.83C81.37 58.71 81.69 58.58 82.02 58.46C82.35 58.34 82.68 58.23 83.01 58.10C83.33 57.97 83.66 57.84 83.99 57.69C84.32 57.54 84.64 57.36 84.97 57.20C85.30 57.04 85.63 56.88 85.96 56.71C86.28 56.53 86.61 56.36 86.94 56.17C87.27 55.98 87.59 55.79 87.92 55.59C88.25 55.39 88.58 55.18 88.90 54.95C89.23 54.72 89.56 54.49 89.89 54.23C90.22 53.96 90.55 53.67 90.87 53.36C91.19 53.06 91.55 52.70 91.82 52.39C92.10 52.07 92.31 51.79 92.52 51.47C92.73 51.16 92.94 50.82 93.09 50.49C93.25 50.16 93.36 49.84 93.45 49.51C93.55 49.18 93.62 48.85 93.67 48.53C93.72 48.20 93.75 47.87 93.75 47.54C93.75 47.21 93.73 46.89 93.67 46.56C93.61 46.23 93.56 45.89 93.39 45.58C93.21 45.26 92.92 44.92 92.63 44.67C92.34 44.42 91.97 44.25 91.64 44.07C91.32 43.89 90.99 43.74 90.66 43.60C90.33 43.46 90.00 43.34 89.68 43.23C89.35 43.12 89.02 43.02 88.69 42.93C88.37 42.84 88.04 42.77 87.71 42.70C87.38 42.63 87.06 42.58 86.73 42.53C86.40 42.48 86.07 42.45 85.74 42.42C85.42 42.39 85.09 42.36 84.76 42.35C84.43 42.34 84.11 42.36 83.78 42.35C83.45 42.33 83.12 42.28 82.79 42.28C82.47 42.28 82.14 42.32 81.81 42.34C81.48 42.37 81.16 42.38 80.83 42.41C80.50 42.44 80.17 42.46 79.85 42.51C79.52 42.55 79.19 42.62 78.86 42.69C78.53 42.75 78.21 42.82 77.88 42.89C77.55 42.96 77.22 43.02 76.90 43.10C76.57 43.18 76.24 43.27 75.91 43.37C75.59 43.46 75.26 43.56 74.93 43.67C74.60 43.77 74.27 43.89 73.95 44.02C73.62 44.14 73.29 44.27 72.96 44.40C72.64 44.53 72.31 44.67 71.98 44.81C71.65 44.94 71.32 45.08 71.00 45.22C70.67 45.37 70.34 45.50 70.01 45.65C69.69 45.81 69.36 45.98 69.03 46.14C68.70 46.30 68.38 46.45 68.05 46.62C67.72 46.78 67.39 46.96 67.06 47.12C66.74 47.28 66.41 47.44 66.08 47.59C65.75 47.75 65.43 47.90 65.10 48.05C64.77 48.20 64.44 48.35 64.12 48.50C63.79 48.64 63.46 48.78 63.13 48.91C62.80 49.04 62.48 49.17 62.15 49.29C61.82 49.41 61.49 49.51 61.17 49.62C60.84 49.72 60.51 49.82 60.18 49.91C59.85 50.00 59.53 50.09 59.20 50.17C58.87 50.24 58.54 50.30 58.22 50.36C57.89 50.42 57.56 50.49 57.23 50.52C56.91 50.56 56.58 50.56 56.25 50.58C55.92 50.60 55.59 50.62 55.27 50.63C54.94 50.64 54.61 50.63 54.28 50.63C53.96 50.63 53.63 50.63 53.30 50.62C52.97 50.60 52.65 50.60 52.32 50.56C51.99 50.52 51.66 50.46 51.33 50.40C51.01 50.34 50.68 50.29 50.35 50.21C50.02 50.14 49.70 50.04 49.37 49.94C49.04 49.84 48.71 49.73 48.38 49.62C48.06 49.51 47.73 49.41 47.40 49.29C47.07 49.16 46.75 49.02 46.42 48.88C46.09 48.73 45.76 48.58 45.44 48.43C45.11 48.27 44.78 48.11 44.45 47.94C44.12 47.76 43.80 47.59 43.47 47.40C43.14 47.21 42.81 46.99 42.49 46.78C42.16 46.57 41.83 46.35 41.50 46.13C41.18 45.90 40.85 45.68 40.52 45.45C40.19 45.22 39.86 44.98 39.54 44.75C39.21 44.51 38.88 44.26 38.55 44.03C38.23 43.79 37.90 43.57 37.57 43.33C37.24 43.10 36.91 42.86 36.59 42.64C36.26 42.41 35.93 42.19 35.60 41.99C35.28 41.78 34.95 41.59 34.62 41.41C34.29 41.22 33.97 41.04 33.64 40.87C33.31 40.71 32.98 40.56 32.65 40.41C32.33 40.26 32.00 40.11 31.67 39.98C31.34 39.85 31.02 39.73 30.69 39.62C30.36 39.52 30.03 39.42 29.71 39.33C29.38 39.25 29.05 39.18 28.72 39.13C28.39 39.07 28.07 39.03 27.74 38.99C27.41 38.95 27.08 38.92 26.76 38.89C26.43 38.86 26.10 38.84 25.77 38.83C25.44 38.82 25.09 38.83 24.79 38.83C24.49 38.84 24.25 38.84 23.95 38.87Z" fill="#EB8094"/><path d="M22.82 51.86C22.59 51.88 22.17 51.93 21.84 51.97C21.51 52.01 21.18 52.05 20.86 52.10C20.53 52.15 20.20 52.21 19.87 52.28C19.55 52.35 19.22 52.42 18.89 52.50C18.56 52.58 18.24 52.68 17.91 52.78C17.58 52.88 17.25 52.99 16.92 53.12C16.60 53.24 16.27 53.37 15.94 53.51C15.61 53.66 15.29 53.84 14.96 54.01C14.63 54.19 14.30 54.36 13.97 54.55C13.65 54.75 13.31 54.97 12.99 55.19C12.68 55.41 12.39 55.61 12.08 55.85C11.77 56.10 11.46 56.37 11.14 56.66C10.83 56.95 10.48 57.27 10.19 57.58C9.89 57.90 9.62 58.24 9.35 58.57C9.09 58.90 8.83 59.22 8.60 59.55C8.38 59.88 8.18 60.21 7.99 60.53C7.81 60.86 7.64 61.19 7.49 61.52C7.34 61.84 7.20 62.17 7.10 62.50C7.00 62.83 6.94 63.16 6.88 63.48C6.82 63.81 6.76 64.14 6.74 64.47C6.73 64.79 6.70 65.14 6.79 65.45C6.89 65.76 7.06 66.18 7.31 66.35C7.56 66.52 7.96 66.52 8.29 66.48C8.61 66.44 8.94 66.23 9.27 66.10C9.60 65.97 9.93 65.81 10.25 65.68C10.58 65.55 10.91 65.43 11.24 65.32C11.56 65.22 11.89 65.12 12.22 65.03C12.55 64.94 12.87 64.86 13.20 64.78C13.53 64.70 13.86 64.62 14.19 64.56C14.51 64.49 14.84 64.42 15.17 64.37C15.50 64.32 15.82 64.29 16.15 64.26C16.48 64.22 16.81 64.20 17.13 64.17C17.46 64.14 17.79 64.07 18.12 64.05C18.45 64.03 18.77 64.04 19.10 64.04C19.43 64.04 19.76 64.03 20.08 64.05C20.41 64.06 20.74 64.11 21.07 64.14C21.40 64.17 21.72 64.19 22.05 64.22C22.38 64.24 22.71 64.25 23.03 64.29C23.36 64.32 23.69 64.39 24.02 64.44C24.34 64.48 24.67 64.52 25.00 64.58C25.33 64.64 25.66 64.72 25.98 64.79C26.31 64.85 26.64 64.92 26.97 65.00C27.29 65.08 27.62 65.16 27.95 65.25C28.28 65.34 28.60 65.43 28.93 65.53C29.26 65.63 29.59 65.72 29.92 65.83C30.24 65.93 30.57 66.05 30.90 66.17C31.23 66.28 31.55 66.39 31.88 66.51C32.21 66.63 32.54 66.74 32.87 66.86C33.19 66.98 33.52 67.10 33.85 67.23C34.18 67.35 34.50 67.49 34.83 67.62C35.16 67.76 35.49 67.90 35.81 68.04C36.14 68.18 36.47 68.30 36.80 68.44C37.13 68.58 37.45 68.75 37.78 68.90C38.11 69.06 38.44 69.22 38.76 69.38C39.09 69.53 39.42 69.67 39.75 69.82C40.07 69.97 40.40 70.13 40.73 70.29C41.06 70.45 41.39 70.61 41.71 70.77C42.04 70.94 42.37 71.12 42.70 71.28C43.02 71.44 43.35 71.59 43.68 71.75C44.01 71.90 44.34 72.04 44.66 72.19C44.99 72.33 45.32 72.48 45.65 72.62C45.97 72.77 46.30 72.91 46.63 73.06C46.96 73.21 47.28 73.37 47.61 73.52C47.94 73.66 48.27 73.79 48.60 73.92C48.92 74.05 49.25 74.16 49.58 74.28C49.91 74.41 50.23 74.56 50.56 74.69C50.89 74.82 51.22 74.95 51.54 75.07C51.87 75.18 52.20 75.28 52.53 75.39C52.86 75.50 53.18 75.62 53.51 75.72C53.84 75.83 54.17 75.92 54.49 76.02C54.82 76.12 55.15 76.22 55.48 76.31C55.81 76.40 56.13 76.48 56.46 76.56C56.79 76.65 57.12 76.74 57.44 76.81C57.77 76.89 58.10 76.94 58.43 77.01C58.75 77.08 59.08 77.15 59.41 77.22C59.74 77.29 60.07 77.37 60.39 77.44C60.72 77.50 61.05 77.55 61.38 77.60C61.70 77.66 62.03 77.70 62.36 77.75C62.69 77.79 63.01 77.82 63.34 77.86C63.67 77.90 64.00 77.96 64.33 77.99C64.65 78.02 64.98 78.03 65.31 78.05C65.64 78.07 65.96 78.07 66.29 78.09C66.62 78.11 66.95 78.15 67.28 78.16C67.60 78.17 67.93 78.16 68.26 78.17C68.59 78.18 68.91 78.23 69.24 78.23C69.57 78.23 69.90 78.19 70.22 78.17C70.55 78.15 70.88 78.11 71.21 78.10C71.54 78.08 71.86 78.09 72.19 78.07C72.52 78.06 72.85 78.04 73.17 78.01C73.50 77.99 73.83 77.94 74.16 77.90C74.49 77.86 74.81 77.82 75.14 77.77C75.47 77.71 75.80 77.63 76.12 77.58C76.45 77.52 76.78 77.49 77.11 77.43C77.43 77.36 77.76 77.28 78.09 77.20C78.42 77.12 78.75 77.04 79.07 76.95C79.40 76.85 79.73 76.74 80.06 76.63C80.38 76.53 80.71 76.42 81.04 76.29C81.37 76.17 81.69 76.03 82.02 75.90C82.35 75.77 82.68 75.66 83.01 75.51C83.33 75.36 83.66 75.20 83.99 75.02C84.32 74.85 84.64 74.66 84.97 74.46C85.30 74.26 85.63 74.04 85.96 73.82C86.28 73.59 86.61 73.37 86.94 73.11C87.27 72.85 87.61 72.56 87.92 72.26C88.24 71.96 88.55 71.62 88.83 71.31C89.12 70.99 89.37 70.69 89.62 70.37C89.87 70.04 90.09 69.71 90.31 69.38C90.53 69.05 90.75 68.73 90.95 68.40C91.14 68.07 91.33 67.74 91.50 67.42C91.67 67.09 91.82 66.76 91.96 66.43C92.10 66.10 92.22 65.78 92.34 65.45C92.45 65.12 92.57 64.79 92.67 64.47C92.77 64.14 92.85 63.81 92.94 63.48C93.02 63.16 93.10 62.83 93.17 62.50C93.25 62.17 93.33 61.84 93.40 61.52C93.46 61.19 93.52 60.86 93.57 60.53C93.62 60.21 93.67 59.88 93.68 59.55C93.69 59.22 93.76 58.87 93.65 58.57C93.55 58.26 93.31 57.84 93.05 57.73C92.78 57.61 92.39 57.75 92.06 57.87C91.74 57.99 91.41 58.24 91.08 58.44C90.75 58.64 90.43 58.86 90.10 59.07C89.77 59.27 89.44 59.47 89.12 59.66C88.79 59.85 88.46 60.02 88.13 60.20C87.80 60.38 87.48 60.57 87.15 60.74C86.82 60.91 86.49 61.08 86.17 61.24C85.84 61.40 85.51 61.55 85.18 61.70C84.85 61.84 84.53 61.98 84.20 62.11C83.87 62.24 83.54 62.36 83.22 62.49C82.89 62.61 82.56 62.74 82.23 62.87C81.91 62.99 81.58 63.12 81.25 63.23C80.92 63.33 80.59 63.42 80.27 63.51C79.94 63.61 79.61 63.71 79.28 63.80C78.96 63.89 78.63 63.97 78.30 64.05C77.97 64.14 77.65 64.23 77.32 64.31C76.99 64.39 76.66 64.46 76.33 64.53C76.01 64.59 75.68 64.64 75.35 64.70C75.02 64.75 74.70 64.82 74.37 64.87C74.04 64.92 73.71 64.96 73.38 65.01C73.06 65.06 72.73 65.12 72.40 65.15C72.07 65.19 71.75 65.21 71.42 65.24C71.09 65.26 70.76 65.28 70.44 65.31C70.11 65.33 69.78 65.36 69.45 65.38C69.12 65.40 68.80 65.43 68.47 65.45C68.14 65.46 67.81 65.45 67.49 65.45C67.16 65.45 66.83 65.46 66.50 65.45C66.18 65.44 65.85 65.40 65.52 65.38C65.19 65.36 64.86 65.34 64.54 65.31C64.21 65.29 63.88 65.26 63.55 65.23C63.23 65.21 62.90 65.19 62.57 65.15C62.24 65.11 61.91 65.05 61.59 65.00C61.26 64.96 60.93 64.94 60.60 64.88C60.28 64.83 59.95 64.75 59.62 64.68C59.29 64.62 58.97 64.58 58.64 64.52C58.31 64.45 57.98 64.37 57.65 64.29C57.33 64.22 57.00 64.13 56.67 64.05C56.34 63.97 56.02 63.88 55.69 63.79C55.36 63.70 55.03 63.61 54.71 63.51C54.38 63.41 54.05 63.30 53.72 63.19C53.39 63.08 53.07 62.98 52.74 62.85C52.41 62.73 52.08 62.58 51.76 62.45C51.43 62.32 51.10 62.21 50.77 62.08C50.44 61.96 50.12 61.83 49.79 61.70C49.46 61.56 49.13 61.43 48.81 61.29C48.48 61.15 48.15 61.00 47.82 60.84C47.50 60.69 47.17 60.53 46.84 60.37C46.51 60.21 46.18 60.04 45.86 59.88C45.53 59.72 45.20 59.57 44.87 59.41C44.55 59.25 44.22 59.09 43.89 58.92C43.56 58.74 43.24 58.55 42.91 58.37C42.58 58.19 42.25 58.01 41.92 57.83C41.60 57.65 41.27 57.48 40.94 57.30C40.61 57.13 40.29 56.97 39.96 56.79C39.63 56.62 39.30 56.45 38.97 56.28C38.65 56.10 38.32 55.92 37.99 55.75C37.66 55.58 37.34 55.43 37.01 55.27C36.68 55.11 36.35 54.95 36.03 54.80C35.70 54.65 35.37 54.50 35.04 54.35C34.71 54.21 34.39 54.07 34.06 53.93C33.73 53.79 33.40 53.65 33.08 53.53C32.75 53.40 32.42 53.28 32.09 53.17C31.76 53.06 31.44 52.96 31.11 52.86C30.78 52.77 30.45 52.70 30.13 52.61C29.80 52.53 29.47 52.44 29.14 52.38C28.82 52.31 28.49 52.28 28.16 52.22C27.83 52.17 27.50 52.08 27.18 52.02C26.85 51.97 26.52 51.94 26.19 51.91C25.87 51.87 25.54 51.84 25.21 51.83C24.88 51.82 24.56 51.83 24.23 51.83C23.90 51.83 23.48 51.82 23.24 51.83C23.01 51.83 23.06 51.83 22.82 51.86Z" fill="#69B7C7"/><path d="M19.17 67.31C18.90 67.33 18.52 67.38 18.19 67.41C17.86 67.44 17.53 67.45 17.21 67.49C16.88 67.53 16.55 67.60 16.22 67.66C15.89 67.71 15.57 67.76 15.24 67.83C14.91 67.91 14.58 68.01 14.26 68.11C13.93 68.21 13.60 68.31 13.27 68.42C12.94 68.54 12.62 68.67 12.29 68.81C11.96 68.96 11.63 69.12 11.31 69.30C10.98 69.49 10.64 69.68 10.32 69.93C10.01 70.19 9.61 70.54 9.40 70.86C9.18 71.17 9.10 71.51 9.03 71.84C8.97 72.17 8.97 72.50 9.01 72.82C9.05 73.15 9.18 73.48 9.29 73.81C9.39 74.13 9.52 74.46 9.66 74.79C9.80 75.12 9.96 75.44 10.12 75.77C10.29 76.10 10.46 76.43 10.65 76.76C10.84 77.08 11.04 77.41 11.25 77.74C11.46 78.07 11.68 78.39 11.90 78.72C12.12 79.05 12.34 79.38 12.58 79.71C12.82 80.03 13.08 80.37 13.34 80.69C13.60 81.01 13.87 81.31 14.14 81.61C14.41 81.91 14.70 82.20 14.97 82.49C15.25 82.77 15.51 83.02 15.81 83.30C16.10 83.58 16.42 83.88 16.74 84.17C17.05 84.45 17.37 84.74 17.70 85.00C18.02 85.26 18.35 85.50 18.68 85.74C19.01 85.97 19.34 86.20 19.66 86.43C19.99 86.65 20.32 86.87 20.65 87.08C20.97 87.29 21.30 87.49 21.63 87.68C21.96 87.87 22.28 88.04 22.61 88.22C22.94 88.40 23.27 88.58 23.60 88.76C23.92 88.93 24.25 89.10 24.58 89.26C24.91 89.42 25.23 89.56 25.56 89.70C25.89 89.85 26.22 90.00 26.54 90.13C26.87 90.27 27.20 90.39 27.53 90.52C27.86 90.64 28.18 90.77 28.51 90.89C28.84 91.00 29.17 91.11 29.49 91.21C29.82 91.32 30.15 91.42 30.48 91.52C30.81 91.61 31.13 91.70 31.46 91.79C31.79 91.88 32.12 91.97 32.44 92.06C32.77 92.14 33.10 92.23 33.43 92.30C33.75 92.38 34.08 92.44 34.41 92.51C34.74 92.57 35.07 92.63 35.39 92.69C35.72 92.76 36.05 92.82 36.38 92.89C36.70 92.95 37.03 93.03 37.36 93.08C37.69 93.14 38.01 93.17 38.34 93.22C38.67 93.27 39.00 93.33 39.33 93.38C39.65 93.42 39.98 93.43 40.31 93.47C40.64 93.50 40.96 93.54 41.29 93.57C41.62 93.61 41.95 93.65 42.28 93.68C42.60 93.71 42.93 93.72 43.26 93.75C43.59 93.77 43.91 93.79 44.24 93.82C44.57 93.84 44.90 93.87 45.22 93.89C45.55 93.91 45.88 93.94 46.21 93.95C46.54 93.96 46.86 93.96 47.19 93.96C47.52 93.96 47.85 93.96 48.17 93.96C48.50 93.96 48.83 93.96 49.16 93.96C49.49 93.96 49.81 93.96 50.14 93.96C50.47 93.96 50.80 93.97 51.12 93.96C51.45 93.96 51.78 93.95 52.11 93.93C52.43 93.91 52.76 93.85 53.09 93.83C53.42 93.80 53.75 93.80 54.07 93.78C54.40 93.76 54.73 93.74 55.06 93.72C55.38 93.70 55.71 93.68 56.04 93.65C56.37 93.61 56.69 93.55 57.02 93.51C57.35 93.47 57.68 93.44 58.01 93.39C58.33 93.35 58.66 93.28 58.99 93.23C59.32 93.18 59.64 93.14 59.97 93.08C60.30 93.03 60.63 92.96 60.96 92.89C61.28 92.82 61.61 92.74 61.94 92.68C62.27 92.61 62.59 92.55 62.92 92.48C63.25 92.41 63.58 92.34 63.90 92.26C64.23 92.18 64.56 92.10 64.89 92.01C65.22 91.92 65.54 91.82 65.87 91.72C66.20 91.62 66.53 91.52 66.85 91.42C67.18 91.32 67.51 91.21 67.84 91.10C68.16 90.99 68.49 90.87 68.82 90.75C69.15 90.63 69.48 90.50 69.80 90.37C70.13 90.24 70.46 90.12 70.79 89.99C71.11 89.86 71.44 89.72 71.77 89.57C72.10 89.42 72.43 89.27 72.75 89.11C73.08 88.95 73.41 88.77 73.74 88.60C74.06 88.43 74.39 88.26 74.72 88.08C75.05 87.90 75.37 87.71 75.70 87.51C76.03 87.32 76.36 87.14 76.69 86.92C77.01 86.71 77.34 86.47 77.67 86.25C78.00 86.03 78.32 85.83 78.65 85.59C78.98 85.36 79.31 85.10 79.63 84.85C79.96 84.59 80.29 84.32 80.62 84.04C80.95 83.76 81.28 83.46 81.60 83.17C81.92 82.88 82.23 82.60 82.53 82.30C82.82 82.01 83.12 81.70 83.39 81.39C83.66 81.08 83.92 80.77 84.14 80.46C84.37 80.14 84.63 79.81 84.71 79.49C84.79 79.18 84.79 78.75 84.63 78.57C84.46 78.39 84.02 78.38 83.71 78.40C83.39 78.43 83.05 78.59 82.72 78.70C82.40 78.80 82.07 78.93 81.74 79.03C81.41 79.14 81.09 79.25 80.76 79.34C80.43 79.44 80.10 79.53 79.78 79.61C79.45 79.70 79.12 79.77 78.79 79.86C78.46 79.94 78.14 80.02 77.81 80.10C77.48 80.19 77.15 80.27 76.83 80.35C76.50 80.43 76.17 80.51 75.84 80.57C75.51 80.64 75.19 80.68 74.86 80.74C74.53 80.79 74.20 80.85 73.88 80.89C73.55 80.94 73.22 80.96 72.89 81.00C72.57 81.04 72.24 81.12 71.91 81.15C71.58 81.18 71.25 81.17 70.93 81.19C70.60 81.20 70.27 81.24 69.94 81.25C69.62 81.26 69.29 81.25 68.96 81.25C68.63 81.25 68.31 81.25 67.98 81.25C67.65 81.25 67.32 81.26 66.99 81.25C66.67 81.24 66.34 81.23 66.01 81.22C65.68 81.21 65.36 81.20 65.03 81.18C64.70 81.16 64.37 81.13 64.04 81.10C63.72 81.07 63.39 81.02 63.06 80.98C62.73 80.95 62.41 80.93 62.08 80.88C61.75 80.83 61.42 80.75 61.10 80.70C60.77 80.64 60.44 80.60 60.11 80.55C59.78 80.49 59.46 80.42 59.13 80.36C58.80 80.29 58.47 80.23 58.15 80.16C57.82 80.09 57.49 80.01 57.16 79.94C56.84 79.86 56.51 79.77 56.18 79.68C55.85 79.60 55.52 79.52 55.20 79.43C54.87 79.34 54.54 79.25 54.21 79.15C53.89 79.05 53.56 78.95 53.23 78.84C52.90 78.73 52.57 78.62 52.25 78.50C51.92 78.39 51.59 78.27 51.26 78.15C50.94 78.03 50.61 77.91 50.28 77.78C49.95 77.66 49.63 77.53 49.30 77.40C48.97 77.27 48.64 77.15 48.31 77.01C47.99 76.88 47.66 76.74 47.33 76.60C47.00 76.46 46.68 76.31 46.35 76.16C46.02 76.02 45.69 75.89 45.37 75.74C45.04 75.60 44.71 75.45 44.38 75.29C44.05 75.14 43.73 74.97 43.40 74.81C43.07 74.65 42.74 74.50 42.42 74.34C42.09 74.18 41.76 74.02 41.43 73.87C41.10 73.71 40.78 73.56 40.45 73.41C40.12 73.25 39.79 73.10 39.47 72.94C39.14 72.79 38.81 72.63 38.48 72.47C38.16 72.32 37.83 72.16 37.50 72.00C37.17 71.85 36.84 71.70 36.52 71.55C36.19 71.41 35.86 71.28 35.53 71.14C35.21 71.00 34.88 70.84 34.55 70.70C34.22 70.56 33.90 70.43 33.57 70.30C33.24 70.17 32.91 70.06 32.58 69.93C32.26 69.81 31.93 69.67 31.60 69.55C31.27 69.42 30.95 69.30 30.62 69.19C30.29 69.07 29.96 68.96 29.63 68.86C29.31 68.76 28.98 68.66 28.65 68.57C28.32 68.47 28.00 68.39 27.67 68.30C27.34 68.22 27.01 68.13 26.69 68.06C26.36 67.98 26.03 67.92 25.70 67.86C25.37 67.80 25.05 67.75 24.72 67.69C24.39 67.64 24.06 67.56 23.74 67.52C23.41 67.48 23.08 67.47 22.75 67.45C22.43 67.42 22.10 67.39 21.77 67.36C21.44 67.33 21.11 67.29 20.79 67.28C20.46 67.27 20.07 67.27 19.80 67.28C19.53 67.28 19.44 67.28 19.17 67.31Z" fill="#494692"/></svg>`;

// ---------------- Today (FR-06, FR-27, FR-29) ----------------
function todayView() {
  const p = S.pred, t = today();
  if (!p || p.empty) {
    return `${topbar('Today')}<section class="empty"><p class="lede">No period logged yet. Log the first day of your next period, or add a past one.</p>
      <button class="btn primary wide" data-act="period-start" data-date="${t}">My period started today</button>
      <button class="btn wide" data-act="add-past">Add a past period</button></section>`;
  }
  const st = p.state;
  if (p.paused) return pregnancyView(p, t);
  const wording = !!S.data.settings.wording;
  let sub;
  if (st.id === 'late' && st.stale) sub = `No period logged since ${fmt(st.lastStart)}`;
  else if (st.id === 'late') sub = `Period ${plural(st.daysLate, 'day')} late`;
  else if (st.daysToNext === 0) sub = 'Period expected today';
  else if (st.daysToNext > 0) sub = `Next period in ${plural(st.daysToNext, 'day')}`;
  else sub = 'Next period expected now';
  const fertileLine = st.id === 'fertile'
    ? `<p class="fertile-line ${st.peak ? 'peak' : ''}">${wording ? (st.peak ? 'High chance of pregnancy' : 'Higher chance of pregnancy') : (st.peak ? 'Peak fertile days (estimated)' : 'Possible fertile days (estimated)')}</p>` : '';
  const heroBtn = st.id === 'menstruation' && st.periodOpen ? `<button class="hero-btn" data-act="period-end" data-date="${t}">Period ended today</button>`
    : st.id === 'menstruation' ? '' : `<button class="hero-btn" data-act="period-start" data-date="${t}">Period started today</button>`;
  const actions = st.id === 'menstruation' && st.periodOpen
    ? '<button class="btn" data-act="period-end-earlier">Ended on another day</button>'
    : st.id === 'menstruation' ? '' : `<button class="btn" data-act="add-past">Started on another day</button>${openPeriodBefore(t) ? '<button class="btn" data-act="period-end-earlier">Log when my last period ended</button>' : ''}`;
  const flow = (S.data.days[t] || {}).flow || 'none';
  // U4: one short line; the explanation lives in the Guide (ⓘ)
  const est = `<p class="estimate">${st.id === 'late' ? 'Forecasts paused until you log your period' : `Confidence: ${h(p.confidence)}`} ${info('estimate')}</p>`;
  // One list of blocks; on a phone they stack in this order, on a laptop they split into two columns.
  const L = look();
  return `${heroView(p, heroBtn, t)}
  ${flagCards()}
  ${st.id === 'late' ? `<button class="card late-card" data-act="late-check"><span><strong>Period ${st.stale ? 'not logged for a long time' : `${plural(st.daysLate, 'day')} late`}</strong><span class="fine">Check what could be behind it</span></span><span aria-hidden="true">›</span></button>` : ''}
  ${L.companion !== 'off' && !L.noteSeen ? `<section class="note companion-note"><p>${h(TH.COMPANION_CAPTION)}</p><button class="btn small" data-act="note-seen">Got it</button></section>` : ''}
  <div class="today-grid">
    <div class="col">
      <section class="ring-block o1">${cycleRing(p)}
        <div class="ring-center"><span class="cd">Day ${st.cycleDay}</span><span class="stl">${h(st.label)}</span><span class="sub">${sub}</span></div></section>
      <div class="o2">${wording && st.id === 'fertile' ? `<p class="warning">${WARNING}</p>` : ''}${est}</div>
      <div class="o4">${L.cards.week ? weekStrip(p) : ''}</div>
      <div class="actions o5">${actions}</div>
      <section class="card o6"><h2>Bleeding today</h2>
        <div class="chips" role="radiogroup" aria-label="Bleeding today">${FLOWS.map(([v, l]) => `<button class="chip ${flow === v ? 'on' : ''}" role="radio" aria-checked="${flow === v}" data-act="flow" data-date="${t}" data-flow="${v}">${l}</button>`).join('')}</div></section>
    </div>
    <div class="col">
      <div class="o2">${sharpenCard(p)}</div>
      <div class="o3 bento">${L.cards.checkin ? checkinCard(t) : ''}${L.cards.food ? foodTeaser() : ''}</div>
      <div class="o8">${L.cards.phase ? phaseCard(st.id) : ''}</div>

      <div class="o10">${p.notes.filter((n) => n.kind !== 'doctor').map(noteCard).join('')}</div>
    </div>
  </div>`;
}
// v4 (D10): the current cycle is marked as pregnancy: no predictions, no late alerts
function pregnancyView(p, t) {
  return `<section class="hero" aria-label="Today at a glance"><div class="top"><h1>Today · ${weekday(t)}, ${fmt(t, true)}</h1>${syncPill()}</div>
    <div class="state">Pregnancy</div><div class="lead">Predictions paused since</div><div class="big">${fmt(p.lastStart)}</div>
    <div class="sub">No period forecasts or late alerts while this cycle is marked as pregnancy.</div>
    <button class="hero-btn" data-act="edit-period" data-id="${p.lastPeriod.id}">End pregnancy mode</button></section>`;
}
// U2: one big readout in the header, with the cycle-aware companion
function heroView(p, btn, t) {
  const st = p.state, L = look();
  let lead, big;
  if (st.id === 'late' && st.stale) { lead = 'No period logged since'; big = fmt(st.lastStart); }
  else if (st.id === 'late') { lead = 'Period late by'; big = plural(st.daysLate, 'day'); }
  else if (st.daysToNext === 0) { lead = 'Period expected'; big = 'today'; }
  else if (st.daysToNext > 0) { lead = 'Next period in'; big = plural(st.daysToNext, 'day'); }
  else { lead = 'Period expected'; big = 'now'; }
  const wording = !!S.data.settings.wording;
  const line = st.id === 'fertile' ? (wording ? (st.peak ? 'High chance of pregnancy' : 'Higher chance of pregnancy') : (st.peak ? 'Peak fertile days (estimated)' : 'Possible fertile days (estimated)'))
    : st.id === 'late' && st.stale ? 'Add your recent periods to get predictions again' : st.id === 'late' ? `Expected ${fmt(p.nextRange[0])} to ${fmt(p.nextRange[1])}` : `Estimated ${fmt(p.nextRange[0])} to ${fmt(p.nextRange[1])}`;
  const start = p.lastStart, total = Math.max(diff(p.nextStart, start), 1);
  const per = p.lastPeriod.end ? diff(p.lastPeriod.end, start) + 1 : p.periodLen;
  const phase = st.id === 'menstruation' ? 'period' : st.id === 'fertile' ? 'fertile' : st.id === 'luteal' || st.id === 'late' ? 'luteal' : 'follicular';
  const c = { d: st.cycleDay, len: total, per, f0: diff(p.possible[0], start) + 1, f1: diff(p.possible[1], start) + 1, ov: diff(p.ovulation.likely, start) + 1, phase };
  const art = L.companion === 'moon' ? moon(c) : L.companion === 'sprout' ? sprout(c) : '';
  return `<section class="hero ${art ? 'has-comp' : ''}" aria-label="Today at a glance">
    <div class="top"><h1>Today · ${weekday(t)}, ${fmt(t, true)}</h1>${syncPill()}</div>
    <div class="state">Day ${st.cycleDay} · ${h(st.label)}</div>
    <div class="lead">${lead}</div><div class="big">${String(big).replace(/^(\d+) (\w+)$/, '<span class="n">$1</span> <span class="u">$2</span>')}</div>
    <div class="sub">${h(line)}</div>
    ${btn}
    ${art ? `<div class="companion" data-stage="${L.companion}-${phase}" aria-hidden="true">${art}</div>` : ''}
  </section>`;
}
// B2 item 1: explain wide estimates and how to sharpen them
function sharpenCard(p) {
  if (p.usedCycles >= CONST.MEDIUM_FROM) return '';
  const need = CONST.MEDIUM_FROM - p.usedCycles;
  return `<section class="card sharpen"><h2>Sharpen your predictions</h2><button class="btn small" data-act="add-past">Add a past period</button>
    <details><summary>Why</summary><p class="fine">Cycle has ${p.usedCycles ? `${plural(p.usedCycles, 'complete cycle')} of yours` : 'no complete cycle of yours yet'}, so it relies on ${p.usedDefault ? 'a typical 29-day cycle' : 'the cycle length you entered'} with a ±${p.spread}-day margin. That is why the ranges are wide. Add ${need === 1 ? 'one more past period' : `${need} more past periods`} with their first and last days, and the estimates narrow to your own rhythm.</p>
</details></section>`;
}
// B2 item 6: what is happening now
function phaseCard(id) {
  const info = T.PHASE_INFO[id]; if (!info) return '';
  return `<section class="card phase"><h2>${h(info.title)}</h2><details><summary>More</summary><p>${h(info.text)}</p>
    <p class="fine">Sources: ${info.src.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${h(n)}</a>`).join('; ')}</p></details></section>`;
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
    ${f.phone ? `<a class="btn primary" href="tel:${h(f.phone)}">${h(f.label)}</a>` : ''}
    ${f.src ? `<p class="fine">Source: <a href="${T.SRC[f.src].url}" target="_blank" rel="noopener noreferrer">${h(T.SRC[f.src].name)}</a></p>` : ''}
    <button class="btn small" data-act="ack" data-id="${h(f.id)}">I have read this</button></section>`).join('');
}
// G4-10: with symptoms and moods both hidden, the check-in is just a note (bleeding safety questions stay)
const noteOnly = () => hidden('symptoms') && hidden('moods');
function checkinCard(date) {
  const ci = S.data.checkins[date];
  const recs = ci ? recsFor(ci, phaseOn(date)) : [];
  if (!ci && noteOnly()) return `<section class="card checkin"><h2>Today's note</h2><button class="btn primary" data-act="checkin" data-date="${date}">Add note</button></section>`;
  if (!ci) return `<button class="card checkin focus" data-act="checkin" data-date="${date}"><span class="ft">How are you today?</span><span class="arrow" aria-hidden="true">→</span></button>`;
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
  return `<button class="card food-teaser" data-tab="food"><span class="badge-soft">Food for now</span><span class="ft">${h(f.title)}</span></button>`;
}
const phaseKey = (id) => (['menstruation', 'luteal', 'late', 'fertile', 'follicular'].includes(id) ? id : 'follicular');

function foodView() {
  const cur = S.pred && !S.pred.empty ? phaseKey(S.pred.state.id) : 'follicular';
  const curKey = ['fertile', 'late'].includes(cur) ? 'follicular' : cur;
  const show = S.foodTab || curKey;
  const tabs = [['menstruation', 'During your period'], ['follicular', 'Rest of the cycle'], ['luteal', 'Before your period']];
  const diet = S.data.settings.diet || 'all';
  // B3: all three cards are rendered; on a phone only the selected one shows, on a wide screen all three sit side by side.
  return `${topbar('Food')}
  <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${show === k}" data-act="foodtab" data-k="${k}">${l}${curKey === k ? ' (now)' : ''}</button>`).join('')}</div>
  ${S.data.settings.diet ? '' : '<section class="note missed"><p>Choose your diet in Settings so the lists only show foods you eat. Until then, all foods are listed.</p><button class="btn" data-tab="settings">Open Settings</button></section>'}
  <div class="food-grid">${tabs.map(([k, l]) => foodCard(k, l, k === show, k === curKey, diet)).join('')}</div>
  <p class="fine">Food lists follow your diet setting (${h((T.DIETS.find(([k]) => k === diet) || T.DIETS[0])[1])}). Cycle gives no supplement doses; ask your doctor before taking any.</p>`;
}
function foodCard(k, label, selected, now, diet) {
  const f = { ...T.FOOD[k], groups: T.dietFilter(T.FOOD[k].groups, diet) };
  const heavy = k === 'menstruation' && heavyDays(S.data, S.pred) >= 2;
  return `<section class="card food-card ${selected ? 'sel' : ''}"><p class="phase-label">${h(label)}${now ? ' · now' : ''}</p><h2>${h(f.title)}</h2><p>${h(f.why)}</p>
    ${heavy ? `<p class="esc">${h(T.HEAVY_IRON_NOTE)}</p>` : ''}
    ${f.groups.map((g) => `<h3>${h(g.name)}</h3><ul class="foods">${g.items.map(([n, v]) => `<li><span>${h(n)}</span>${v ? `<b>${h(v)}</b>` : ''}</li>`).join('')}</ul>`).join('')}
    ${f.tips.map((t) => `<p class="tip">${h(t)}</p>`).join('')}
    ${k === 'follicular' ? comingUp() : ''}
    ${f.src.length ? `<p class="fine">Sources: ${f.src.map((x) => `<a href="${T.SRC[x].url}" target="_blank" rel="noopener noreferrer">${h(T.SRC[x].name)}</a>`).join('; ')}. Iron values per serving from the NIH table (USDA FoodData Central).</p>` : ''}
  </section>`;
}

// B2 item 7: mid-cycle, preview what comes next
function comingUp() {
  const p = S.pred; if (!p || p.empty || p.paused) return '';
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
    clots: yesno('clots', 'Any clots 2.5 cm across or larger?'),
    dizzy: yesno('dizzy', 'Feeling dizzy, faint, or a racing heart?'),
    discharge: `<fieldset class="q"><legend>Discharge</legend>${T.DISCHARGE.map(([v, l]) => `<label class="pick"><input type="radio" name="discharge" value="${v}" ${ci.discharge === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}<label class="pick"><input type="radio" name="discharge" value="" ${!ci.discharge ? 'checked' : ''}><span>Not noted</span></label></fieldset>`,
    sidepain: yesno('sidepain', 'Pain on one side of your lower belly?') };
  const others = T.SYMPTOMS.filter((s) => !q.symptoms.includes(s.code));
  const extraOpen = others.some((s) => sy[s.code]);
  return `<h2>${h(q.title)}: ${date === today() ? 'today' : fmt(date)}</h2>
  <form class="stack checkin-form" data-form="checkin" data-date="${date}">
    ${q.ask.map((k) => asks[k]).join('')}
    ${hidden('symptoms') ? '' : q.symptoms.map(scale).join('')}
    ${hidden('moods') ? '' : `<fieldset class="q"><legend>Mood</legend>${T.MOOD_GOOD.map((m) => `<label class="pick"><input type="checkbox" name="g_${m.code}" ${sy[m.code] ? 'checked' : ''}><span>${m.label}</span></label>`).join('')}</fieldset>`}
    ${hidden('symptoms') ? '' : `<details ${extraOpen ? 'open' : ''}><summary>Log another symptom</summary>${others.map((s) => scale(s.code)).join('')}</details>`}
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
  if (!i.logged && i.fertile && !hidden('predictions')) c.push(i.fertile === 'peak' ? 'm-peak' : 'm-possible');
  if (i.horizon > 1) c.push('far');
  return c.join(' ');
}
function daySymbol(i) {
  let out = '';
  if (i.test === 'pos' && !hidden('tests')) out += '<span class="s-test" title="Positive ovulation test">▲</span>';
  if (i.sex && !hidden('sex')) out += '<span class="s-sex" title="Sex logged">○</span>';
  if (out) return out;
  if (i.ovulation && !i.logged && !hidden('predictions')) return '<span class="s-ovu" title="Likely ovulation">●</span>';
  if (i.flow && i.flow !== 'none' && !i.logged) return '<span class="s-flow" title="Bleeding logged">◆</span>';
  return '';
}
function describe(i) {
  const parts = [];
  if (i.logged) parts.push('period'); else if (i.predictedPeriod) parts.push('predicted period');
  if (!hidden('predictions')) { if (i.fertile === 'peak') parts.push('peak fertile day'); else if (i.fertile) parts.push('possible fertile day'); if (i.ovulation) parts.push('likely ovulation'); }
  if (i.test && !hidden('tests')) parts.push(i.test === 'pos' ? 'positive ovulation test' : 'ovulation test logged');
  if (i.sex && !hidden('sex')) parts.push('sex logged');
  if (i.flow && i.flow !== 'none') parts.push(`${i.flow} bleeding logged`);
  return parts.join(', ') || 'no marks';
}

// ---------------- Calendar (FR-07, FR-08) ----------------
function calendarView() {
  const t = today(); const ym = S.month || t.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`; const sun = display().weekStart === 'sun'; const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + (sun ? 0 : 6)) % 7;
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
  <div class="cal-grid">${(sun ? ['Sun', ...WD.slice(0, 6)] : WD).map((w) => `<span class="cal-wd">${w.slice(0, 2)}</span>`).join('')}${cells.join('')}</div>
  ${ym !== t.slice(0, 7) ? '<button class="link center" data-act="month-today">Back to this month</button>' : ''}
  <section class="legend">
    <span><i class="lg m-period"></i>Period</span><span><i class="lg m-pred"></i>Predicted period</span>
    <span><i class="lg m-peak"></i>${wording ? 'High chance of pregnancy' : 'Peak fertile days'}</span><span><i class="lg m-possible"></i>${wording ? 'Higher chance of pregnancy' : 'Possible fertile days'}</span>
    <span><b class="s-ovu">●</b>Likely ovulation</span><span><b class="s-flow">◆</b>Bleeding logged</span>
    ${hidden('tests') ? '' : '<span><b class="s-test">▲</b>Positive test</span>'}${hidden('sex') ? '' : '<span><b class="s-sex">○</b>Sex logged</span>'}
  </section>
  <p class="fine">${wording ? WARNING : 'All future days are estimates. Paler marks are further ahead and less certain.'}</p>`;
}

// ---------------- History (FR-05) ----------------
function historyView() {
  const all = livePeriods(S.data.periods); const p = S.pred;
  const cyc = cycles(S.data.periods); const cycBy = Object.fromEntries(cyc.map((c) => [c.start, c]));
  const suspects = new Set((p && !p.empty ? p.notes : []).filter((n) => n.kind === 'missed').map((n) => n.cycleStart));
  const years = [...new Set(all.map((x) => x.start.slice(0, 4)))].sort().reverse();
  const f = S.histFilter || 'last6';
  const filters = [['last3', 'Last 3'], ['last6', 'Last 6'], ['year', 'Last year'], ...years.map((y) => [y, y]), ['all', 'All']];
  let list = all.slice().reverse();
  if (f === 'last3') list = list.slice(0, 3); else if (f === 'last6') list = list.slice(0, 6);
  else if (f === 'year') list = list.filter((x) => diff(today(), x.start) <= 365); else if (/^\d{4}$/.test(f)) list = list.filter((x) => x.start.startsWith(f));
  const stats = p && !p.empty ? `<section class="stats-hero"><div><span class="cap">Average cycle</span><span class="big">${p.cycleLen}<small> days</small></span></div>
      <div class="r"><span class="cap">Period</span><span class="mid">${plural(p.periodLen, 'day')}</span><span class="cap">Range ±${plural(p.spread, 'day')}</span></div></section>` : '';
  const expected = p && !p.empty ? p.cycleLen + p.spread : 38;
  const rows = list.map((x) => {
    const c = cycBy[x.start]; const plen = periodLength(x) || (p && !p.empty ? p.periodLen : CONST.DEFAULT_PERIOD);
    const preg = x.excluded && x.excludeReason === 'Pregnancy';
    const len = c ? c.length : diff(today(), x.start) + 1;
    const seg = (n, cls, ov) => `<i class="${cls}" style="flex:${Math.max(n, 0)} 1 0">${ov ? '<b></b>' : ''}</i>`;
    let bar;
    if (preg) bar = seg(len, 'g');
    else if (c) {
      const ov = c.length - CONST.D_LIKELY; const late = Math.max(0, c.length - expected);
      const gap = Math.max(0, ov - 6 - plen), fert = Math.max(0, ov - 1 - plen - gap); // G5-5: the parts always add up to the cycle length
      bar = seg(plen, 'p') + seg(gap, 'x') + seg(fert, 'f') + seg(1, 'o', true) + seg(1, 'f') + seg(Math.max(0, c.length - ov - 1 - late), 'x') + (late ? seg(late, 'l') : '');
    } else bar = seg(Math.min(plen, len), 'p') + seg(Math.max(len - plen, 0), 'x') + seg(Math.max((p && !p.empty ? p.cycleLen : 30) - len, 0), 'e');
    const title = preg ? 'Pregnancy' : c ? plural(c.length, 'day') : `Day ${len} now`;
    const note = preg ? ' · left out of averages' : x.excluded ? ' · left out' : c && !c.valid ? ' · check this' : c && suspects.has(c.start) ? ' · possible missed period' : '';
    return `<li><button class="hist-row" data-act="edit-period" data-id="${x.id}"><span class="hist-top"><span class="t">${title}</span><span class="fine">${fmt(x.start, true)}${c ? ` – ${fmt(addDays(c.next, -1), true)}` : ''}${note}</span></span><span class="cbar" aria-hidden="true">${bar}</span></button></li>`;
  }).join('');
  const legend = '<p class="hist-legend fine"><span><i class="p"></i>Period</span><span><i class="f"></i>Fertile (est.)</span><span><i class="o"></i>Ovulation (est.)</span><span><i class="l"></i>Late</span><span><i class="g"></i>Pregnancy</span></p>';
  return `${topbar('History')}<div class="chips hist-filters" role="tablist">${filters.map(([v, l]) => `<button class="chip ${f === v ? 'on' : ''}" aria-pressed="${f === v}" data-act="hist-filter" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="hist-grid"><div class="hist-side">${stats}<button class="btn wide" data-act="add-past">Add a past period</button>${legend}</div>
    <div class="hist-main">${list.length ? `<ul class="hist-list">${rows}</ul>` : '<p class="fine">No periods logged here.</p>'}</div></div>`;
}

// ---------------- Settings (FR-10, FR-11, FR-27, NFR-13) ----------------
// U4 (v4): Settings is a short list; each item opens its own page
const SET_PAGES = [
  ['cycle', 'Your cycle'], ['look', 'Look'], ['display', 'Display and hide'],
  ['sync', 'Google Drive sync'], ['backup', 'Backup and import'], ['report', 'Export report'],
  ['privacy', 'Privacy and Face ID'], ['guide', 'Guide'], ['about', 'About and sources'],
];
function setValue(k) {
  const s = S.data.settings, l = look(), dsp = display();
  if (k === 'cycle') return [s.usualCycle ? `Usual cycle ${s.usualCycle} days` : 'Usual lengths not set', s.birthYear ? `born ${s.birthYear}` : ''].filter(Boolean).join(' · ');
  if (k === 'look') return `${({ auto: 'Automatic', light: 'Light', dark: 'Dark' })[l.mode]} · ${(TH.THEMES[l.theme] || {}).name || ''}`;
  if (k === 'display') return `${fmt(today())} · week starts ${dsp.weekStart === 'sun' ? 'Sunday' : 'Monday'}`;
  if (k === 'sync') return S.meta.cloud && S.meta.cloud.fileId ? (tokenOk() ? `On${S.cloud.token.email ? ` · ${S.cloud.token.email}` : ''}` : 'On · sign in to sync') : 'Off';
  if (k === 'backup') return 'Export or import your data';
  if (k === 'report') return 'PDF for you or your doctor';
  if (k === 'privacy') return S.meta.lock ? 'Face ID on · locks after 5 min' : 'Locks after 5 min';
  if (k === 'guide') return 'How Cycle works';
  return `Version ${VERSION}`;
}
function settingsView() {
  const pg = S.setPage;
  if (!pg) {
    const groups = [SET_PAGES.slice(0, 3), SET_PAGES.slice(3, 6), SET_PAGES.slice(6)];
    return `${topbar('Settings', `Cycle ${VERSION}`)}${groups.map((g) => `<section class="card set-list">${g.map(([k, t]) => `<button class="set-row" data-act="set-page" data-v="${k}"><span><span class="t">${t}</span><span class="v">${h(setValue(k))}</span></span><span class="chev" aria-hidden="true">›</span></button>`).join('')}</section>`).join('')}`;
  }
  const title = (SET_PAGES.find((x) => x[0] === pg) || [, ''])[1];
  return `<button class="link back" data-act="set-page" data-v="">‹ Settings</button>${topbar(title)}<div class="settings-page">${setPage(pg)}</div>`;
}
function setPage(pg) {
  const s = S.data.settings;
  if (pg === 'cycle') return `<section class="card"><form class="stack" data-form="settings">
      <label>Usual cycle length, in days<input type="number" name="usualCycle" min="15" max="90" inputmode="numeric" placeholder="I don't know" value="${h(s.usualCycle || '')}"></label>
      <label>Usual period length, in days<input type="number" name="usualPeriod" min="1" max="15" inputmode="numeric" placeholder="I don't know" value="${h(s.usualPeriod || '')}"></label>
      <label>Year of birth<input type="number" name="birthYear" min="1940" max="${+today().slice(0, 4) - 10}" inputmode="numeric" placeholder="Optional" value="${h(s.birthYear || '')}"></label>
      <label>Diet<select name="diet">${s.diet ? '' : '<option value="" selected>Choose</option>'}${T.DIETS.map(([v, t]) => `<option value="${v}" ${s.diet === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button class="btn primary">Save</button></form>${info('lengths')}</section>
    <section class="card"><label class="switch"><span>Pregnancy-chance wording</span><input type="checkbox" role="switch" data-act="wording" ${s.wording ? 'checked' : ''}></label>${info('safe')}</section>
    <section class="card"><h2>Support line</h2><form class="stack" data-form="helpline"><label>Name<input type="text" name="name" maxlength="40" value="${h((s.helpline || {}).name || '')}" placeholder="Optional"></label>
      <label>Phone number<input type="tel" name="number" maxlength="25" inputmode="tel" value="${h((s.helpline || {}).number || '')}" placeholder="Not set"></label>
      <button class="btn">Save</button></form><p class="fine">Shown on the low-mood card. Stored only encrypted.</p></section>`;
  if (pg === 'look') return lookCard();
  if (pg === 'display') {
    const d = display(); const seg = (act, items, cur) => `<div class="seg2" role="group">${items.map(([v, t]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
    const ex = today(); const [y, m, dd] = ex.split('-').map(Number);
    const fmts = [['dmy', `${dd} ${MONTHS[m - 1].slice(0, 3)}`], ['mdy', `${MONTHS[m - 1].slice(0, 3)} ${dd}`], ['num', `${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}`]];
    const rows = [['symptoms', 'Symptoms'], ['moods', 'Moods'], ['predictions', 'Ovulation and fertile days'], ['tests', 'Ovulation tests'], ['sex', 'Sex life']];
    return `<section class="card"><h2>Date format</h2>${seg('disp-date', fmts, d.dateFmt)}<h2>First day of week</h2>${seg('disp-week', [['mon', 'Monday'], ['sun', 'Sunday']], d.weekStart)}</section>
      <section class="card"><h2>Show in Cycle</h2>${rows.map(([k, t]) => `<label class="switch"><span>${t}</span><input type="checkbox" role="switch" data-act="hide-tog" data-k="${k}" ${hidden(k) ? '' : 'checked'}></label>`).join('')}
        <p class="fine">Off hides it everywhere, including the export. Nothing is deleted. Safety warnings always show.</p>
        ${hidden('tests') ? '<button class="link danger-link" data-act="del-cat" data-k="ovu">Delete all logged ovulation tests…</button>' : ''}${hidden('sex') ? '<button class="link danger-link" data-act="del-cat" data-k="sex">Delete all logged sex-life data…</button>' : ''}</section>`;
  }
  if (pg === 'sync') return syncCard();
  if (pg === 'backup') return `<section class="card"><h2>Export</h2><div class="stack-btns"><button class="btn" data-act="export-enc">Encrypted backup</button><button class="btn" data-act="export-json">Plain backup</button><button class="btn" data-act="export-csv">Periods as CSV</button></div>
      <details><summary>Which one?</summary><p class="fine">An encrypted backup opens only with your passphrase. A plain backup and the CSV can be read by anyone who gets them.</p></details></section>
    <section class="card"><h2>Import</h2><div class="stack-btns"><label class="btn file">Import a file<input type="file" accept="${PICK}" data-act="import-json" hidden></label><button class="btn" data-act="paste-open">Paste dates</button></div>
      <details><summary>How to</summary><ol class="steps"><li>Choose a Cycle backup, a PDF, a CSV or a text file, or paste dates.</li><li>Check the list. Nothing is added before you confirm.</li></ol></details></section>
    <section class="card"><button class="btn danger wide" data-act="wipe">Delete all data on this device</button></section>`;
  if (pg === 'report') return reportPage();
  if (pg === 'privacy') return `<section class="card"><h2>App lock</h2>
    ${S.meta.lock ? '<p class="fine">Face ID unlock is on for this device.</p><button class="btn" data-act="faceid-off">Turn off Face ID</button>'
      : S.faceIdOk ? '<button class="btn" data-act="faceid-setup">Turn on Face ID</button>' : '<p class="fine">Face ID is not available in this browser.</p>'}
    <p class="fine">Cycle locks itself after 5 minutes in the background.</p><button class="btn" data-act="lock-now">Lock now</button></section>
    <section class="card"><h2>Change passphrase</h2>
    <form class="stack" data-form="change-pass">${USER}${pw('cur', 'Current passphrase', 'current-password', false, 0)}${pw('p1', 'New passphrase', 'new-password')}${pw('p2', 'Repeat new passphrase', 'new-password')}
      <button class="btn">Change passphrase</button></form>${info('privacy')}</section>`;
  if (pg === 'guide') return guidePage();
  return `<section class="card about"><p class="fine">Cycle ${VERSION}. A wellness tracker, not medical advice and not a method of birth control.</p>
    <ul class="fine sources">
      <li>Bull et al. 2019, 612,613 cycles (npj Digital Medicine): luteal phase 12.4 ± 2.4 days, mean cycle 29.3 days, bleed 4.0 days</li>
      <li>Wilcox 2000 and ACOG: fertile window from 5 days before to 1 day after ovulation</li>
      <li>FIGO 2018: normal cycle 24–38 days, normal variation about ±4 days</li>
      <li>ACOG: 12–24 pregnancies per 100 women in the first year of typical fertility-awareness use</li>
      <li>ACOG, Mayo Clinic and CDC: suggestions for symptoms and the warning signs for heavy or unusual bleeding</li>
      <li>NIH Office of Dietary Supplements: iron needs, iron in foods, and what helps or reduces its absorption</li>
      <li>NHS: stopped or missed periods; ectopic pregnancy (late period check)</li>
    </ul></section>`;
}
// U4: an ⓘ button opens the matching Guide entry
const info = (id) => `<button class="info-btn" data-act="guide" data-id="${id}" aria-label="About this">i</button>`;
function guidePage() {
  const open = S.guideOpen;
  return `<section class="card set-list guide">${T.GUIDE.filter(([id]) => !(id === 'tests' && hidden('tests'))).map(([id, t, body, src]) => `<details id="g-${id}" ${open === id ? 'open' : ''}><summary>${h(t)}</summary><p>${h(body)}</p>${src && T.SRC[src] ? `<p class="fine">Source: <a href="${T.SRC[src].url}" target="_blank" rel="noopener">${h(T.SRC[src].name)}</a></p>` : ''}</details>`).join('')}</section>`;
}
// R4: export report page
function reportPage() {
  const r = S.report || (S.report = { range: '12m', on: { periods: true, flow: true, symptoms: true, moods: true, tests: true, sex: false, notes: false } });
  const items = [['periods', 'Periods and cycle lengths'], ['flow', 'Bleeding'], ['symptoms', 'Symptoms'], ['moods', 'Moods'], ['tests', 'Ovulation tests'], ['sex', 'Sex life'], ['notes', 'Notes']]
    .filter(([k]) => !((k === 'symptoms' && hidden('symptoms')) || (k === 'moods' && hidden('moods')) || (k === 'tests' && hidden('tests')) || (k === 'sex' && hidden('sex'))));
  return `<section class="card"><h2>Time</h2><div class="seg2" role="group">${[['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['all', 'Everything']].map(([v, t]) => `<button data-act="rep-range" data-v="${v}" aria-pressed="${r.range === v}">${t}</button>`).join('')}</div></section>
    <section class="card"><h2>Choose data</h2>${items.map(([k, t]) => `<label class="switch"><span>${t}</span><input type="checkbox" role="switch" data-act="rep-tog" data-k="${k}" ${r.on[k] ? 'checked' : ''}></label>`).join('')}
      <p class="fine">Made on this device, nothing is uploaded. The share sheet opens: save to Files, AirDrop, Mail or print.</p></section>
    <button class="btn primary wide" data-act="rep-make">Create PDF report</button>`;
}
function lookCard() {
  const l = look();
  const seg = (act, items, cur) => `<div class="seg2" role="group">${items.map(([v, t]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
  return `<section class="card look-card"><h2>Look</h2>
    <h3>Appearance</h3>${seg('look-mode', TH.MODES, l.mode)}
    <h3>Theme</h3><div class="swatches" role="group">${Object.entries(TH.THEMES).map(([k, t]) => `<button class="sw" data-act="look-theme" data-v="${k}" aria-pressed="${l.theme === k}"><i style="background:linear-gradient(160deg,${t.light[0]},${t.light[1]})"></i>${t.name}</button>`).join('')}</div>
    <h3>Companion</h3>${seg('look-companion', TH.COMPANIONS, l.companion)}
    <p class="fine">${h(TH.COMPANION_CAPTION)}</p>
    <h3>Cards on Today</h3>${TH.CARDS.map(([k, t]) => `<label class="switch"><span>${t}</span><input type="checkbox" role="switch" data-act="look-card" data-k="${k}" ${l.cards[k] ? 'checked' : ''}></label>`).join('')}
    <p class="fine">Period and fertile colours stay the same in every theme. Your choices are stored only in your encrypted data.</p></section>`;
}
function syncCard() {
  if (!cfg.googleClientId) return '<section class="card"><h2>Google Drive sync</h2><p class="fine">Not set up yet. Add the Google sign-in ID to config.js to keep an encrypted copy in your Google Drive and use Cycle on more than one device.</p></section>';
  const c = S.cloud, m = S.meta.cloud;
  let body;
  const who = tokenOk() ? `<p class="fine">${c.token.email ? `Signed in as <strong>${h(c.token.email)}</strong>` : 'Signed in to Google'}. <button class="link" data-act="gswitch">Use a different Google account</button></p>` : '';
  if (c.existing) body = `${who}<p class="fine">A Cycle vault already exists in this Google account. Choose one:</p>
    <ol class="steps"><li><strong>Join it:</strong> enter that vault's passphrase below. The ${plural(livePeriods(S.data.periods).length, 'period')} on this device are merged into the vault, and this device switches to the vault's passphrase.</li>
      <li><strong>Wrong account?</strong> Tap <em>Use a different Google account</em> above.</li>
      <li><strong>Passphrase lost?</strong> Tap <em>Start a new vault</em>. The old file is kept under a backup name.</li></ol>
    <form class="stack" data-form="vault-join">${USER}${pw('p', "Vault's passphrase", 'current-password', false, 0)}<button class="btn primary">Join vault</button></form>
    <button class="btn danger wide" data-act="vault-new">Start a new vault</button><button class="link" data-act="vault-join-cancel">Cancel</button>`;
  else if (m && m.fileId && c.status === 'newpass') body = `<p class="fine">The vault passphrase was changed on another device.</p><ol class="steps"><li>Enter the new vault passphrase below.</li><li>Tap <strong>Unlock vault</strong>.</li></ol>
    <form class="stack" data-form="vault-newpass">${USER}${pw('p', 'New vault passphrase', 'current-password', false, 0)}<button class="btn primary">Unlock vault</button></form>`;
  else if (!m || !m.fileId) body = tokenOk()
    ? `${who || '<p class="fine">Signed in.</p>'}<p class="fine">Create the encrypted vault in your Google Drive. It uses your Cycle passphrase.</p><button class="btn primary" data-act="vault-create">Create vault</button>`
    : '<p class="fine">Keep an encrypted copy in your own Google Drive, so your data survives a lost phone and appears on your other devices.</p><ol class="steps"><li>Tap <strong>Sign in with Google</strong>.</li><li>Choose the Google account to use. Use the same account on every device.</li><li>Tap <strong>Create vault</strong> (or enter the passphrase if a vault already exists).</li></ol><button class="btn primary" data-act="gsignin">Sign in with Google</button>';
  else if (!tokenOk()) body = `<p class="fine">Google sign-in lasts about an hour. Sign in again to sync${m.dirty ? '; your latest changes are waiting' : ''}.</p><button class="btn primary" data-act="gsignin">Sign in again</button>`;
  else body = `${who}<p class="fine">${c.status === 'error' ? `<span class="bad">${h(c.msg)}</span> ` : ''}Encrypted vault in your Google Drive (${C.VAULT_NAME}). Changes sync automatically.${m.lastSync ? ` Last sync ${fmtTime(m.lastSync)}.` : ''}</p>
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
  return `<button class="pill ${c.status === 'error' ? 'bad' : tokenOk() && !c.busy ? 'ok' : ''}" data-tab="settings" data-page="sync">${txt}</button>`;
}
function navBar() {
  const tabs = [['today', 'Today', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="2.2" class="f"/>'], ['calendar', 'Calendar', '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'], ['food', 'Food', '<path d="M12 21c-4.5 0-7-3.5-7-7.5C5 9 8 6 12 6s7 3 7 7.5c0 4-2.5 7.5-7 7.5z"/><path d="M12 6c0-1.6 1-3 2.5-3.5"/>'],
    ['history', 'History', '<path d="M5 6h14M5 12h14M5 18h9"/>'], ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>']];
  return `<nav class="tabs" aria-label="Sections"><div class="brand" aria-hidden="true">${ringMark()}<span>Cycle</span></div>${tabs.map(([id, l, ic]) => `<button data-tab="${id}" class="${S.tab === id ? 'on' : ''}" aria-current="${S.tab === id ? 'page' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${l}</span></button>`).join('')}</nav>`;
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
      ${future ? '' : testSection(d)}${future ? '' : sexSection(d)}
      ${future ? '' : daySymptoms(d)}
      <div class="stack-btns">${acts}<button class="btn" data-act="close-sheet">Close</button></div>`;
  }
  if (s.name === 'checkin') return checkinSheet(s.date);
  if (s.name === 'late') return lateSheet();
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
        <label>Reason<select name="excludeReason">${['', 'Pregnancy', 'Illness', 'Travel', 'Stopped hormonal contraception', 'Missed logging', 'Other'].map((r) => `<option ${p.excludeReason === r ? 'selected' : ''} value="${r}">${r || 'None'}</option>`).join('')}</select></label>` : ''}
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
  if (s.name === 'import-review') return S.imp ? `<h2>Check these periods</h2>${reviewBody()}` : '';
  if (s.name === 'import-paste') return `<h2>Paste dates</h2>${pasteSteps()}${pasteForm()}<button class="btn wide" data-act="close-sheet">Cancel</button>`;
  if (s.name === 'import-preview') {
    const m = S.imp; if (!m) return '';
    if (m.kind === 'vault' && !m.data) return `<h2>Encrypted file</h2>${vaultOpenForm()}<button class="btn wide" data-act="import-cancel">Cancel</button>`;
    return `<h2>Import this backup?</h2><p><strong>${h(backupSummary(m.data))}.</strong></p>
      ${m.skippedKnown ? `<p class="fine">${plural(m.skippedKnown, 'period')} already in Cycle (or overlapping one) left out.</p>` : ''}
      ${m.replaceIds ? `<p class="notice warnbox"><strong>${plural(m.replaceIds.length, 'current period')} will be removed</strong> and replaced by the ${plural(m.data.periods.length, 'period')} in this list. Check-ins and notes stay. The removal also syncs to your Google Drive vault.</p>` : '<p class="fine">It is merged with the data on this device: for each record, the newest version wins.</p>'}
      <div class="stack-btns"><button class="btn primary" data-act="import-confirm">Import</button><button class="btn" data-act="import-cancel">Cancel</button></div>`;
  }
  if (s.name === 'confirm') {
    return `<h2>${h(s.title)}</h2><p class="fine">${h(s.text)}</p><div class="stack-btns"><button class="btn ${s.danger ? 'danger' : 'primary'}" data-act="confirm-yes">${h(s.yes)}</button><button class="btn" data-act="close-sheet">Cancel</button></div>`;
  }
  return '';
}
// v4 (R7a): ovulation tests, several a day, each with its time and a remove button (I2)
const TESTS = [['neg', 'Negative'], ['pos', 'Positive'], ['peak', 'Peak']];
const anyLogged = (f) => Object.values(S.data.days).some((x) => x && (Array.isArray(x[f]) ? x[f].length : x[f] && x[f].kind && x[f].kind !== 'none'));
const newBadge = (f) => (anyLogged(f) ? '' : ' <span class="badge-new">New</span>');
function testSection(d) {
  if (hidden('tests')) return '';
  const list = ((S.data.days[d] || {}).ovu || []);
  const label = (r) => (TESTS.find((x) => x[0] === r) || [r, r])[1];
  return `<h3>Ovulation test${newBadge('ovu')}</h3><div class="chips">${TESTS.map(([v, l]) => `<button class="chip" data-act="ovu-add" data-date="${d}" data-r="${v}">${l}</button>`).join('')}</div>
    ${list.map((x, i) => [x, i]).sort((u, v) => String(u[0].at || '').localeCompare(String(v[0].at || ''))).map(([x, i]) => `<div class="logrow"><span>${h(x.at || '')} · ${label(x.r)}</span><button class="icon-x" data-act="ovu-del" data-date="${d}" data-i="${i}" aria-label="Remove this test">✕</button></div>`).join('')}
    ${list.some((x) => x.r !== 'neg') ? '<p class="fine">Ovulation usually follows within 1–2 days. An estimate, never a "safe" day.</p>' : ''}`;
}
// v4 (R7b): sex life, one entry a day with an optional note; can be hidden completely
const SEX = [['none', 'None'], ['protected', 'Protected'], ['unprotected', 'Unprotected']];
function sexSection(d) {
  if (hidden('sex')) return '';
  const x = (S.data.days[d] || {}).sex || {}; const k = x.kind || 'none';
  return `<h3>Sex life${newBadge('sex')}</h3><div class="chips">${SEX.map(([v, l]) => `<button class="chip ${k === v ? 'on' : ''}" aria-pressed="${k === v}" data-act="sex" data-date="${d}" data-kind="${v}">${l}</button>`).join('')}</div>
    ${k !== 'none' ? `<label class="stack fine">Note (optional)<input type="text" maxlength="200" value="${h(x.note || '')}" data-act="sex-note" data-date="${d}"></label>` : ''}`;
}
function daySymptoms(d) {
  const ci = S.data.checkins[d];
  const logged = ci ? Object.entries(ci.symptoms || {}).filter(([, s]) => s).map(([c, s]) => T.MOOD_GOOD.some((m) => m.code === c) ? T.label(c) : `${T.label(c)} (${T.SEVERITY[s].toLowerCase()})`) : [];
  return `<h3>Check-in</h3><p class="fine">${ci ? (logged.length ? h(logged.join(', ')) : 'No symptoms logged.') + (ci.note ? ` Note: ${h(ci.note)}` : '') : 'No check-in for this day.'}</p>
    <button class="btn small" data-act="checkin" data-date="${d}">${noteOnly() ? (ci ? 'Edit note' : 'Add note') : ci ? 'Edit check-in' : 'Add a check-in for this day'}</button>`;
}
// v4 (R8): late period check, 5 short steps; answers stay in memory unless saved to today's note
function lateSheet() {
  const L = S.late || { step: 1, changes: [], signs: [] }; const p = S.pred; const st = p.state;
  const bar = `<div class="steps-bar" aria-label="Step ${L.step} of 5"><i style="width:${L.step * 20}%"></i></div>`;
  const head = `<div class="late-head">${L.step > 1 ? '<button class="link" data-act="late-back">‹ Back</button>' : '<span></span>'}<span class="fine">Step ${L.step} of 5</span></div>${bar}`;
  const title = `<h2>${st.stale ? 'No period logged for a long time' : `Period ${plural(st.daysLate, 'day')} late`}</h2>`;
  const chips = (list, key) => `<div class="chips">${list.map(([v, l]) => `<button class="chip ${L[key].includes(v) ? 'on' : ''}" aria-pressed="${L[key].includes(v)}" data-act="late-tog" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const next = '<button class="btn primary wide" data-act="late-next">Next</button>';
  if (L.step === 1) {
    const done = cycles(S.data.periods).filter((c) => c.valid && !c.excluded).slice(-3).reverse();
    const max = Math.max(st.cycleDay, ...done.map((c) => c.length), 1);
    const row = (label, n, now) => `<div class="cmp"><span class="fine">${label}</span><span class="cmp-row"><span class="cmp-track"><i class="${now ? 'now' : ''}" style="width:${Math.round(n / max * 100)}%"></i></span><b>${plural(n, 'day')}</b></span></div>`;
    return `${head}${title}<h3>This cycle compared with your others</h3>${row(`This cycle so far (from ${fmt(p.lastStart)})`, st.cycleDay, true)}${done.map((c) => row(`${fmt(c.start)} – ${fmt(addDays(c.next, -1))}`, c.length)).join('')}${next}`;
  }
  if (L.step === 2) return `${head}<h2>Could you be pregnant?</h2><div class="stack-btns">${[['yes', 'Yes, possibly'], ['no', 'No'], ['unsure', 'Not sure']].map(([v, l]) => `<button class="btn ${L.preg === v ? 'primary' : ''}" data-act="late-preg" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (L.step === 3) return `${head}<h2>Anything new in the last 2 months?</h2><p class="fine">Choose all that apply.</p>${chips(T.LATE_CHANGES, 'changes')}${next}`;
  if (L.step === 4) return `${head}<h2>Any of these as well?</h2><p class="fine">Choose all that apply, or none.</p>${chips(T.LATE_SIGNS, 'signs')}${next}`;
  const r = lateResult(L, age());
  return `${head}<h2>What could be behind it</h2>
    <section class="card"><h3>From your answers</h3>${r.reasons.length ? r.reasons.map((x) => `<p>${h(x.text)}</p>`).join('') : '<p class="fine">None of the usual reasons were chosen.</p>'}
      <details><summary>Other possible reasons</summary><ul>${r.other.map((x) => `<li>${h(x)}</li>`).join('')}</ul></details></section>
    <section class="card"><h3>Next steps</h3><ol class="steps">${r.steps.map((x) => `<li>${h(x)}</li>`).join('')}</ol>
      ${L.preg === 'yes' ? '<button class="btn small" data-act="late-preg-mark">My test is positive: mark this cycle as pregnancy</button>' : ''}</section>
    <section class="card"><h3>See a doctor if</h3><ul>${r.doctor.map((x) => `<li>${h(x)}</li>`).join('')}</ul></section>
    <section class="note urgent"><p><strong>${h(r.urgent[0])}</strong></p><p><strong>${h(r.urgent[1])}</strong></p></section>
    <div class="row"><button class="btn" data-act="late-save">Save to today's note</button><button class="btn primary" data-act="close-sheet">Done</button></div>
    <p class="fine">Not a diagnosis. Based on <a href="${T.SRC.nhsMissed.url}" target="_blank" rel="noopener">${T.SRC.nhsMissed.name}</a> and <a href="${T.SRC.nhsEctopic.url}" target="_blank" rel="noopener">${T.SRC.nhsEctopic.name}</a>.</p>`;
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
  setDay(date, 'flow', flow);
  await persist();
  const info = S.pred && !S.pred.empty ? dayInfo(date, S.pred, S.data.periods, S.data.days) : {};
  if (['light', 'medium', 'heavy'].includes(flow) && !info.logged) { openSheet('confirm-start', { date, flow }); return; }
  render();
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { S.tab = tabBtn.dataset.tab; S.setPage = tabBtn.dataset.page || null; S.sheet = null; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.act, d = b.dataset.date;
  try {
    if (a === 'start') { S.view = 'onboard'; render(); }
    else if (a === 'restore-start') { S.restore = {}; S.view = 'restore'; render(); }
    else if (a === 'restore-cancel') { S.view = S.meta ? 'forgot' : 'welcome'; render(); }
    else if (a === 'forgot') { S.imp = null; S.view = 'forgot'; render(); }
    else if (a === 'back-locked') { S.view = 'locked'; render(); }
    else if (a === 'import-start') { S.imp = null; S.view = 'import'; render(); }
    else if (a === 'import-back') { S.imp = null; S.view = 'welcome'; render(); }
    else if (a === 'import-cancel') { S.imp = null; closeSheet(); }
    else if (a === 'import-reset') { S.imp = null; if (S.view === 'import') render(); else closeSheet(); }
    else if (a === 'paste-open') openSheet('import-paste');
    else if (a === 'row-del') { S.imp.rows.splice(+b.dataset.i, 1); render(); }
    else if (a === 'row-add') { S.imp.rows.push({ start: '', end: '' }); render(); }
    else if (a === 'import-order') { const m = S.imp; S.imp = foundFrom(m.text, m.source, b.dataset.order); render(); }
    else if (a === 'review-continue') reviewContinue();
    else if (a === 'import-confirm') { const inc = S.imp.data, rm = S.imp.replaceIds; S.imp = null; if (rm) { const now = Date.now(); for (const p of S.data.periods) if (rm.includes(p.id)) Object.assign(p, { deleted: true, updatedAt: now }); } S.data = upgrade(C.merge(S.data, inc)); await persist(); closeSheet(); toast(`Backup imported: ${plural(livePeriods(inc.periods).length, 'period')}`); }
    else if (a === 'look-mode' || a === 'look-theme' || a === 'look-companion') await setLook({ [a.slice(5)]: b.dataset.v });
    else if (a === 'note-seen') await setLook({ noteSeen: true });
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
    else if (a === 'set-page') { S.setPage = b.dataset.v || null; S.guideOpen = null; render(); window.scrollTo(0, 0); }
    else if (a === 'guide') { S.tab = 'settings'; S.setPage = 'guide'; S.guideOpen = b.dataset.id; S.sheet = null; render(); const g = document.getElementById(`g-${b.dataset.id}`); if (g) g.scrollIntoView({ block: 'center' }); }
    else if (a === 'disp-date' || a === 'disp-week') { const k = a === 'disp-date' ? 'dateFmt' : 'weekStart'; S.data.settings = { ...S.data.settings, display: { ...display(), [k]: b.dataset.v, updatedAt: Date.now() }, updatedAt: Date.now() }; await persist(); render(); }
    else if (a === 'del-cat') confirmSheet(b.dataset.k === 'sex' ? 'Delete all sex-life data?' : 'Delete all ovulation tests?', 'Removed on this device and, with sync on, in your Google Drive vault. This cannot be undone.', 'Delete', async () => {
      for (const d0 of Object.keys(S.data.days)) if (S.data.days[d0][b.dataset.k] !== undefined) setDay(d0, b.dataset.k, b.dataset.k === 'sex' ? { kind: 'none' } : []);
      await persist(); closeSheet(); toast('Deleted');
    }, true);
    else if (a === 'rep-range') { S.report.range = b.dataset.v; render(); }
    else if (a === 'rep-make') await makeReport();
    else if (a === 'hist-filter') { S.histFilter = b.dataset.v; render(); }
    else if (a === 'late-check') { S.late = { step: 1, changes: [], signs: [] }; openSheet('late'); }
    else if (a === 'late-next') { S.late.step = Math.min(5, S.late.step + 1); render(); }
    else if (a === 'late-back') { S.late.step = Math.max(1, S.late.step - 1); render(); }
    else if (a === 'late-preg') { S.late.preg = b.dataset.v; S.late.step = 3; render(); }
    else if (a === 'late-tog') { const arr = S.late[b.dataset.k]; const i = arr.indexOf(b.dataset.v); if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.v); render(); }
    else if (a === 'late-save') {
      const t = today(); const L = S.late; const st = S.pred.state; const names = [...T.LATE_CHANGES.filter(([c]) => L.changes.includes(c)).map((x) => x[1].toLowerCase()), ...T.LATE_SIGNS.filter(([c]) => L.signs.includes(c)).map((x) => x[1].toLowerCase())];
      const line = `Late check (${st.stale ? 'long gap' : `${st.daysLate} days late`}): ${names.length ? names.join(', ') : 'nothing new chosen'}${L.preg ? `; pregnancy ${L.preg === 'unsure' ? 'not sure' : L.preg}` : ''}.`;
      const ci = S.data.checkins[t] || {}; // I1: added to the note, never overwriting it
      S.data.checkins[t] = { ...ci, note: ci.note ? `${ci.note}\n${line}` : line, updatedAt: Date.now() }; await persist(); toast("Saved to today's note");
    }
    else if (a === 'late-preg-mark') confirmSheet('Mark this cycle as pregnancy?', 'Predictions and late alerts pause until you end pregnancy mode. You can change this any time in History.', 'Mark as pregnancy', async () => {
      const lp = S.pred.lastPeriod; const p0 = S.data.periods.find((x) => x.id === lp.id); Object.assign(p0, { excluded: true, excludeReason: 'Pregnancy', updatedAt: Date.now() }); await persist(); closeSheet(); toast('Predictions paused');
    });
    else if (a === 'ovu-add') { const dd = S.data.days[d] || {}; const now = new Date(); setDay(d, 'ovu', [...(dd.ovu || []), { r: b.dataset.r, at: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` }]); await persist(); render(); }
    else if (a === 'ovu-del') { const list = [...((S.data.days[d] || {}).ovu || [])]; list.splice(+b.dataset.i, 1); setDay(d, 'ovu', list); await persist(); render(); }
    else if (a === 'sex') { const prev = (S.data.days[d] || {}).sex || {}; setDay(d, 'sex', b.dataset.kind === 'none' ? { kind: 'none' } : { ...prev, kind: b.dataset.kind }); await persist(); render(); }
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
    else if (a === 'export-enc') download(`cycle-backup-${today()}.encrypted.json`, await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter), 'application/json');
    else if (a === 'export-json') download(`cycle-backup-${today()}.json`, JSON.stringify(S.data, null, 1), 'application/json');
    else if (a === 'export-csv') download(`cycle-periods-${today()}.csv`, csv(), 'text/csv');
    else if (a === 'wipe') confirmSheet('Delete all data on this device?', 'Everything Cycle stores on this device is removed. Your Google Drive vault, if any, is not touched.', 'Delete everything', async () => {
      await kvClear(); Object.assign(S, { meta: null, key: null, data: null, pred: null, sheet: null, late: null, report: null, setPage: null, guideOpen: null, histFilter: null, imp: null, view: 'welcome', cloud: { token: null, status: 'off', msg: '', busy: false } }); render();
    }, true);
    else if (a === 'gsignin') await signIn('sync', S.meta && S.meta.cloud && S.meta.cloud.fileId ? '' : 'select_account');
    else if (a === 'gswitch') { S.cloud.existing = null; await signIn('sync', 'select_account'); }
    else if (a === 'restore-switch') { S.restore = {}; await signIn('restore', 'select_account'); }
    else if (a === 'vault-new') confirmSheet('Start a new vault?', `The vault file already in this Google account is kept, renamed to a backup name, and is not deleted. A new vault is then created from the ${plural(livePeriods(S.data.periods).length, 'period')} on this device, using this device's passphrase. Other devices that used the old vault need Restore from Google Drive with the new passphrase.`, 'Start a new vault', async () => {
      closeSheet(); const old = S.cloud.existing; const stamp = localToday().replace(/-/g, '');
      await cloudAction('New vault created', async () => { await C.renameFile(cloudTok(), old.id, `cycle-vault-old-${stamp}.json`); S.cloud.existing = null; await createVaultFlow(); });
    }, true);
    else if (a === 'vault-create') {
      busy(true, 'Checking Google Drive');
      try { const files = await C.findVault(cloudTok()); busy(false);
        if (files.length) { S.cloud.existing = files[0]; render(); return; } }
      catch (e) { busy(false); throw e; }
      await cloudAction('Vault created', createVaultFlow);
    }
    else if (a === 'sync-now') await syncNow();
    else if (a === 'disconnect') confirmSheet('Stop syncing this device?', 'Your data stays on this device and in Google Drive.', 'Disconnect', async () => {
      S.meta.cloud = null; await kvSet('meta', S.meta); closeSheet(); toast('Sync is off on this device');
    });
  } catch (err) { busy(false); lostSignIn(err); toast(friendly(err)); }
});
// B7: the checked list becomes a normal backup; from Settings it is merged (rows already in Cycle are left out), at start-up it needs a passphrase next
function reviewContinue() {
  const m = S.imp; const rows = m.rows.filter((r) => !r.off && (r.start || r.end)).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  if (!rows.length) { toast('Add at least one period.'); return; }
  for (const r of rows) {
    if (!isDate(r.start)) { toast('Every row needs a start date.'); return; }
    if (diff(r.start, today()) > 0 || (r.end && diff(r.end, today()) > 0)) { toast('Dates cannot be in the future.'); return; }
    if (r.end && (!isDate(r.end) || diff(r.end, r.start) < 0)) { toast('An end date cannot be before its start date.'); return; }
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.start === b.start || (a.end && diff(b.start, a.end) <= 0)) { toast(`Two rows overlap around ${fmt(b.start, true)}. Remove one.`); return; }
  }
  let keep = rows;
  if (S.view !== 'import') {
    keep = m.replace ? rows : rows.filter((r) => !overlapping(r.start, r.end || null));
    if (!keep.length) { toast('All of these periods are already in Cycle.'); return; }
  }
  const now = Date.now();
  S.imp = { kind: 'plain', replaceIds: m.replace && S.view !== 'import' ? livePeriods(S.data.periods).map((x) => x.id) : null, skippedKnown: rows.length - keep.length, data: { app: 'cycle', v: 1, settings: { updatedAt: 0 }, periods: keep.map((r) => ({ id: uid(), start: r.start, end: r.end || null, updatedAt: now })), days: {}, checkins: {}, acks: {} } };
  if (S.view === 'import') render(); else openSheet('import-preview');
}
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'hide-tog') { S.data.settings = { ...S.data.settings, hide: { ...(S.data.settings.hide || {}), [el.dataset.k]: !el.checked, updatedAt: Date.now() }, updatedAt: Date.now() }; await persist(); render(); return; }
  if (el.dataset.act === 'rep-tog') { S.report.on[el.dataset.k] = el.checked; return; }
  if (el.dataset.act === 'sex-note') { const prev = (S.data.days[el.dataset.date] || {}).sex || {}; setDay(el.dataset.date, 'sex', { ...prev, note: el.value.slice(0, 200) }); await persist(); return; }
  if (el.dataset.act === 'row-tick' && S.imp && S.imp.rows) { S.imp.rows[+el.dataset.i].off = !el.checked; el.closest('.irow').classList.toggle('off', !el.checked); return; }
  if (el.dataset.act === 'import-replace' && S.imp) { S.imp.replace = el.checked; return; }
  if (el.dataset.act === 'wording') {
    if (el.checked) { el.checked = false; openSheet('wording'); }
    else { S.data.settings = { ...S.data.settings, wording: false, updatedAt: Date.now() }; await persist(); render(); toast('Pregnancy-chance wording is off'); }
  } else if (el.dataset.act === 'look-card') {
    const l = look(); await setLook({ cards: { ...l.cards, [el.dataset.k]: el.checked } });
  } else if ((el.dataset.act === 'row-start' || el.dataset.act === 'row-end') && S.imp && S.imp.rows) {
    S.imp.rows[+el.dataset.i][el.dataset.act === 'row-start' ? 'start' : 'end'] = el.value; refreshCloseNotes();
  } else if (el.dataset.act === 'import-json' && el.files[0]) {
    try { S.imp = await readBackup(el.files[0]); openSheet(S.imp.kind === 'found' ? 'import-review' : 'import-preview'); } catch (err) { toast(err.message); }
    el.value = '';
  } else if (el.dataset.act === 'import-pick' && el.files[0]) {
    try { S.imp = await readBackup(el.files[0]); render(); } catch (err) { toast(err.message); }
    el.value = ''; // G-3: the same file can be picked again after a refusal
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f); const kind = f.dataset.form;
  try {
    if (kind === 'onboard') {
      const num = (k, lo, hi) => { const v = Number(fd.get(k)); return v >= lo && v <= hi ? v : null; };
      S.draft = { last: fd.get('last'), usualCycle: num('usualCycle', 15, 90), usualPeriod: num('usualPeriod', 1, 15), birthYear: num('birthYear', 1940, 2100), diet: fd.get('diet') };
      if (S.draft.last && diff(S.draft.last, today()) > 0) { toast('The last period cannot be in the future.'); return; }
      S.view = 'passphrase'; render();
    } else if (kind === 'passphrase') {
      if (fd.get('p1') !== fd.get('p2')) { toast('The two passphrases are different.'); return; }
      busy(true, 'Encrypting');
      const salt = K.newSalt(); S.key = await K.deriveKey(fd.get('p1'), salt);
      const d = S.draft; S.data = fresh();
      S.data.settings = { usualCycle: d.usualCycle, usualPeriod: d.usualPeriod, birthYear: d.birthYear || null, diet: d.diet, accepted: new Date().toISOString(), wording: false, updatedAt: Date.now() };
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
    } else if (kind === 'import-paste') {
      S.imp = foundFrom(String(fd.get('text')), 'the pasted text');
      if (S.view === 'import') render(); else openSheet('import-review');
    } else if (kind === 'import-open') {
      busy(true, 'Opening the file');
      const m = S.imp; const key = await K.deriveKey(fd.get('p'), m.head.salt, m.head.iter);
      const data = await C.openVault(m.text, key);
      if (!data || data.app !== 'cycle' || !Array.isArray(data.periods)) throw new Error('This file does not hold Cycle data.');
      S.imp = { kind: 'vault', data: upgrade(data) }; busy(false); render();
    } else if (kind === 'import-new') {
      if (fd.get('p1') !== fd.get('p2')) { toast('The two passphrases are different.'); return; }
      busy(true, 'Restoring');
      const salt = K.newSalt(); S.key = await K.deriveKey(fd.get('p1'), salt); S.data = upgrade(S.imp.data); S.imp = null;
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
      const date = f.dataset.date; const prev = S.data.checkins[date] || {};
      // G5-2: entries this form does not show (a hidden category) are kept, never erased
      const shown = new Set([...f.querySelectorAll('[name^=s_], [name^=g_]')].map((x) => x.name.slice(2)));
      const symptoms = Object.fromEntries(Object.entries(prev.symptoms || {}).filter(([k]) => !shown.has(k)));
      for (const [k, v] of fd.entries()) {
        if (k.startsWith('s_') && Number(v) > 0) symptoms[k.slice(2)] = Number(v);
        if (k.startsWith('g_')) symptoms[k.slice(2)] = 1;
      }
      // G5-3: fields this form does not know are kept; the ones it edits are set again from the form
      const ci = { ...prev, symptoms, updatedAt: Date.now() };
      for (const k of ['change', 'discharge', 'clots', 'dizzy', 'sidepain', 'meds', 'note']) if (f.querySelector(`[name=${k}]`)) delete ci[k];
      for (const k of ['change', 'discharge']) if (fd.get(k)) ci[k] = fd.get(k);
      for (const k of ['clots', 'dizzy', 'sidepain']) if (fd.has(k)) ci[k] = fd.get(k) === '1';
      if ((fd.get('meds') || '').trim()) ci.meds = fd.get('meds').trim();
      if ((fd.get('note') || '').trim()) ci.note = fd.get('note').trim();
      S.data.checkins[date] = ci;
      if (fd.has('flow') && fd.get('flow') !== ((S.data.days[date] || {}).flow || 'none')) setDay(date, 'flow', fd.get('flow'));
      await persist(); S.sheet = null; render(); window.scrollTo(0, 0); toast('Check-in saved');
    } else if (kind === 'end-earlier') await endPeriod(fd.get('end'));
    else if (kind === 'settings') {
      const num = (k, lo, hi) => { const v = Number(fd.get(k)); return v >= lo && v <= hi ? v : null; };
      S.data.settings = { ...S.data.settings, usualCycle: num('usualCycle', 15, 90), usualPeriod: num('usualPeriod', 1, 15), birthYear: num('birthYear', 1940, 2100), diet: fd.get('diet') || null, updatedAt: Date.now() };
      await persist(); render(); toast('Saved');
    } else if (kind === 'helpline') {
      const number = (fd.get('number') || '').trim(); const name = (fd.get('name') || '').trim().slice(0, 40);
      if (number && !/^[+0-9 ()/-]{3,25}$/.test(number)) { toast('Use digits, spaces and + only.'); return; }
      S.data.settings = { ...S.data.settings, helpline: number ? { name, number } : null, updatedAt: Date.now() };
      await persist(); render(); toast(number ? 'Support line saved' : 'Support line removed');
    }
  } catch (err) { busy(false); lostSignIn(err); toast(friendly(err)); }
});

function busy(on, msg = '') { const b = $('#busy'); b.hidden = !on; b.querySelector('span').textContent = msg; }
function afterUnlock() { busy(false); recompute(); S.view = 'app'; render(); if (cloudReady()) syncNow(true); }
function lockApp() { Object.assign(S, { key: null, data: null, pred: null, sheet: null, late: null, report: null, setPage: null, guideOpen: null, histFilter: null, imp: null, view: 'locked' }); render(); }

// ---------------- Face ID ----------------
async function faceIdSetup() {
  busy(true, 'Waiting for Face ID');
  try { S.meta.lock = await Lock.setup(S.key); await kvSet('meta', S.meta); busy(false); toast('Face ID unlock is on'); S.view = 'app'; render(); }
  catch (e) {
    busy(false); toast(e.message);
    // I4: the passkey exists but the browser wanted a tap first: the next tap anywhere finishes the setup (once)
    if (e.retryOnTap && S.view === 'faceid') document.addEventListener('click', (ev) => { if (!ev.target.closest('[data-act=faceid-skip]')) faceIdSetup(); }, { once: true });
  }
}
async function unlockFaceId() {
  busy(true, 'Waiting for Face ID');
  try { const key = await Lock.unlock(S.meta.lock); S.data = upgrade(await K.open(await kvGet('sealed'), key)); S.key = key; afterUnlock(); }
  catch (e) { busy(false); toast(e.message); }
}

// ---------------- Google Drive sync ----------------
const cloudReady = () => !!(cfg.googleClientId && S.meta && S.meta.cloud && S.meta.cloud.fileId && S.key);
const tokenOk = () => !!(S.cloud.token && S.cloud.token.exp > Date.now());
// B16 (v4): no Drive call without a valid sign-in; a lost sign-in sends her back one step with a plain message
const SIGNIN_LOST = 'Your Google sign-in was lost. Tap Sign in with Google again.';
function needToken(t) { if (!t || !t.token || (t.exp && t.exp <= Date.now())) throw Object.assign(new Error(SIGNIN_LOST), { code: 'signin' }); return t.token; }
const cloudTok = () => needToken(S.cloud.token);
const restoreTok = () => needToken(S.restore && S.restore.token);
// raw program errors are never shown to her (they are logged instead)
function friendly(err) { console.error(err); return err instanceof TypeError || err instanceof ReferenceError || !err.message ? 'Something went wrong. Please try again.' : err.message; }
function lostSignIn(err) {
  if (err.code !== 'signin' && err.code !== 401) return false;
  if (S.view === 'restore') S.restore = {}; else { S.cloud.token = null; kvSet('gtoken', null); }
  render(); return true;
}
// B10: the first sign-in always lets her choose the Google account; a later sign-in to an existing vault stays silent
async function signIn(next, prompt = 'select_account') {
  if (!cfg.googleClientId) { toast('Google sync is not set up in config.js.'); return; }
  if (C.isStandalone()) { C.signInRedirect(cfg.googleClientId, next, prompt); return; }
  const tok = await C.signInWindow(cfg.googleClientId, prompt);
  tok.email = await C.accountEmail(tok.token).catch(() => '');
  S.cloud.token = tok; await kvSet('gtoken', tok);
  if (next === 'restore') { S.restore = { token: tok }; await findForRestore(); }
  else { render(); if (cloudReady()) await syncNow(); }
}
async function findForRestore() {
  const st = S.restore; // B16: only the attempt that started the search gets its result
  busy(true, 'Checking Google Drive');
  let files;
  try { files = await C.findVault(restoreTok()); } finally { busy(false); }
  if (S.restore !== st) return;
  st.fileId = files.length ? files[0].id : null; render();
}
async function restoreFlow(pass) {
  const tok = restoreTok(); const text = await C.download(tok, S.restore.fileId);
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
  const tok = cloudTok(); const id = fileId || S.cloud.existing.id;
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
    const res = await C.updateVault(cloudTok(), S.meta.cloud.fileId, await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter));
    S.meta.cloud.remoteModified = res.modifiedTime; S.meta.cloud.dirty = false; await kvSet('meta', S.meta);
  } else if (S.meta.cloud && S.meta.cloud.fileId) { S.meta.cloud.dirty = true; await kvSet('meta', S.meta); }
}
async function createVaultFlow() {
  const res = await C.createVault(cloudTok(), await C.sealVault(S.data, S.key, S.meta.salt, S.meta.iter));
  S.meta.cloud = { fileId: res.id, remoteModified: res.modifiedTime, lastSync: new Date().toISOString(), dirty: false };
  await kvSet('meta', S.meta);
}
async function cloudAction(done, fn) {
  busy(true, 'Talking to Google Drive');
  try { await fn(); toast(done); } catch (e) { if (e.code === 401 || e.code === 'signin') { S.cloud.token = null; await kvSet('gtoken', null); } toast(friendly(e)); }
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
  const tok = cloudTok(), m = S.meta.cloud;
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
  } finally { S.cloud.busy = false; await kvSet('meta', S.meta); if (S.view === 'app') softRender(); }
}

// ---------------- export ----------------
async function makeReport() {
  const r = S.report; const t = today();
  const first = livePeriods(S.data.periods)[0];
  const from = r.range === '6m' ? addDays(t, -182) : r.range === '12m' ? addDays(t, -365) : (first ? first.start : t);
  const on = { ...r.on }; for (const k of ['symptoms', 'moods', 'tests', 'sex']) if (hidden(k)) on[k] = false;
  busy(true, 'Making the report');
  try {
    const R = await import('./report.js');
    const bytes = R.buildReport(S.data, { from, to: t, today: t, sections: on, fmt, pred: hidden('predictions') ? null : S.pred, label: T.label, moods: T.MOOD_GOOD.map((m) => m.code) });
    busy(false);
    const how = await R.shareOrDownload(bytes, `cycle-report-${t}.pdf`);
    if (how === 'downloaded') toast('Report saved');
  } catch (e) { busy(false); toast(friendly(e)); }
}
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
  if (red && red.token) { S.cloud.token = { token: red.token, exp: red.exp }; try { S.cloud.token.email = await C.accountEmail(red.token); } catch { /* shown only when known */ } await kvSet('gtoken', S.cloud.token); }
  if (!S.meta || (red && red.next === 'restore')) {
    if (red && red.next === 'restore') { S.restore = { token: red.token ? S.cloud.token : null }; S.view = 'restore'; if (red.token) { try { await findForRestore(); } catch (e) { toast(e.message); } } }
    else S.view = 'welcome';
  } else { S.view = 'locked'; if (red && red.next === 'sync') S.tab = 'settings'; }
  if (red && red.error) toast(red.error);
  render();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyLook(); }); } catch { /* old browser */ }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') S.hiddenAt = Date.now();
    else if (S.view === 'app') {
      if (S.hiddenAt && Date.now() - S.hiddenAt > AUTO_LOCK_MS) lockApp();
      else { recompute(); softRender(); if (cloudReady()) syncNow(true); }
    }
  });
})();
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
// I3: a redraw held back while she was typing is done once the field loses focus
document.addEventListener('focusin', (e) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !/checkbox|radio|file/.test(e.target.type)) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => document.body.classList.remove('typing'), 50));
document.addEventListener('focusout', () => setTimeout(() => { if (S.redrawLater && !busyEditing()) render(); }, 250));
window.__cycle = { busyEditing, softRender, S, predict, VERSION, render, findForRestore, restoreFlow, recompute, persist };
