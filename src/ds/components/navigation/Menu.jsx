import React from 'react';

/** Anchored dropdown of actions. Opens on click, closes on choose or outside click. */
export function Menu({ trigger, items = [], align = 'end', open: openProp, onOpenChange, style }) {
  const [openState, setOpenState] = React.useState(false);
  const open = openProp == null ? openState : openProp;
  const set = (v) => { if (openProp == null) setOpenState(v); if (onOpenChange) onOpenChange(v); };
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) set(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <span onClick={() => set(!open)}>{trigger}</span>
      {open ? (
        <div role="menu" style={{ position: 'absolute', top: '100%', marginTop: 6, zIndex: 70,
          [align === 'end' ? 'insetInlineEnd' : 'insetInlineStart']: 0, minWidth: 190,
          background: '#fff', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-hover)', padding: 6, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {items.map((it, i) => it.divider
            ? <span key={i} style={{ height: 'var(--stroke-hair)', background: 'var(--border)', margin: '5px 4px' }} />
            : <button key={i} type="button" role="menuitem" disabled={it.disabled}
                onClick={() => { set(false); it.onClick && it.onClick(); }}
                data-tc={it.disabled ? undefined : 'row'}
                style={{ border: 0, background: 'transparent', textAlign: 'start', cursor: it.disabled ? 'default' : 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-bold)',
                  color: it.destructive ? 'var(--tc-invalid)' : (it.disabled ? 'var(--text-faint)' : 'var(--text-body)'),
                  padding: '8px 10px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.meta ? <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{it.meta}</span> : null}
              </button>)}
        </div>
      ) : null}
    </span>
  );
}
