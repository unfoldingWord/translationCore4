/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Action } from '../primitives/Action.jsx';

/** Ancestry trail: Bible · Book · Chapter · Tool. */
export function Breadcrumb({ items = [], style, ...rest }) {
  return (
    <Stack as="nav" direction="row" gap={7} align="center" wrap aria-label="Breadcrumb" style={style} {...rest}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i ? <Text role="caption" tone="faint" aria-hidden="true">·</Text> : null}
          {it.onClick
            ? <Action weight="text" onClick={it.onClick}>{it.label}</Action>
            : <Text role="captionStrong" aria-current="page">{it.label}</Text>}
        </React.Fragment>
      ))}
    </Stack>
  );
}
