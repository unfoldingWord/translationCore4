import React from 'react';

/** 32×32 hairline square button for panel toggles and modal dismiss. */
export function IconButton({ variant = 'outline', size = 32, title, children, onClick, style, ...rest }) {
  const v = {
    outline: { background: '#fff', border: 'var(--stroke) solid var(--border-input)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' },
    muted:   { background: 'var(--surface-muted)', border: 0, color: 'var(--text-secondary)', borderRadius: 'var(--radius-pill)' },
    plain:   { background: 'transparent', border: 0, color: 'var(--text-tertiary)', borderRadius: 'var(--radius-sm)' },
  }[variant];
  return (
    <button type="button" data-tc={variant === 'plain' ? 'text' : 'quiet'} title={title} aria-label={title} onClick={onClick} style={{
      width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flex: 'none', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)',
      ...v, ...style,
    }} {...rest}>{children}</button>
  );
}
