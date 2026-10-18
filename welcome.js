// v6: the first-run welcome. Three screens, in this order: splash, features, get started.
// Pure markup, no data. The actions (data-act) are the same ones the old welcome page used.
export const STEPS = ['splash', 'features', 'start'];

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  calendar: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v3.6M16 3v3.6"/><circle cx="8" cy="14" r=".7"/><circle cx="12" cy="14" r=".7"/><circle cx="16" cy="14" r=".7"/><circle cx="8" cy="17.2" r=".7"/><circle cx="12" cy="17.2" r=".7"/></svg>`,
  lotus: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M12 4.5c2.3 2.2 3 5 0 9-3-4-2.3-6.800 0-9z"/><path d="M12 19c-3.300-1.200-5.200-3.800-5.200-7 2.200.4 4 1.800 5.200 4"/><path d="M12 19c3.300-1.200 5.200-3.800 5.200-7-2.200.4-4 1.800-5.200 4"/><path d="M4 14.500c.8 2.800 3.800 4.800 8 4.800s7.200-2 8-4.800"/></svg>`,
  food: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M6 3v6.500a2.200 2.200 0 0 0 4.400 0V3M8.200 3v18"/><path d="M17.500 21V3c-2.300 1.400-3.500 4-3.500 7 0 1.800 1.400 3 3.500 3"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M12 3l7 3v5.200c0 4.800-3 7.800-7 9.800-4-2-7-5-7-9.800V6z"/><path d="M9 12l2.200 2.200L15.500 10"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M12 20.200S4.800 15.900 4.800 10.200A4.100 4.100 0 0 1 12 7.600a4.100 4.100 0 0 1 7.200 2.600c0 5.700-7.200 10-7.200 10z"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M7 18.200a4 4 0 0 1-.6-7.960A6 6 0 0 1 18 9.600a4.300 4.300 0 0 1-.5 8.600z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" ${stroke} stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" ${stroke} stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
};

// soft watercolour hills along the bottom, a pale sun and a leaf sprig; decoration only
const HILLS = `<svg class="w-hills" viewBox="0 0 390 330" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="wh1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w-h1a)"/><stop offset="1" stop-color="var(--w-h1b)"/></linearGradient>
    <linearGradient id="wh2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w-h2a)"/><stop offset="1" stop-color="var(--w-h2b)"/></linearGradient>
    <linearGradient id="wh3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w-h3a)"/><stop offset="1" stop-color="var(--w-h3b)"/></linearGradient>
    <linearGradient id="wh4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w-h4a)"/><stop offset="1" stop-color="var(--w-h4b)"/></linearGradient>
  </defs>
  <path d="M-10 120C50 80 110 84 170 112S300 134 400 92V340H-10z" fill="url(#wh1)"/>
  <path d="M-10 168C60 128 130 140 196 166S320 188 400 142V340H-10z" fill="url(#wh2)"/>
  <path d="M-10 214C70 176 140 196 210 214S330 238 400 196V340H-10z" fill="url(#wh3)"/>
  <path d="M-10 262C80 232 150 250 220 266S340 286 400 250V340H-10z" fill="url(#wh4)"/>
</svg>`;
const SUN = '<div class="w-sun" aria-hidden="true"></div>';
const SPRIG = `<svg class="w-sprig" viewBox="0 0 120 200" aria-hidden="true"><g fill="none" stroke="var(--w-leaf)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M60 196C58 150 60 100 66 40"/>
  <path d="M60 150C40 138 30 118 34 92 52 100 62 122 60 150z" fill="var(--w-leaf-fill)"/>
  <path d="M62 112C84 102 96 82 94 56 72 62 60 84 62 112z" fill="var(--w-leaf-fill)"/>
  <path d="M64 70C48 60 42 44 46 24 60 32 66 50 64 70z" fill="var(--w-leaf-fill)"/>
</g></svg>`;
const LEAF_TR = `<svg class="w-leaf-tr" viewBox="0 0 140 160" aria-hidden="true"><g fill="var(--w-leaf-fill)" stroke="var(--w-leaf)" stroke-width="1.2" stroke-linejoin="round">
  <path d="M120 10C90 22 76 52 84 90 110 76 124 46 120 10z"/><path d="M84 96C58 98 38 118 36 150 66 148 86 128 84 96z"/><path d="M130 70C112 90 110 116 122 140 140 122 142 96 130 70z"/>
</g></svg>`;

const dots = (step) => `<div class="w-dots" role="group" aria-label="Page ${step === 'start' ? 2 : 1} of 2">${['features', 'start'].map((s, i) => `<button type="button" class="w-dot" data-act="w-go" data-v="${s}" aria-label="Page ${i + 1} of 2" ${step === s ? 'aria-current="true"' : ''}></button>`).join('')}</div>`;
const feature = (tone, icon, title, text, i) => `<li class="w-feat" style="--i:${i}"><span class="w-ic ic-${tone}">${ICONS[icon]}</span><span><strong>${title}</strong><span class="w-ft">${text}</span></span></li>`;
const mini = (tone, icon, a, b) => `<li><span class="w-ic ic-${tone}">${ICONS[icon]}</span><span>${a}<br>${b}</span></li>`;

