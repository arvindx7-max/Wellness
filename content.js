// Fixed, reviewed content for v2 (spec v0.3 Sections 5 and 6). Nothing here is generated at run time.
// Adding a suggestion, food or rule needs a source and the owner's approval (spec 6.2).

export const SRC = {
  acogPain: { name: 'ACOG: Dysmenorrhea (painful periods)', url: 'https://www.acog.org/womens-health/faqs/dysmenorrhea-painful-periods' },
  acogPms: { name: 'ACOG: Premenstrual syndrome', url: 'https://www.acog.org/womens-health/faqs/premenstrual-syndrome' },
  mayoPms: { name: 'Mayo Clinic: PMS treatment', url: 'https://www.mayoclinic.org/diseases-conditions/premenstrual-syndrome/diagnosis-treatment/drc-20376787' },
  mayoHmb: { name: 'Mayo Clinic: Heavy menstrual bleeding', url: 'https://www.mayoclinic.org/diseases-conditions/menorrhagia/symptoms-causes/syc-20352829' },
  cdcHmb: { name: 'CDC: Heavy menstrual bleeding', url: 'https://cdc.gov/female-blood-disorders/about/heavy-menstrual-bleeding.html' },
  nihIron: { name: 'NIH Office of Dietary Supplements: Iron', url: 'https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/' },
  figo: { name: 'FIGO 2018 (Munro et al.)', url: 'https://obgyn.onlinelibrary.wiley.com/doi/10.1002/ijgo.12666' },
};

// Symptom catalogue (spec 6.1). Severity 1 = mild, 2 = moderate (disrupts the day), 3 = severe (stops normal activities).
export const SYMPTOMS = [
  { code: 'cramps', label: 'Cramps', cat: 'Pain' },
  { code: 'backpain', label: 'Back pain', cat: 'Pain' },
  { code: 'headache', label: 'Headache', cat: 'Pain' },
  { code: 'breast', label: 'Breast tenderness', cat: 'Body' },
  { code: 'bloating', label: 'Bloating', cat: 'Body' },
  { code: 'acne', label: 'Acne', cat: 'Body' },
  { code: 'nausea', label: 'Nausea', cat: 'Digestion' },
  { code: 'diarrhoea', label: 'Diarrhoea', cat: 'Digestion' },
  { code: 'constipation', label: 'Constipation', cat: 'Digestion' },
  { code: 'cravings', label: 'Cravings', cat: 'Digestion' },
  { code: 'fatigue', label: 'Tiredness', cat: 'Energy and sleep' },
  { code: 'insomnia', label: 'Poor sleep', cat: 'Energy and sleep' },
  { code: 'dizziness', label: 'Dizziness', cat: 'Energy and sleep' },
  { code: 'irritable', label: 'Irritable', cat: 'Mood' },
  { code: 'anxious', label: 'Anxious', cat: 'Mood' },
  { code: 'low', label: 'Low mood', cat: 'Mood' },
  { code: 'swings', label: 'Mood swings', cat: 'Mood' },
];
export const MOOD_GOOD = [{ code: 'calm', label: 'Calm' }, { code: 'happy', label: 'Happy' }];
export const SEVERITY = { 1: 'Mild', 2: 'Moderate', 3: 'Severe' };
export const label = (code) => (SYMPTOMS.find((s) => s.code === code) || MOOD_GOOD.find((s) => s.code === code) || { label: code }).label;

