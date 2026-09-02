import React from 'react';
import { ProgressBar } from '../core/ProgressBar.jsx';

/** Compact book button with a progress rail. Grid tile on Home, full row in the rail. */
export function BookTile({ name, percent = 0, meta, layout = 'tile', active, onClick, style, ...rest }) {
  const row = layout === 'row';
  const nameStyle = row
    ? { fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-heavy)' }
    : { fontSize: 'var(--fs-ui)', fontWeight: 'var(--fw-black)' };
  return (
    <button type="button" data-tc={row ? 'rail' : 'surface'} data-tc-selected={active ? 'true' : undefined} onClick={onClick} style={{
      border: row ? 0 : 'var(--stroke) solid var(--border)', background: active ? 'var(--surface-accent-soft)' : (row ? 'transparent' : 'var(--surface-app)'),
      cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: row ? '10px 12px' : '10px 12px',
      textAlign: 'start', fontFamily: 'var(--font-ui)', minWidth: 0, width: row ? '100%' : undefined,
      ...style,
    }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: row ? 7 : 8 }}>
        {/* No cap trim here: the trimmed box plus overflow:hidden clips the
            descending hook of Mulish's J ("Jonah" rendered as "Ionah"). */}
        <span style={{ ...nameStyle, color: 'var(--text-heading)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        <span style={{ fontSize: 'var(--fs-badge)', letterSpacing: 'var(--track-10)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', flex: 'none' }}>{meta != null ? meta : percent + '%'}</span>
      </div>
      <ProgressBar value={percent} height={row ? 5 : 4} />
    </button>
  );
}
