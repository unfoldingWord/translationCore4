/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Progress } from '../primitives/Progress.jsx';

/* The old component injected a <style> element into the DOM on every render of
   every instance to define its keyframes. They live in tokens/states.css now,
   defined once, and Progress carries role="progressbar" and aria-busy, which
   this had neither of. */

/** Activity indicator for network waits with no known duration. */
export function Spinner({ size = 18, tone = 'accent', label, style, ...rest }) {
  /* `inverse` is gone: on a data-on="dark" container --tone reads correctly
     without being told. It maps to neutral, which is translucent white there. */
  return <Progress shape="ring" value={null} size={size}
    tone={tone === 'inverse' ? 'neutral' : tone} label={label} style={style} {...rest} />;
}
