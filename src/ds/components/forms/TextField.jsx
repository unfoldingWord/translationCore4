/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { Input } from '../primitives/Input.jsx';

/** Labelled single-line text input.
 * tC4 local: an `id` goes to the Field, so the label's htmlFor reaches the
 * control (accessibility + getByLabel tests). */
export function TextField({ label, hint, invalid, id, style, ...rest }) {
  /* The old `invalid` was a boolean with no message, and it suppressed the
     field's own focus treatment — an invalid input had no focus ring at all.
     Field takes an `error` string instead, which also wires aria-invalid,
     aria-describedby and role="alert". A bare boolean can only produce the red
     border, so that is what it maps to; pass a message to gain the rest. */
  return (
    <Field label={label} hint={hint} id={id} style={style}>
      <Input invalid={invalid} {...rest} />
    </Field>
  );
}
