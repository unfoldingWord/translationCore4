/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';

const TONE = { ocean: 'ocean', accent: 'accent', cultivate: 'cultivate', muted: 'neutral' };

/** Initials tile identifying a Bible, a book or a person. */
export function Avatar({ initials = '', size = 44, tone = 'ocean', shape = 'square', src, style, ...rest }) {
  /* The old component switched radius on size — --radius-sm at 32px and under,
     --radius-lg above — which contradicts the system's own rule that radii
     follow the element, not the size. Preserved here so existing tiles do not
     change, but an explicit radius is the right call in new work. */
  const radius = shape === 'circle' ? 'pill' : (size <= 32 ? 'sm' : 'lg');
  return (
    <Surface as="span" tone={TONE[tone] || 'ocean'} fill="solid" radius={radius}
      style={{ width: size, height: size, flex: 'none', display: 'inline-flex',
               alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...style }} {...rest}>
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <Text role="strong" style={{ color: 'var(--tone-on-fill)', fontSize: Math.round(size * 0.386) }}>{initials}</Text>}
    </Surface>
  );
}
