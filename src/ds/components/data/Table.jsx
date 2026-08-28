import React from 'react';

/** Hairline data table. Uppercase overline headers, no zebra striping. */
export function Table({ columns = [], rows = [], onRowClick, style }) {
  return (
    <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#fff', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)' }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: c.align === 'end' ? 'end' : 'start', padding: '10px 14px',
                background: 'var(--surface-app)', borderBottom: 'var(--stroke-hair) solid var(--border)',
                fontSize: 'var(--fs-badge)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : undefined, borderTop: i ? 'var(--stroke-hair) solid var(--border-hair)' : 0 }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '11px 14px', textAlign: c.align === 'end' ? 'end' : 'start',
                  fontSize: 'var(--fs-ui-sm)', color: 'var(--text-body)',
                  fontFamily: c.mono ? 'var(--font-mono)' : 'inherit',
                  fontWeight: c.strong ? 'var(--fw-heavy)' : 'var(--fw-medium)' }}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
