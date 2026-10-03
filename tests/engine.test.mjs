// Run: node tests/engine.test.mjs   — a build must not ship with a failing test (NFR-06).
import { predict, cycles, addDays, diff, dayInfo, CONST } from '../engine.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};
const P = (...starts) => starts.map((s, i) => ({ id: `p${i}`, start: s }));

// 1. Spec 3.7 worked example: 3 Jul, 2 Aug, 30 Aug, 29 Sep 2026 → cycles 30, 28, 30
{
  const r = predict(P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'), {}, '2026-10-03');
  eq('3.7 cycle lengths', cycles(P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29')).map((c) => c.length), [30, 28, 30]);
  eq('3.7 mean cycle', r.cycleLen, 29);
  eq('3.7 spread s', r.spread, 1);
  eq('3.7 next period', r.nextStart, '2026-10-28');
  eq('3.7 next range', r.nextRange, ['2026-10-27', '2026-10-29']);
  eq('3.7 ovulation likely', r.ovulation.likely, '2026-10-15');
  eq('3.7 ovulation range', [r.ovulation.early, r.ovulation.late], ['2026-10-11', '2026-10-18']);
  eq('3.7 peak window', r.peak, ['2026-10-10', '2026-10-16']);
  eq('3.7 possible fertile days', r.possible, ['2026-10-06', '2026-10-19']);
  eq('3.7 confidence', r.confidence, 'Medium');
  eq('3.7 state on 3 Oct (no end logged; 4-day default passed)', [r.state.id, r.state.cycleDay], ['follicular', 5]);
}
// 2. Month-end and leap day: arithmetic across 31 Jan, 29 Feb 2028, 31 Mar
{
  eq('31 Jan + 29 days (leap year)', addDays('2028-01-31', 29), '2028-02-29');
  eq('29 Feb + 31 days', addDays('2028-02-29', 31), '2028-03-31');
  eq('diff across leap day', diff('2028-03-01', '2028-02-28'), 2);
  eq('diff across a non-leap Feb', diff('2027-03-01', '2027-02-28'), 1);
  const r = predict(P('2028-01-03', '2028-01-31', '2028-02-29', '2028-03-29'), {}, '2028-04-01');
  eq('leap-year cycles 28, 29, 29', cycles(P('2028-01-03', '2028-01-31', '2028-02-29', '2028-03-29')).map((c) => c.length), [28, 29, 29]);
  eq('leap-year next period (mean 28.67 → 29)', r.nextStart, '2028-04-27');
}
// 3. No history at all → onboarding value, else population default 29; spread ±4 (FIGO)
{
  const a = predict(P('2026-09-29'), { usualCycle: 32 }, '2026-10-03');
  eq('one period + usual 32 → 32 days', [a.cycleLen, a.spread, a.confidence], [32, 4, 'Low']);
  const b = predict(P('2026-09-29'), {}, '2026-10-03');
  eq('one period, unknown usual → default 29', [b.cycleLen, b.spread, b.usedDefault], [29, 4, true]);
  eq('period length default 4 days', b.periodLen, CONST.DEFAULT_PERIOD);
  const c = predict(P('2026-09-29'), { usualPeriod: 6 }, '2026-10-03');
  eq('usual period 6 used when nothing logged', c.periodLen, 6);
}
// 4. 1–2 cycles: her cycles + usual value; 3+: her cycles only
{
  const a = predict(P('2026-08-01', '2026-08-31'), { usualCycle: 28 }, '2026-09-05');
  eq('1 cycle (30) + usual 28 → mean 29, Low', [a.cycleLen, a.confidence], [29, 'Low']);
  const b = predict(P('2026-06-01', '2026-07-01', '2026-07-31', '2026-08-30'), { usualCycle: 40 }, '2026-09-05');
  eq('3 cycles ignore the usual value', b.cycleLen, 30);
}
// 5. Irregular history → wide range, irregular spread visible
{
  const r = predict(P('2026-01-01', '2026-01-25', '2026-03-01', '2026-03-28', '2026-05-03', '2026-05-29'), {}, '2026-06-01');
  eq('irregular lengths', cycles(P('2026-01-01', '2026-01-25', '2026-03-01', '2026-03-28', '2026-05-03', '2026-05-29')).map((c) => c.length), [24, 35, 27, 36, 26]);
  eq('irregular mean 29.6 → 30, spread 5.50 → 6', [r.cycleLen, r.spread], [30, 6]);
  eq('irregular next range ±6', r.nextRange, ['2026-06-22', '2026-07-04']);
}
// 6. Exclusion and validation (10–90 days)
{
  const ps = P('2026-01-01', '2026-01-29', '2026-04-15', '2026-05-13', '2026-06-10');
  const r = predict(ps, {}, '2026-06-12');
  eq('D1: 76 days > 2 × 28 → suspected missed period, left out → 28', [r.cycleLen, r.notes.some((n) => n.kind === 'missed')], [28, true]);
  ps[1].confirmedLong = true;
  eq('D1: once confirmed, the 76-day cycle is used → 40', predict(ps, {}, '2026-06-12').cycleLen, 40);
  ps[1].confirmedLong = false;
  ps[1].excluded = true;
  const r2 = predict(ps, {}, '2026-06-12');
  eq('excluding the 76-day cycle → 28', r2.cycleLen, 28);
  const r3 = predict(P('2026-01-01', '2026-05-01', '2026-05-29'), {}, '2026-06-01');
  eq('120-day cycle not used, note raised', [r3.usedCycles, r3.notes.some((n) => n.kind === 'check')], [1, true]);
}
// 7. Late period state and note
{
  const r = predict(P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'), {}, '2026-11-01');
  eq('late on 1 Nov (next 28 Oct ±1)', [r.state.id, r.state.daysLate], ['late', 4]);
  eq('late note present', r.notes.some((n) => n.kind === 'late'), true);
  const r2 = predict(P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'), {}, '2026-10-29');
  eq('not late inside the range (29 Oct)', r2.state.id !== 'late', true);
}
// 8. States through the 3.7 cycle (period logged 29 Sep–2 Oct)
{
  const ps = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'); ps[3].end = '2026-10-02';
  const at = (d) => predict(ps, {}, d).state.id;
  eq('3 Oct follicular (period ended 2 Oct)', at('2026-10-03'), 'follicular');
  eq('6 Oct fertile (possible)', at('2026-10-06'), 'fertile');
  eq('15 Oct fertile peak', predict(ps, {}, '2026-10-15').state.peak, true);
  eq('20 Oct luteal', at('2026-10-20'), 'luteal');
}
// 9. FIGO range notes: one cycle outside 24–38 → info; two in a row → doctor
{
  const one = predict(P('2026-01-01', '2026-01-29', '2026-02-26', '2026-04-10'), {}, '2026-04-12');
  eq('one 43-day cycle → info note', one.notes.map((n) => n.kind).filter((k) => k !== 'late'), ['info']);
  const two = predict(P('2026-01-01', '2026-01-29', '2026-03-12', '2026-04-25'), {}, '2026-04-27');
  eq('42 and 44 days → doctor note', two.notes.some((n) => n.kind === 'doctor'), true);
}
// 10. Short cycle: fertile window never reaches back before the cycle start
{
  const r = predict(P('2026-01-01', '2026-01-22', '2026-02-12', '2026-03-05'), {}, '2026-03-06');
  eq('21-day cycles: possible window starts at cycle start or later', diff(r.possible[0], r.lastStart) >= 0, true);
}
// 11. Calendar: logged period wins over predictions; 3 cycles ahead are predicted
{
  const ps = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'); ps[3].end = '2026-10-02';
  const r = predict(ps, {}, '2026-10-03');
  eq('30 Sep shows logged period', dayInfo('2026-09-30', r, ps, {}).logged, true);
  eq('28 Oct shows predicted period', dayInfo('2026-10-28', r, ps, {}).predictedPeriod, true);
  eq('15 Oct shows ovulation estimate', dayInfo('2026-10-15', r, ps, {}).ovulation, true);
  eq('third cycle ahead predicted (28 Oct + 58 = 25 Dec)', dayInfo('2026-12-25', r, ps, {}).predictedPeriod, true);
}
// 12. Deleted entries are ignored (edit/delete recalculates)
{
  const ps = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29'); ps[3].deleted = true;
  eq('deleting the last period moves the prediction back', predict(ps, {}, '2026-09-30').lastStart, '2026-08-30');
}

// 13. Late period: no forecasts for the next, not-yet-started cycle
{
  const ps = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29');
  const r = predict(ps, {}, '2026-11-01');
  eq('late: 4 Nov not shown as fertile', dayInfo('2026-11-04', r, ps, {}).fertile || null, null);
  eq('late: 26 Nov not shown as predicted period', dayInfo('2026-11-26', r, ps, {}).predictedPeriod || null, null);
}

// 14. Open period that runs longer than usual: still "Period" while bleeding is logged
{
  const ps = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29');
  const days = { '2026-10-03': { flow: 'medium' }, '2026-10-04': { flow: 'light' } };
  eq('day 6 with bleeding logged → period, not follicular', predict(ps, {}, '2026-10-04', days).state.id, 'menstruation');
  eq('calendar shows 4 Oct as period', dayInfo('2026-10-04', predict(ps, {}, '2026-10-04', days), ps, days).logged, true);
  eq('bleeding 7 days after the period with nothing logged between → not the same period', predict(ps, {}, '2026-10-10', { '2026-10-10': { flow: 'light' } }).state.id === 'menstruation', false);
  eq('explicit "none" ends it', predict(ps, {}, '2026-10-05', { ...days, '2026-10-05': { flow: 'none' } }).state.id, 'follicular');
}

// 15. D1 boundaries
{
  const r = predict(P('2026-01-01', '2026-01-29', '2026-02-26', '2026-04-23'), {}, '2026-04-25');
  eq('D1: 56 days = exactly 2 × 28 → not suspected', r.notes.some((n) => n.kind === 'missed'), false);
  const r2 = predict(P('2026-01-01', '2026-01-29', '2026-03-27'), {}, '2026-03-29');
  eq('D1: needs at least 2 other cycles', r2.notes.some((n) => n.kind === 'missed'), false);
  const r3 = predict(P('2026-01-01', '2026-03-01', '2026-03-29', '2026-04-26'), {}, '2026-04-28');
  eq('D1: an old long cycle (59 vs 28, 28) is suspected too', [r3.notes.filter((n) => n.kind === 'missed').length, r3.cycleLen], [1, 28]);
}

// 16. B2: with Low confidence, later cycles show the predicted period but no fertile band
{
  const ps = P('2026-09-23');
  const r = predict(ps, { usualCycle: 30 }, '2026-10-03');
  eq('Low: next predicted period shown (23 Oct)', dayInfo('2026-10-23', r, ps, {}).predictedPeriod, true);
  eq('Low: next cycle fertile days hidden (30 Oct)', dayInfo('2026-10-30', r, ps, {}).fertile || null, null);
  eq('Low: current cycle fertile days still shown (8 Oct)', !!dayInfo('2026-10-08', r, ps, {}).fertile, true);
  const ps3 = P('2026-07-03', '2026-08-02', '2026-08-30', '2026-09-29');
  eq('Medium: next cycle fertile days shown (12 Nov)', !!dayInfo('2026-11-12', predict(ps3, {}, '2026-10-03'), ps3, {}).fertile, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
