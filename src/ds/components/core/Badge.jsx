/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';

/* Seven tone entries were a local colour map; they are data-tone now. Two of
   them differed only in fill vs tint, which is `fill` rather than a tone. */
const TONE = {
  accent:     { tone: 'accent',    fill: 'solid' },
  accentSoft: { tone: 'accent',    fill: 'soft'  },
  cultivate:  { tone: 'cultivate', fill: 'solid' },
  ocean:      { tone: 'ocean',     fill: 'solid' },
  neutral:    { tone: 'neutral',   fill: 'soft'  },
  valid:      { tone: 'valid',     fill: 'soft'  },
  warn:       { tone: 'warn',      fill: 'soft'  },
};

/** Uppercase micro-pill label attached to a card or row. */
export function Badge({ tone = 'accent', size = 'md', children, style, ...rest }) {
  const t = TONE[tone] || TONE.accent;
  const solid = t.fill === 'solid';
  return (
    <Surface as="span" tone={t.tone} fill={t.fill} radius="pill"
      style={{ display: 'inline-flex', padding: size === 'sm' ? '3px 8px' : '2px 7px', ...style }} {...rest}>
      <Text role={size === 'sm' ? 'labelMicro' : 'label'}
        tone={solid ? undefined : 'tone'}
        style={solid ? { color: 'var(--tone-on-fill)' } : null}>{children}</Text>
    </Surface>
  );
}
