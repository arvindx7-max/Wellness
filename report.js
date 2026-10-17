// v4 (R4): the PDF report, made on this device. A small PDF writer (A4, Helvetica, text, lines, boxes), no library,
// nothing uploaded. The caller passes already-decrypted data; this file stores nothing.
import { livePeriods, periodLength, cycles, diff, addDays } from './engine.js';

// ---------- a minimal PDF writer ----------
const W = 595, H = 842, M = 48;
const MAP = { '–': 0x96, '—': 0x97, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '…': 0x85, '•': 0x95, '€': 0x80 };
const enc = (t) => [...String(t)].map((c) => { const n = MAP[c] ?? c.charCodeAt(0); return String.fromCharCode(n < 256 ? n : 63); }).join('');
const esc = (t) => enc(t).replace(/[\\()]/g, (c) => `\\${c}`);
// average Helvetica glyph widths (per 1000 em), enough to wrap and right-align text
const wid = (t, size, bold) => [...String(t)].reduce((a, c) => a + (/[il.,:;'|!]/.test(c) ? 280 : /[mwMW]/.test(c) ? 830 : /[A-Z0-9]/.test(c) ? 640 : c === ' ' ? 278 : 540) * (bold ? 1.05 : 1), 0) * size / 1000;

class Doc {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = H - M; }
  text(x, y, t, size = 10, bold = false, gray = 0) { this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(t)}) Tj ET`); }
  line(x1, y1, x2, y2, w = 0.5, gray = 0.75) { this.ops.push(`${gray} G ${w} w ${x1} ${y1} m ${x2} ${y2} l S`); }
  box(x, y, w, h, gray = 0.95) { this.ops.push(`${gray} g ${x} ${y} ${w} ${h} re f 0 g`); }
  need(h) { if (this.y - h < M + 30) { this.newPage(); } }
  wrap(t, size, maxW) {
    const words = String(t).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const n = cur ? `${cur} ${w}` : w; if (wid(n, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = n; }
    if (cur) lines.push(cur); return lines;
  }
  para(t, size = 10, gray = 0) { for (const l of this.wrap(t, size, W - 2 * M)) { this.need(size + 4); this.text(M, this.y, l, size, false, gray); this.y -= size + 4; } }
  heading(t) { this.need(40); this.y -= 10; this.text(M, this.y, t, 13, true); this.y -= 18; }
  table(cols, rows) { // cols: [[title, x]]
    this.need(30);
    cols.forEach(([t, x]) => this.text(M + x, this.y, t, 9, true, 0.25)); this.y -= 6; this.line(M, this.y, W - M, this.y, 0.8, 0.6); this.y -= 13;
    // G5-4: each cell is shortened to fit its column
    const fit = (v, i) => { const max = (i + 1 < cols.length ? cols[i + 1][1] : W - 2 * M) - cols[i][1] - 6; let t = String(v); if (wid(t, 9.5) <= max) return t; while (t.length > 1 && wid(t + '...', 9.5) > max) t = t.slice(0, -1); return t.trimEnd() + '...'; };
    for (const r of rows) { this.need(16); r.forEach((v, i) => this.text(M + cols[i][1], this.y, fit(v, i), 9.5)); this.y -= 5; this.line(M, this.y, W - M, this.y, 0.3, 0.85); this.y -= 11; }
  }
  bytes() {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    const kids = [];
    this.pages.forEach((ops, i) => {
      const footer = `BT /F1 8 Tf 0.45 g ${M} 28 Td (${esc(`Page ${i + 1} of ${this.pages.length}`)}) Tj ET`;
      const stream = [...ops, footer].join('\n');
      objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${objs.length} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      kids.push(`${objs.length} 0 R`);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255; return b;
  }
}

// ---------- the report ----------
// opts: { from, to, today, sections: {periods, flow, symptoms, moods, tests, sex, notes}, fmt(date, withYear), pred, label(code), moods: [codes] }
export function buildReport(data, opts) {
  const { from, to, today, sections: on, fmt, pred } = opts;
  const inRange = (d) => diff(d, from) >= 0 && diff(to, d) >= 0;
  const d = new Doc();
  d.text(M, d.y, 'Cycle report', 22, true); d.y -= 18;
  d.text(M, d.y, `${fmt(from, true)} – ${fmt(to, true)} · made on ${fmt(today, true)}`, 10, false, 0.35); d.y -= 14;
  d.line(M, d.y, W - M, d.y, 1.5, 0.3); d.y -= 26;
  if (pred && !pred.empty) {
    const boxes = [['Average cycle', `${pred.cycleLen} days`, `spread ±${pred.spread} days`], ['Average period', `${pred.periodLen} days`, 'bleeding days logged'],
      pred.paused ? ['Predictions', 'Paused', 'cycle marked as pregnancy'] : ['Next period (estimate)', fmt(pred.nextStart), `${fmt(pred.nextRange[0])} – ${fmt(pred.nextRange[1])}`]];
    const bw = (W - 2 * M - 24) / 3;
    boxes.forEach(([a, b, c], i) => { const x = M + i * (bw + 12); d.box(x, d.y - 46, bw, 60); d.text(x + 10, d.y, a, 8.5, false, 0.3); d.text(x + 10, d.y - 20, b, 15, true); d.text(x + 10, d.y - 36, c, 8.5, false, 0.3); });
    d.y -= 76;
  }
  const ps = livePeriods(data.periods).filter((p) => inRange(p.start)).reverse();
  const cyc = Object.fromEntries(cycles(data.periods).map((c) => [c.start, c]));
  const order = ['none', 'spotting', 'light', 'medium', 'heavy'];
  const heaviest = (p) => { let best = 'none'; const end = p.end || addDays(p.start, 6); for (let x = p.start; diff(end, x) >= 0; x = addDays(x, 1)) { const f = (data.days[x] || {}).flow; if (f && order.indexOf(f) > order.indexOf(best)) best = f; } return best === 'none' ? '–' : best[0].toUpperCase() + best.slice(1); };
  const left = [];
  if (on.periods) {
    d.heading('Periods and cycle lengths');
    const cols = [['Start', 0], ['End', 110], ['Period', 220], ['Cycle', 300], ...(on.flow ? [['Heaviest bleeding', 380]] : [])];
    d.table(cols, ps.map((p) => { const c = cyc[p.start]; const l = periodLength(p); const r = [fmt(p.start, true), p.end ? fmt(p.end, true) : '–', l ? `${l} days` : '–', c ? `${c.length} days` : 'current']; if (on.flow) r.push(heaviest(p)); if (p.excluded) r[3] += p.excludeReason === 'Pregnancy' ? ' (pregnancy)' : ' (left out)'; return r; }));
    if (!ps.length) d.para('No periods in this time.', 10, 0.35);
  } else left.push('periods');
  if (!on.flow) left.push('bleeding');
  const days = Object.keys(data.checkins || {}).filter(inRange).sort();
  const count = (codes) => { const m = {}; for (const day of days) for (const [c, v] of Object.entries(data.checkins[day].symptoms || {})) if (v && codes(c)) (m[c] ||= []).push(day); return m; };
  const cycleDay = (day) => { const st = livePeriods(data.periods).filter((p) => diff(day, p.start) >= 0).pop(); return st ? diff(day, st.start) + 1 : null; };
  const countTable = (m, title) => {
    d.heading(title);
    const rows = Object.entries(m).sort((a, b) => b[1].length - a[1].length).map(([c, list]) => { const cds = list.map(cycleDay).filter(Boolean).sort((a, b) => a - b); return [opts.label(c), String(list.length), cds.length ? `${cds[0]}–${cds[cds.length - 1]}` : '–']; });
    if (rows.length) d.table([['Logged', 0], ['Days', 220], ['Cycle days', 300]], rows); else d.para('Nothing logged in this time.', 10, 0.35);
  };
  const moodCodes = new Set(opts.moods || []);
  if (on.symptoms) countTable(count((c) => !moodCodes.has(c)), 'Symptoms'); else left.push('symptoms');
  if (on.moods) countTable(count((c) => moodCodes.has(c)), 'Moods'); else left.push('moods');
  if (on.tests) {
    d.heading('Ovulation tests');
    const rows = Object.keys(data.days).filter(inRange).sort().flatMap((day) => (data.days[day].ovu || []).map((t) => [fmt(day, true), t.at || '', t.r === 'pos' ? 'Positive' : t.r === 'peak' ? 'Peak' : 'Negative']));
    if (rows.length) d.table([['Day', 0], ['Time', 120], ['Result', 200]], rows); else d.para('No tests logged in this time.', 10, 0.35);
  } else left.push('ovulation tests');
  if (on.sex) {
    d.heading('Sex life');
    const k = { protected: 0, unprotected: 0 };
    for (const day of Object.keys(data.days).filter(inRange)) { const x = data.days[day].sex; if (x && k[x.kind] !== undefined) k[x.kind]++; }
    d.para(`Days logged: ${k.protected} protected, ${k.unprotected} unprotected.`);
  } else left.push('sex life');
  if (on.notes) {
    d.heading('Notes');
    const notes = days.filter((day) => data.checkins[day].note);
    if (notes.length) for (const day of notes) d.para(`${fmt(day, true)}: ${data.checkins[day].note}`); else d.para('No notes in this time.', 10, 0.35);
  } else left.push('notes');
  d.y -= 10; d.need(40); d.line(M, d.y, W - M, d.y, 0.5, 0.7); d.y -= 14;
  d.para(`Made by Cycle on this device from the owner's own logs. Predictions are estimates, not a diagnosis.${left.length ? ` Left out by choice: ${left.join(', ')}.` : ''}`, 8.5, 0.35);
  return d.bytes();
}

// iPhone: the share sheet with the file (Save to Files, AirDrop, Mail, Print); elsewhere a normal download
export async function shareOrDownload(bytes, name) {
  const file = new File([bytes], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}