// opts: { step, mark (logo svg), canRestore, anim ('' | 'anim-push' | 'anim-back' | 'anim-fade') }
export function welcomeHtml({ step = 'start', mark = '', canRestore = false, anim = '' } = {}) {
  const s = STEPS.includes(step) ? step : 'start';
  const bg = `<div class="w-bg" aria-hidden="true"><i class="w-blob b1"></i><i class="w-blob b2"></i><i class="w-blob b3"></i></div>`;
  if (s === 'splash') {
    return `<section class="intro welcome w-splash ${anim}" aria-label="Cycle">${bg}${SUN}${HILLS}${SPRIG}
      <button type="button" class="w-hit" data-act="w-go" data-v="features" aria-label="Continue"></button>
      <div class="w-center">
        <div class="w-logo" data-rise style="--i:0">${mark}</div>
        <h1 class="w-title" data-rise style="--i:1">Cycle</h1>
        <p class="w-tag" data-rise style="--i:2">Your personal cycle companion for a healthier, happier you.</p>
        <p class="w-words" data-rise style="--i:3"><span>Track</span><b aria-hidden="true">·</b><span>Plan</span><b aria-hidden="true">·</b><span>Feel good</span></p>
      </div>
    </section>`;
  }
  if (s === 'features') {
    return `<section class="intro welcome w-features ${anim}" aria-label="What Cycle does">${bg}${LEAF_TR}
      <div class="w-col">
        <p class="w-eyebrow" data-rise style="--i:0">A smarter way to</p>
        <h1 class="w-h1" data-rise style="--i:1">Understand<br>Your Cycle</h1>
        <p class="w-lede" data-rise style="--i:2">Track your period, see your fertile days and get insights that fit you, all in one place.</p>
        <ul class="w-feats">
          ${feature('pink', 'calendar', 'Track Your Period', 'Log your cycle and see predictions for your next period and fertile days.', 3)}
          ${feature('lilac', 'lotus', 'Daily Check-ins', 'Quick questions about your symptoms, mood and well-being.', 4)}
          ${feature('teal', 'food', 'Phase-Based Food Tips', 'Food ideas that fit each phase of your cycle, shaped by your own diet.', 5)}
          ${feature('amber', 'shield', 'Trusted &amp; Private', 'Encrypted on your device, and in your own Google Drive only if you choose.', 6)}
        </ul>
        <p class="w-quote" data-rise style="--i:7">Small steps, big changes <span aria-hidden="true">♡</span></p>
      </div>
      <div class="w-foot">${dots(s)}<button type="button" class="w-next" data-act="w-go" data-v="start" aria-label="Next">${ICONS.arrow}</button></div>
    </section>`;
  }
  return `<section class="intro welcome w-start ${anim}" aria-label="Get started">${bg}${HILLS}
    <button type="button" class="w-back" data-act="w-go" data-v="features" aria-label="Back">${ICONS.back}</button>
    <div class="w-col w-startcol">
      <div class="w-logo sm" data-rise style="--i:0">${mark}</div>
      <h1 class="w-title" data-rise style="--i:1">Cycle</h1>
      <p class="w-tag" data-rise style="--i:2">Track your cycle.<br>Feel more in control.</p>
      <ul class="w-minis" data-rise style="--i:3">
        ${mini('pink', 'calendar', 'Period', 'Tracking')}${mini('teal', 'lotus', 'Fertility', 'Insights')}${mini('lilac', 'heart', 'Wellness', 'Tips')}
      </ul>
      <div class="w-actions" data-rise style="--i:4">
        <button class="w-btn primary" data-act="start">Get started</button>
        <button class="w-btn outline" data-act="import-start">Start from a backup file</button>
        <p class="w-or" aria-hidden="true"><span>or</span></p>
        <button class="w-btn glass" data-act="restore-start" ${canRestore ? '' : 'disabled'}>${ICONS.cloud}<span>Restore from Google Drive</span></button>
        ${canRestore ? '' : '<p class="fine center">Restoring from Google Drive is not available in this copy of Cycle, because Google sign-in is not set up.</p>'}
      </div>
      <p class="w-notice" data-rise style="--i:5"><strong>Used Cycle before on this iPhone?</strong> The Home Screen app and Safari keep separate data. If you set Cycle up from the Home Screen icon, open it from there; if you used it in Safari, open it in Safari. Setting up here creates a new, empty Cycle.</p>
      ${dots(s)}
    </div>
  </section>`;
}
