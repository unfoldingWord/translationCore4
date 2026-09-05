/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Progress } from '../primitives/Progress.jsx';

/** Flat progress rail on a frost track. */
export function ProgressBar({ value = 0, tone = 'accent', height = 5, style, ...rest }) {
  return <Progress value={value} tone={tone} height={height} style={style} {...rest} />;
}
