// Cycle calculation engine — implements spec v0.3, Section 3. Pure functions, no UI, no storage.
// Every constant carries its source (NFR-07). Dates are 'YYYY-MM-DD' strings; arithmetic is done in
// whole UTC days so month ends, leap years and time zones can never shift a day.

export const CONST = {
  D_LIKELY: 13,        // days from ovulation to next period: luteal 12.4 ± 2.4 d (Bull et al. 2019) + 1 → 13
  D_MIN: 11,           // ±1 SD lower bound, 11.0
  D_MAX: 16,           // ±1 SD upper bound, 15.8 rounded
  FERTILE_BEFORE: 5,   // fertile window starts 5 days before ovulation (Wilcox 2000, via Bull 2019)
  FERTILE_AFTER: 1,    // ...and ends 1 day after ovulation (ACOG fertility-awareness FAQ)
  WINDOW: 6,           // cycles used for the average — design parameter (spec 3.2)
  DEFAULT_CYCLE: 29,   // population mean 29.3 days (Bull et al. 2019), used only with no data at all
  DEFAULT_PERIOD: 4,   // mean bleed length 4.0 days (Bull et al. 2019)
  NO_HISTORY_SPREAD: 4,// with fewer than 2 data points: FIGO 2018 normal variation expressed as ±4 days
  VALID_MIN: 10,       // cycles outside 10–90 days are not used until confirmed (Bull 2019 inclusion range)
  VALID_MAX: 90,
  NORMAL_MIN: 24,      // FIGO 2018 normal frequency 24–38 days
  NORMAL_MAX: 38,
  MEDIUM_FROM: 3,      // completed cycles needed for "Medium" confidence (spec 3.5)
  MAX_GAP: 2,          // open period: at most 2 unlogged days between bleeding days still count as the same period (design parameter)
  SUSPECT_FACTOR: 2,   // D1: "Did you miss a period?" when a cycle is more than twice her average (approved 3 Oct)
};

