import React from 'react';

/** What to show when a list, filter or panel has nothing in it. */
export function EmptyState({ title, description, action, variant = 'block', style }) {
  if (variant === 'inline') {
    return <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '6px 2px', ...style }}>{title}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6,
      padding: '38px 24px', border: 'var(--stroke-selected) dashed var(--border-dashed)', borderRadius: 'var(--radius-xl)',
      background: 'transparent', ...style }}>
      <p data-trim="cap" style={{ fontSize: 'var(--fs-ui-lg)', letterSpacing: 'var(--track-14-5)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: 0 }}>{title}</p>
      {description ? <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0, maxWidth: 380 }}>{description}</p> : null}
      {action ? <span style={{ marginTop: 10 }}>{action}</span> : null}
    </div>
  );
}
