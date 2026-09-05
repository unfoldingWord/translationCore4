/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';

/* The five statuses were a colour map; four are tone names and `todo` is the
   palette's black, which is not a tone and stays a token reference. */
const TONE = { valid: 'valid', invalid: 'invalid', warn: 'warn', accent: 'accent' };

/** Round state pip for checking items, save state and conflict rows. */
export function StatusDot({ status = 'valid', size = 9, label, style, ...rest }) {
  const tone = TONE[status];
  const pip = <span aria-hidden="true" style={{ width: size, height: size, flex: 'none',
    borderRadius: 'var(--radius-pill)', background: tone ? 'var(--tone)' : 'var(--tc-todo)' }} />;
  if (!label) return <span data-tone={tone} style={{ display: 'inline-flex', ...style }} {...rest}>{pip}</span>;
  return (
    <Stack direction="row" gap={6} align="center" data-tone={tone} style={style} {...rest}>
      {pip}<Text role="captionStrong">{label}</Text>
    </Stack>
  );
}
