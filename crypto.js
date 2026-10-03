// Encryption shared by on-device storage and the Drive vault (NFR-02, NFR-03).
// One passphrase → one AES-GCM 256 key (PBKDF2-SHA256). Data is sealed before it is stored or uploaded.
const enc = new TextEncoder(), dec = new TextDecoder();
export const ITER = 310000;
export const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

// Extractable so the Face ID lock can wrap it; it is never written anywhere unwrapped.
export async function deriveKey(passphrase, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function open(blob, key, msg = 'That passphrase does not open this data.') {
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct)))); }
  catch { throw new Error(msg); }
}
export const exportRaw = async (key) => b64(await crypto.subtle.exportKey('raw', key));
export const importRaw = (raw) => crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
