import React from 'react';

const TONES = {
  accent:    { background: 'var(--accent)', color: '#fff' },
  accentSoft:{ background: 'var(--surface-accent-soft)', color: 'var(--accent)' },
  cultivate: { background: 'var(--uw-cultivate)', color: '#fff' },
  ocean:     { background: 'var(--uw-ocean)', color: '#fff' },
  neutral:   { background: 'var(--surface-muted)', color: 'var(--text-tertiary)' },
  valid:     { background: 'var(--tc-valid-surface)', color: 'var(--tc-valid-strong)' },
  warn:      { background: 'var(--surface-warm)', color: 'var(--tc-warn-text-2)' },
};

/** Uppercase micro-pill: Note, Key word, Recommended, Always included. */
export function Badge({ tone = 'accent', size = 'md', children, style, ...rest }) {
  return <span style={{
    display: 'inline-flex', alignItems: 'center',
    fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)',
    fontSize: size === 'sm' ? 'var(--fs-micro)' : 'var(--fs-badge)',
    letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
    borderRadius: 'var(--radius-pill)', padding: size === 'sm' ? '3px 8px' : '2px 7px',
    whiteSpace: 'nowrap', ...TONES[tone], ...style,
  }} {...rest}>{children}</span>;
}
