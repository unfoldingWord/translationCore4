/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Progress } from '../primitives/Progress.jsx';

/** Book button with its drafting progress. */
export function BookTile({ name, percent = 0, meta, layout = 'tile', active, onClick, style, ...rest }) {
  const row = layout === 'row';
  return (
    <Surface as="button" tone="accent" interactive={row ? 'row' : 'choice'} selected={active}
      border={row ? 'none' : 'line'} fill={row ? 'none' : 'app'} radius="md" onClick={onClick}
      style={{ padding: '10px 12px', width: row ? '100%' : undefined,
               textAlign: 'start', cursor: 'pointer', font: 'inherit', ...style }} {...rest}>
      <Stack direction="row" gap={6} justify="between" align="baseline" style={{ marginBottom: row ? 7 : 8 }}>
        <Text role="ui" truncate style={{ fontSize: row ? 'var(--fs-ui-md)' : 'var(--fs-ui)' }}>{name}</Text>
        <Text role="labelNum">{meta != null ? meta : percent + '%'}</Text>
      </Stack>
      <Progress value={percent} height={row ? 5 : 4} />
    </Surface>
  );
}
