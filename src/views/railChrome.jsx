// The left rail's chrome, shared by the book rail (books and chapters) and the
// story rail (stories and frames) (#330): one shell, one tinted group for the
// active row, one number button for a chapter or a frame. One definition each,
// so the two rails differ only in their labels and their count.
import React from 'react';
import { Overline } from '../ds/index.js';

/** The rail: its width, panel surface, header and scrolling list. */
export function RailShell({ title, children, ...rest }) {
  return (
    <aside {...rest} style={{ width: 'var(--rail-width)', flex: 'none', background: 'var(--surface-panel)', borderInlineEnd: 'var(--stroke-hair) solid var(--border-hair)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '16px 16px 10px' }}>
        <Overline>{title}</Overline>
      </div>
      <div style={{ padding: '0 10px 14px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </aside>
  );
}

/** One row's group: the active row and its number grid share one tint. */
export function RailGroup({ active, children }) {
  return (
    <div style={{ borderRadius: 'var(--radius-md)', background: active ? 'var(--surface-accent-soft)' : 'transparent' }}>
      {children}
    </div>
  );
}

/** The five-column grid of number buttons under the active row. */
export function RailNumbers({ children, ...rest }) {
  return (
    <div {...rest} style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: '2px 12px 12px' }}>
      {children}
    </div>
  );
}

/** A chapter or frame number. `selected` is the one in view (filled); `drafted`
 * (frames) tints a unit with text so the rail shows progress at a glance. */
export function RailNumberButton({ selected, drafted, children, style, ...rest }) {
  const look = selected
    ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
    : drafted
      ? { background: 'var(--surface-accent-soft)', color: 'var(--text-accent)', borderColor: 'var(--border)' }
      : { background: '#fff', color: 'var(--text-tertiary)', borderColor: 'var(--border)' };
  return (
    <button type="button" data-i={selected ? undefined : 'choice'} data-tone="accent" {...rest}
      style={{ cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', height: 32, borderRadius: 'var(--radius-sm)', borderWidth: 'var(--stroke)', borderStyle: 'solid', ...look, ...style }}>
      {children}
    </button>
  );
}
