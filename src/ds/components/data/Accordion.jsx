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
import { Rule } from '../primitives/Rule.jsx';

/** Disclosure list for optional or reference detail. */
export function Accordion({ items = [], defaultOpen = [], style, ...rest }) {
  const [open, setOpen] = React.useState(() => new Set(defaultOpen));
  const toggle = k => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  return (
    <Surface fill="card" border="line" radius="lg" style={{ overflow: 'hidden', ...style }} {...rest}>
      {items.map((it, i) => {
        const on = open.has(it.key);
        return (
          <div key={it.key}>
            {i ? <Rule /> : null}
            <Action weight="row" aria-expanded={on} aria-controls={it.key + '-p'} onClick={() => toggle(it.key)}
              style={{ padding: '12px 14px', borderRadius: 0,
                       background: on ? 'var(--surface-app)' : 'transparent' }}>
              <Text role="strong" style={{ flex: 1 }}>{it.title}</Text>
              {it.meta ? <Text role="labelNum">{it.meta}</Text> : null}
              <Text role="caption" aria-hidden="true" style={{ transform: on ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--dur-hover) var(--ease-standard)' }}>›</Text>
            </Action>
            {on ? (
              <Stack id={it.key + '-p'} style={{ padding: '2px 14px 14px' }}>
                <Text role="body" tone="muted" style={{ fontSize: 'var(--fs-ui-sm)' }}>{it.content}</Text>
              </Stack>
            ) : null}
          </div>
        );
      })}
    </Surface>
  );
}
