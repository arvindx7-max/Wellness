// Encrypted sync through the user's own Google Drive (FR-10, NFR-03). No server: the browser talks to Google directly.
// The vault file holds only ciphertext. Access scope drive.file = only files this app created.
// Own file name and storage keys, so other apps on the same web address are never touched.
import { seal, open } from './crypto.js';

export const VAULT_NAME = 'cycle-vault.json';
const APP_TAG = 'cycle-wellness-vault';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LS = (k) => `cycle_${k}`; // keeps clear of other apps' keys on this address

export async function sealVault(obj, key, salt, iter) { return JSON.stringify({ app: APP_TAG, v: 1, kdf: 'PBKDF2-SHA256', iter, salt, ...(await seal(obj, key)) }); }
export function vaultHeader(text) {
  let v; try { v = JSON.parse(text); } catch { throw new Error('The Drive file is not a vault from this app.'); }
  if (v.app !== APP_TAG) throw new Error('The Drive file is not a vault from this app.');
  return v;
}
export async function openVault(text, key) { return open(vaultHeader(text), key, "That passphrase doesn't open this vault."); }

// ---------- sign-in: redirect for the Home Screen app, window elsewhere ----------
export const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
export const redirectUri = () => location.origin + location.pathname;
export function signInRedirect(clientId, next, prompt = '') {
  const state = crypto.getRandomValues(new Uint32Array(4)).join('');
  try { localStorage.setItem(LS('oauth_state'), state); localStorage.setItem(LS('oauth_next'), next); } catch { /* storage blocked */ }
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state, ...(prompt ? { prompt } : {}) });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}
export function readRedirect() {
  if (!/access_token=|error=/.test(location.hash)) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let expected = null, next = 'sync';
  try { expected = localStorage.getItem(LS('oauth_state')); next = localStorage.getItem(LS('oauth_next')) || 'sync'; localStorage.removeItem(LS('oauth_state')); } catch { /* ignore */ }
  if (h.get('error')) return { error: h.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${h.get('error')}).`, next };
  if (!expected || h.get('state') !== expected) return { error: 'Google sign-in could not be verified. Try again.', next };
  return { token: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in') || 3600) - 60) * 1000, next };
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Could not reach Google. Check the internet connection.'));
    document.head.appendChild(s);
  });
}
export async function signInWindow(clientId, prompt = '') {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (r) => (r && r.access_token ? res({ token: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000 })
        : rej(new Error(r && r.error_description ? r.error_description : 'Google sign-in failed.'))),
      error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Google sign-in window could not open.')),
    });
    tc.requestAccessToken({ prompt });
  });
}

// ---------- Drive ----------
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
async function api(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (r.status === 401) throw Object.assign(new Error('Google sign-in has expired.'), { code: 401 });
  if (r.status === 404) throw Object.assign(new Error('The vault file was not found in Google Drive.'), { code: 404 });
  if (!r.ok) throw new Error(`Google Drive answered with error ${r.status}.`);
  return r;
}
export async function findVault(token) {
  const q = encodeURIComponent(`name='${VAULT_NAME}' and trashed=false`);
  return (await (await api(token, `${DRIVE}?q=${q}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`)).json()).files || [];
}
// v3.2 (B10): which Google account is signed in (shown to the user) and renaming the old vault file when a new one is started
export async function accountEmail(token) { return (await (await api(token, 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json()).user.emailAddress || ''; }
export async function renameFile(token, id, name) { return (await api(token, `${DRIVE}/${id}?fields=id,name`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json(); }
export async function fileMeta(token, id) { return (await api(token, `${DRIVE}/${id}?fields=id,modifiedTime`)).json(); }
export async function download(token, id) { return (await api(token, `${DRIVE}/${id}?alt=media`)).text(); }
export async function createVault(token, text) {
  const bd = `cyc${Date.now()}`;
  const body = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: VAULT_NAME, mimeType: 'application/json' })}\r\n--${bd}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${bd}--`;
  return (await api(token, `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bd}` }, body })).json();
}
export async function updateVault(token, id, text) {
  return (await api(token, `${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text })).json();
}

// ---------- merge: newest change wins per record; deletions are kept as tombstones so they sync ----------
// v4 (G4-1): a day holds several separate entries (bleeding, ovulation tests, sex life), each with its own time,
// so two devices logging different things on the same day both keep theirs. Fields and keys this version does
// not know are kept, so a newer version's data survives a sync through this one.
export const SCHEMA = 4;
const DAY_FIELDS = ['flow', 'ovu', 'sex'];
const at = (d, f) => (d && (d[f + 'At'] ?? (d[f] !== undefined ? d.updatedAt : 0))) || 0;
export function mergeDay(a, b) {
  if (!a) return b; if (!b) return a;
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const out = { ...(newer === a ? b : a), ...newer };
  for (const f of DAY_FIELDS) {
    const src = at(b, f) > at(a, f) ? b : at(a, f) > at(b, f) ? a : newer;
    if (src[f] === undefined) { delete out[f]; delete out[f + 'At']; } else { out[f] = src[f]; out[f + 'At'] = at(src, f); }
  }
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}
// I5-1 (v4): settings sync part by part: look, display and hide each carry their own time, so a change to one
// part on one device cannot undo a change to another part made on the other device
const SETTING_PARTS = ['look', 'display', 'hide'];
export function mergeSettings(a = {}, b = {}) {
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const out = { ...(newer === a ? b : a), ...newer };
  for (const k of SETTING_PARTS) {
    const x = a[k], y = b[k];
    if (x && y) out[k] = ((y.updatedAt || 0) > (x.updatedAt || 0)) ? y : ((x.updatedAt || 0) > (y.updatedAt || 0)) ? x : newer[k];
    else if (x || y) out[k] = x || y;
  }
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}
// v5 (B20): a period saved twice (the same history imported on two devices, or a backup imported over itself) has two
// records with different ids but the same first day. They become one: the lowest id stays, with the later end and any
// exclusion kept; the others are tombstoned so the repair syncs. Every device computes the same result, and running
// it again changes nothing.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function dedupePeriods(periods) {
  const groups = {};
  for (const p of periods || []) if (!p.deleted && DATE.test(p.start || '')) (groups[p.start] ||= []).push(p);
  const swap = new Map();
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const top = Math.max(...g.map((p) => p.updatedAt || 0)) + 1;
    const ends = g.map((p) => p.end).filter((e) => DATE.test(e || '')).sort();
    const ex = [...g].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (a.id < b.id ? -1 : 1)).find((p) => p.excluded); // the newest exclusion wins, the same on every device
    const keep = { ...g[0], updatedAt: top };
    if (ends.length) keep.end = ends[ends.length - 1];
    if (ex) { keep.excluded = true; keep.excludeReason = ex.excludeReason || ''; }
    if (g.some((p) => p.confirmedLong)) keep.confirmedLong = true;
    swap.set(g[0], keep);
    for (const p of g.slice(1)) swap.set(p, { ...p, deleted: true, updatedAt: top });
  }
  return swap.size ? (periods || []).map((p) => swap.get(p) || p) : (periods || []);
}
export function merge(local, remote) {
  if (!remote) return local;
  const newer = (a, b) => ((b && b.updatedAt) || 0) > ((a && a.updatedAt) || 0) ? b : a;
  const byId = {};
  for (const p of [...(local.periods || []), ...(remote.periods || [])]) byId[p.id] = byId[p.id] ? newer(byId[p.id], p) : p;
  const days = { ...(local.days || {}) };
  for (const [d, v] of Object.entries(remote.days || {})) days[d] = mergeDay(days[d], v);
  const perKey = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = o[k] ? newer(o[k], v) : v; return o; };
  return { ...remote, ...local, app: 'cycle', v: 1, schema: Math.max(SCHEMA, local.schema || 0, remote.schema || 0),
    settings: mergeSettings(local.settings || {}, remote.settings || {}), periods: dedupePeriods(Object.values(byId)), days,
    checkins: perKey(local.checkins, remote.checkins), acks: perKey(local.acks, remote.acks) };
}
