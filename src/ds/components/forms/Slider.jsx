import React from 'react';
import { Overline } from '../core/Overline.jsx';

/** Range control for continuous settings (font size, line spacing). */
export function Slider({ label, value = 50, min = 0, max = 100, step = 1, unit = '', onChange, style }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {label ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Overline as="label">{label}</Overline>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-label)', color: 'var(--text-secondary)' }}>{value}{unit}</span>
        </div>
      ) : null}
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} style={{
        WebkitAppearance: 'none', appearance: 'none', width: '100%', height: 5, borderRadius: 'var(--radius-pill)',
        outline: 'none', cursor: 'pointer',
        background: 'linear-gradient(to right, var(--accent) 0%, var(--accent) ' + pct + '%, var(--surface-muted) ' + pct + '%, var(--surface-muted) 100%)',
      }} />
    </div>
  );
}
