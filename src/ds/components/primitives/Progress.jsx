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
    /* A determinate ring used to be a single-coloured top border rotated by
       value × 3.6deg — which reads as a spinner frozen at an angle, not as an
       arc showing progress. It is an SVG arc now; only the indeterminate case
       stays a rotating border, because that is what a spinner is.
       AUDIT.md CANNOT-EXPRESS #13. */
    const stroke = Math.max(2, Math.round(size / 9));
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    return (
      <span data-tone={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, ...style }} {...rest}>
        {indeterminate ? (
          <span {...aria} style={{
            width: size, height: size, flex: 'none', borderRadius: 'var(--radius-pill)', display: 'inline-block',
            border: stroke + 'px solid var(--surface-muted)',
            borderTopColor: 'var(--tone)',
            animation: 'tcSpin 800ms linear infinite',
          }} />
        ) : (
          <svg {...aria} width={size} height={size} viewBox={'0 0 ' + size + ' ' + size}
            style={{ flex: 'none', transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-muted)" strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tone)" strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct / 100)}
              style={{ transition: 'stroke-dashoffset var(--dur-enter) var(--ease-standard)' }} />
          </svg>
        )}
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
