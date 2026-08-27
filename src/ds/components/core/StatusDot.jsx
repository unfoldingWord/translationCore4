import React from 'react';
const C = { valid: 'var(--tc-valid)', invalid: 'var(--tc-invalid)', todo: 'var(--uw-mist)', warn: 'var(--uw-kindle)', accent: 'var(--accent)' };
/** Small round state pip. */
export function StatusDot({ status = 'todo', size = 9, label, style }) {
  const dot = <span style={{ width: size, height: size, borderRadius: 'var(--radius-pill)', background: C[status], flex: 'none', display: 'inline-block', ...style }} />;
  if (!label) return dot;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }}>{dot}{label}</span>;
}
