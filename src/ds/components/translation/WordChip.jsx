import React from 'react';
/** A draggable word token in the alignment editor. */
export function WordChip({ state = 'default', children, style, ...rest }) {
  const S = {
    default:   { background: '#fff', color: 'var(--text-scripture)', border: 'var(--stroke) solid var(--border-input)', boxShadow: 'var(--shadow-chip)' },
    selected:  { background: 'var(--accent)', color: '#fff', border: 'var(--stroke) solid var(--accent)', boxShadow: 'var(--shadow-focus)' },
    suggested: { background: 'var(--tc-suggest-bg)', color: 'var(--tc-suggest-fg)', border: 'var(--stroke-selected) dashed var(--accent)', boxShadow: 'none' },
    placed:    { background: '#fff', color: 'var(--text-scripture)', border: 'var(--stroke) solid var(--border-input)', boxShadow: 'var(--shadow-chip)' },
  }[state];
  return <span draggable style={{ fontFamily: 'var(--font-scripture)', fontSize: state === 'placed' ? 'var(--fs-ui-md)' : 'var(--fs-body)', lineHeight: 1.2,
    borderRadius: state === 'placed' ? 'var(--radius-chip)' : 'var(--radius-sm)',
    padding: state === 'placed' ? '3px 9px' : '5px 11px', cursor: 'pointer', whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 5, ...S, ...style }} {...rest}>{children}</span>;
}
