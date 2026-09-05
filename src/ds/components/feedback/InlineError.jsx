/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Text } from '../primitives/Text.jsx';

/* Not a thing you place — a state of a field. `<Field error="…">` is the
   replacement, and it also wires aria-invalid, aria-describedby and
   role="alert", none of which this had. */

/** Error message attached to a single form field. */
export function InlineError({ children, style, ...rest }) {
  return (
    <Text role="captionStrong" as="p" data-tone="invalid" tone="tone"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, ...style }} {...rest}>
      <span aria-hidden="true" style={{ width: 14, height: 14, flex: 'none', marginTop: 1,
        borderRadius: 'var(--radius-pill)', border: 'var(--stroke-selected) solid currentColor',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 'var(--fw-black)', lineHeight: 1 }}>!</span>
      <span role="alert">{children}</span>
    </Text>
  );
}
