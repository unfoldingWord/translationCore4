import React from 'react';
import { IconButton } from '../core/IconButton.jsx';

/** Centered dialog over an Ocean scrim. Header / scrolling body / right-aligned footer.
 * `closeLabel` localizes the ✕ button; `zIndex` lets a confirmation stack over
 * another modal; extra props (e.g. data-testid) land on the scrim. */
export function Modal({ open = true, title, subtitle, width = 520, zIndex = 80, closeLabel = 'Close', onClose, footer, children, ...rest }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim-modal)', zIndex,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }} {...rest}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 'var(--radius-2xl)',
        width: '100%', maxWidth: width, maxHeight: '88vh', overflow: 'auto', boxShadow: 'var(--shadow-modal)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 'var(--fs-h3)', letterSpacing: 'var(--track-20)', fontWeight: 'var(--fw-black)', color: 'var(--uw-ocean)', margin: '0 0 4px' }}>{title}</h3>
            {subtitle ? <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', margin: 0, lineHeight: 'var(--lh-ui)' }}>{subtitle}</p> : null}
          </div>
          <IconButton variant="muted" size={28} title={closeLabel} onClick={onClose}>✕</IconButton>
        </div>
        <div style={{ padding: '18px 24px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {footer ? <div style={{ padding: '18px 24px 22px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>{footer}</div> : null}
      </div>
    </div>
  );
}
