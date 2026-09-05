import React from 'react';
import { Text } from './Text.jsx';

/* Tabs and a segmented control are the same object — an exclusive row of
   options — differing only in whether the selection mark is an underline or a
   filled pill. The system carried them as two components with fourteen combined
   consumers, and composing either from Action took five inline style properties
   per option, two of them borders, which re-specified the control's entire
   visual identity at every call site. That is the drift the system exists to
   prevent, so the indicator is an axis here rather than a style.
   AUDIT.md CANNOT-EXPRESS #17. */

const H = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };
const FS = { sm: 'var(--fs-caption)', md: 'var(--fs-caption-lg)', lg: 'var(--fs-ui)' };
const TRACK = { sm: 'var(--track-12)', md: 'var(--track-12-5)', lg: 'var(--track-13-5)' };

/**
 * An exclusive row of options. `indicator` is how the selection is marked:
 * an underline (a tab strip that divides a panel), a pill (a compact switch
 * inside a toolbar), or none (the mark is colour alone).
 */
export function Switcher({
  options = [], value, onChange, indicator = 'underline', tone = 'accent',
  size = 'md', label, grow, as = 'div', style, ...rest
}) {
  const pill = indicator === 'pill';
  const refs = React.useRef([]);
  const idx = options.findIndex(o => o.value === value);

  /* Arrow keys move the selection, which is what role="tablist" and a radio
     group both require; Tab enters and leaves the whole control. Only the
     selected option is tabbable, so the strip is one stop rather than N. */
  const onKeyDown = e => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
      : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
    if (!step || !options.length) return;
    e.preventDefault();
    const next = step === -Infinity ? 0 : step === Infinity ? options.length - 1
      : (idx + step + options.length) % options.length;
    const opt = options[next];
    if (opt && !opt.disabled) { onChange && onChange(opt.value); const el = refs.current[next]; if (el) el.focus(); }
  };

  const Tag = as;
  return (
    <Tag role="tablist" aria-label={label} aria-orientation="horizontal" onKeyDown={onKeyDown}
      data-tone={tone}
      style={{
        display: pill ? 'inline-flex' : 'flex', boxSizing: 'border-box',
        ...(pill
          ? { gap: 3, padding: 3, background: 'var(--fill-quiet-hover)', borderRadius: 'var(--radius-pill)' }
          : { gap: 2, paddingInline: 14, borderBottom: 'var(--stroke-hair) solid var(--border-hair)' }),
        ...style,
      }} {...rest}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} ref={el => { refs.current[i] = el; }}
            type="button" role="tab" aria-selected={on ? 'true' : 'false'}
            tabIndex={on || (idx === -1 && i === 0) ? 0 : -1}
            disabled={o.disabled}
            data-i={o.disabled ? undefined : (pill ? (on ? 'fill' : 'quiet') : 'text')}
            data-selected={on ? 'true' : undefined}
            onClick={() => !o.disabled && onChange && onChange(o.value)}
            style={{
              boxSizing: 'border-box', font: 'inherit', fontFamily: 'var(--font-ui)',
              fontSize: FS[size], fontWeight: 'var(--fw-heavy)', letterSpacing: TRACK[size],
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 'var(--control-gap)', whiteSpace: 'nowrap', lineHeight: 1.2,
              cursor: o.disabled ? 'default' : 'pointer',
              flex: grow ? '1 1 0' : 'none',
              ...(pill ? {
                height: H[size], paddingInline: 'var(--action-px-sm)', border: 0,
                borderRadius: 'var(--radius-pill)',
                background: on ? 'var(--tone-fill)' : 'transparent',
                color: on ? 'var(--tone-on-fill)' : 'var(--fg-muted)',
                boxShadow: on ? 'var(--shadow-raised)' : 'none',
              } : {
                padding: '14px 9px', border: 0, borderRadius: 0, background: 'transparent',
                color: on ? 'var(--tone-text)' : 'var(--fg-muted)',
                boxShadow: indicator === 'none' || !on ? 'none'
                  : 'inset 0 calc(-1 * var(--stroke-control)) 0 0 var(--tone)',
              }),
              ...(o.disabled ? { color: 'var(--disabled-fg)' } : null),
            }}>
            {o.label}
            {o.count != null
              ? <Text role="labelNum" tone={on ? 'tone' : 'faint'}>{o.count}</Text>
              : null}
          </button>
        );
      })}
    </Tag>
  );
}
