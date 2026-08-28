import React from 'react';

/** Ancestry trail. Separated by the system's middle dot. */
export function Breadcrumb({ items = [], style }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, ...style }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)' }}>·</span> : null}
          {it.onClick ? (
            <button type="button" data-trim="cap" onClick={it.onClick} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0,
              fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-accent)' }}>{it.label}</button>
          ) : (
            <span aria-current="page" data-trim="cap" style={{ fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)',
              fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)' }}>{it.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
