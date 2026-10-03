// Face ID / Touch ID lock (FR-11) — same method as the Finances app v14.
// A passkey for this site with the PRF extension yields a secret only after your face or fingerprint
// is verified. That secret wraps the data key, so without Face ID (or the passphrase) nothing opens.
import { b64, unb64, seal, open, exportRaw, importRaw } from './crypto.js';
const enc = new TextEncoder();

export async function available() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function wrapKeyFrom(prf, salt) {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unb64(salt), info: enc.encode('wellness-device-lock-v1') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function prfFor(credId, prfSalt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
    userVerification: 'required', timeout: 60000,
    extensions: { prf: { eval: { first: unb64(prfSalt) } } },
  } });
  const r = cred.getClientExtensionResults();
  const out = r && r.prf && r.prf.results && r.prf.results.first;
  if (!out) throw Object.assign(new Error('This browser verified you but cannot provide an encryption key, so Face ID unlock is not supported here.'), { code: 'noprf' });
  return out;
}
// Creates the passkey and returns what to store: the data key, wrapped by the Face ID secret.
export async function setup(dataKey) {
  const prfSalt = b64(crypto.getRandomValues(new Uint8Array(32)));
  const hkdfSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Cycle' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Cycle app lock', displayName: 'Cycle app lock' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: {} },
    } });
  } catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Face ID setup was cancelled.' : `Face ID setup failed (${e.name}).`); }
  const credId = b64(cred.rawId);
  const wrap = await wrapKeyFrom(await prfFor(credId, prfSalt), hkdfSalt);
  return { credId, prfSalt, hkdfSalt, wrapped: await seal({ raw: await exportRaw(dataKey) }, wrap), since: new Date().toISOString() };
}
export async function unlock(meta) {
  let prf;
  try { prf = await prfFor(meta.credId, meta.prfSalt); }
  catch (e) { if (e.code === 'noprf') throw e; throw new Error(e.name === 'NotAllowedError' ? 'Face ID was cancelled or did not match.' : `Unlock failed (${e.name || e.message}).`); }
  const { raw } = await open(meta.wrapped, await wrapKeyFrom(prf, meta.hkdfSalt), 'Face ID unlock failed. Use your passphrase.');
  return importRaw(raw);
}
