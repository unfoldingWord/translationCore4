import React from 'react';

/** Field-level error. Names the field and says how to fix it. */
export function InlineError({ children, style, ...rest }) {
  return <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '6px 0 0',
    fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', lineHeight: 'var(--lh-ui)', color: 'var(--tc-invalid)', fontWeight: 'var(--fw-medium)', ...style }} {...rest}>
    <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 'var(--radius-pill)', border: 'var(--stroke-selected) solid currentColor',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'var(--fw-black)', flex: 'none', marginTop: 1 }}>!</span>
    <span>{children}</span>
  </p>;
}
