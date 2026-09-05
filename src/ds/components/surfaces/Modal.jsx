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

let seq = 0;

/** Centered dialog over an Ocean scrim.
 * tC4 local: `open` defaults to true (the app mounts a modal only while it is
 * open); `closeLabel` localizes the ✕ button; `zIndex` is accepted for the old
 * call sites and ignored (Layer stacks by nesting depth, then DOM order); extra
 * props (e.g. data-testid) land on the scrim, as before. */
export function Modal({ open = true, title, subtitle, width, closeLabel = 'Close', zIndex, onClose, footer, children, ...rest }) {
  void zIndex;
  const idRef = React.useRef(null);
  if (idRef.current == null) { seq += 1; idRef.current = 'tc-dlg' + seq; }
  /* Layer supplies the scrim, escape, focus trap, focus restoration, scroll
     lock and the stacking position, and it now animates in and out. The panel
     is a Surface; the padding literals 22/24/18 are the product's dialog
     rhythm and live here rather than at each call site. */
  return (
    <Layer open={!!open} level="overlay" scrim="modal" placement="center"
      role="dialog" labelledBy={idRef.current} scrimProps={rest}
      dismiss="scrim escape" trapFocus lockScroll onDismiss={onClose}>
      <Surface fill="card" radius="2xl" elevation="modal"
        style={{ width: width || 'var(--modal-w)', maxWidth: '100%', maxHeight: '82vh', overflow: 'auto' }}>
        <Stack direction="row" gap={12} align="start" style={{ padding: '22px 24px 0' }}>
          <Stack direction="column" gap={4} grow>
            <Text id={idRef.current} role="h3">{title}</Text>
            {subtitle ? <Text role="caption">{subtitle}</Text> : null}
          </Stack>
          {onClose ? <Action weight="soft" iconOnly shape="square" size="sm" tone="neutral"
            title={closeLabel} onClick={onClose} style={{ borderRadius: 'var(--radius-pill)' }}>✕</Action> : null}
        </Stack>
        <Stack direction="column" gap={16} style={{ padding: '18px 24px 4px' }}>{children}</Stack>
        {footer ? <Stack direction="row" gap={10} justify="end" style={{ padding: '18px 24px 22px' }}>{footer}</Stack> : null}
      </Surface>
    </Layer>
  );
}
