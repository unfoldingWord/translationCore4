/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { Choice } from '../primitives/Choice.jsx';

/** Setting switch used in side panels (page setup, export options). */
export function Toggle({ checked, onChange, label, disabled, style, ...rest }) {
  const mark = <Choice mark="switch" checked={checked} disabled={disabled} onChange={onChange} />;
  if (!label) return <span style={style} {...rest}>{mark}</span>;
  /* placement="start" is the entire difference between this row and Checkbox's —
     the thing the two old components hard-coded separately. */
  return (
    <Field label={label} disabled={disabled} placement="start" style={style} {...rest}>
      {mark}
    </Field>
  );
}