// Check-in questions per phase (spec 6.1). Symptom questions use the 0–3 scale (0 = none).
export const CHANGE = [
  ['h1x2', 'Every hour or more often, for more than 2 hours in a row'],
  ['lt2', 'More often than every 2 hours'],
  ['2to4', 'Every 2 to 4 hours'],
  ['gt4', 'Less often than every 4 hours'],
];
export const DISCHARGE = [['dry', 'Dry'], ['sticky', 'Sticky'], ['creamy', 'Creamy'], ['eggwhite', 'Clear and stretchy, like egg white']];
export const CHECKIN = {
  menstruation: { title: 'During your period', ask: ['flow', 'change', 'clots', 'dizzy'], symptoms: ['cramps', 'fatigue'] },
  follicular: { title: 'After your period', ask: [], symptoms: ['fatigue', 'insomnia', 'low'] },
  fertile: { title: 'Around ovulation', ask: ['discharge', 'sidepain'], symptoms: [] },
  luteal: { title: 'Before your period', ask: [], symptoms: ['irritable', 'low', 'anxious', 'bloating', 'breast', 'headache', 'cravings', 'insomnia'] },
  late: { title: 'Today', ask: [], symptoms: ['irritable', 'low', 'bloating', 'breast'] },
  other: { title: 'Today', ask: [], symptoms: ['cramps', 'fatigue', 'low'] },
};

// Recommendations (spec 6.2). Only symptoms listed here get a suggestion.
const MOOD_REC = { text: 'Regular aerobic exercise through the whole month, not only on days with symptoms, may ease PMS. So may complex carbohydrates and calcium-rich foods.', escalate: 'If these symptoms come back every month and make normal life hard, talk to a doctor.', src: 'acogPms' };
export const RECS = {
  cramps: { text: 'Heat on your lower belly or a warm bath can ease cramps, and regular exercise through the month helps too. Over-the-counter pain relievers called NSAIDs (ibuprofen, naproxen) are the first choice and work best when started at the first sign of pain. Ask a pharmacist whether they suit you: they are not for people with asthma, stomach ulcers, bleeding disorders or an aspirin allergy.', escalate: 'See a doctor if the pain is severe, worse than usual, stops normal activities, or does not get better with NSAIDs.', src: 'acogPain' },
  irritable: MOOD_REC, anxious: MOOD_REC, low: MOOD_REC, swings: MOOD_REC,
  bloating: { text: 'Eat less salt, and have smaller, more frequent meals.', src: 'mayoPms' },
  breast: { text: 'Calcium-rich foods may help. Magnesium is also reported to help, but the evidence is limited.', src: 'acogPms' },
  fatigue: { text: 'During your period, choose iron-rich foods together with vitamin C. See the Food tab.', escalate: 'If you feel very tired or short of breath and your bleeding is heavy, see a doctor.', src: 'mayoHmb', phases: ['menstruation'] },
};
export const NO_REC = 'Cycle has no suggestion for this symptom. If it is severe, new or worrying, talk to a doctor.';

