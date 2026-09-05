/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { FieldGroup } from '../primitives/FieldGroup.jsx';
import { Choice } from '../primitives/Choice.jsx';

/** Circular single-choice control. */
export function Radio({ checked, disabled, label, description, onChange, name, value, style, ...rest }) {
  const mark = <Choice mark="radio" checked={checked} disabled={disabled}
    name={name} value={value} onChange={onChange} />;
  if (!label) return <span style={style} {...rest}>{mark}</span>;
  return (
    <Field label={label} hint={description} disabled={disabled} placement="end" style={style} {...rest}>
      {mark}
    </Field>
  );
}

let gseq = 0;

/** Vertical radio set sharing one value. */
export function RadioGroup({ options = [], value, onChange, legend, style, ...rest }) {
  /* The old component had no role="radiogroup", no fieldset and no group label,
     so a screen reader announced each option without ever saying what the
     choice was for. FieldGroup supplies all three. `legend` is new and
     optional — without it the group is still unnamed, which is why the
     migration guide asks you to add one. */
  const nameRef = React.useRef(null);
  if (nameRef.current == null) { gseq += 1; nameRef.current = 'tc-rg' + gseq; }
  return (
    <FieldGroup legend={legend} role="radiogroup" name={nameRef.current} style={style} {...rest}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        const d = typeof o === 'string' ? undefined : o.description;
        return (
          <Field key={v} label={l} hint={d} placement="end" id={nameRef.current + '-' + v}>
            <Choice mark="radio" value={v} checked={value === v} onChange={() => onChange && onChange(v)} />
          </Field>
        );
      })}
    </FieldGroup>
  );
}
