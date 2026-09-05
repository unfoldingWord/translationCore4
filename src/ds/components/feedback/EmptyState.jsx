/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';

/** Empty list, empty filter or empty panel. */
export function EmptyState({ title, description, action, variant = 'block', style, ...rest }) {
  if (variant === 'inline') {
    return <Text role="caption" style={{ fontStyle: 'italic', margin: '6px 2px', ...style }} {...rest}>{title || description}</Text>;
  }
  return (
    <Surface border="dashed" radius="xl" pad="38px 24px" style={style} {...rest}>
      <Stack direction="column" gap={6} align="center">
        {title ? <Text role="titleSm">{title}</Text> : null}
        {description ? <Text role="caption" align="center" measure="narrow">{description}</Text> : null}
        {action ? <span style={{ marginTop: 10 }}>{action}</span> : null}
      </Stack>
    </Surface>
  );
}
