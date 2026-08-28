import React from 'react';

/** Single circular radio. For a full labelled set use RadioGroup. */
export function Radio({ checked, disabled, label, description, onChange, style, ...rest }) {
  const dot = (
    <span style={{ width: 18, height: 18, flex: 'none', borderRadius: 'var(--radius-pill)',
      border: 'var(--stroke-control) solid ' + (checked ? 'var(--accent)' : 'var(--border-strong)'),
      background: disabled ? 'var(--disabled-bg)' : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'border-color var(--dur-hover) var(--ease-standard)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: checked ? 'var(--accent)' : 'transparent' }} />
    </span>
  );
  if (!label) return <span onClick={disabled ? undefined : onChange} style={{ cursor: disabled ? 'default' : 'pointer', ...style }} {...rest}>{dot}</span>;
  return (
    <label onClick={disabled ? undefined : onChange} style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
      cursor: disabled ? 'default' : 'pointer', ...style }} {...rest}>
      {dot}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-bold)', color: disabled ? 'var(--text-tertiary)' : 'var(--text-body)', lineHeight: 1.3 }}>{label}</span>
        {description ? <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', lineHeight: 'var(--lh-ui)' }}>{description}</span> : null}
      </span>
    </label>
  );
}

/** Vertical set of radios sharing one value. */
export function RadioGroup({ options = [], value, onChange, style }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
    {options.map(o => {
      const v = typeof o === 'string' ? o : o.value;
      return <Radio key={v} checked={v === value} label={typeof o === 'string' ? o : o.label}
        description={typeof o === 'string' ? undefined : o.description} onChange={() => onChange && onChange(v)} />;
    })}
  </div>;
}
