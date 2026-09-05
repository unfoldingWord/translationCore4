/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';

/** Grid of small labelled facts. */
export function KeyValueGrid({ items = [], columns = 2, style, ...rest }) {
  return (
    <Stack columns={columns} gap={10} style={style} {...rest}>
      {items.map((it, i) => (
        <Surface key={i} border="line" radius="md" pad="10px 12px">
          <Text role="label" as="div" style={{ marginBottom: 3 }}>{it.k}</Text>
          <Text role="strong" style={{ fontSize: 'var(--fs-ui-sm)' }}>{it.v}</Text>
        </Surface>
      ))}
    </Stack>
  );
}
