import React from 'react';
import { Badge } from '../core/Badge.jsx';

/** Selectable row: export formats, gateway languages, import methods. */
export function OptionCard({ selected, control = 'none', icon, title, description, meta, recommended, recommendedLabel = 'Recommended', trailing, onClick, style, ...rest }) {
  return (
    <button type="button" data-tc="surface" data-tc-selected={selected ? 'true' : undefined} onClick={onClick} style={{
      display: 'flex', alignItems: control === 'radio' ? 'flex-start' : 'center', gap: '12px', width: '100%',
      textAlign: 'start', cursor: 'pointer', fontFamily: 'var(--font-ui)',
      border: 'var(--stroke-selected) solid ' + (selected ? 'var(--accent)' : 'var(--border-input)'),
      background: selected ? 'var(--surface-accent-soft)' : '#fff',
      borderRadius: 'var(--radius-lg)', padding: '13px 14px',
      ...style,
    }} {...rest}>
      {control === 'radio' ? (
        <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-pill)', border: 'var(--stroke-control) solid ' + (selected ? 'var(--accent)' : 'var(--border-strong)'),
          flex: 'none', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: selected ? 'var(--accent)' : 'transparent' }} />
        </span>
      ) : null}
      {icon ? <span style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'var(--surface-accent-soft)',
        color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-black)', flex: 'none' }}>{icon}</span> : null}
      <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span data-trim="cap" style={{ fontSize: 'var(--fs-ui-lg)', letterSpacing: 'var(--track-14-5)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{title}</span>
          {meta ? <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{meta}</span> : null}
          {recommended ? <Badge tone="accentSoft" size="sm">{recommendedLabel}</Badge> : null}
        </span>
        {description ? <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-ui)' }}>{description}</span> : null}
      </span>
      {trailing ? <span style={{ flex: 'none', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-heavy)' }}>{trailing}</span> : null}
    </button>
  );
}
