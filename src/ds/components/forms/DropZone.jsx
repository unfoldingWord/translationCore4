/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';

/** Dashed file-drop target for imports. */
export function DropZone({ title = 'Drop your file here, or browse', hint, onClick, style, ...rest }) {
  /* The old component was a <button> with no onDragOver and no onDrop — a drop
     zone that could not be dropped on. Both are the caller's to supply now, and
     visibly so: they spread straight through. */
  return (
    <Surface as="button" tone="accent" interactive="choice" border="dashed-tone" radius="xl"
      onClick={onClick}
      style={{ width: '100%', padding: '34px 20px', background: 'var(--tc-dropzone-bg)',
               cursor: 'pointer', font: 'inherit', ...style }} {...rest}>
      <Stack direction="column" gap={8} align="center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--uw-inspire)"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4" /><path d="M6 10l6-6 6 6" /><path d="M4 20h16" />
        </svg>
        <Text role="titleSm">{title}</Text>
        {hint ? <Text role="caption">{hint}</Text> : null}
      </Stack>
    </Surface>
  );
}
