import React from 'react';

/**
 * A separator. It exists because a hairline is the one shape a Surface cannot
 * make: Surface paints a box with a border on all four sides, and a rule is a
 * single edge. Everything else about it — colour, weight, the label treatment —
 * is a token.
 */
export function Rule({ orientation = 'horizontal', label, weight = 'hair', style, ...rest }) {
  const c = 'var(--line)';
  const w = weight === 'hair' ? 'var(--stroke-hair)' : 'var(--stroke)';
  if (orientation === 'vertical') {
    return <span role="separator" aria-orientation="vertical" style={{ width: w, alignSelf: 'stretch',
      minHeight: 26, background: c, flex: 'none', ...style }} {...rest} />;
  }
  if (label) {
    return (
      <span role="separator" style={{ display: 'flex', alignItems: 'center', gap: 10, ...style }} {...rest}>
        <span style={{ height: w, flex: 1, background: c }} />
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)',
          letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</span>
        <span style={{ height: w, flex: 1, background: c }} />
      </span>
    );
  }
  return <span role="separator" style={{ display: 'block', height: w, background: c, ...style }} {...rest} />;
}
