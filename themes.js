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
export const LOOK_DEFAULT = { mode: 'auto', theme: 'tide', companion: 'moon', noteSeen: false, cards: { checkin: true, week: true, phase: true, food: true } };
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
