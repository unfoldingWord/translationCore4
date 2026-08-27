import React from 'react';

/** Dark hover label for icon-only controls and truncated text. */
export function Tooltip({ label, placement = 'top', children, style }) {
  const [on, setOn] = React.useState(false);
  const pos = {
    top:    { bottom: '100%', insetInlineStart: '50%', transform: 'translateX(-50%)', marginBottom: 7 },
    bottom: { top: '100%', insetInlineStart: '50%', transform: 'translateX(-50%)', marginTop: 7 },
    start:  { insetInlineEnd: '100%', top: '50%', transform: 'translateY(-50%)', marginInlineEnd: 7 },
    end:    { insetInlineStart: '100%', top: '50%', transform: 'translateY(-50%)', marginInlineStart: 7 },
  }[placement];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
      {children}
      {on ? <span role="tooltip" style={{ position: 'absolute', zIndex: 70, background: 'var(--uw-ocean)', color: '#fff',
        fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', lineHeight: 1.4,
        padding: '6px 9px', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-hover)', whiteSpace: 'nowrap',
        pointerEvents: 'none', ...pos }}>{label}</span> : null}
    </span>
  );
}
