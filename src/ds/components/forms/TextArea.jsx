import React from 'react';
import { Overline } from '../core/Overline.jsx';

/** Multi-line entry. Defaults to UI type; `variant="scripture"` renders Charis SIL at
    reading size and is required for any box holding translated text. */
export function TextArea({ label, variant = 'ui', rows = 3, dir, value, onChange, placeholder, style, ...rest }) {
  const serif = variant === 'scripture';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      {label ? <Overline as="label" style={{ marginBottom: '6px' }}>{label}</Overline> : null}
      <textarea data-tc="field" rows={rows} dir={dir} value={value} onChange={onChange} placeholder={placeholder} style={{
        width: '100%', boxSizing: 'border-box', border: 'var(--stroke) solid var(--border-input)',
        borderRadius: 'var(--radius-input)', padding: '11px 13px', outline: 'none', resize: 'vertical',
        fontFamily: serif ? 'var(--font-scripture)' : 'var(--font-ui)',
        fontSize: serif ? 'var(--fs-verse-sm)' : 'var(--fs-ui-md)',
        lineHeight: serif ? 'var(--lh-verse-sm)' : 'var(--lh-body)',
        color: serif ? 'var(--text-scripture)' : 'var(--text-body)', background: 'var(--surface-app)',
      }} {...rest} />
    </div>
  );
}
