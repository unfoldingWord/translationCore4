import React from 'react';
import { ProgressBar } from '../core/ProgressBar.jsx';

/** Compact book button with a progress rail. Grid tile on Home, full row in the rail. */
export function BookTile({ name, percent = 0, meta, layout = 'tile', active, onClick, style, ...rest }) {
  const row = layout === 'row';
  return (
    <button type="button" data-tc={row ? 'row' : 'surface'} data-tc-selected={active ? 'true' : undefined} onClick={onClick} style={{
      border: row ? 0 : 'var(--stroke) solid var(--border)', background: active ? 'var(--surface-accent-soft)' : (row ? 'transparent' : 'var(--surface-app)'),
      cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: row ? '10px 12px' : '10px 12px',
      textAlign: 'start', fontFamily: 'var(--font-ui)', minWidth: 0, width: row ? '100%' : undefined,
      ...style,
    }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: row ? 7 : 8 }}>
        <span data-trim="cap" style={{ fontSize: row ? 'var(--fs-ui-md)' : 'var(--fs-ui)',
          letterSpacing: row ? 'var(--track-14)' : 'var(--track-13-5)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        <span style={{ fontSize: 'var(--fs-badge)', letterSpacing: 'var(--track-10)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', flex: 'none' }}>{meta != null ? meta : percent + '%'}</span>
      </div>
      <ProgressBar value={percent} height={row ? 5 : 4} />
    </button>
  );
}
