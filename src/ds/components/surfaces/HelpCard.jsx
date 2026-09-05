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

/** Helps-panel card carrying one translation note or key word.
 * tC4 local (carried from the first vendoring, #104/#106): a key word is named
 * by its title and carries no verse label; a note with no quoted phrase (a
 * chapter introduction) prints no bare quotes; the body is a div, because it
 * carries rendered markdown blocks and a <p> inside a <p> is invalid. */
export function HelpCard({ kind = 'note', verse, title, body, active, actionLabel = 'Translation Academy →', onAction, onClick, style, ...rest }) {
  const word = kind === 'word';
  /* The inner badge inherits the tone from the outer Surface, so note/word
     switches four values at once from one prop. */
  return (
    <Surface tone={word ? 'cultivate' : 'accent'} interactive="choice" border="line"
      selected={active} fill="card" radius="lg" pad="md" onClick={onClick} style={style} {...rest}>
      <Stack direction="row" gap={7} align="center" style={{ marginBottom: 6 }}>
        <Surface fill="solid" radius="pill" style={{ display: 'inline-flex', padding: '2px 7px' }}>
          <Text role="label" style={{ color: 'var(--tone-on-fill)' }}>{word ? 'Key word' : 'Note'}</Text>
        </Surface>
        {verse != null && !word ? <Text role="labelNum">v{verse}</Text> : null}
      </Stack>
      {title ? <Text role="quote" as="p" style={{ marginBottom: 5 }}>{word ? title : '\u201C' + title + '\u201D'}</Text> : null}
      <Text role="body" as="div" tone="muted" style={{ fontSize: 'var(--fs-ui-sm)' }}>{body}</Text>
      {onAction ? <Action weight="text" size="sm" style={{ marginTop: 9 }}
        onClick={e => { e.stopPropagation(); onAction(); }}>{actionLabel}</Action> : null}
    </Surface>
  );
}
