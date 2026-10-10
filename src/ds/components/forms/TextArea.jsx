/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { Input } from '../primitives/Input.jsx';

/** Multi-line entry for translator comments and draft text.
 * tC4 local: an `id` goes to the Field, so the label's htmlFor reaches the
 * control (accessibility + getByLabel tests). */
export function TextArea({ label, variant = 'ui', dir, rows = 3, id, style, ...rest }) {
  return (
    <Field label={label} id={id} style={style}>
      <Input as="textarea" variant={variant} dir={dir} rows={rows} {...rest} />
    </Field>
  );
}
