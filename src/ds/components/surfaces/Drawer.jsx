/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Layer } from '../primitives/Layer.jsx';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Action } from '../primitives/Action.jsx';

/** End-edge slide-over panel for reference content.
 * tC4 local: `open` defaults to true (the app mounts the drawer only while it
 * is open); extra props (e.g. data-testid) land on the scrim, as before. */
export function Drawer({ open = true, eyebrow, title, width, onClose, children, ...rest }) {
  /* It now actually slides: Layer reads --dur-panel, which existed in
     tokens/motion.css and nothing had ever read. The old component appeared. */
  return (
    <Layer open={!!open} level="overlay" scrim="drawer" placement="end"
      role="dialog" label={typeof title === 'string' ? title : 'Panel'} scrimProps={rest}
      dismiss="scrim escape" trapFocus lockScroll onDismiss={onClose}>
      <Surface fill="card" radius="none" elevation="drawer"
        style={{ width: width || 'var(--drawer-w)', maxWidth: '100%', height: '100%',
                 display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" gap={12} justify="between" align="start"
          style={{ padding: '20px 24px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)' }}>
          <Stack direction="column" gap={6}>
            {eyebrow ? <Text role="overline" tone="accent">{eyebrow}</Text> : null}
            <Text role="h2">{title}</Text>
          </Stack>
          {onClose ? <Action weight="soft" iconOnly shape="square" size="sm" tone="neutral"
            title="Close" onClick={onClose} style={{ borderRadius: 'var(--radius-pill)' }}>✕</Action> : null}
        </Stack>
        <Stack direction="column" gap={14} style={{ padding: 24, flex: 1, overflow: 'auto' }}>{children}</Stack>
      </Surface>
    </Layer>
  );
}
