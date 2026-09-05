import React from 'react';
import { Text } from './Text.jsx';

/* `Stack columns={n}` produces a CSS grid, and a grid cannot supply
   <th scope>, <caption>, row association or column headers to assistive
   technology. Writing <table> by hand with inline styles is not a composition
   of the primitives; it is bypassing them. So this is a genuine primitive — it
   owns table semantics and takes Text and Surface for its cells.
   AUDIT.md CANNOT-EXPRESS #5. */

const ALIGN = { start: 'start', center: 'center', end: 'end', numeric: 'end' };

function cellStyle(col, header) {
  return {
    padding: '9px 12px', textAlign: ALIGN[col.align] || 'start',
    verticalAlign: header ? 'bottom' : 'middle',
    width: col.width, whiteSpace: col.wrap ? 'normal' : 'nowrap',
    borderBottom: 'var(--stroke-hair) solid var(--border-hair)',
    ...(col.align === 'numeric' ? { fontVariantNumeric: 'tabular-nums' } : null),
  };
}

/**
 * A real `<table>`: caption, column headers with `scope`, row association and
 * per-column alignment. Cells render whatever the column's `cell` returns —
 * a Text, a Badge composition, an Action — so the table owns structure and
 * nothing about appearance beyond the header treatment and the row rule.
 */
export function Table({
  columns = [], rows = [], caption, captionVisible, rowKey, onRowClick,
  selectedKey, empty, style, ...rest
}) {
  const key = (r, i) => (rowKey ? rowKey(r, i) : (r.id != null ? r.id : i));
  return (
    <table style={{
      width: '100%', borderCollapse: 'collapse', borderSpacing: 0,
      fontFamily: 'var(--font-ui)', ...style,
    }} {...rest}>
      {caption ? (
        <caption style={captionVisible ? { textAlign: 'start', padding: '0 0 10px' } : {
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
        }}>
          {captionVisible ? <Text role="overline">{caption}</Text> : caption}
        </caption>
      ) : null}
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c.key} scope="col" style={{
              ...cellStyle(c, true),
              borderBottom: 'var(--stroke) solid var(--line)',
              background: 'transparent',
            }}>
              {/* The 10px tracked header treatment is named once here rather
                  than retyped per table. */}
              <Text role="label">{c.header}</Text>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty ? (
          <tr><td colSpan={columns.length} style={{ padding: '22px 12px', textAlign: 'center' }}>{empty}</td></tr>
        ) : rows.map((r, i) => {
          const k = key(r, i);
          const on = selectedKey != null && k === selectedKey;
          return (
            <tr key={k}
              data-i={onRowClick ? 'row' : undefined}
              data-selected={on ? 'true' : undefined}
              aria-selected={selectedKey != null ? (on ? 'true' : 'false') : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r, i) : undefined}
              onKeyDown={onRowClick ? e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r, i); }
              } : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : undefined,
                background: on ? 'var(--tone-soft)' : undefined,
              }}>
              {columns.map((c, ci) => {
                const content = c.cell ? c.cell(r, i) : <Text role="ui">{r[c.key]}</Text>;
                /* The first column is the row's name to a screen reader, which
                   is what makes every other cell in the row mean something. */
                return ci === 0 && c.rowHeader !== false
                  ? <th key={c.key} scope="row" style={{ ...cellStyle(c), fontWeight: 'inherit' }}>{content}</th>
                  : <td key={c.key} style={cellStyle(c)}>{content}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
