import React from 'react';
import { Overline } from '../core/Overline.jsx';

/** Native select styled to match TextField. */
export function Select({ label, options = [], value, onChange, hint, id, style, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      {label ? <Overline as="label" htmlFor={id} style={{ marginBottom: '6px' }}>{label}</Overline> : null}
      <select id={id} data-tc="field" value={value} onChange={onChange} style={{
        width: '100%', border: 'var(--stroke) solid var(--border-input)', borderRadius: 'var(--radius-input)',
        padding: '10px 12px', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)',
        color: 'var(--text-body)', background: '#fff', outline: 'none',
      }} {...rest}>
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      {hint ? <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', margin: '8px 0 0', lineHeight: 'var(--lh-ui)' }}>{hint}</p> : null}
    </div>
  );
}
