import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Overline } from '../core/Overline.jsx';

/** End-edge slide-over for reference reading (Translation Academy). */
export function Drawer({ open = true, eyebrow, title, width = 440, onClose, children, ...rest }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim-drawer)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} {...rest}>
      <div onClick={e => e.stopPropagation()} style={{ width, maxWidth: '90vw', height: '100%', background: '#fff',
        boxShadow: 'var(--shadow-drawer)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            {eyebrow ? <Overline tone="accent" style={{ marginBottom: 6 }}>{eyebrow}</Overline> : null}
            <h2 style={{ fontSize: 'var(--fs-h2)', letterSpacing: 'var(--track-22)', fontWeight: 'var(--fw-black)', color: 'var(--uw-ocean)', margin: 0 }}>{title}</h2>
          </div>
          <IconButton variant="muted" title="Close" onClick={onClose} style={{ borderRadius: 'var(--radius-sm)' }}>✕</IconButton>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}
