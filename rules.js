// Red-flag rules (spec 6.3) and recommendation lookup (spec 6.2). Pure functions, unit-tested.
import { addDays, diff, livePeriods, isDate, periodEnd } from './engine.js';
import { RECS, NO_REC, label } from './content.js';

const BLEED = ['spotting', 'light', 'medium', 'heavy'];
const sev = (ci, code) => (ci && ci.symptoms && ci.symptoms[code]) || 0;

// The logged period that a date belongs to (start..end, or start..start+periodLen-1 while open).
const periodRange = (p, periodLen, days = {}) => [p.start, periodEnd(p, periodLen, days)];
const inRange = (d, [a, b]) => diff(d, a) >= 0 && diff(b, d) >= 0;

export function evaluate(data, pred, today) {
  const flags = []; const days = data.days || {}; const ci = data.checkins || {};
  const ps = livePeriods(data.periods);
  if (!ps.length || !pred || pred.empty) return flags;
  const last = ps[ps.length - 1]; const prev = ps[ps.length - 2];
  const cycleId = last.start;
  const curDates = []; for (let d = last.start; diff(today, d) >= 0; d = addDays(d, 1)) curDates.push(d);
  const lastRange = periodRange(last, pred.periodLen, days);
  const add = (id, level, title, text, src, extra = {}) => flags.push({ id: `${id}@${cycleId}`, level, title, text, src, ...extra });

  // R1 / R5: pad or tampon changes (Mayo Clinic; CDC)
  const changes = curDates.map((d) => ci[d] && ci[d].change).filter(Boolean);
  if (changes.includes('h1x2')) add('soak', 'urgent', 'Seek medical care today',
    'You logged soaking through a pad or tampon every hour or more often, for more than 2 hours in a row.', 'mayoHmb');
  else if (changes.includes('lt2')) add('change2h', 'doctor', 'See a doctor about heavy bleeding',
    'You logged needing to change a pad or tampon more often than every 2 hours.', 'cdcHmb');

  // R2: heavy bleeding plus dizziness, fainting or racing heart (Mayo Clinic)
  const heavyDizzy = curDates.some((d) => ci[d] && ci[d].dizzy && ((days[d] && days[d].flow === 'heavy') || ['h1x2', 'lt2'].includes(ci[d].change)));
  if (heavyDizzy) add('heavydizzy', 'urgent', 'Seek medical care today',
    'You logged heavy bleeding together with dizziness, fainting or a racing heart.', 'mayoHmb');

  // R3: period longer than 7 days (CDC)
  const lateBleed = curDates.filter((d) => diff(d, last.start) >= 7 && days[d] && ['light', 'medium', 'heavy'].includes(days[d].flow) && (!last.end || diff(last.end, d) >= 0));
  const loggedLen = last.end && isDate(last.end) ? diff(last.end, last.start) + 1 : 0;
  if (loggedLen > 7 || lateBleed.length) add('long', 'doctor', 'See a doctor: period longer than 7 days',
    'Bleeding that lasts more than 7 days is a reason to see a doctor.', 'cdcHmb');

  // R4: clots about 2.5 cm or larger (CDC)
  if (curDates.some((d) => ci[d] && ci[d].clots)) add('clots', 'doctor', 'See a doctor about large clots',
    'You logged blood clots about the size of a 2-euro coin (2.5 cm) or larger.', 'cdcHmb');

  // R6: bleeding between periods (Mayo Clinic)
  const between = curDates.filter((d) => days[d] && BLEED.includes(days[d].flow) && !inRange(d, lastRange));
  if (between.length) add('between', 'doctor', 'Bleeding between periods',
    `You logged bleeding between periods (${between.length === 1 ? 'one day' : `${between.length} days`}). This is worth mentioning to a doctor.`, 'mayoHmb', { dates: between });

  // R7: severe cramps in 2 consecutive cycles (ACOG; app trigger)
  if (prev) {
    const severeIn = (a, b) => Object.entries(ci).some(([d, v]) => diff(d, a) >= 0 && diff(b, d) > 0 && sev(v, 'cramps') >= 3);
    if (severeIn(prev.start, last.start) && severeIn(last.start, addDays(today, 1))) add('cramps2', 'doctor', 'See a doctor about severe cramps',
      'You logged severe cramps in two cycles in a row. Period pain that stops normal activities every month should be checked.', 'acogPain');
  }

  // R9: very low mood on several days (app rule: severe low mood on 3+ of the last 14 days)
  const lowDays = Object.entries(ci).filter(([d, v]) => diff(today, d) >= 0 && diff(today, d) < 14 && sev(v, 'low') >= 3).map(([d]) => d).sort();
  // acknowledged until a new severe low-mood day is logged
  if (lowDays.length >= 3) flags.push({ id: `lowmood@${lowDays[lowDays.length - 1]}`, level: 'support', title: 'You have logged very low mood on several days',
    text: 'Please talk to a doctor or someone you trust. If you need to talk now, TelefonSeelsorge is free and open 24 hours: 0800 111 0 111.', src: null, phone: '08001110111' });

  // R8 (cycles outside 24–38 twice) comes from the engine as a 'doctor' note.
  for (const n of pred.notes.filter((x) => x.kind === 'doctor')) flags.push({ id: `${n.id}@${cycleId}`, level: 'doctor', title: 'Cycle length', text: n.text, src: 'figo' });

  const order = { urgent: 0, support: 1, doctor: 2 };
  return flags.sort((a, b) => order[a.level] - order[b.level]);
}

// Suggestions for the symptoms logged on one day (spec 6.2). Unknown symptoms get the fixed "no suggestion" text.
export function recsFor(checkin, phase) {
  const out = []; const seen = new Set();
  for (const [code, s] of Object.entries((checkin && checkin.symptoms) || {})) {
    if (!s) continue;
    const r = RECS[code];
    if (r && r.phases && !r.phases.includes(phase)) { out.push({ codes: [code], text: NO_REC }); continue; }
    if (!r) { out.push({ codes: [code], text: NO_REC, none: true }); continue; }
    if (seen.has(r)) { out.find((o) => o.rec === r).codes.push(code); continue; }
    seen.add(r); out.push({ codes: [code], rec: r, text: r.text, escalate: r.escalate, src: r.src });
  }
  // one combined line for all symptoms without a suggestion
  const none = out.filter((o) => o.text === NO_REC); const some = out.filter((o) => o.text !== NO_REC);
  if (none.length) some.push({ codes: none.flatMap((o) => o.codes), text: NO_REC });
  return some.map((o) => ({ ...o, title: o.codes.map(label).join(', ') }));
}

// Heavy days in the current period (spec 5.2 heavy-flow link)
export function heavyDays(data, pred) {
  const ps = livePeriods(data.periods); if (!ps.length || !pred || pred.empty) return 0;
  const last = ps[ps.length - 1]; const r = periodRange(last, pred.periodLen, data.days);
  return Object.entries(data.days || {}).filter(([d, v]) => v.flow === 'heavy' && inRange(d, r)).length;
}
