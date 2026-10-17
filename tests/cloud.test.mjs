// v4 (G4-1): per-field merge of days, schema number, unknown keys kept. Mock data only.
import { merge, mergeDay, SCHEMA } from '../cloud.js';
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
console.log(`cloud: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
