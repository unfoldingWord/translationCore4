import React from 'react';

/** Square check control. 18px box, Inspire fill when checked. */
export function Checkbox({ checked, indeterminate, disabled, label, description, onChange, style, ...rest }) {
  const box = (
    <span style={{
      width: 18, height: 18, flex: 'none', borderRadius: 'var(--radius-xs)',
      border: 'var(--stroke-control) solid ' + (checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)'),
      background: disabled ? 'var(--disabled-bg)' : (checked || indeterminate ? 'var(--accent)' : '#fff'),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: 11, fontWeight: 'var(--fw-black)', lineHeight: 1,
      transition: 'background var(--dur-hover) var(--ease-standard), border-color var(--dur-hover) var(--ease-standard)',
    }}>{indeterminate ? '–' : (checked ? '✓' : '')}</span>
  );
  if (!label) return <span onClick={disabled ? undefined : onChange} style={{ cursor: disabled ? 'default' : 'pointer', ...style }} {...rest}>{box}</span>;
  return (
    <label onClick={disabled ? undefined : onChange} style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
      cursor: disabled ? 'default' : 'pointer', ...style }} {...rest}>
      {box}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-bold)', color: disabled ? 'var(--text-tertiary)' : 'var(--text-body)', lineHeight: 1.3 }}>{label}</span>
        {description ? <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', lineHeight: 'var(--lh-ui)' }}>{description}</span> : null}
      </span>
    </label>
  );
}
