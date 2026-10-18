// Colour themes (U2). Neutral defaults only: her choice is stored in her encrypted data, never here.
// Period pink and fertile teal never change with the theme. White text sits on every header colour,
// so each gradient end must reach 4.5:1 against white (checked by tests/look.test.mjs).
export const THEMES = {
  tide:   { name: 'Tide',   light: ['#4F4BD0', '#5D71B5'], dark: ['#3532A3', '#4C67B2'], accent: ['#4F4BD0', '#9C9AF5'] },
  petal:  { name: 'Petal',  light: ['#C93D66', '#B05B63'], dark: ['#8C2E52', '#A04A5E'], accent: ['#C13B62', '#FF8FAB'] },
  dusk:   { name: 'Dusk',   light: ['#5A3A8F', '#8961BD'], dark: ['#40296E', '#6A4C9E'], accent: ['#5A3A8F', '#C6A4F0'] },
  meadow: { name: 'Meadow', light: ['#2F7055', '#498063'], dark: ['#245640', '#3E7458'], accent: ['#2F7055', '#7BD3A4'] },
};
export const ON_ACCENT = { light: '#FFFFFF', dark: '#0B0B12' }; // text on an accent-coloured button
// v5 (U9): the Style. Classic is the look Cycle has always had (with the Colour options above); Halloween is a seasonal style with its own palette.
// It is stored as a separate `style` field, so an older version that does not know it simply shows Classic.
export const STYLES = [['classic', 'Classic'], ['halloween', 'Halloween']];
export const HALLOWEEN = {
  light: { '--bg': '#F7F0E4', '--cell': '#FFFDF8', '--cell2': '#EFE4D2', '--label': '#1E1426', '--label2': '#524954', '--label3': 'rgba(30, 20, 38, .30)', '--sep': 'rgba(30, 20, 38, .14)', '--fill': 'rgba(30, 20, 38, .08)', '--fill2': 'rgba(30, 20, 38, .14)', '--seg-on': '#FFFDF8',
    '--h1': '#3B1F5C', '--h2': '#A3420F', '--glow': '#F2873A', '--accent': '#B4470C', '--accent-tint': 'rgba(180, 71, 12, .12)', '--on-accent': '#FFFFFF', '--coral': '#F2873A', '--coral-ink': '#1E1426', '--orange': '#7A4E00', '--ring-base': 'rgba(30, 20, 38, .12)',
    '--sketch': 'rgba(140, 62, 18, .72)', '--sketch-fill': 'rgba(242, 135, 58, .16)', '--sketch-solid': '#F8DFC6', '--ghost': '#FFFDF8', '--witch': 'rgba(91, 63, 168, .72)', '--witch-fill': 'rgba(91, 63, 168, .10)' },
  dark: { '--bg': '#0E0A14', '--cell': '#1B1424', '--cell2': '#2A2036', '--label': '#F6EFE4', '--label2': '#BAB3AE', '--label3': 'rgba(246, 239, 228, .30)', '--sep': 'rgba(255, 255, 255, .12)', '--fill': 'rgba(255, 255, 255, .10)', '--fill2': 'rgba(255, 255, 255, .18)', '--seg-on': '#3A2E4A',
    '--h1': '#24123A', '--h2': '#7A2E12', '--glow': '#FF8A2A', '--accent': '#FF8A2A', '--accent-tint': 'rgba(255, 138, 42, .18)', '--on-accent': '#1A0E05', '--coral': '#FF8A2A', '--coral-ink': '#1A0E05', '--orange': '#FFD15C', '--ring-base': 'rgba(255, 255, 255, .14)',
    '--sketch': 'rgba(255, 200, 140, .78)', '--sketch-fill': 'rgba(255, 138, 42, .16)', '--sketch-solid': '#3A2418', '--ghost': '#2A2036', '--witch': 'rgba(214, 196, 255, .78)', '--witch-fill': 'rgba(160, 130, 255, .16)' },
};
export const HALLOWEEN_PREVIEW = 'linear-gradient(160deg, #24123A, #4A1F3A 58%, #7A2E12)';
// "Back to Classic on 1 November": a pure rule, nothing is written when the date passes. Halloween ends on the first 1 November after the day it was chosen.
export function halloweenEnd(setOn) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(setOn || '') ? setOn : null; if (!d) return null;
  const y = +d.slice(0, 4); return d < `${y}-11-01` ? `${y}-11-01` : `${y + 1}-11-01`;
}
export function effectiveStyle(l, today) {
  if (!l || l.style !== 'halloween') return 'classic';
  if (l.autoBack === false) return 'halloween';
  const end = halloweenEnd(l.styleSet); return end && today >= end ? 'classic' : 'halloween';
}
// v5 (U8): Motion. 'auto' follows the phone's Reduce Motion setting until she chooses.
export const MOTIONS = [['auto', 'Automatic'], ['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']];
export const MOTION_NOTE = 'Automatic follows your phone\'s Reduce Motion setting. Full slides pages in and out. Reduced only fades. Off shows pages at once.';
export function effectiveMotion(l, systemReduced) {
  const m = l && l.motion; if (m === 'full' || m === 'reduced' || m === 'off') return m;
  return systemReduced ? 'reduced' : 'full';
}
export const LOOK_DEFAULT = { mode: 'auto', theme: 'tide', style: 'classic', styleSet: '', autoBack: true, motion: 'auto', companion: 'moon', noteSeen: false, cards: { checkin: true, week: true, phase: true, food: true } };
export const MODES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];
export const COMPANIONS = [['moon', 'Moon'], ['sprout', 'Sprout'], ['off', 'Off']];
export const CARDS = [['checkin', 'Check-in'], ['week', 'Week strip'], ['phase', 'What is happening now'], ['food', 'Food for now']];
export const COMPANION_CAPTION = 'The moon and the sprout show where you are in your cycle, not whether pregnancy is possible. Any day can carry a chance of pregnancy.';
// text colour helpers shared with the tests
export function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const tint = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;
