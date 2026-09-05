/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { Choice } from '../primitives/Choice.jsx';

/** Square check control for independent options inside a form. */
export function Checkbox({ checked, indeterminate, disabled, label, description, onChange, style, ...rest }) {
  const mark = <Choice mark="check" checked={checked} indeterminate={indeterminate}
    disabled={disabled} onChange={onChange} />;
  if (!label) return <span style={style} {...rest}>{mark}</span>;
  return (
    <Field label={label} hint={description} disabled={disabled} placement="end" style={style} {...rest}>
      {mark}
    </Field>
  );
}
