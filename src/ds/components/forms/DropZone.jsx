import React from 'react';
/** Dashed upload target. The only dashed border in the system besides empty slots. */
export function DropZone({ title = 'Drop your file here, or browse', hint, onClick, style, ...rest }) {
  return (
    <button type="button" data-tc="surface" onClick={onClick} style={{
      width: '100%', border: 'var(--stroke-selected) dashed var(--border-dashed-accent)', background: 'var(--tc-dropzone-bg)',
      cursor: 'pointer', borderRadius: 'var(--radius-xl)', padding: '34px 20px', fontFamily: 'var(--font-ui)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      ...style,
    }} {...rest}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V4" /><path d="M6 10l6-6 6 6" /><path d="M4 20h16" />
      </svg>
      <span data-trim="cap" style={{ fontSize: 'var(--fs-ui-lg)', letterSpacing: 'var(--track-14-5)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{title}</span>
      {hint ? <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)' }}>{hint}</span> : null}
    </button>
  );
}
