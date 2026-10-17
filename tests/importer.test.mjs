// Unit test for the date finder (v3.1, B7). Uses only invented dates from the mock data ledger in CLAUDE.md.
import { findPeriods } from '../importer.js';
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : (fail++, console.log(`FAIL  ${name} ${info}`)); };
const T = '2026-10-03';
const f = (text, o = {}) => findPeriods(text, { today: T, ...o });
const starts = (r) => r.rows.map((x) => x.start).join(',');
const pairs = (r) => r.rows.map((x) => `${x.start}>${x.end}`).join(',');

ok('ISO dates, one per line', starts(f('2026-06-24\n2026-07-25\n2026-08-24')) === '2026-06-24,2026-07-25,2026-08-24');
ok('ISO range on one line', pairs(f('2026-06-24 to 2026-06-28')) === '2026-06-24>2026-06-28');
ok('CSV with header and two columns', pairs(f('start,end\n2026-06-24,2026-06-28\n2026-07-25,2026-07-29')) === '2026-06-24>2026-06-28,2026-07-25>2026-07-29');
ok('day.month.year', pairs(f('24.06.2026 - 28.06.2026')) === '2026-06-24>2026-06-28');
ok('day first when a day is above 12', f('24/06/2026').order === 'dmy' && !f('24/06/2026').ambiguous);
ok('month first when the second number is above 12', starts(f('06/24/2026')) === '2026-06-24' && f('06/24/2026').order === 'mdy');
const amb = f('05/06/2026');
ok('both numbers up to 12 is flagged and read day first', amb.ambiguous && starts(amb) === '2026-06-05');
ok('the user can choose month first', starts(f('05/06/2026', { order: 'mdy' })) === '2026-05-06');
ok('day, month name, year', pairs(f('24 Jun 2026 – 28 Jun 2026')) === '2026-06-24>2026-06-28');
ok('month name first', pairs(f('Jun 24, 2026 - Jun 28, 2026')) === '2026-06-24>2026-06-28');
ok('German month names', pairs(f('24. Juni 2026 bis 28. Juni 2026')) === '2026-06-24>2026-06-28' && starts(f('3. Okt. 2025\n5. März 2026')) === '2025-10-03,2026-03-05');
ok('year only on the last date of a range', pairs(f('24 Jun - 28 Jun 2026')) === '2026-06-24>2026-06-28');
ok('a range across New Year', pairs(f('28 Dec - 02 Jan 2026')) === '2025-12-28>2026-01-02');
ok('year taken from a heading above', starts(f('2026\n24 Jun\n25 Jul')) === '2026-06-24,2026-07-25');
ok('month and year heading gives the year', starts(f('June 2026\n24 Jun')) === '2026-06-24');
ok('a date without any year is skipped and counted', f('24 Jun').rows.length === 0 && f('24 Jun').skipped === 1);
ok('May 2026 is not read as May 20', f('May 2026').rows.length === 0);
ok('future dates are dropped', starts(f('2026-10-04\n2026-09-23')) === '2026-09-23');
ok('duplicates are merged, the one with an end wins', pairs(f('2026-06-24\n2026-06-24 to 2026-06-28')) === '2026-06-24>2026-06-28');
ok('two dates far apart are two starts', starts(f('2026-06-24 2026-07-25')) === '2026-06-24,2026-07-25');
ok('rows are sorted', starts(f('2026-08-24\n2026-06-24')) === '2026-06-24,2026-08-24');
ok('ovulation and export lines are ignored', starts(f('Ovulation 2026-07-08\nExported 2026-10-01\n2026-06-24')) === '2026-06-24');
ok('impossible dates are skipped', f('2026-02-30\n31.04.2026').rows.length === 0);
ok('text without dates', f('hello').rows.length === 0 && f('').rows.length === 0);
ok('two-digit year', starts(f('24.06.26')) === '2026-06-24');
ok('mixed day-first and month-first dates are each read the only way they can be', (() => { const r = f('25.06.2026\n07.24.2026'); return starts(r) === '2026-06-25,2026-07-24' && r.skipped === 0 && !r.ambiguous; })());
ok('the chosen order does not break a date that has only one reading', starts(f('25.06.2026\n05/06/2026', { order: 'mdy' })) === '2026-05-06,2026-06-25');
ok('pregnancy and miscarriage lines are ignored (English and German)', starts(f('Pregnancy test 2026-07-08\nSchwangerschaft 2026-07-09\nMiscarriage 2026-07-10\nFehlgeburt 2026-07-11\n2026-06-24')) === '2026-06-24');
ok('at most 200 rows', f(Array.from({ length: 300 }, (_, i) => `20${String(i % 25).padStart(2, '0')}-01-${String(1 + (i % 28)).padStart(2, '0')}\n2001-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`).join('\n')).rows.length <= 200);
// ---- v3.2 (B9): history table of a tracker report (invented rows in the same layout: START - END OF CYCLE, PERIOD LENGTH, CYCLE LENGTH)
const REPORT = ['Name: Alice Placeholder Age:Cycle Summary 07/01,2025 - 03/10 (6 cycles)', 'LAST PERIOD 23/09', 'AVG CYCLE LENGTH 30 days', 'Cycle History 07/01,2025 - 03/10',
  'START - END DATE PERIOD CYCLE(DAY)',
  '23/09 - Today 5 Days', '24/08 - 22/09 5 Days 30 Days', '25/07 - 23/08 4 Days 30 Days', '25/05 - 24/07 Pregnant 61 Days',
  '12/05,2025 - 24/05 6 Days 29 Days', '13/04,2025 - 11/05,2025 4 Days 30 Days',
  'Period Tracker Page 1/9', 'Cycle Details', '23/09 - Today (30 Days)', '23/09 30/09 07/10 14/10', '1 2 3 4 5 6 7 8 9 10',
  '24/08 - 22/09 (30 Days) Next 31-32 Days >>', '24/08 31/08 07/09 14/09'].join('\n');
const rep = f(REPORT);
ok('report: only the table rows become periods, in order', starts(rep) === '2025-04-13,2025-05-12,2026-05-25,2026-07-25,2026-08-24,2026-09-23', starts(rep));
ok('report: a row without a year takes the report year, with a year keeps it', rep.rows[0].start === '2025-04-13' && rep.rows[2].start === '2026-05-25');
ok('report: the end is the start plus the period length minus one (not the end of the cycle)', pairs(rep).includes('2026-08-24>2026-08-28') && pairs(rep).includes('2025-04-13>2025-04-16') && pairs(rep).includes('2025-05-12>2025-05-17'), pairs(rep));
ok('report: a "Pregnant" row is kept without an end and flagged', rep.rows[2].end === '' && rep.rows[2].preg === true);
ok('report: an open row ("Today") ends no later than today', rep.rows[5].start === '2026-09-23' && rep.rows[5].end === '2026-09-27', JSON.stringify(rep.rows[5]));
ok('report: summary lines, chart labels and detail headers add nothing', rep.rows.length === 6 && rep.mode === 'history');
ok('report: needs at least two table rows, otherwise the normal finder runs', f('24/06 - 28/06 5 Days 30 Days').mode !== 'history');
console.log(`importer: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
