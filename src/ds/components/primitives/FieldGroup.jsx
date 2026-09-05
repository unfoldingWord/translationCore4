import React from 'react';
import { Text } from './Text.jsx';
import { Stack } from './Stack.jsx';

/* Field labels ONE control. A set of radios sharing a name is a group to the
   browser, but it had no role="radiogroup", no <fieldset>, no group label and no
   group-level error — so a screen reader announced "Literal text (ULT), radio
   button, 1 of 2" without ever saying what the choice was for. Every
   multi-option question in every form had that defect, and the composition read
   as complete, which was the dangerous part. AUDIT.md CANNOT-EXPRESS #6. */

export const FieldGroupContext = React.createContext(null);
export function useFieldGroup() { return React.useContext(FieldGroupContext); }

let gseq = 0;

function ErrorGlyph() {
  return <span aria-hidden="true" style={{ width: 14, height: 14, flex: 'none', marginTop: 1,
    borderRadius: 'var(--radius-pill)', border: 'var(--stroke-selected) solid currentColor',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 'var(--fw-black)', lineHeight: 1 }}>!</span>;
}

/**
 * A set of controls answering one question: legend, group hint, group-level
 * error, and the shared `name` handed down through context so each Choice
 * inside does not repeat it. A real `<fieldset>`, because that is what carries
 * the legend to assistive technology.
 */
export function FieldGroup({
  legend, hint, error, required, disabled, name, role = 'group',
  direction = 'column', gap = 10, columns, children, style, ...rest
}) {
  const idRef = React.useRef(null);
  if (idRef.current == null) { gseq += 1; idRef.current = 'tc-g' + gseq; }
  const id = idRef.current;
  const hintId = hint ? id + '-hint' : null;
  const errId = error ? id + '-err' : null;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset disabled={disabled}
      style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0, ...style }} {...rest}>
      <Stack direction="column" gap={8}>
        {legend ? (
          <legend style={{ padding: 0, float: 'none' }}>
            <Text role="overline" tone={disabled ? 'faint' : 'muted'}>
              {legend}
              {required ? <span aria-hidden="true" style={{ color: 'var(--tc-invalid)', marginInlineStart: 3 }}>*</span> : null}
            </Text>
          </legend>
        ) : null}
        {hint ? <Text id={hintId} role="caption" tone="muted">{hint}</Text> : null}
        {/* role and aria live on an inner div: a fieldset with role="radiogroup"
            loses its own legend association in several screen readers. */}
        <div role={role} aria-labelledby={legend ? undefined : rest['aria-labelledby']}
          aria-label={legend ? undefined : rest['aria-label']}
          aria-describedby={describedBy} aria-invalid={error ? 'true' : undefined}
          aria-required={required ? 'true' : undefined}>
          <FieldGroupContext.Provider value={{ name, disabled, invalid: !!error, describedBy }}>
            <Stack direction={direction} gap={gap} columns={columns}>{children}</Stack>
          </FieldGroupContext.Provider>
        </div>
        {error ? (
          <Text id={errId} role="captionStrong" as="p" data-tone="invalid" tone="tone"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <ErrorGlyph />
            <span role="alert">{error}</span>
          </Text>
        ) : null}
      </Stack>
    </fieldset>
  );
}
