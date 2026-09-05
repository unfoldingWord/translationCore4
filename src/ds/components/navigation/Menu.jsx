/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Layer } from '../primitives/Layer.jsx';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';
import { Action } from '../primitives/Action.jsx';
import { Rule } from '../primitives/Rule.jsx';

/** Anchored dropdown of actions. */
export function Menu({ trigger, items = [], align = 'start', open: openProp, onOpenChange, style }) {
  const ref = React.useRef(null);
  const [openState, setOpenState] = React.useState(false);
  const open = openProp != null ? openProp : openState;
  const set = v => { setOpenState(v); onOpenChange && onOpenChange(v); };
  /* Composing fixed three things the component had wrong. It is portalled, so
     it is no longer clipped by a Table or an Accordion. It resolves its z-index
     as popover + 10 × depth, so a menu inside a drawer clears that drawer —
     the old fixed literals (Menu 70, Drawer 50) put it underneath. And it
     answers arrow keys, Home/End and typeahead, which role="menu" requires and
     neither version had until Layer gained `navigate`. */
  return (
    <>
      <span ref={ref} style={{ display: 'inline-flex' }} onClick={() => set(!open)}>{trigger}</span>
      <Layer open={open} level="popover" placement="anchor" anchorTo={ref} align={align}
        role="menu" navigate="vertical" dismiss="outside escape" onDismiss={() => set(false)}>
        <Surface fill="card" border="line" radius="lg" elevation="hover" pad={6}
          style={{ minWidth: 200, ...style }}>
          {items.map((it, i) => it.divider
            ? <Rule key={i} style={{ margin: '5px 4px' }} />
            : <Action key={i} weight="row" role="menuitem" disabled={it.disabled}
                tone={it.destructive ? 'invalid' : undefined}
                onClick={() => { set(false); it.onClick && it.onClick(); }}>
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.meta ? <Text role="meta" tone="faint">{it.meta}</Text> : null}
              </Action>)}
        </Surface>
      </Layer>
    </>
  );
}
