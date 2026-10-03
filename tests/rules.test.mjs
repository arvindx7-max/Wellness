// Run: node tests/rules.test.mjs — every red-flag rule must fire on test data (v2 gate).
import { predict } from '../engine.js';
import { evaluate, recsFor, heavyDays } from '../rules.js';
import { NO_REC } from '../content.js';
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `\n      got  ${JSON.stringify(g)}\n      want ${JSON.stringify(w)}`}`); };
const base = () => ({ periods: [{ id: 'a', start: '2026-08-30', end: '2026-09-03' }, { id: 'b', start: '2026-09-29' }], days: {}, checkins: {}, settings: {} });
const run = (data, today) => evaluate(data, predict(data.periods, data.settings, today), today);
const ids = (fl) => fl.map((f) => f.id.split('@')[0]);

{ const d = base(); eq('no data → no flags', ids(run(d, '2026-10-01')), []); }
{ const d = base(); d.checkins['2026-09-30'] = { change: 'h1x2' }; eq('R1 soaking every hour >2h → urgent', run(d, '2026-10-01').map((f) => [f.id.split('@')[0], f.level]), [['soak', 'urgent']]); }
{ const d = base(); d.checkins['2026-09-30'] = { change: 'lt2' }; eq('R5 change <2h → doctor', ids(run(d, '2026-10-01')), ['change2h']); }
{ const d = base(); d.days['2026-09-30'] = { flow: 'heavy' }; d.checkins['2026-09-30'] = { dizzy: true }; eq('R2 heavy + dizzy → urgent', ids(run(d, '2026-10-01')), ['heavydizzy']); }
{ const d = base(); d.days['2026-09-30'] = { flow: 'light' }; d.checkins['2026-09-30'] = { dizzy: true }; eq('R2 not on light flow', ids(run(d, '2026-10-01')), []); }
{ const d = base(); d.periods[1].end = '2026-10-06'; eq('R3 logged 8-day period → doctor', ids(run(d, '2026-10-07')), ['long']); }
{ const d = base(); d.periods[1].end = '2026-10-05'; eq('R3 7-day period → no flag', ids(run(d, '2026-10-07')), []); }
{ const d = base(); d.days['2026-10-06'] = { flow: 'medium' }; eq('R3 open period, bleeding on day 8 → doctor', ids(run(d, '2026-10-06')), ['long']); }
{ const d = base(); for (const x of ['2026-10-04', '2026-10-05', '2026-10-06']) d.days[x] = { flow: 'light' }; d.days['2026-10-12'] = { flow: 'spotting' }; eq('open period continuing, no "None" logged → long only', ids(run(d, '2026-10-12')), ['long']); }
{ const d = base(); d.days['2026-10-04'] = { flow: 'none' }; d.days['2026-10-06'] = { flow: 'spotting' }; eq('open period, "None" logged, then spotting → between only', ids(run(d, '2026-10-06')), ['between']); }
{ const d = base(); d.checkins['2026-09-30'] = { clots: true }; eq('R4 clots ≥2.5 cm → doctor', ids(run(d, '2026-10-01')), ['clots']); }
{ const d = base(); d.periods[1].end = '2026-10-02'; d.days['2026-10-12'] = { flow: 'spotting' }; eq('R6 spotting between periods → doctor', ids(run(d, '2026-10-13')), ['between']); }
{ const d = base(); d.periods[1].end = '2026-10-02'; d.days['2026-10-01'] = { flow: 'heavy' }; eq('R6 not for bleeding inside the period', ids(run(d, '2026-10-13')), []); }
{ const d = base(); d.checkins['2026-08-31'] = { symptoms: { cramps: 3 } }; d.checkins['2026-09-30'] = { symptoms: { cramps: 3 } }; eq('R7 severe cramps 2 cycles in a row → doctor', ids(run(d, '2026-10-01')), ['cramps2']); }
{ const d = base(); d.checkins['2026-09-30'] = { symptoms: { cramps: 3 } }; eq('R7 one cycle only → no flag', ids(run(d, '2026-10-01')), []); }
{ const d = base(); for (const x of ['2026-09-25', '2026-09-28', '2026-10-01']) d.checkins[x] = { symptoms: { low: 3 } }; const f = run(d, '2026-10-01'); eq('R9 severe low mood 3 days in 14 → support with helpline', [ids(f), f[0].text.includes('0800 111 0 111')], [['lowmood'], true]); }
{ const d = base(); for (const x of ['2026-09-10', '2026-09-28', '2026-10-01']) d.checkins[x] = { symptoms: { low: 3 } }; eq('R9 only 2 in the last 14 days → no flag', ids(run(d, '2026-10-01')), []); }
{ const d = { periods: [{ id: 'a', start: '2026-01-01' }, { id: 'b', start: '2026-01-29' }, { id: 'c', start: '2026-03-12' }, { id: 'e', start: '2026-04-25' }], days: {}, checkins: {}, settings: {} };
  eq('R8 two cycles outside 24–38 → doctor', ids(run(d, '2026-04-27')), ['doctor-range']); }
{ const d = base(); d.checkins['2026-09-30'] = { change: 'h1x2', clots: true }; eq('urgent sorted first', ids(run(d, '2026-10-01')), ['soak', 'clots']); }
// recommendations
{ const r = recsFor({ symptoms: { cramps: 2 } }, 'menstruation'); eq('cramps → ACOG suggestion with escalation', [r.length, r[0].src, !!r[0].escalate], [1, 'acogPain', true]); }
{ const r = recsFor({ symptoms: { irritable: 2, low: 1 } }, 'luteal'); eq('two mood symptoms share one suggestion', [r.length, r[0].title], [1, 'Irritable, Low mood']); }
{ const r = recsFor({ symptoms: { acne: 1, nausea: 2 } }, 'luteal'); eq('no table entry → fixed "no suggestion" text', [r.length, r[0].text === NO_REC, r[0].title], [1, true, 'Acne, Nausea']); }
{ const r = recsFor({ symptoms: { fatigue: 2 } }, 'luteal'); eq('tiredness outside the period → no iron suggestion', r[0].text === NO_REC, true); }
{ const r = recsFor({ symptoms: { fatigue: 2 } }, 'menstruation'); eq('tiredness during the period → iron suggestion', r[0].src, 'mayoHmb'); }
{ const d = base(); d.days['2026-09-29'] = { flow: 'heavy' }; d.days['2026-09-30'] = { flow: 'heavy' }; eq('heavy days counted in current period', heavyDays(d, predict(d.periods, {}, '2026-10-01')), 2); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