// Nutrition (spec 5). Iron values per serving from the NIH table (USDA FoodData Central).
export const FOOD = {
  menstruation: {
    title: 'Iron and vitamin C',
    why: 'Iron is the one nutrient you lose in menstrual blood. That is why women aged 19 to 50 need 18 mg of iron a day, compared with 8 mg for men.',
    groups: [
      { name: 'Iron from fish and chicken (best absorbed)', items: [['Oysters, 3 oz', '8 mg'], ['Sardines, 3 oz', '2 mg'], ['Chicken, 3 oz', '1 mg'], ['Light tuna, 3 oz', '1 mg']] },
      { name: 'Iron from plants and eggs', items: [['White beans, 1 cup', '8 mg'], ['Fortified breakfast cereal, 1 serving', 'up to 18 mg'], ['Lentils (dal), ½ cup', '3 mg'], ['Tofu, ½ cup', '3 mg'], ['Chickpeas (chana), ½ cup', '2 mg'], ['Kidney beans (rajma), ½ cup', '2 mg'], ['Egg, 1 large', '1 mg'], ['Spinach, ½ cup cooked', '3 mg, poorly absorbed']] },
      { name: 'Add vitamin C to the same meal', items: [['Lemon squeezed on dal', ''], ['Oranges and other citrus', ''], ['Strawberries', ''], ['Sweet peppers, tomatoes, broccoli', '']] },
    ],
    tips: [
      'Fish, chicken and vitamin C help your body absorb iron from plants; phytate (in grains and beans) and some polyphenols reduce it. In a normal mixed diet these effects are small, so there is no need to time meals.',
      'If you take calcium and iron supplements, take them at different times of day.',
    ],
    src: ['nihIron'],
  },
  follicular: {
    title: 'A balanced plate',
    why: 'No specific nutrient need is established for this part of the cycle, so Cycle does not suggest special foods now.',
    groups: [], tips: [], src: [],
  },
  luteal: {
    title: 'Calcium and complex carbohydrates',
    why: 'Nothing extra is lost before a period, but these foods may ease PMS symptoms. Calcium has the strongest evidence.',
    groups: [
      { name: 'Calcium-rich foods', items: [['Yogurt (dahi), milk', ''], ['Paneer, cheese', ''], ['Leafy greens', '']] },
      { name: 'Complex carbohydrates', items: [['Whole-wheat bread, roti or pasta', ''], ['Barley, brown rice', ''], ['Beans and lentils', '']] },
      { name: 'If you feel bloated', items: [['Less salt', ''], ['Smaller, more frequent meals', '']] },
      { name: 'May help, limited evidence', items: [['Nuts, seeds and whole grains (magnesium, vitamin E, vitamin B6)', '']] },
    ],
    tips: ['ACOG notes that 1,200 mg of calcium a day may reduce PMS symptoms. Talk to your doctor before taking a supplement.'],
    src: ['acogPms', 'mayoPms'],
  },
  late: {
    title: 'A balanced plate',
    why: 'Your period is late, so phase-specific food suggestions are paused until you log it.',
    groups: [], tips: [], src: [],
  },
};
FOOD.fertile = FOOD.follicular;
export const HEAVY_IRON_NOTE = 'You logged heavy bleeding on 2 or more days this period. Ask your doctor whether an iron check is useful. Do not take iron supplements without a doctor: some people (for example with hemochromatosis) must avoid them.';

// B2 item 6: what is happening in each phase (short, sourced).
export const PHASE_INFO = {
  menstruation: { title: 'Your period', text: 'The lining of the uterus is shed. Bleeding lasts about 4 days on average; up to 8 days is within the normal range.', src: [['Bull et al. 2019', 'https://www.nature.com/articles/s41746-019-0152-7'], ['FIGO 2018', 'https://obgyn.onlinelibrary.wiley.com/doi/10.1002/ijgo.12666']] },
  follicular: { title: 'After your period', text: 'An egg is maturing in one of the ovaries. This part of the cycle varies most in length from cycle to cycle, which is why ovulation is hard to predict from dates alone.', src: [['Bull et al. 2019', 'https://www.nature.com/articles/s41746-019-0152-7']] },
  fertile: { title: 'Fertile window', text: 'Pregnancy is possible from about 5 days before ovulation until the day after it, because sperm can survive for up to 5 days. Cycle estimates ovulation from your dates; it cannot see it.', src: [['ACOG: Fertility awareness', 'https://www.acog.org/womens-health/faqs/fertility-awareness-based-methods-of-family-planning'], ['Bull et al. 2019', 'https://www.nature.com/articles/s41746-019-0152-7']] },
  luteal: { title: 'Before your period', text: 'After ovulation, this phase lasts about 12 days on average. In the days before a period many people notice PMS symptoms such as mood changes, bloating or breast tenderness.', src: [['Bull et al. 2019', 'https://www.nature.com/articles/s41746-019-0152-7'], ['ACOG: PMS', 'https://www.acog.org/womens-health/faqs/premenstrual-syndrome']] },
  late: { title: 'Period late', text: 'Cycle lengths vary, and a period that comes a few days late now and then is common. If pregnancy is possible, a home test can tell you.', src: [['FIGO 2018', 'https://obgyn.onlinelibrary.wiley.com/doi/10.1002/ijgo.12666']] },
};
