import React from 'react';
import { Badge } from '../core/Badge.jsx';

/** Helps-panel card: a translation note or key word tied to a verse. */
export function HelpCard({ kind = 'note', verse, title, body, active, onClick, actionLabel = 'Translation Academy →', onAction, style, ...rest }) {
  // A key word is named by its title and carries no verse label; a note quotes
  // its phrase under a verse label.
  const k = kind === 'word'
    ? { tc: 'outline-cultivate', tone: 'cultivate', badge: 'Key word', headGap: 0, titleSize: 'var(--fs-title-sm)', titleMargin: '7px 0 5px', quote: (s) => s, verseLabel: false }
    : { tc: 'outline', tone: 'accent', badge: 'Note', headGap: 6, titleSize: 'var(--fs-body)', titleMargin: '0 0 5px', quote: (s) => '\u201C' + s + '\u201D', verseLabel: true };
  const state = active
    ? { borderColor: 'var(--accent)', background: 'var(--surface-accent-soft)' }
    : { borderColor: 'var(--border)', background: 'var(--surface-card)' };
  return (
    <div data-tc={k.tc} data-tc-selected={active ? 'true' : undefined} onClick={onClick} style={{ cursor: 'pointer', border: 'var(--stroke) solid ' + state.borderColor,
      borderRadius: 'var(--radius-lg)', padding: 14, background: state.background,
      ...style }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: k.headGap }}>
        <Badge tone={k.tone}>{k.badge}</Badge>
        {verse && k.verseLabel ? <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>v{verse}</span> : null}
      </div>
      {/* A note with no quoted phrase (a chapter introduction) has no title to
        * quote \u2014 rendering the quotes anyway printed a bare \u201C\u201D. */}
      {title ? (
        <p style={{ fontFamily: 'var(--font-scripture)', fontSize: k.titleSize,
          lineHeight: 'var(--lh-body)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: k.titleMargin }}>
          {k.quote(title)}
        </p>
      ) : null}
      {/* A div, not a p: the body carries rendered markdown blocks, and a <p>
        * inside a <p> is invalid \u2014 the browser closes the outer one early. */}
      <div style={{ fontSize: 'var(--fs-ui-sm)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)', margin: 0 }}>{body}</div>
      {onAction ? <button type="button" data-tc="text" onClick={e => { e.stopPropagation(); onAction(); }} style={{ marginTop: 9, border: 0,
        background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)',
        fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--accent)', padding: 0 }}>{actionLabel}</button> : null}
    </div>
  );
}
