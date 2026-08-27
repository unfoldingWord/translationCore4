import React from 'react';
/** 34×20 switch. On is Inspire, off is mist. Never animates beyond the 150ms slide. */
export function Toggle({ checked, onChange, label, disabled, style }) {
  const sw = (
    <span onClick={disabled ? undefined : onChange} style={{
      width: 34, height: 20, borderRadius: 'var(--radius-pill)', position: 'relative', flex: 'none',
      background: checked ? 'var(--accent)' : 'var(--uw-mist)', cursor: disabled ? 'default' : 'pointer',
      transition: 'background var(--dur-hover) var(--ease-standard)',
    }}>
      <span style={{ position: 'absolute', top: 2, insetInlineStart: checked ? 16 : 2, width: 16, height: 16,
        borderRadius: 'var(--radius-pill)', background: '#fff',
        transition: 'inset-inline-start var(--dur-hover) var(--ease-standard)' }} />
    </span>
  );
  if (!label) return sw;
  return <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
    fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: disabled ? 'var(--text-tertiary)' : 'var(--text-body)', ...style }}>
    <span>{label}</span>{sw}</label>;
}
