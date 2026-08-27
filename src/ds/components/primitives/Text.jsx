import React from 'react';

/* One entry per type role in the product. Roles, not sizes: a caller asks for
   what the string IS, so the scale can be retuned in one place. */
/* Every role names its optical tracking from --track-<its own px size>. The pairing
   is the whole point: a role cannot be given the wrong tracking, and adding a role
   forces the question of which value it takes. Uppercase roles use --tracking-*
   instead — caps are letterspaced by choice, not corrected by curve.
   trim: true adds data-trim="cap" — headings and single-line titles only. */
const ROLE = {
  display:   { fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-black)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-38)', color: 'var(--fg-strong)', trim: true },
  h1:        { fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-black)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-32)', color: 'var(--fg-strong)', trim: true },
  h2:        { fontSize: 'var(--fs-h2)', fontWeight: 'var(--fw-black)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-22)', color: 'var(--fg-strong)', trim: true },
  h3:        { fontSize: 'var(--fs-h3)', fontWeight: 'var(--fw-black)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-20)', color: 'var(--fg-strong)', trim: true },
  title:     { fontSize: 'var(--fs-title-lg)', fontWeight: 'var(--fw-heavy)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-19)', color: 'var(--fg-strong)', trim: true },
  titleSm:   { fontSize: 'var(--fs-ui-lg)', fontWeight: 'var(--fw-heavy)', lineHeight: 'var(--lh-tight)', letterSpacing: 'var(--track-14-5)', color: 'var(--fg-strong)', trim: true },
  strong:    { fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-heavy)', lineHeight: 'var(--lh-ui)', letterSpacing: 'var(--track-14)', color: 'var(--fg-strong)' },
  body:      { fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-regular)', lineHeight: 'var(--lh-body)', letterSpacing: 'var(--track-14)', color: 'var(--fg)' },
  ui:        { fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', lineHeight: 'var(--lh-ui)', letterSpacing: 'var(--track-13)', color: 'var(--fg)' },
  caption:   { fontSize: 'var(--fs-caption-lg)', fontWeight: 'var(--fw-regular)', lineHeight: 'var(--lh-ui)', letterSpacing: 'var(--track-12-5)', color: 'var(--fg-muted)' },
  captionStrong: { fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', lineHeight: 'var(--lh-ui)', letterSpacing: 'var(--track-12)', color: 'var(--fg-muted)' },
  /* The two label scales. 11px/.13em labels something OUTSIDE itself (a field, a
     column, a group). 10px/.10em labels something INSIDE a component (a badge, a
     table header, a fact key). Never mix the two tracking values at one size. */
  overline:  { fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', lineHeight: 'var(--lh-ui)', color: 'var(--fg-muted)' },
  label:     { fontSize: 'var(--fs-badge)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: 'var(--lh-ui)', color: 'var(--fg-muted)' },
  labelMicro:{ fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', lineHeight: 'var(--lh-ui)', color: 'var(--fg-muted)' },
  meta:      { fontSize: 'var(--fs-meta)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--fw-regular)', lineHeight: 'var(--lh-ui)', letterSpacing: 'var(--track-11-5)', color: 'var(--fg-muted)' },
  /* Serif means Scripture. If a string is Scripture or quotes Scripture, it is Charis. */
  /* Scripture leading is px on the 4px baseline grid, paired to its size, so a
     source column and the translation beside it share every baseline. Scripture is
     never optically tracked: Charis is drawn for reading at these sizes and the
     curve would fight it. */
  scripture:   { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)', color: 'var(--text-scripture)' },
  scriptureMd: { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)' },
  scriptureSm: { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)' },
  quote:       { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', fontWeight: 'var(--fw-bold)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--fg-strong)' },
};

const TONE = {
  default: undefined, strong: 'var(--fg-strong)', muted: 'var(--fg-muted)', faint: 'var(--fg-faint)',
  accent: 'var(--text-accent)', tone: 'var(--tone-text)', inverse: '#fff', scripture: 'var(--text-scripture)',
};

/* Charis covers no Greek, Hebrew or Arabic. Non-Latin faces carry font-size-adjust
   so they read at Charis's optical size — except Nastaliq, which sets diagonally
   and has no x-height to normalise against. */
const SCRIPT = {
  latin:    { fontFamily: 'var(--font-scripture)' },
  greek:    { fontFamily: 'var(--font-greek)', fontSizeAdjust: 'var(--fs-adjust-scripture)' },
  hebrew:   { fontFamily: 'var(--font-hebrew)', fontSizeAdjust: 'var(--fs-adjust-scripture)' },
  arabic:   { fontFamily: 'var(--font-arabic)', fontSizeAdjust: 'var(--fs-adjust-scripture)' },
  /* Nastaliq keeps its own size and its own leading — 64px, still on the grid, but
     off the scripture ladder. It is the one script whose line box is set by
     ascender collision rather than by reading comfort. */
  nastaliq: { fontFamily: 'var(--font-nastaliq)', fontSize: 'var(--fs-verse-nastaliq)', lineHeight: 'var(--lh-nastaliq)' },
};
const RTL = { hebrew: 1, arabic: 1, nastaliq: 1 };

/** A run of text in one of the system's type roles. */
export function Text({ role = 'ui', as, tone = 'default', script, align, truncate, trim, dir, children, style, ...rest }) {
  const Tag = as || (role === 'body' || role === 'caption' ? 'p' : 'span');
  const { trim: roleTrim, ...s } = ROLE[role] || ROLE.ui;
  const sc = script ? SCRIPT[script] : null;
  const capTrim = trim != null ? trim : !!roleTrim;
  return (
    <Tag
      data-trim={capTrim ? 'cap' : undefined}
      dir={dir || (script && RTL[script] ? 'rtl' : undefined)}
      style={{
        fontFamily: 'var(--font-ui)', margin: 0, ...s, ...sc,
        color: TONE[tone] || s.color,
        textAlign: align,
        ...(truncate ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } : null),
        ...style,
      }}
      {...rest}
    >{children}</Tag>
  );
}
