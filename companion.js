// Cycle-aware companions (U2), drawn in code from the predicted cycle. No images, works offline.
// c = { d: cycle day, len: predicted cycle length, per: period days, f0, f1: first/last possible fertile cycle day, ov: likely ovulation cycle day, phase }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const n = (v) => (Number.isFinite(v) ? +v.toFixed(2) : 0);

// Moon: the lit part grows to full at ovulation, then wanes to new at the next period.
export function moon(c) {
  const ov = Math.max(2, c.ov), len = Math.max(ov + 1, c.len), d = Math.max(1, c.d);
  const wax = d <= ov;
  const f = clamp(wax ? (d - 1) / (ov - 1) : 1 - (d - ov) / (len - ov), 0, 1);
  const r = 38, cx = 60, cy = 60, k = Math.cos(Math.PI * f) * r;
  const lit = wax
    ? `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r} A${n(Math.abs(k))} ${r} 0 0 ${k > 0 ? 0 : 1} ${cx} ${cy - r}Z`
    : `M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} A${n(Math.abs(k))} ${r} 0 0 ${k > 0 ? 1 : 0} ${cx} ${cy - r}Z`;
  const glow = (0.18 + 0.5 * f).toFixed(2);
  return `<svg viewBox="0 0 120 120" width="100%" height="100%" focusable="false"><defs>
    <radialGradient id="cmg" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#FFFBEF"/><stop offset=".7" stop-color="#F6E7C4"/><stop offset="1" stop-color="#E8D3A6"/></radialGradient>
    <radialGradient id="cmh" cx="50%" cy="50%" r="50%"><stop offset=".55" stop-color="#FFF4D6" stop-opacity="${glow}"/><stop offset="1" stop-color="#FFF4D6" stop-opacity="0"/></radialGradient>
    <clipPath id="cmc"><path d="${lit}"/></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="58" fill="url(#cmh)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0A0A1A" opacity=".28"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".18"/>
    <g clip-path="url(#cmc)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#cmg)"/>
      <circle cx="${cx + 13}" cy="${cy - 11}" r="6" fill="#D9C08E" opacity=".55"/><circle cx="${cx - 10}" cy="${cy + 15}" r="4.5" fill="#D9C08E" opacity=".5"/>
      <circle cx="${cx - 16}" cy="${cy - 14}" r="3" fill="#D9C08E" opacity=".45"/><circle cx="${cx + 6}" cy="${cy + 22}" r="2.5" fill="#D9C08E" opacity=".45"/></g></svg>`;
}

// Sprout: a seed during the period, growing after it, in bloom in the fertile window, petals closing before the next period.
export function sprout(c) {
  const ph = c.phase;
  const g = ph === 'period' ? 0 : ph === 'follicular' ? clamp((c.d - c.per) / Math.max(1, c.f0 - c.per), 0, 1) : 1;
  const h = 12 + 44 * g, base = 98, x = 60, tip = base - h;
  const leaf = (y, side, s) => `<path d="M${x} ${n(y)} C${n(x + 10 * side * s)} ${n(y - 14 * s)} ${n(x + 28 * side * s)} ${n(y - 12 * s)} ${n(x + 32 * side * s)} ${n(y - 2 * s)} C${n(x + 22 * side * s)} ${n(y + 4 * s)} ${n(x + 8 * side * s)} ${n(y + 2 * s)} ${x} ${n(y)}Z" fill="url(#csl)"/><path d="M${x} ${n(y)} Q${n(x + 16 * side * s)} ${n(y - 6 * s)} ${n(x + 30 * side * s)} ${n(y - 2 * s)}" stroke="#4E9A44" stroke-width="1" fill="none" opacity=".6"/>`;
  const petals = [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${n(tip - 10)}" rx="6.5" ry="11" fill="url(#csp)" transform="rotate(${a} ${x} ${n(tip)})"/>`).join('');
  const flower = ph === 'fertile' ? `${petals}<circle cx="${x}" cy="${n(tip)}" r="6" fill="#FFC24A"/><circle cx="${x - 1.5}" cy="${n(tip - 1.5)}" r="2" fill="#FFE29A"/>`
    : ph === 'luteal' ? `<path d="M${x} ${n(tip + 2)} C${x - 9} ${n(tip - 4)} ${x - 6} ${n(tip - 18)} ${x} ${n(tip - 20)} C${x + 6} ${n(tip - 18)} ${x + 9} ${n(tip - 4)} ${x} ${n(tip + 2)}Z" fill="url(#csp)"/><path d="M${x - 6} ${n(tip + 1)} Q${x} ${n(tip + 7)} ${x + 6} ${n(tip + 1)}" fill="#6DBF57"/>`
    : g > 0.8 ? `<circle cx="${x}" cy="${n(tip - 3)}" r="4.5" fill="#8FD47A"/>` : '';
  const seed = ph === 'period' ? `<ellipse cx="${x}" cy="${base - 3}" rx="8" ry="5.5" fill="#B9875A"/><path d="M${x - 3} ${base - 5} q3 -2 6 0" stroke="#E8C79E" stroke-width="1.2" fill="none"/>` : '';
  return `<svg viewBox="0 0 120 120" width="100%" height="100%" focusable="false"><defs>
    <linearGradient id="csl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A8E68E"/><stop offset="1" stop-color="#5DB04B"/></linearGradient>
    <linearGradient id="csp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE1EA"/><stop offset="1" stop-color="#FF9DB8"/></linearGradient></defs>
    <circle cx="60" cy="60" r="54" fill="#fff" opacity=".12"/>
    <path d="M22 ${base + 2} Q60 ${base - 12} 98 ${base + 2} L98 ${base + 10} L22 ${base + 10}Z" fill="#7A4E33"/><path d="M26 ${base + 1} Q60 ${base - 9} 94 ${base + 1}" stroke="#9C6A48" stroke-width="2" fill="none"/>
    ${seed}${g > 0 ? `<path d="M${x} ${base - 2} C${x - 3} ${n(base - h * 0.4)} ${x + 3} ${n(base - h * 0.7)} ${x} ${n(tip)}" stroke="#6DBF57" stroke-width="3.5" fill="none" stroke-linecap="round"/>` : ''}
    ${g > 0.25 ? leaf(base - h * 0.38, 1, Math.min(1, g * 1.4)) : ''}${g > 0.5 ? leaf(base - h * 0.62, -1, Math.min(1, g * 1.2)) : ''}${flower}</svg>`;
}
