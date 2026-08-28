import React from 'react';
const FAMILY = { latin: 'var(--font-scripture)', greek: 'var(--font-greek)', hebrew: 'var(--font-hebrew)', arabic: 'var(--font-arabic)', nastaliq: 'var(--font-nastaliq)' };
const RTL = { hebrew: 1, arabic: 1, nastaliq: 1 };
/* Size and leading travel together — a step, never one without the other. Which
   step to use is a question about MEASURE, not importance: --fs-verse-lg is drawn
   for the 720px single column, and a 200px column in the translate split wants md
   or it wraps every three words. */
const STEP = {
  lg: ['var(--fs-verse-lg)', 'var(--lh-verse-lg)'],
  md: ['var(--fs-verse-md)', 'var(--lh-verse-md)'],
  sm: ['var(--fs-verse-sm)', 'var(--lh-verse-sm)'],
};

const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/* Which word positions a highlight covers. Matching is by CONTIGUOUS RUN, not by
   word membership: "In the beginning" has to mark those three words in that order,
   because marking every "the" in the passage would be worse than marking nothing. */
function runs(words, phrases) {
  const w = words.map(norm);
  const hit = new Set();
  for (const phrase of phrases) {
    const t = String(phrase).trim().split(/\s+/).map(norm).filter(Boolean);
    if (!t.length) continue;
    for (let i = 0; i + t.length <= w.length; i++) {
      let ok = true;
      for (let j = 0; j < t.length; j++) if (w[i + j] !== t[j]) { ok = false; break; }
      if (ok) for (let j = 0; j < t.length; j++) hit.add(i + j);
    }
  }
  /* Group consecutive hits into one segment so the highlight is continuous across
     the spaces inside a phrase instead of striping word by word. */
  const out = [];
  let i = 0;
  while (i < words.length) {
    const on = hit.has(i);
    let j = i;
    while (j + 1 < words.length && hit.has(j + 1) === on) j++;
    out.push({ on, text: words.slice(i, j + 1).join(' ') });
    i = j + 1;
  }
  return out;
}

/** Continuous scripture prose. Verses run on; a new paragraph starts only at a USFM marker. */
export function ScripturePassage({ verses = [], dir, script = 'latin', step = 'lg', size, highlight = [], style }) {
  const nastaliq = script === 'nastaliq';
  const d = dir || (RTL[script] ? 'rtl' : 'ltr');
  const [stepSize, stepLeading] = STEP[step] || STEP.lg;
  /* Accepts a phrase, a list, null or nothing — a default parameter only guards
     undefined, and this used to throw on null. */
  const phrases = (highlight == null ? [] : Array.isArray(highlight) ? highlight : [highlight]).filter(Boolean);
  return (
    <p dir={d} style={{ textAlign: 'start', fontFamily: FAMILY[script] || FAMILY.latin,
      // Nastaliq has no x-height to normalise against; every other non-Latin face is matched to Charis.
      fontSizeAdjust: (script === 'latin' || nastaliq) ? undefined : 'var(--fs-adjust-scripture)',
      fontSize: size || (nastaliq ? 'var(--fs-verse-nastaliq)' : stepSize),
      /* Baseline-grid leading, paired to the step. `size` is an escape hatch for an
         off-scale measure and breaks the pairing — pass a px line-height with it,
         still a multiple of --baseline. */
      lineHeight: nastaliq ? 'var(--lh-nastaliq)' : stepLeading,
      color: 'var(--text-scripture)', margin: '0 0 10px', ...style }}>
      {verses.map(v => {
        const words = String(v.text).split(/\s+/).filter(Boolean);
        const segs = phrases.length ? runs(words, phrases) : [{ on: false, text: words.join(' ') }];
        return (
          <React.Fragment key={v.n}>
            <sup style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
            {/* Real spaces between segments, and inline rather than inline-block, so the
                line breaker sets and compresses the gaps itself. Unmarked runs carry no
                box at all. */}
            {segs.map((s, i) => (
              <React.Fragment key={i}>
                {i ? ' ' : null}
                {s.on
                  ? <span style={{ borderRadius: 'var(--radius-xs)', padding: '0 .08em',
                      background: 'var(--tc-highlight-soft)', color: 'var(--uw-ocean)',
                      boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
                      transition: 'background var(--dur-hover) var(--ease-standard)' }}>{s.text}</span>
                  : s.text}
              </React.Fragment>
            ))}
            {' '}
          </React.Fragment>
        );
      })}
    </p>
  );
}
