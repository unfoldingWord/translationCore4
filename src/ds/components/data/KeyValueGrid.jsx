import React from 'react';

/** Grid of small labelled facts — the import-review summary pattern. */
export function KeyValueGrid({ items = [], columns = 2, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ',1fr)', gap: 10, ...style }}>
      {items.map((it, i) => (
        <div key={i} style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-badge)', fontWeight: 'var(--fw-heavy)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 3 }}>{it.k}</span>
          <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{it.v}</span>
        </div>
      ))}
    </div>
  );
}
