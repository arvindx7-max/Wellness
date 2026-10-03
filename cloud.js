// Encrypted sync through her own Google Drive (FR-10, NFR-03). No server: the browser talks to Google directly.
// The vault file holds only ciphertext. Access scope drive.file = only files this app created.
// Same pattern as the Finances app, with its own file name and storage keys (both apps share one web address).
import { seal, open } from './crypto.js';

export const VAULT_NAME = 'cycle-vault.json';
const APP_TAG = 'cycle-wellness-vault';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LS = (k) => `cycle_${k}`; // keeps clear of the Finances app's keys

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
export function signInRedirect(clientId, next) {
  const state = crypto.getRandomValues(new Uint32Array(4)).join('');
  try { localStorage.setItem(LS('oauth_state'), state); localStorage.setItem(LS('oauth_next'), next); } catch { /* storage blocked */ }
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state });
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
export async function signInWindow(clientId) {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (r) => (r && r.access_token ? res({ token: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000 })
        : rej(new Error(r && r.error_description ? r.error_description : 'Google sign-in failed.'))),
      error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Google sign-in window could not open.')),
    });
    tc.requestAccessToken({ prompt: '' });
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
export function merge(local, remote) {
  if (!remote) return local;
  const newer = (a, b) => ((b && b.updatedAt) || 0) > ((a && a.updatedAt) || 0) ? b : a;
  const byId = {};
  for (const p of [...(local.periods || []), ...(remote.periods || [])]) byId[p.id] = byId[p.id] ? newer(byId[p.id], p) : p;
  const days = { ...(local.days || {}) };
  for (const [d, v] of Object.entries(remote.days || {})) days[d] = days[d] ? newer(days[d], v) : v;
  const perKey = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = o[k] ? newer(o[k], v) : v; return o; };
  return { app: 'cycle', v: 1, settings: newer(local.settings || {}, remote.settings || {}), periods: Object.values(byId), days,
    checkins: perKey(local.checkins, remote.checkins), acks: perKey(local.acks, remote.acks) };
}
