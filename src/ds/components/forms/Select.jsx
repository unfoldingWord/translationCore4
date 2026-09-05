/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Field } from '../primitives/Field.jsx';
import { Input } from '../primitives/Input.jsx';

/** Native dropdown for long enumerations (books, script fonts).
 * tC4 local: an `id` goes to the Field, so the label's htmlFor reaches the
 * control; an option object may carry `disabled`. */
export function Select({ label, options = [], hint, id, children, style, ...rest }) {
  return (
    <Field label={label} hint={hint} id={id} style={style}>
      <Input as="select" {...rest}>
        {children || options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          const d = typeof o === 'string' ? undefined : o.disabled;
          return <option key={v} value={v} disabled={d}>{l}</option>;
        })}
      </Input>
    </Field>
  );
}
