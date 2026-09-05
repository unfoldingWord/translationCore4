/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';

/** Bordered pill toggle for multi-select and filtering. */
export function FilterChip({ selected, mark, tone = 'accent', children, onClick, style, ...rest }) {
  const solid = tone === 'ocean' && selected;
  return (
    <Surface as="button" tone={tone} interactive="choice" border="choice" selected={selected}
      fill={solid ? 'solid' : undefined} radius="pill" onClick={onClick}
      style={{ padding: '7px 14px', cursor: 'pointer', font: 'inherit', ...style }} {...rest}>
      <Text role="caption" tone={solid ? undefined : (selected ? 'tone' : 'muted')}
        style={{ fontWeight: 'var(--fw-heavy)', ...(solid ? { color: 'var(--tone-on-fill)' } : null) }}>
        {mark ? mark + ' ' : ''}{children}
      </Text>
    </Surface>
  );
}
