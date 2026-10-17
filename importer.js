// v3.1 (B7): find period dates in text taken from another app (PDF, CSV, text) or pasted in.
// Everything runs on the device. The result is only a suggestion: the app shows it as a list to check before anything is stored.
import { fromDays, diff, isDate } from './engine.js';

const MON = 'jan(?:uary|uar)?|feb(?:ruary|ruar)?|mar(?:ch)?|mär(?:z)?|maerz|mrz|apr(?:il)?|ma[iy]|jun[ei]?|jul[iy]?|aug(?:ust)?|sep(?:t(?:ember)?)?|o[ck]t(?:ober)?|nov(?:ember)?|de[cz](?:ember)?';
const MONTH_NO = { jan: 1, feb: 2, mar: 3, 'mär': 3, mrz: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const monthNo = (w) => { const k = w.toLowerCase().replace('maerz', 'mar').slice(0, 3); return MONTH_NO[k] || 0; };

// one pattern, four shapes; the groups tell which shape matched
const DATE_RE = new RegExp([
  '(\\d{4})-(\\d{1,2})-(\\d{1,2})(?!\\d)',                                   // 1-3  2026-06-24
  '(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})(?!\\d)',                    // 4-6  24.06.2026, 24/06/2026
  `(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s*(${MON})\\b\\.?(?:,?\\s*(\\d{4})(?!\\d))?`, // 7-9  24 Jun 2026, 24. Juni, 24 Jun
  `\\b(${MON})\\b\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s*(\\d{4})(?!\\d))?`, // 10-12 Jun 24, 2026
].join('|'), 'gi');
const HEADING_RE = new RegExp(`^\\s*(${MON})\\b\\.?\\s+(\\d{4})\\s*$`, 'i');   // "June 2026" on its own line: gives the year to the lines below
const YEAR_RE = /^\s*((?:19|20)\d{2})\s*$/;
// lines about other things than periods
const IGNORE_RE = /ovulat|fertil|eisprung|fruchtbar|pregnan|schwanger|miscarriage|fehlgeburt|generated|exported|created|printed|report date|erstellt|exportiert|birth|geburt|due date|termin/i;

const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && isDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// day/month or month/day: decided by the numbers when they allow it (a first number above 12 can only be a day)
function numericOrder(text) {
  let dmy = 0, mdy = 0, both = 0;
  for (const m of text.matchAll(new RegExp(DATE_RE.source, 'gi'))) {
    if (m[4] === undefined) continue;
    const a = +m[4], b = +m[5];
    if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++; else if (a <= 12 && b <= 12) both++;
  }
  if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
  if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: both > 0 };
}

// returns { rows: [{start, end}], order, ambiguous, skipped } ; rows are sorted, without duplicates, none in the future
export function findPeriods(text, opts = {}) {
  const today = opts.today || fromDays(Math.floor(Date.now() / 864e5));
  const found = numericOrder(text);
  const order = opts.order || found.order;
  const ambiguous = found.ambiguous;
  let year = null, skipped = 0; const raw = [];
  for (const line of String(text).split(/\r?\n/)) {
    const ym = line.match(YEAR_RE); if (ym) { year = +ym[1]; continue; }
    if (IGNORE_RE.test(line)) continue;
    const hm = line.match(HEADING_RE); if (hm) { year = +hm[2]; continue; }
    const ds = [];
    for (const m of line.matchAll(DATE_RE)) {
      let y = null, mo = 0, d = 0;
      if (m[1] !== undefined) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if (m[4] !== undefined) {
        const a = +m[4], b = +m[5]; y = m[6].length === 2 ? 2000 + +m[6] : +m[6];
        const asMdy = (a <= 12 && b > 12) || (order === 'mdy' && !(a > 12 && b <= 12));
        if (asMdy) { mo = a; d = b; } else { d = a; mo = b; }
      } else if (m[7] !== undefined) { d = +m[7]; mo = monthNo(m[8]); y = m[9] ? +m[9] : null; }
      else { mo = monthNo(m[10]); d = +m[11]; y = m[12] ? +m[12] : null; }
      if (!mo) continue;
      ds.push({ y, mo, d });
    }
    if (!ds.length) continue;
    // a date without a year takes the year of the other date in the line, else the last year seen above
    const withYear = ds.find((x) => x.y);
    const res = [];
    for (let i = 0; i < ds.length; i++) {
      const x = ds[i]; let y = x.y;
      if (!y) {
        if (withYear) { y = withYear.y; const later = ds.slice(i + 1).find((z) => z.y); if (later && iso(y, x.mo, 1) > iso(later.y, later.mo, 1)) y -= 1; }
        else y = year;
      }
      if (!y || !valid(y, x.mo, x.d)) { skipped++; continue; }
      res.push(iso(y, x.mo, x.d)); year = y;
    }
    // two dates close together are start and end of one period; anything else is a start
    for (let i = 0; i < res.length; i++) {
      if (i + 1 < res.length && diff(res[i + 1], res[i]) >= 0 && diff(res[i + 1], res[i]) <= 15) { raw.push({ start: res[i], end: res[i + 1] }); i++; }
      else raw.push({ start: res[i], end: '' });
    }
  }
  const byStart = new Map();
  for (const r of raw) {
    if (diff(r.start, today) > 0 || r.start < '2000-01-01') continue;
    const old = byStart.get(r.start);
    if (!old || (!old.end && r.end)) byStart.set(r.start, r);
  }
  const rows = [...byStart.values()].sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 200)
    .map((r) => (r.end && diff(r.end, today) > 0 ? { start: r.start, end: '' } : r));
  return { rows, order, ambiguous, skipped };
}

// text of a PDF, line by line. The reader is loaded only now, from this app's own files; nothing is sent anywhere.
async function readPages(pdfjs, buffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false });
  try {
    const doc = await task.promise;
    const out = [];
    for (let n = 1; n <= doc.numPages && n <= 60; n++) {
      const page = await doc.getPage(n); const tc = await page.getTextContent();
      const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }));
      items.sort((a, b) => b.y - a.y);
      const lines = [];
      for (const it of items) { const L = lines[lines.length - 1]; if (L && Math.abs(L.y - it.y) <= 3) L.items.push(it); else lines.push({ y: it.y, items: [it] }); }
      for (const L of lines) out.push(L.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
    }
    return out.join('\n');
  } finally { await task.destroy().catch(() => {}); }
}
// Safari's engine cannot loop over a stream with "for await" (PDF.js does); this adds that one missing piece
function streamLoopFix() {
  if (typeof ReadableStream === 'undefined' || ReadableStream.prototype[Symbol.asyncIterator]) return;
  const it = async function* () {
    const reader = this.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock(); }
  };
  ReadableStream.prototype[Symbol.asyncIterator] = it; ReadableStream.prototype.values = it;
}
export async function pdfToText(buffer) {
  streamLoopFix();
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  try { return await readPages(pdfjs, buffer); } catch (err) {
    // some browsers refuse the background worker: read on the main thread instead (a short pause, same result)
    console.error('PDF read with a worker failed, trying the main thread:', err && err.message);
    globalThis.pdfjsWorker = await import('./vendor/pdfjs/pdf.worker.min.mjs');
    return readPages(pdfjs, buffer);
  }
}
