/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';

/* Four tones were two colour values each, both of which are tone slots now.
   `kindle` and `warn` were two near-identical creams for the same advisory
   meaning; both resolve to the warn tint #FCF6EA. That is a visible change to
   the kindle callout, taken deliberately — see readme caveat and AUDIT.md. */
const TONE = {
  warn:    { tone: 'warn',  border: 'tone' },
  kindle:  { tone: 'warn' },
  success: { tone: 'valid' },
  info:    { fill: 'app', border: 'line' },
};

/** Inline notice block explaining a consequence or state.
 * tC4 local: the inner Text is a `display: contents` div, so a layout the caller
 * puts on the callout (`style={{ display: 'flex' }}` with a text span and a
 * button) reaches the children, as it did when they were the callout's direct
 * children. Type and colour still come from the Text role. */
export function Callout({ tone = 'info', children, style, ...rest }) {
  const t = TONE[tone] || TONE.info;
  return (
    <Surface tone={t.tone} fill={t.fill || 'soft'} border={t.border} radius="lg" pad="sm" style={style} {...rest}>
      <Text as="div" role="caption" tone={t.tone ? 'tone' : 'muted'} style={{ display: 'contents' }}>{children}</Text>
    </Surface>
  );
}
