import React from 'react';

/**
 * How far along something is. A determinate value renders a filled rail or arc;
 * `value={null}` renders the same thing with no known end, which is the only
 * difference between a progress bar and a spinner.
 */
export function Progress({
  value = null, shape = 'bar', tone = 'accent', height = 5, size = 18, label, style, ...rest
}) {
  const indeterminate = value == null;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  const aria = {
    role: 'progressbar', 'aria-label': label || undefined,
    'aria-valuenow': indeterminate ? undefined : Math.round(pct),
    'aria-valuemin': indeterminate ? undefined : 0,
    'aria-valuemax': indeterminate ? undefined : 100,
    'aria-busy': indeterminate ? 'true' : undefined,
  };

  if (shape === 'ring') {
    return (
      <span data-tone={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, ...style }} {...rest}>
        <span {...aria} style={{
          width: size, height: size, flex: 'none', borderRadius: 'var(--radius-pill)', display: 'inline-block',
          border: Math.max(2, Math.round(size / 9)) + 'px solid var(--surface-muted)',
          borderTopColor: 'var(--tone)',
          animation: indeterminate ? 'tcSpin 800ms linear infinite' : undefined,
          transform: indeterminate ? undefined : 'rotate(' + (pct * 3.6 - 90) + 'deg)',
        }} />
        {label ? <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)',
          fontWeight: 'var(--fw-bold)', color: 'var(--fg-muted)' }}>{label}</span> : null}
      </span>
    );
  }

  return (
    <div data-tone={tone} {...aria} style={{
      height, borderRadius: 'var(--radius-pill)', background: 'var(--surface-muted)', overflow: 'hidden', ...style,
    }} {...rest}>
      <div style={{
        height: '100%', borderRadius: 'var(--radius-pill)', background: 'var(--tone)',
        width: indeterminate ? '35%' : pct + '%',
        animation: indeterminate ? 'tcSlide 1200ms var(--ease-standard) infinite' : undefined,
        transition: indeterminate ? undefined : 'width var(--dur-enter) var(--ease-standard)',
      }} />
    </div>
  );
}
