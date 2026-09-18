// The Translate chrome that Bible Translate and OBS Translate share (#307): the
// cell and hairline of the two-column grid, the source-tab chip style, the dashed
// "Draft …" pill that opens an editor, and the editing card's shell. One
// definition each, so the two surfaces cannot drift apart (the owner's parity
// checklist on #307: same element, same relative place).
import React from 'react';

export const hair = 'var(--stroke-hair) solid var(--border-hair)';
export const CELL = { padding: '14px 26px 20px', borderTop: hair };

/** The source-tab chip, selected or not (Bible: ULT | UST | orig; OBS: the gateway story). */
export const chipStyle = (active) => ({
  display: 'inline-block',
  padding: '3px 9px',
  fontSize: 'var(--fs-label)',
  letterSpacing: 'var(--track-11)',
  borderWidth: 1,
  ...(active
    ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
    : { background: 'var(--surface-card)', color: 'var(--text-heading)', borderColor: 'var(--border-input)' }),
});

/** The design's inline dashed pill for an undrafted unit: "Draft verse N",
 * "Draft frame N". Clicking it opens the unit's editing card. */
export function DraftPill({ children, style, ...rest }) {
  return (
    <button type="button" data-i="choice" data-tone="accent" {...rest}
      style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', background: 'transparent', borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', verticalAlign: 'middle', ...style }}>
      {children}
    </button>
  );
}

/** The editing card's shell: the accent border, a header row, the field, and the
 * footer with the Save and Cancel controls. The Save/Cancel buttons a caller
 * places in `footer` carry onMouseDown preventDefault so the field's blur does
 * not close the card before the click lands. */
export function EditingCard({ header, footer, children, ...rest }) {
  return (
    <div {...rest} style={{ border: 'var(--stroke-selected) solid var(--accent)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--surface-card)', boxShadow: '0 2px 8px rgba(49,173,227,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>{header}</div>
      {children}
      {footer && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>{footer}</div>}
    </div>
  );
}
