/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';

/* Five variants were a fill × radius × elevation product. */
const VARIANT = {
  default: { fill: 'card',  border: 'line', radius: '2xl', elevation: 'card' },
  flat:    { fill: 'card',  border: 'line', radius: 'lg' },
  muted:   { fill: 'app',   border: 'line', radius: 'lg' },
  ocean:   { fill: 'solid', tone: 'ocean',  radius: 'xl', elevation: 'hero' },
  paper:   { fill: 'paper', radius: 'xs',   elevation: 'page' },
};

/** White surface container on the paper background. */
export function Card({ variant = 'default', interactive, padding, children, onClick, style, ...rest }) {
  const v = VARIANT[variant] || VARIANT.default;
  /* Surface derives role="button", tabIndex and the Enter/Space handler from
     onClick rather than from the flag, so `interactive` without `onClick` — a
     hover lift with no keyboard path — is no longer possible. */
  return (
    <Surface tone={v.tone} fill={v.fill} border={v.border} radius={v.radius} elevation={v.elevation}
      interactive={interactive ? 'card' : undefined} onClick={onClick}
      pad={padding == null ? 'lg' : padding} style={style} {...rest}>{children}</Surface>
  );
}
