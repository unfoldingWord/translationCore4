/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Input } from '../primitives/Input.jsx';
import { Action } from '../primitives/Action.jsx';

const Magnifier = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
  </svg>
);

/** Search input with a leading magnifier and clear button. */
export function SearchField({ value, onClear, placeholder = 'Search…', style, ...rest }) {
  /* This was TextField plus two slots. Moving the slots onto Input gave them to
     every other field in the system and removed the reason for the component. */
  return (
    <Input value={value} placeholder={placeholder} leading={Magnifier} style={style}
      trailing={value && onClear
        ? <Action weight="text" tone="neutral" iconOnly title="Clear" size="sm"
            onClick={onClear} style={{ width: 20, height: 20, minWidth: 20 }}>✕</Action>
        : null}
      {...rest} />
  );
}
