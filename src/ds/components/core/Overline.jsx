import React from 'react';
const TONE = { muted: 'var(--text-tertiary)', accent: 'var(--text-accent)', inverse: 'rgba(255,255,255,.72)' };
/** Tracked-out uppercase micro-heading that labels a field, column or section. */
export function Overline({ tone = 'muted', as = 'span', children, style, ...rest }) {
  const Tag = as;
  return <Tag style={{
    display: 'block', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-label)',
    fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-overline)',
    textTransform: 'uppercase', color: TONE[tone], margin: 0, ...style,
  }} {...rest}>{children}</Tag>;
}
