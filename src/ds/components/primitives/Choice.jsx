import React from 'react';
import { useField } from './Field.jsx';

const HIDDEN = { position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0,
  opacity: 0, cursor: 'pointer', zIndex: 1 };

/**
 * A binary or exclusive mark backed by a real input. The drawn mark is a sibling
 * of a transparent native control, so the browser supplies the value, the
 * keyboard, the form and the accessibility tree, and the system supplies only
 * the appearance.
 */
export function Choice({
  mark = 'check', checked, indeterminate, disabled: disabledProp, tone = 'accent',
  value, name, onChange, style, ...rest
}) {
  const f = useField() || {};
  const disabled = disabledProp != null ? disabledProp : f.disabled;
  const on = !!checked || !!indeterminate;
  const type = mark === 'radio' ? 'radio' : 'checkbox';
  const box = {
    check: {
      width: 18, height: 18, borderRadius: 'var(--radius-xs)',
      border: 'var(--stroke-control) solid ' + (on ? 'var(--tone-border)' : 'var(--border-strong)'),
      background: on ? 'var(--tone-fill)' : '#fff', color: 'var(--tone-on-fill)',
    },
    radio: {
      width: 18, height: 18, borderRadius: 'var(--radius-pill)',
      border: 'var(--stroke-control) solid ' + (on ? 'var(--tone-border)' : 'var(--border-strong)'),
      background: '#fff',
    },
    switch: {
      width: 34, height: 20, borderRadius: 'var(--radius-pill)',
      background: on ? 'var(--tone-fill)' : 'var(--uw-mist)', position: 'relative',
    },
  }[mark];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none',
      cursor: disabled ? 'default' : 'pointer', ...style }}>
      <input data-choice-input type={type} role={mark === 'switch' ? 'switch' : undefined}
        id={f.id} name={name || f.name} value={value} checked={!!checked} disabled={disabled}
        aria-describedby={f.describedBy} aria-invalid={f.invalid ? 'true' : undefined}
        ref={el => { if (el) el.indeterminate = !!indeterminate; }}
        onChange={onChange} style={HIDDEN} {...rest} />
      <span data-choice aria-hidden="true" data-tone={tone} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
        fontSize: 11, fontWeight: 'var(--fw-black)', lineHeight: 1,
        transition: 'background var(--dur-hover) var(--ease-standard), border-color var(--dur-hover) var(--ease-standard)',
        ...box,
      }}>
        {mark === 'check' ? (indeterminate ? '\u2013' : (checked ? '\u2713' : '')) : null}
        {mark === 'radio' ? <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)',
          background: on ? 'var(--tone-fill)' : 'transparent' }} /> : null}
        {mark === 'switch' ? <span style={{ position: 'absolute', top: 2, insetInlineStart: on ? 16 : 2,
          width: 16, height: 16, borderRadius: 'var(--radius-pill)', background: '#fff',
          transition: 'inset-inline-start var(--dur-hover) var(--ease-standard)' }} /> : null}
      </span>
    </span>
  );
}
