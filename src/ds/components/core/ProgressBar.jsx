import React from 'react';
/** Flat rounded progress rail. Inspire = drafting progress, green = checking progress. */
export function ProgressBar({ value = 0, tone = 'accent', height = 5, style }) {
  return (
    <div style={{ height, borderRadius: 'var(--radius-pill)', background: 'var(--surface-muted)', overflow: 'hidden', ...style }}>
      <div style={{ height: '100%', width: Math.max(0, Math.min(100, value)) + '%', borderRadius: 'var(--radius-pill)',
        background: tone === 'valid' ? 'var(--tc-valid)' : 'var(--accent)',
        transition: 'width var(--dur-enter) var(--ease-standard)' }} />
    </div>
  );
}
