/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Text } from '../primitives/Text.jsx';

/* `inverse` is gone from the system: a container declares its ground with
   data-on="dark" and Text reads --fg-muted from it. The prop is honoured here
   so old call sites keep working, but it maps to the muted role either way —
   on a dark ground that resolves to white at 60%, which is what it always was. */
const TONE = { muted: 'muted', accent: 'accent', inverse: 'muted' };

/** Tracked-out uppercase micro-heading — the system's universal label. */
export function Overline({ tone = 'muted', as = 'span', children, style, ...rest }) {
  return <Text role="overline" as={as} tone={TONE[tone] || 'muted'}
    style={{ display: 'block', ...style }} {...rest}>{children}</Text>;
}
