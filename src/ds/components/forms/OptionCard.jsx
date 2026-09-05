/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Choice } from '../primitives/Choice.jsx';
import { Badge } from '../core/Badge.jsx';

/** Full-width selectable row with title, description and optional radio or icon tile.
 * tC4 local: `recommendedLabel` localizes the Recommended badge. */
export function OptionCard({ selected, control = 'none', icon, title, description, meta, recommended, recommendedLabel = 'Recommended', trailing, onClick, style, ...rest }) {
  return (
    <Surface as="button" tone="accent" interactive="choice" border="choice" selected={selected}
      radius="md" onClick={onClick}
      style={{ width: '100%', padding: '14px 16px', textAlign: 'start', cursor: 'pointer', font: 'inherit', ...style }} {...rest}>
      <Stack direction="row" gap={12} align={control === 'radio' ? 'start' : 'center'}>
        {control === 'radio' ? <Choice mark="radio" checked={selected} /> : null}
        {icon ? (
          <Surface fill="soft" radius="md" style={{ width: 42, height: 42, flex: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Text role="labelMicro" tone="accent">{icon}</Text>
          </Surface>
        ) : null}
        <Stack direction="column" gap={3} grow>
          <Stack direction="row" gap={8} align="center" wrap>
            <Text role="strong">{title}</Text>
            {recommended ? <Badge tone="accentSoft" size="sm">{recommendedLabel}</Badge> : null}
          </Stack>
          {description ? <Text role="caption">{description}</Text> : null}
          {meta ? <Text role="meta">{meta}</Text> : null}
        </Stack>
        {/* tC4 local: not aria-hidden — the app's trailing slot carries an
            "Always included" badge and installed counts, part of the row's name. */}
        {trailing ? <Text role="ui" tone="muted">{trailing}</Text> : null}
      </Stack>
    </Surface>
  );
}
