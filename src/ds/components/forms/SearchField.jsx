import React from 'react';
import { IconButton } from '../core/IconButton.jsx';

/** Input with a leading magnifier and a clear affordance. */
export function SearchField({ value, onChange, onClear, placeholder = 'Search…', style, ...rest }) {
  return (
    <div data-tc="field" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'var(--stroke) solid var(--border-input)',
      borderRadius: 'var(--radius-input)', padding: '0 10px', background: '#fff', height: 36, ...style }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
      </svg>
      <input value={value} onChange={onChange} placeholder={placeholder} style={{ flex: 1, minWidth: 0, border: 0, outline: 'none',
        fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-body)', background: 'transparent' }} {...rest} />
      {value ? <IconButton variant="plain" size={20} title="Clear" onClick={onClear}>✕</IconButton> : null}
    </div>
  );
}
