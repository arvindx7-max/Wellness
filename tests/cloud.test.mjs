// v4 (G4-1): per-field merge of days, schema number, unknown keys kept. Mock data only.
import { merge, mergeDay, mergeSettings, dedupePeriods, SCHEMA } from '../cloud.js';
let pass = 0, fail = 0;
const ok = (n, c, info = '') => { c ? pass++ : (fail++, console.log(`FAIL  ${n} ${info}`)); };
const D = '2026-10-03';
const phone = { periods: [], days: { [D]: { flow: 'light', flowAt: 10, updatedAt: 10 } }, settings: { updatedAt: 1 } };
const laptop = { periods: [], days: { [D]: { ovu: [{ r: 'pos', at: '08:30' }], ovuAt: 20, updatedAt: 20 } }, settings: { updatedAt: 1 } };
const m1 = merge(phone, laptop), m2 = merge(laptop, phone);
ok('bleeding on one device and a test on the other both survive', m1.days[D].flow === 'light' && m1.days[D].ovu.length === 1, JSON.stringify(m1.days[D]));
ok('the merge is the same in both directions', JSON.stringify(m1.days[D]) === JSON.stringify(m2.days[D]));
const old = { flow: 'heavy', updatedAt: 30 }; // a record written by v3.2 (no field times)
const m3 = mergeDay({ flow: 'light', flowAt: 10, sex: { kind: 'protected' }, sexAt: 15, updatedAt: 15 }, old);
ok('a newer v3.2 record updates bleeding but keeps the sex entry', m3.flow === 'heavy' && m3.sex.kind === 'protected', JSON.stringify(m3));
const m4 = mergeDay({ ovu: [{ r: 'pos' }], ovuAt: 10, updatedAt: 10 }, { ovu: [], ovuAt: 40, updatedAt: 40 });
ok('a removed test (empty list) wins when it is newer', Array.isArray(m4.ovu) && m4.ovu.length === 0);
const m5 = merge({ ...phone, futureThing: { a: 1 } }, { ...laptop, schema: 7, laterKey: [1] });
ok('unknown top-level keys are kept from both sides', m5.futureThing && m5.laterKey);
ok('the schema number is the highest seen', m5.schema === 7 && merge(phone, laptop).schema === SCHEMA);
// I5-1: settings part by part
const sA = { usualCycle: 30, look: { theme: 'tide', updatedAt: 50 }, hide: { sex: true, updatedAt: 10 }, updatedAt: 50 };
const sB = { usualCycle: 30, look: { theme: 'petal', updatedAt: 20 }, hide: { sex: false, updatedAt: 40 }, updatedAt: 40 };
const ms = mergeSettings(sA, sB), ms2 = mergeSettings(sB, sA);
ok('a theme change on one device and a hide change on the other both survive', ms.look.theme === 'tide' && ms.hide.sex === false, JSON.stringify(ms));
ok('settings merge is the same in both directions', JSON.stringify(ms) === JSON.stringify(ms2));
ok('settings from v3.2 without part times still merge', mergeSettings({ usualCycle: 28, updatedAt: 5 }, { usualCycle: 30, look: { theme: 'tide' }, updatedAt: 9 }).usualCycle === 30);
// v5 (B20): the same history saved twice under different ids becomes one record per start day. Mock dates only.
const dupA = [{ id: 'pA1', start: '2026-06-24', end: '2026-06-28', updatedAt: 10 }, { id: 'pA2', start: '2026-07-25', end: '2026-07-29', updatedAt: 10 }];
const dupB = [{ id: 'pB1', start: '2026-06-24', updatedAt: 20 }, { id: 'pB2', start: '2026-07-25', end: '2026-07-30', updatedAt: 20 }, { id: 'pB3', start: '2026-08-24', updatedAt: 20 }];
const mA = merge({ periods: dupA, settings: {} }, { periods: dupB, settings: {} }), mB = merge({ periods: dupB, settings: {} }, { periods: dupA, settings: {} });
const liveOf = (m) => m.periods.filter((p) => !p.deleted);
ok('the same history on two devices merges to one period per start day', liveOf(mA).length === 3 && new Set(liveOf(mA).map((p) => p.start)).size === 3, JSON.stringify(liveOf(mA)));
ok('the merge keeps the later end day and is the same in both directions', liveOf(mA).find((p) => p.start === '2026-07-25').end === '2026-07-30' && JSON.stringify(liveOf(mA).map((p) => [p.id, p.start, p.end]).sort()) === JSON.stringify(liveOf(mB).map((p) => [p.id, p.start, p.end]).sort()));
ok('the copies are kept as deleted records so the repair syncs', mA.periods.filter((p) => p.deleted).length === 2);
ok('repairing again changes nothing', JSON.stringify(dedupePeriods(mA.periods)) === JSON.stringify(mA.periods));
const again = merge(mA, { periods: dupB, settings: {} });
ok('an older device that still has the copies cannot bring them back', liveOf(again).length === 3);
const ex = dedupePeriods([{ id: 'a', start: '2026-06-24', updatedAt: 1 }, { id: 'b', start: '2026-06-24', excluded: true, excludeReason: 'Pregnancy', updatedAt: 2 }]).find((p) => !p.deleted);
ok('an exclusion on either copy is kept', ex.excluded === true && ex.excludeReason === 'Pregnancy');
ok('periods without copies are returned untouched', (() => { const x = [{ id: 'a', start: '2026-06-24', updatedAt: 1 }]; return dedupePeriods(x) === x; })());
const two = dedupePeriods([{ id: 'a', start: '2026-06-24', excluded: true, excludeReason: 'dummy_reason_old', updatedAt: 1 }, { id: 'b', start: '2026-06-24', excluded: true, excludeReason: 'dummy_reason_new', updatedAt: 5 }]).find((p) => !p.deleted);
ok('when both copies are excluded, the newest reason is kept', two.excludeReason === 'dummy_reason_new');
console.log(`cloud: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
