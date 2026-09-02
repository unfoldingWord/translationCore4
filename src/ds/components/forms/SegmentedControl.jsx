import React from 'react';
/** Pill track with one active segment. The mode switch in the app header and every 2–3 way inline choice. */
export function SegmentedControl({ options = [], value, onChange, tone = 'accent', size = 'md', style }) {
  const pad = size === 'sm' ? '5px 11px' : '7px 16px';
  const fs = size === 'sm' ? 'var(--fs-label)' : 'var(--fs-ui-sm)';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '3px',
      borderRadius: 'var(--radius-pill)', background: tone === 'inverse' ? 'rgba(255,255,255,.10)' : 'var(--surface-muted)', ...style }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const on = v === value;
        return <button key={v} type="button" data-trim="cap" onClick={() => onChange && onChange(v)} style={{
          border: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)',
          fontSize: fs, padding: pad, borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
          letterSpacing: size === 'sm' ? 'var(--track-11)' : undefined,
          background: on ? (tone === 'ocean' ? 'var(--uw-ocean)' : 'var(--accent)') : 'transparent',
          color: on ? '#fff' : (tone === 'inverse' ? 'rgba(255,255,255,.78)' : 'var(--text-secondary)'),
          boxShadow: on ? 'var(--shadow-raised)' : 'none',
        }}>{typeof o === 'string' ? o : o.label}</button>;
      })}
    </div>
  );
}
