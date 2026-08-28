import React from 'react';
import { Text } from './Text.jsx';
import { Stack } from './Stack.jsx';

/* Every control inside a Field reads its id, its described-by list and its
   invalid flag from here, so the label, the hint and the error are wired to the
   control without the caller passing anything. */
export const FieldContext = React.createContext(null);
export function useField() { return React.useContext(FieldContext); }

let seq = 0;
function useId(given) {
  const ref = React.useRef(null);
  if (ref.current == null) { seq += 1; ref.current = given || 'tc-f' + seq; }
  return given || ref.current;
}

function ErrorGlyph() {
  return <span aria-hidden="true" style={{ width: 14, height: 14, flex: 'none', marginTop: 1,
    borderRadius: 'var(--radius-pill)', border: 'var(--stroke-selected) solid currentColor',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 'var(--fw-black)', lineHeight: 1 }}>!</span>;
}

/**
 * The chrome and the wiring around one control: label, required marker, hint,
 * error. It does not know or care what the control is — it supplies the ids and
 * the ARIA relationships through context, so the control stays a bare box.
 */
export function Field({
  label, hint, error, required, optional, disabled, size = 'md',
  placement = 'above', id: givenId, name, children, style, ...rest
}) {
  const id = useId(givenId);
  const hintId = hint ? id + '-hint' : null;
  const errId = error ? id + '-err' : null;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  const ctx = { id, describedBy, invalid: !!error, disabled, size, name };

  const labelNode = label ? (
    <Text as="label" htmlFor={id} role={placement === 'above' ? 'overline' : 'ui'}
      tone={disabled ? 'faint' : (placement === 'above' ? 'muted' : 'default')}
      style={{ cursor: disabled ? 'default' : 'pointer' }}>
      {label}
      {required ? <span aria-hidden="true" style={{ color: 'var(--tc-invalid)', marginInlineStart: 3 }}>*</span> : null}
      {optional ? <span style={{ color: 'var(--fg-faint)', marginInlineStart: 5, textTransform: 'none', letterSpacing: 0 }}>optional</span> : null}
    </Text>
  ) : null;

  const hintNode = hint ? <Text id={hintId} role="caption" tone="muted">{hint}</Text> : null;
  const errNode = error ? (
    <Text id={errId} role="captionStrong" as="p" data-tone="invalid" tone="tone"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <ErrorGlyph />
      <span role="alert">{error}</span>
    </Text>
  ) : null;

  const body = <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>;

  if (placement === 'end' || placement === 'start') {
    const row = placement === 'end'
      ? <React.Fragment>{body}<Stack direction="column" gap={2}>{labelNode}{hintNode}</Stack></React.Fragment>
      : <React.Fragment><Stack direction="column" gap={2} grow>{labelNode}{hintNode}</Stack>{body}</React.Fragment>;
    return (
      <Stack direction="column" gap={6} style={style} {...rest}>
        <Stack direction="row" gap={10} align={hint ? 'start' : 'center'} justify={placement === 'start' ? 'between' : undefined}>{row}</Stack>
        {errNode}
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap={6} style={style} {...rest}>
      {labelNode}{body}{hintNode}{errNode}
    </Stack>
  );
}
