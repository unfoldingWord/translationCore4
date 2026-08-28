import React from 'react';
/** Bordered pill toggle: rail filters, book selection, include-options. */
export function FilterChip({ selected, onClick, mark, tone = 'accent', children, style, ...rest }) {
  const on = tone === 'ocean'
    ? { background: 'var(--uw-ocean)', color: '#fff', borderColor: 'var(--uw-ocean)' }
    : { background: 'var(--surface-accent-soft)', color: 'var(--uw-ocean)', borderColor: 'var(--accent)' };
  return <button type="button" data-trim="cap" data-tc="surface" data-tc-selected={selected ? 'true' : undefined} onClick={onClick} style={{
    border: 'var(--stroke-selected) solid', borderRadius: 'var(--radius-pill)', padding: '7px 14px', cursor: 'pointer',
    fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)',
    display: 'inline-flex', alignItems: 'center', gap: '7px', whiteSpace: 'nowrap',
    ...(selected ? on : { background: '#fff', color: 'var(--text-tertiary)', borderColor: 'var(--border-input)' }),
    ...style,
  }} {...rest}>{mark ? <span style={{ fontWeight: 'var(--fw-black)' }}>{mark}</span> : null}{children}</button>;
}
