import React from 'react';
import { useField } from './Field.jsx';

const H  = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };
const PX = { sm: 'var(--field-px-sm)', md: 'var(--field-px-md)', lg: 'var(--field-px-lg)' };
const FS = { sm: 'var(--fs-ui-sm)', md: 'var(--fs-ui-md)', lg: 'var(--fs-ui-md)' };

/**
 * The box a value is typed or picked in. It is the box only — the label, the
 * hint and the error belong to the enclosing Field, which it reads through
 * context. Wrap a native input, textarea or select, keep the height ladder, and
 * accept a glyph at either end.
 */
export function Input({
  as = 'input', variant = 'ui', size, leading, trailing, rows = 3,
  invalid: invalidProp, disabled: disabledProp, children, style, inputStyle, ...rest
}) {
  const f = useField() || {};
  const sz = size || f.size || 'md';
  const invalid = invalidProp != null ? invalidProp : f.invalid;
  const disabled = disabledProp != null ? disabledProp : f.disabled;
  const multiline = as === 'textarea';
  const scripture = variant === 'scripture';
  /* A drafting box sits beside the source column, so its leading has to be the
     same 36px grid step — text typed here lands on the same baselines it will be
     read on. */
  const Native = as;
  return (
    <div data-i={disabled ? undefined : 'field'} aria-invalid={invalid ? 'true' : undefined}
      style={{
        boxSizing: 'border-box', display: 'flex', alignItems: multiline ? 'stretch' : 'center', gap: 8,
        background: disabled ? 'var(--disabled-bg)' : (scripture ? 'var(--surface-app)' : '#fff'),
        border: 'var(--stroke) solid ' + (invalid ? 'var(--tc-invalid)' : 'var(--line-strong)'),
        borderRadius: 'var(--radius-input)', paddingInline: PX[sz],
        height: multiline ? undefined : H[sz], paddingBlock: multiline ? 10 : 0,
        ...style,
      }}>
      {leading ? <span aria-hidden="true" style={{ display: 'flex', flex: 'none', color: 'var(--fg-muted)' }}>{leading}</span> : null}
      <Native
        id={f.id} name={f.name} rows={multiline ? rows : undefined} disabled={disabled}
        aria-describedby={f.describedBy} aria-invalid={invalid ? 'true' : undefined}
        style={{
          flex: 1, minWidth: 0, width: '100%', border: 0, outline: 'none', background: 'transparent',
          padding: 0, margin: 0, appearance: as === 'select' ? undefined : 'none',
          fontFamily: scripture ? 'var(--font-scripture)' : 'var(--font-ui)',
          fontSize: scripture ? 'var(--fs-verse-lg)' : FS[sz],
          lineHeight: scripture ? 'var(--lh-verse-lg)' : 'var(--lh-ui)',
          color: scripture ? 'var(--text-scripture)' : 'var(--fg)',
          resize: multiline ? 'vertical' : undefined,
          cursor: disabled ? 'default' : undefined,
          ...inputStyle,
        }}
        {...rest}
      >{children}</Native>
      {trailing ? <span style={{ display: 'flex', flex: 'none' }}>{trailing}</span> : null}
    </div>
  );
}
