import React from 'react';
import { Overline } from '../core/Overline.jsx';

/** Labelled single-line input. The label is always an Overline above the field. */
export function TextField({ label, hint, value, onChange, placeholder, invalid, id, style, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      {label ? <Overline as="label" htmlFor={id} style={{ marginBottom: '6px' }}>{label}</Overline> : null}
      <input id={id} data-tc={invalid ? undefined : 'field'} value={value} onChange={onChange} placeholder={placeholder} style={{
        width: '100%', border: 'var(--stroke) solid ' + (invalid ? 'var(--tc-invalid)' : 'var(--border-input)'),
        borderRadius: 'var(--radius-input)', padding: '10px 12px', fontFamily: 'var(--font-ui)',
        fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', color: 'var(--text-body)', background: '#fff', outline: 'none',
      }} {...rest} />
      {hint ? <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', margin: '8px 0 0', lineHeight: 'var(--lh-ui)' }}>{hint}</p> : null}
    </div>
  );
}
