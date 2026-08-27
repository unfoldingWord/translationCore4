import React from 'react';
/** White surface on the paper background. The base container for everything. */
export function Card({ variant = 'default', interactive, padding, children, style, onClick, ...rest }) {
  const v = {
    default: { background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-card)' },
    flat:    { background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'none' },
    muted:   { background: 'var(--surface-app)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'none' },
    ocean:   { background: 'var(--uw-ocean)', border: 0, borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-hero)', color: 'var(--text-inverse)' },
    paper:   { background: '#fff', border: 0, borderRadius: 'var(--radius-xs)', boxShadow: 'var(--shadow-page)' },
  }[variant];
  // A card you can click is a control: it takes focus and answers Enter and Space.
  const clickable = interactive && onClick;
  const a11y = clickable ? {
    role: 'button', tabIndex: 0,
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
  } : null;
  return <div data-tc={interactive ? 'card' : undefined} onClick={onClick} {...a11y} style={{ padding: padding == null ? 22 : padding,
    cursor: clickable ? 'pointer' : undefined, ...v, ...style }} {...rest}>{children}</div>;
}
