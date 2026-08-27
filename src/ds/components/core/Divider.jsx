import React from 'react';
/** Hairline rule. Horizontal by default; `vertical` for the 26px header rule. */
export function Divider({ orientation = 'horizontal', label, inverse, style }) {
  const c = inverse ? 'var(--border-inverse)' : 'var(--border)';
  if (orientation === 'vertical') return <span style={{ width: 'var(--stroke-hair)', alignSelf: 'stretch', minHeight: 26, background: c, flex: 'none', ...style }} />;
  if (label) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, ...style }}>
      <span style={{ height: 'var(--stroke-hair)', flex: 1, background: c }} />
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)',
        letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ height: 'var(--stroke-hair)', flex: 1, background: c }} />
    </span>
  );
  return <span style={{ display: 'block', height: 'var(--stroke-hair)', background: c, ...style }} />;
}
