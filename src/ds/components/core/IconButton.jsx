/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Action } from '../primitives/Action.jsx';

const VARIANT = {
  outline: { weight: 'quiet', shape: 'square' },
  muted:   { weight: 'soft',  shape: 'square', radius: 'var(--radius-pill)' },
  plain:   { weight: 'text',  shape: 'square' },
};

/** Square icon-only button: rail/panel toggles, modal close. */
export function IconButton({ variant = 'outline', size, title, children, onClick, style, ...rest }) {
  const v = VARIANT[variant] || VARIANT.outline;
  /* The old `size` was a raw number (20, 28, 32) and three of the four values
     in use are off the control height ladder, so it stays an explicit box
     rather than being rounded onto `size="sm"`. */
  const box = size ? { width: size, height: size, minWidth: size } : null;
  return <Action weight={v.weight} tone="neutral" iconOnly shape="square"
    size={size && size <= 28 ? 'sm' : 'md'} title={title} onClick={onClick}
    style={{ ...(v.radius ? { borderRadius: v.radius } : null), ...box, ...style }} {...rest}>{children}</Action>;
}
