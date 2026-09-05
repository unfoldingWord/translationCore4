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

/** Confirmation dialog for irreversible actions. */
export function ConfirmDialog({ open, title, description, consequence, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, onConfirm, onCancel }) {
  const idRef = React.useRef(null);
  if (idRef.current == null) { seq += 1; idRef.current = 'tc-cfm' + seq; }
  /* Two things this could not express before. `Button variant="danger"` was
     white with red text, so the old component overrode it inline to get a
     filled red one; weight and tone are independent now, so
     `weight="fill" tone="invalid"` is a legal combination. And dismissal is
     escape only — no scrim click — so a stray backdrop click cannot cancel
     something consequential, which the old one allowed. */
  return (
    <Layer open={!!open} level="overlay" scrim="modal" placement="center"
      role="alertdialog" labelledBy={idRef.current}
      dismiss="escape" trapFocus lockScroll onDismiss={onCancel}>
      <Surface fill="card" radius="2xl" elevation="modal" style={{ width: 'var(--modal-w-sm)', maxWidth: '100%' }}>
        <Stack direction="column" gap={16} style={{ padding: 24 }}>
          <Stack direction="column" gap={5}>
            <Text id={idRef.current} role="h3">{title}</Text>
            {description ? <Text role="caption">{description}</Text> : null}
          </Stack>
          {consequence ? (
            <Surface tone="warn" fill="soft" border="tone" radius="lg" pad="sm">
              <Text role="caption" tone="tone">{consequence}</Text>
            </Surface>
          ) : null}
          <Stack direction="row" gap={10} justify="end">
            <Action weight="quiet" tone="neutral" onClick={onCancel}>{cancelLabel}</Action>
            <Action weight="fill" tone={destructive ? 'invalid' : 'accent'} onClick={onConfirm}>{confirmLabel}</Action>
          </Stack>
        </Stack>
      </Surface>
    </Layer>
  );
}
