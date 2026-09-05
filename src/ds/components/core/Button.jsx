/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Action } from '../primitives/Action.jsx';

/* The seven variants were a single enum over what are really two independent
   axes. That is why `danger` could only ever be white-with-red-text: there was
   no way to say "filled" and "destructive" at once. Now there is —
   <Action weight="fill" tone="invalid"> — but this map preserves the old looks. */
const VARIANT = {
  primary:   { weight: 'fill',    tone: 'accent'  },
  ocean:     { weight: 'fill',    tone: 'ocean'   },
  secondary: { weight: 'quiet',   tone: 'neutral' },
  outline:   { weight: 'outline', tone: 'ocean'   },
  ghost:     { weight: 'text',    tone: 'accent'  },
  valid:     { weight: 'fill',    tone: 'valid'   },
  danger:    { weight: 'outline', tone: 'invalid' },
};

/** Pill action button. Primary = Inspire fill; everything else steps down from it. */
export function Button({ variant = 'primary', size = 'md', shape = 'pill', disabled, children, onClick, style, ...rest }) {
  const v = VARIANT[variant] || VARIANT.primary;
  return <Action weight={v.weight} tone={v.tone} size={size} shape={shape}
    disabled={disabled} onClick={onClick} style={style} {...rest}>{children}</Action>;
}
