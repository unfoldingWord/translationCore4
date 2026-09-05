import React from 'react';
import { useField } from './Field.jsx';
import { useFieldGroup } from './FieldGroup.jsx';

const HIDDEN = { position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0,
  opacity: 0, cursor: 'pointer', zIndex: 1 };

/**
 * A binary or exclusive mark backed by a real input. The drawn mark is a sibling
 * of a transparent native control, so the browser supplies the value, the
 * keyboard, the form and the accessibility tree, and the system supplies only
 * the appearance.
 */
export function Choice({
  mark = 'check', size = 'md', checked, indeterminate, disabled: disabledProp, tone = 'accent',
  value, name, onChange, style, ...rest
}) {
  const f = useField() || {};
  const g = useFieldGroup() || {};
  const disabled = disabledProp != null ? disabledProp : (f.disabled != null ? f.disabled : g.disabled);
  const on = !!checked || !!indeterminate;
  const type = mark === 'radio' ? 'radio' : 'checkbox';
  /* Three sizes, because a checkbox in a dense table row and one sized to a 44px
     touch target are both real and neither could be reached before: `style` on
     Choice lands on the wrapper, not on the drawn mark inside it. `lg` is a 24px
     mark inside a 44px hit area rather than a 44px box, which would be a
     cartoon. AUDIT.md CANNOT-EXPRESS #9. */
  const sz = { sm: 15, md: 18, lg: 24 }[size] || 18;
  const sw = { sm: 28, md: 34, lg: 44 }[size] || 34;   /* switch track width */
  const sh = { sm: 17, md: 20, lg: 26 }[size] || 20;   /* switch track height */
  const knob = sh - 4;
  const hit = size === 'lg' ? 'var(--control-h-lg)' : undefined;
  const box = {
    check: {
      width: sz, height: sz, borderRadius: size === 'sm' ? 'var(--radius-xs)' : 'var(--radius-xs)',
      border: 'var(--stroke-control) solid ' + (on ? 'var(--tone-border)' : 'var(--border-strong)'),
      background: on ? 'var(--tone-fill)' : '#fff', color: 'var(--tone-on-fill)',
      fontSize: Math.round(sz * 0.62),
    },
    radio: {
      width: sz, height: sz, borderRadius: 'var(--radius-pill)',
      border: 'var(--stroke-control) solid ' + (on ? 'var(--tone-border)' : 'var(--border-strong)'),
      background: '#fff',
    },
    switch: {
      width: sw, height: sh, borderRadius: 'var(--radius-pill)',
      background: on ? 'var(--tone-fill)' : 'var(--uw-mist)', position: 'relative',
    },
  }[mark];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none',
      alignItems: 'center', justifyContent: 'center',
      minWidth: hit, minHeight: hit,
      cursor: disabled ? 'default' : 'pointer', ...style }}>
      <input data-choice-input type={type} role={mark === 'switch' ? 'switch' : undefined}
        id={f.id} name={name || f.name || g.name} value={value} checked={!!checked} disabled={disabled}
        aria-describedby={f.describedBy} aria-invalid={(f.invalid || g.invalid) ? 'true' : undefined}
        ref={el => { if (el) el.indeterminate = !!indeterminate; }}
        onChange={onChange}
        /* A Choice with no onChange is a legal display-only mark, and React
           warns about a controlled input without a handler. readOnly says what
           is actually true instead of making every such call site noisy. */
        readOnly={onChange ? undefined : true}
        style={HIDDEN} {...rest} />
      <span data-choice aria-hidden="true" data-tone={tone} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
        fontWeight: 'var(--fw-black)', lineHeight: 1,
        transition: 'background var(--dur-hover) var(--ease-standard), border-color var(--dur-hover) var(--ease-standard)',
        ...box,
      }}>
        {mark === 'check' ? (indeterminate ? '\u2013' : (checked ? '\u2713' : '')) : null}
        {mark === 'radio' ? <span style={{ width: Math.round(sz * 0.45), height: Math.round(sz * 0.45), borderRadius: 'var(--radius-pill)',
          background: on ? 'var(--tone-fill)' : 'transparent' }} /> : null}
        {mark === 'switch' ? <span style={{ position: 'absolute', top: 2, insetInlineStart: on ? sw - knob - 2 : 2,
          width: knob, height: knob, borderRadius: 'var(--radius-pill)', background: '#fff',
          transition: 'inset-inline-start var(--dur-hover) var(--ease-standard)' }} /> : null}
      </span>
    </span>
  );
}
