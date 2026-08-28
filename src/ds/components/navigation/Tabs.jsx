import React from 'react';
/** Underline tab bar for the helps panel. Four or more peers; fewer becomes a SegmentedControl. */
export function Tabs({ tabs = [], value, onChange, style }) {
  return (
    <div style={{ display: 'flex', gap: 0, padding: '0 14px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', ...style }}>
      {tabs.map(t => {
        const v = typeof t === 'string' ? t : t.value;
        const on = v === value;
        return <button key={v} type="button" data-trim="cap" onClick={() => onChange && onChange(v)} style={{
          border: 0, borderBottom: 'var(--stroke-control) solid ' + (on ? 'var(--accent)' : 'transparent'), background: 'transparent',
          cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)',
          padding: '14px 9px', color: on ? 'var(--uw-ocean)' : 'var(--text-tertiary)',
          transition: 'color var(--dur-hover) var(--ease-standard)',
        }}>{typeof t === 'string' ? t : t.label}</button>;
      })}
    </div>
  );
}
