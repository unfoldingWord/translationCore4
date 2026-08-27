import React from 'react';

const FILLS = {
  primary: { background: 'var(--accent)', color: '#fff', border: '0', boxShadow: 'var(--shadow-raised)' },
  ocean:   { background: 'var(--uw-ocean)', color: '#fff', border: '0', boxShadow: 'var(--shadow-raised)' },
  secondary: { background: '#fff', color: 'var(--text-secondary)', border: 'var(--stroke) solid var(--border-input)' },
  outline: { background: '#fff', color: 'var(--uw-ocean)', border: 'var(--stroke-selected) solid var(--border-strong)' },
  ghost:   { background: 'transparent', color: 'var(--text-accent)', border: '0', padding: 0 },
  valid:   { background: 'var(--tc-valid-strong)', color: '#fff', border: 'var(--stroke) solid var(--tc-valid-strong)' },
  danger:  { background: '#fff', color: 'var(--tc-invalid)', border: 'var(--stroke) solid var(--border-danger)' },
};
const SIZES = {
  sm: { fontSize: 'var(--fs-caption-lg)', padding: '8px 18px', letterSpacing: 'var(--track-12-5)' },
  md: { fontSize: 'var(--fs-ui)', padding: '10px 20px', letterSpacing: 'var(--track-13-5)' },
  lg: { fontSize: 'var(--fs-ui-md)', padding: '13px 22px', letterSpacing: 'var(--track-14)' },
};

/** Pill action button. Primary = Inspire fill; everything else steps down from it. */
export function Button({ variant = 'primary', size = 'md', shape = 'pill', disabled, children, onClick, style, ...rest }) {
  const base = FILLS[variant] || FILLS.primary;
  const sz = SIZES[size] || SIZES.md;
  const tc = disabled ? undefined
    : variant === 'primary' ? 'fill'
    : variant === 'ocean' ? 'fill-ocean'
    : variant === 'ghost' ? 'text'
    : variant === 'valid' ? 'fill-valid'
    : 'quiet';
  const s = {
    fontFamily: 'var(--font-ui)',
    fontWeight: 'var(--fw-heavy)',
    lineHeight: 1.2,
    borderRadius: shape === 'block' ? 'var(--radius-md)' : 'var(--radius-pill)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    ...sz, ...base,
    ...(variant === 'ghost' ? { fontSize: 'var(--fs-caption)', padding: 0, letterSpacing: 'var(--track-12)' } : null),
    ...(disabled ? { background: 'var(--disabled-bg)', color: 'var(--disabled-fg)', border: '0', boxShadow: 'none' } : null),
    ...style,
  };
  return <button type="button" data-tc={tc} data-trim="cap" disabled={disabled} onClick={onClick} style={s} {...rest}>{children}</button>;
}
