import React from 'react';

/** Determinate-less activity indicator. Used only for real network waits. */
export function Spinner({ size = 18, tone = 'accent', label, style }) {
  const color = tone === 'inverse' ? 'rgba(255,255,255,.9)' : 'var(--accent)';
  const ring = (
    <span style={{ width: size, height: size, borderRadius: 'var(--radius-pill)', flex: 'none',
      border: Math.max(2, Math.round(size / 9)) + 'px solid var(--surface-muted)', borderTopColor: color,
      display: 'inline-block', animation: 'tcSpin 800ms linear infinite' }} />
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, ...style }}>
      <style>{'@keyframes tcSpin{to{transform:rotate(360deg)}}'}</style>
      {ring}
      {label ? <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }}>{label}</span> : null}
    </span>
  );
}
