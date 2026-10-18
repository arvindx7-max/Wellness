// Look (U2) checks: every theme is readable in light and dark, and the companions draw for every cycle day. No real data.
import { THEMES, ON_ACCENT, contrast, LOOK_DEFAULT, HALLOWEEN, effectiveStyle, halloweenEnd, effectiveMotion } from '../themes.js';
import { moon, sprout } from '../companion.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${info}`}`); };
const SURFACES = { light: ['#F2F2F7', '#FFFFFF'], dark: ['#000000', '#1C1C1E'] };

for (const [k, t] of Object.entries(THEMES)) for (const mode of ['light', 'dark']) {
  const [a, b] = t[mode];
  for (const [label, c] of [['start', a], ['end', b]]) {
    const r = contrast('#FFFFFF', c); ok(`${k} ${mode}: white text on header ${label} ≥ 4.5:1`, r >= 4.5, r.toFixed(2));
  }
  const acc = t.accent[mode === 'light' ? 0 : 1];
  for (const bg of SURFACES[mode]) { const r = contrast(acc, bg); ok(`${k} ${mode}: accent text on ${bg} ≥ 4.5:1`, r >= 4.5, r.toFixed(2)); }
  const r2 = contrast(ON_ACCENT[mode], acc); ok(`${k} ${mode}: button text on accent ≥ 4.5:1`, r2 >= 4.5, r2.toFixed(2));
  const r3 = contrast(t.light[0], '#FFFFFF'); ok(`${k}: hero button text (header start) on white ≥ 4.5:1`, r3 >= 4.5, r3.toFixed(2));
}
ok('defaults are neutral: Automatic, Tide, Moon, all cards on', LOOK_DEFAULT.mode === 'auto' && LOOK_DEFAULT.theme === 'tide' && LOOK_DEFAULT.companion === 'moon' && Object.values(LOOK_DEFAULT.cards).every(Boolean));

// v5 (U9): Halloween is readable in light and dark, and returns to Classic on 1 November by a pure date rule
for (const mode of ['light', 'dark']) {
  const v = HALLOWEEN[mode];
  for (const bg of [v['--bg'], v['--cell']]) {
    for (const k of ['--label', '--label2', '--accent']) { const r = contrast(v[k], bg); ok(`halloween ${mode}: ${k} on ${bg} ≥ 4.5:1`, r >= 4.5, r.toFixed(2)); }
  }
  for (const k of ['--h1', '--h2']) { const r = contrast('#FFFFFF', v[k]); ok(`halloween ${mode}: white text on header ${k} ≥ 4.5:1`, r >= 4.5, r.toFixed(2)); }
  const r2 = contrast(v['--on-accent'], v['--accent']); ok(`halloween ${mode}: button text on accent ≥ 4.5:1`, r2 >= 4.5, r2.toFixed(2));
  const r3 = contrast(v['--coral-ink'], v['--coral']); ok(`halloween ${mode}: text on the coral card ≥ 4.5:1`, r3 >= 4.5, r3.toFixed(2));
}
const H = (setOn, extra = {}) => ({ style: 'halloween', styleSet: setOn, autoBack: true, ...extra });
ok('default style is Classic', LOOK_DEFAULT.style === 'classic' && effectiveStyle(LOOK_DEFAULT, '2026-10-03') === 'classic');
ok('Halloween shows before 1 November', effectiveStyle(H('2026-10-03'), '2026-10-31') === 'halloween');
ok('Halloween ends on 1 November', effectiveStyle(H('2026-10-03'), '2026-11-01') === 'classic' && halloweenEnd('2026-10-03') === '2026-11-01');
ok('chosen in November: ends the next 1 November', halloweenEnd('2026-11-05') === '2027-11-01' && effectiveStyle(H('2026-11-05'), '2027-03-01') === 'halloween');
ok('chosen on 1 November itself: lasts until the next one', halloweenEnd('2026-11-01') === '2027-11-01');
ok('"back to Classic" off keeps Halloween after 1 November', effectiveStyle(H('2026-10-03', { autoBack: false }), '2026-12-24') === 'halloween');
ok('a missing or broken date never hides the choice wrongly', effectiveStyle(H(''), '2026-12-24') === 'halloween' && halloweenEnd('nonsense') === null);
// v5 (U8): motion follows the phone until chosen
ok('motion: follows Reduce Motion until chosen', effectiveMotion({ motion: 'auto' }, true) === 'reduced' && effectiveMotion({ motion: 'auto' }, false) === 'full');
ok('motion: her choice wins over the phone', effectiveMotion({ motion: 'full' }, true) === 'full' && effectiveMotion({ motion: 'off' }, false) === 'off' && effectiveMotion({ motion: 'reduced' }, false) === 'reduced');

// Companions: every day of cycles from 15 to 90 days, and days past the predicted end, produce clean drawings
let bad = 0;
for (const len of [15, 24, 30, 38, 90]) for (let d = 1; d <= len + 8; d++) {
  const per = 5, f0 = Math.max(per + 1, Math.round(len / 2) - 4), f1 = f0 + 7, ov = f0 + 5;
  const phase = d <= per ? 'period' : d >= f0 && d <= f1 ? 'fertile' : d < f0 ? 'follicular' : 'luteal';
  for (const svg of [moon({ d, len, per, f0, f1, ov, phase }), sprout({ d, len, per, f0, f1, ov, phase })]) if (/NaN|undefined|Infinity/.test(svg)) bad++;
}
ok('companions draw without NaN for cycles of 15–90 days', bad === 0, `${bad} bad drawings`);
const full = moon({ d: 16, len: 30, per: 5, f0: 10, f1: 17, ov: 16, phase: 'fertile' }), news = moon({ d: 30, len: 30, per: 5, f0: 10, f1: 17, ov: 16, phase: 'luteal' });
ok('moon is brighter at ovulation than before the period', Number(/stop-opacity="([\d.]+)"/.exec(full)[1]) > Number(/stop-opacity="([\d.]+)"/.exec(news)[1]));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
