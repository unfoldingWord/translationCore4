import React from 'react';
import { Badge } from '../core/Badge.jsx';

/** Helps-panel card: a translation note or key word tied to a verse. */
export function HelpCard({ kind = 'note', verse, title, body, active, onClick, actionLabel = 'Translation Academy →', onAction, style, ...rest }) {
  const accent = kind === 'word' ? 'var(--uw-cultivate)' : 'var(--accent)';
  return (
    <div data-tc="surface" data-tc-selected={active ? 'true' : undefined} onClick={onClick} style={{ cursor: 'pointer', border: 'var(--stroke) solid ' + (active ? accent : 'var(--border)'),
      borderRadius: 'var(--radius-lg)', padding: 14, background: active ? 'var(--surface-accent-soft)' : '#fff',
      ...style }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Badge tone={kind === 'word' ? 'cultivate' : 'accent'}>{kind === 'word' ? 'Key word' : 'Note'}</Badge>
        {verse ? <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>v{verse}</span> : null}
      </div>
      <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)',
        lineHeight: 'var(--lh-verse-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--uw-ocean)', margin: '0 0 5px' }}>
        {kind === 'word' ? title : '\u201C' + title + '\u201D'}
      </p>
      <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)', margin: 0 }}>{body}</p>
      {onAction ? <button type="button" data-tc="text" onClick={e => { e.stopPropagation(); onAction(); }} style={{ marginTop: 9, border: 0,
        background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-bold)',
        fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--accent)', padding: 0 }}>{actionLabel}</button> : null}
    </div>
  );
}
