/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Layer } from '../primitives/Layer.jsx';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';

/** Ocean hover label. */
export function Tooltip({ label, placement = 'bottom', children, style }) {
  const ref = React.useRef(null);
  const [on, setOn] = React.useState(false);
  /* Both fixes came from Layer rather than from here: it is portalled, so it is
     no longer clipped by an overflow ancestor, and anchored placement flips
     when there is no room, so `placement` is honoured as a preference instead
     of being ignored. Showing on focus as well as hover is the point of the
     four handlers — a tooltip that only appears on hover is a keyboard loss. */
  return (
    <>
      <span ref={ref} style={{ display: 'inline-flex' }}
        onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}
        onFocus={() => setOn(true)} onBlur={() => setOn(false)}>{children}</span>
      <Layer open={on} level="tooltip" placement="anchor" anchorTo={ref} offset={7}
        side={placement === 'top' ? 'top' : placement === 'start' ? 'start' : placement === 'end' ? 'end' : 'bottom'}
        align="center" role="tooltip" dismiss="" restoreFocus={false}>
        <Surface tone="ocean" fill="solid" radius="sm" elevation="hover"
          style={{ pointerEvents: 'none', ...style }}>
          <Text role="ui" style={{ color: 'var(--tone-on-fill)', padding: '6px 9px', whiteSpace: 'nowrap' }}>{label}</Text>
        </Surface>
      </Layer>
    </>
  );
}
