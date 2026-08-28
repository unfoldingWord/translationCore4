import React from 'react';
const TONES = {
  warn:    { background: 'var(--tc-warn-surface)', border: 'var(--stroke) solid var(--tc-warn-border)', color: 'var(--tc-warn-text)' },
  kindle:  { background: 'var(--surface-warm)', border: 0, color: 'var(--tc-kindle-text)' },
  success: { background: 'var(--tc-valid-surface)', border: 0, color: 'var(--tc-valid-strong)' },
  info:    { background: 'var(--surface-app)', border: 'var(--stroke) solid var(--border)', color: 'var(--text-secondary)' },
};
/** Inline notice. Warnings state the consequence, never just "Warning". */
export function Callout({ tone = 'warn', children, style, ...rest }) {
  return <div style={{ borderRadius: 'var(--radius-lg)', padding: '12px 14px',
    fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', lineHeight: 'var(--lh-body)', ...TONES[tone], ...style }} {...rest}>{children}</div>;
}