// ---------- date helpers ----------
export const toDays = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
export const fromDays = (d) => new Date(Math.round(d) * 864e5).toISOString().slice(0, 10);
export const addDays = (s, n) => fromDays(toDays(s) + n);
export const diff = (a, b) => toDays(a) - toDays(b); // a − b in days
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDays(toDays(s)) === s;
export function localToday(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function sd(a) { // sample standard deviation
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}

// ---------- cycles ----------
export const livePeriods = (periods) => (periods || []).filter((p) => !p.deleted && isDate(p.start)).sort((a, b) => diff(a.start, b.start));

// D1 (approved 3 Oct): a cycle more than twice as long as her other cycles' average is probably a missed
// period. It is left out of predictions until she adds the missed period, excludes it, or confirms it.
export function markSuspects(cyc) {
  const ok = cyc.filter((c) => c.valid && !c.excluded);
  for (const c of ok) {
    const others = ok.filter((o) => o !== c).slice(-CONST.WINDOW).map((o) => o.length);
    if (others.length >= 2 && !c.confirmed && c.length > CONST.SUSPECT_FACTOR * mean(others)) { c.suspect = true; c.othersAvg = Math.round(mean(others)); }
  }
  return cyc;
}
// Completed cycles: from one period start to the next. A cycle is excluded when she marks its starting period.
export function cycles(periods) {
  const ps = livePeriods(periods); const out = [];
  for (let i = 0; i < ps.length - 1; i++) {
    const length = diff(ps[i + 1].start, ps[i].start);
    out.push({ start: ps[i].start, next: ps[i + 1].start, length, periodId: ps[i].id,
      excluded: !!ps[i].excluded, confirmed: !!ps[i].confirmedLong, valid: length >= CONST.VALID_MIN && length <= CONST.VALID_MAX });
  }
  return out;
}

// End of a period: the logged end, or for an open period the predicted length extended through later
// logged bleeding. Up to MAX_GAP unlogged days may sit in between; an explicit "none" stops it; capped at 15 days.
const BLEED = ['spotting', 'light', 'medium', 'heavy'];
export function periodEnd(p, periodLen, days = {}) {
  if (p.end && isDate(p.end)) return p.end;
  let end = addDays(p.start, periodLen - 1);
  for (let d = addDays(end, 1); diff(d, p.start) < 15 && diff(d, end) <= CONST.MAX_GAP + 1; d = addDays(d, 1)) {
    const f = days[d] && days[d].flow;
    if (f === 'none') break;
    if (BLEED.includes(f)) end = d;
  }
  return end;
}
export function periodLength(p) { return p.end && isDate(p.end) && diff(p.end, p.start) >= 0 ? diff(p.end, p.start) + 1 : null; }

// ---------- the prediction (spec 3.2, 3.3, 3.5) ----------
export function predict(periods, settings = {}, today = localToday(), days = {}) {
  const ps = livePeriods(periods);
  if (!ps.length) return { empty: true };
  const cyc = cycles(ps);
  markSuspects(cyc);
  const used = cyc.filter((c) => !c.excluded && c.valid && !c.suspect).slice(-CONST.WINDOW).map((c) => c.length);

  const samples = [...used];
  const usual = Number(settings.usualCycle) || null;
  if (used.length < CONST.MEDIUM_FROM && usual) samples.push(usual);   // 3.5: her cycles + onboarding value
  let usedDefault = false;
  if (!samples.length) { samples.push(CONST.DEFAULT_CYCLE); usedDefault = true; }
  const cycleLen = Math.round(mean(samples));
  const spread = samples.length >= 2 ? Math.max(1, Math.round(sd(samples))) : CONST.NO_HISTORY_SPREAD;

  const lens = ps.map(periodLength).filter(Boolean).slice(-CONST.WINDOW);
  const periodLen = lens.length ? Math.round(mean(lens)) : (Number(settings.usualPeriod) || CONST.DEFAULT_PERIOD);

  const last = ps[ps.length - 1];
  const cyclesOut = [];
  // current cycle (k = 0) and the next 3 predicted cycles (FR-08)
  for (let k = 0; k <= 3; k++) {
    const start = k === 0 ? last.start : addDays(last.start, cycleLen * k);
    cyclesOut.push(windowFor(start, addDays(start, cycleLen), spread, k));
  }
  const cur = cyclesOut[0];
  const confidence = used.length >= CONST.MEDIUM_FROM ? 'Medium' : 'Low';
  return {
    empty: false, today, cycleLen, spread, periodLen, confidence, usedCycles: used.length, usedDefault,
    lastStart: last.start, lastPeriod: last, nextStart: cur.nextStart,
    nextRange: [addDays(cur.nextStart, -spread), addDays(cur.nextStart, spread)],
    ovulation: cur.ovulation, peak: cur.peak, possible: cur.possible,
    cycles: cyclesOut, state: stateOn(today, { last, periodLen, cur, spread, days }),
    notes: notesFor(cyc, cur, today, spread),
  };
}

// 3.3: ovulation estimate and fertile windows for one cycle, given its start and predicted next start.
function windowFor(start, nextStart, s, k) {
  const likely = addDays(nextStart, -CONST.D_LIKELY);
  const early = addDays(nextStart, -s - CONST.D_MAX);
  const late = addDays(nextStart, s - CONST.D_MIN);
  const clamp = (d) => (diff(d, start) < 0 ? start : d); // never before this cycle's own start
  return {
    k, start, nextStart,
    ovulation: { likely, early: clamp(early), late },
    peak: [clamp(addDays(likely, -CONST.FERTILE_BEFORE)), addDays(likely, CONST.FERTILE_AFTER)],
    possible: [clamp(addDays(early, -CONST.FERTILE_BEFORE)), addDays(late, CONST.FERTILE_AFTER)],
  };
}

const within = (d, [a, b]) => diff(d, a) >= 0 && diff(b, d) >= 0;

// 3.9: exactly one state per day.
function stateOn(today, { last, periodLen, cur, spread, days }) {
  const cycleDay = diff(today, last.start) + 1;
  const pEnd = periodEnd(last, periodLen, days);
  const base = { cycleDay, daysToNext: diff(cur.nextStart, today) };
  if (cycleDay < 1) return { ...base, id: 'before', label: 'Before your first logged period' };
  if (diff(pEnd, today) >= 0) return { ...base, id: 'menstruation', label: 'Period', periodOpen: !last.end };
  if (diff(today, addDays(cur.nextStart, spread)) > 0) return { ...base, id: 'late', label: 'Period late', daysLate: diff(today, cur.nextStart) };
  if (within(today, cur.possible)) return { ...base, id: 'fertile', label: 'Fertile window', peak: within(today, cur.peak) };
  if (diff(cur.possible[0], today) > 0) return { ...base, id: 'follicular', label: 'Follicular phase' };
  return { ...base, id: 'luteal', label: 'Luteal phase (estimated)' };
}

// 3.6: rules and notes.
function notesFor(cyc, cur, today, spread) {
  const notes = [];
  for (const c of cyc) if (!c.valid && !c.excluded) notes.push({ id: `check-${c.start}`, kind: 'check', cycleStart: c.start,
    text: `The cycle starting ${c.start} is ${c.length} days long. Did you miss logging a period? It is left out of predictions until you fix or confirm it.` });
  for (const c of cyc) if (c.suspect) notes.push({ id: `missed-${c.start}`, kind: 'missed', cycleStart: c.start, periodId: c.periodId,
    text: `The cycle starting ${c.start} is ${c.length} days long, more than twice your usual ${c.othersAvg} days. Did you miss logging a period? It is left out of predictions until you add the missed period or confirm the length.` });
  const normal = cyc.filter((c) => c.valid && !c.excluded && !c.suspect);
  const out = (c) => c.length < CONST.NORMAL_MIN || c.length > CONST.NORMAL_MAX;
  const a = normal[normal.length - 1], b = normal[normal.length - 2];
  if (a && b && out(a) && out(b)) notes.push({ id: 'doctor-range', kind: 'doctor',
    text: `Your last two cycles (${b.length} and ${a.length} days) were outside the usual 24–38 days. Consider discussing this with a doctor at your next visit.` });
  else if (a && out(a)) notes.push({ id: 'info-range', kind: 'info',
    text: `Your last cycle was ${a.length} days, outside the usual 24–38 days. One cycle like this is common; the app will tell you if it happens twice in a row.` });
  if (diff(today, addDays(cur.nextStart, spread)) > 0) notes.push({ id: 'late', kind: 'late',
    text: `Your period is ${diff(today, cur.nextStart)} days late. Did your period start on an earlier date? You can add it now. If pregnancy is possible, take a home test.` });
  return notes;
}

// What a calendar day shows (FR-07, FR-08). Logged facts win over predictions.
export function dayInfo(date, pred, periods, days) {
  const info = { date, logged: false, flow: (days && days[date] && days[date].flow) || null };
  for (const p of livePeriods(periods)) {
    const end = p.end && isDate(p.end) ? p.end : (pred.empty ? p.start : (p.id === pred.lastPeriod.id ? periodEnd(p, pred.periodLen, days || {}) : p.start));
    if (within(date, [p.start, end])) { info.logged = true; info.periodId = p.id; info.periodOpen = !p.end; break; }
  }
  if (pred.empty) return info;
  const late = pred.state && pred.state.id === 'late';
  for (const c of pred.cycles) {
    if (late && c.k > 0) continue; // period overdue: no forecasts for a cycle that has not started

    if (c.k > 0 && within(date, [c.start, addDays(c.start, pred.periodLen - 1)]) && diff(date, pred.today) > 0) { info.predictedPeriod = true; info.horizon = c.k; }
    if (within(date, c.peak)) { info.fertile = 'peak'; info.horizon = c.k; }
    else if (within(date, c.possible) && !info.fertile) { info.fertile = 'possible'; info.horizon = c.k; }
    if (date === c.ovulation.likely) { info.ovulation = true; info.horizon = c.k; }
  }
  if (info.logged) { delete info.predictedPeriod; }
  return info;
}
