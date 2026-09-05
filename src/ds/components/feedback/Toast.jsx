/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Action } from '../primitives/Action.jsx';

/* Four tones differed only in two colour values, both of which are tone slots
   now. The queue — adding, timing out, capping the stack — is application
   policy and is not here; the product's policy is written in the readme. */
const TONE = { success: 'valid', info: 'accent', warn: 'warn', error: 'invalid' };

/** Transient confirmation. States what happened, in the past tense. */
export function Toast({ tone = 'success', message, action, actionLabel, onDismiss, style, ...rest }) {
  const t = TONE[tone] || 'valid';
  return (
    <Surface tone={t} fill="card" border="line" radius="lg" elevation="hover" style={style} {...rest}>
      <Stack direction="row" gap={11} align="center" role="status"
        style={{ padding: '12px 14px', minWidth: 'var(--toast-w-min)', maxWidth: 'var(--toast-w-max)' }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 'var(--radius-pill)',
          background: 'var(--tone)', flex: 'none' }} />
        <Text role="ui" style={{ flex: 1 }}>{message}</Text>
        {action ? <Action weight="text" size="sm" tone={t} onClick={action}>{actionLabel}</Action> : null}
        {onDismiss ? <Action weight="text" tone="neutral" iconOnly title="Dismiss" size="sm"
          onClick={onDismiss} style={{ width: 20, height: 20, minWidth: 20 }}>✕</Action> : null}
      </Stack>
    </Surface>
  );
}
