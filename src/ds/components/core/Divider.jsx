/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Rule } from '../primitives/Rule.jsx';

/** Hairline rule between groups. */
export function Divider({ orientation = 'horizontal', label, inverse: _inverse, style, ...rest }) {
  /* `inverse` is unnecessary now — Rule reads --line from the surface context,
     so a rule inside a data-on="dark" container is already correct. Accepted
     and ignored rather than removed, so old call sites do not break. */
  return <Rule orientation={orientation} label={label} style={style} {...rest} />;
}
