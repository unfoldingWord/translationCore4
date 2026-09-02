// Target-language typography from the project's chosen script font (settings
// textFont, one of state.SCRIPT_FONTS). Nastaliq sets small and stacks
// diagonally, so it takes its own size and leading and never --fs-verse-lg
// (ds/tokens/typography.css); Arabic script takes its own family at the
// Latin step. Everything else reads in the scripture face.
export const targetScript = (font) => {
  const f = String(font ?? '').toLowerCase();
  if (f.includes('nastaliq')) return 'nastaliq';
  if (f.includes('arabic')) return 'arabic';
  return 'latin';
};

const FAMILY = { latin: 'var(--font-scripture)', arabic: 'var(--font-arabic)', nastaliq: 'var(--font-nastaliq)' };
const STEP = {
  lg: ['var(--fs-verse-lg)', 'var(--lh-verse-lg)'],
  md: ['var(--fs-verse-md)', 'var(--lh-verse-md)'],
  sm: ['var(--fs-verse-sm)', 'var(--lh-verse-sm)'],
  verse: ['var(--fs-verse)', 'var(--lh-verse)'],
};

/** font-family / font-size / line-height for target text at a reading step. */
export const targetType = (font, step = 'lg') => {
  const script = targetScript(font);
  const [fontSize, lineHeight] = script === 'nastaliq' ? ['var(--fs-verse-nastaliq)', 'var(--lh-nastaliq)'] : STEP[step];
  return { fontFamily: FAMILY[script], fontSize, lineHeight };
};

/** The project's text direction as a `dir` value. */
export const projectDir = (s) => (s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr');

/** targetType from app state (the project's script font). */
export const targetTypeFor = (s, step = 'lg') => targetType(s.project?.textFont, step);
