import React from 'react';
import { IconButton } from '../core/IconButton.jsx';

const TONES = {
  success: { dot: 'var(--tc-valid)', fg: 'var(--tc-valid-strong)' },
  info:    { dot: 'var(--accent)', fg: 'var(--uw-ocean)' },
  warn:    { dot: 'var(--uw-kindle)', fg: 'var(--tc-warn-text-2)' },
  error:   { dot: 'var(--tc-invalid)', fg: 'var(--tc-invalid)' },
};

/** Transient confirmation. States what happened, in the past tense. */
export function Toast({ tone = 'success', message, action, actionLabel, onDismiss, style, ...rest }) {
  const t = TONES[tone];
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff',
      border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-hover)',
      padding: '12px 14px', minWidth: 300, maxWidth: 440, ...style }} {...rest}>
      <span style={{ width: 9, height: 9, borderRadius: 'var(--radius-pill)', background: t.dot, flex: 'none' }} />
      <span style={{ flex: 1, fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-bold)', color: 'var(--text-body)', lineHeight: 'var(--lh-ui)' }}>{message}</span>
      {action ? <button type="button" data-tc="text" onClick={action} style={{ border: 0, background: 'transparent', cursor: 'pointer',
        fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: t.fg, padding: 0, whiteSpace: 'nowrap' }}>{actionLabel}</button> : null}
      {onDismiss ? <IconButton variant="plain" size={20} title="Dismiss" onClick={onDismiss}>✕</IconButton> : null}
    </div>
  );
}
