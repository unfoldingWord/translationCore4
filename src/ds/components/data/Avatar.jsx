import React from 'react';

/** Rounded-square initials tile. tC4 identifies things by initials, not photographs. */
export function Avatar({ initials, size = 44, tone = 'ocean', shape = 'square', src, style, ...rest }) {
  const bg = { ocean: 'var(--uw-ocean)', accent: 'var(--accent)', cultivate: 'var(--uw-cultivate)', muted: 'var(--surface-muted)' }[tone];
  return (
    <span style={{ width: size, height: size, flex: 'none', borderRadius: shape === 'circle' ? 'var(--radius-pill)' : (size <= 32 ? 'var(--radius-sm)' : 'var(--radius-lg)'),
      background: bg, color: tone === 'muted' ? 'var(--text-secondary)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-black)', fontSize: Math.round(size / 2.6), overflow: 'hidden', ...style }} {...rest}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </span>
  );
}
