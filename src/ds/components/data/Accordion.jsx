import React from 'react';

/** Disclosure list. One row per section; several may be open at once. */
export function Accordion({ items = [], defaultOpen = [], style }) {
  const [open, setOpen] = React.useState(() => new Set(defaultOpen));
  const toggle = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };
  return (
    <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#fff', ...style }}>
      {items.map((it, i) => {
        const on = open.has(it.key);
        return (
          <div key={it.key} style={{ borderTop: i ? 'var(--stroke-hair) solid var(--border-hair)' : 0 }}>
            <button type="button" onClick={() => toggle(it.key)} aria-expanded={on} style={{ width: '100%', border: 0,
              background: on ? 'var(--surface-app)' : '#fff', cursor: 'pointer', textAlign: 'start',
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-ui)' }}>
              <span data-trim="cap" style={{ flex: 1, fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{it.title}</span>
              {it.meta ? <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>{it.meta}</span> : null}
              <span aria-hidden="true" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', transform: on ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--dur-hover) var(--ease-standard)' }}>›</span>
            </button>
            {on ? <div style={{ padding: '2px 14px 14px', fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)' }}>{it.content}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
