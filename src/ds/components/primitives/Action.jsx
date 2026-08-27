import React from 'react';

const WEIGHT = {
  fill:    { background: 'var(--tone-fill)', color: 'var(--tone-on-fill)', border: '0', boxShadow: 'var(--shadow-raised)', i: 'fill' },
  soft:    { background: 'var(--fill-quiet-hover)', color: 'var(--fg)', border: '0', i: 'quiet' },
  outline: { background: 'var(--fill-plain)', color: 'var(--tone-text)', border: 'var(--stroke-selected) solid var(--tone-border)', i: 'outline' },
  quiet:   { background: 'var(--fill-plain)', color: 'var(--fg-muted)', border: 'var(--stroke) solid var(--line-strong)', i: 'quiet' },
  text:    { background: 'transparent', color: 'var(--tone-text)', border: '0', i: 'text' },
  row:     { background: 'transparent', color: 'var(--fg)', border: '0', i: 'row' },
};
const H  = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };
const PX = { sm: 'var(--action-px-sm)', md: 'var(--action-px-md)', lg: 'var(--action-px-lg)' };
const FS = { sm: 'var(--control-fs-sm)', md: 'var(--control-fs-md)', lg: 'var(--control-fs-lg)' };
const TFS= { sm: 'var(--fs-caption)', md: 'var(--fs-caption-lg)', lg: 'var(--fs-ui-sm)' };

/**
 * Anything the user activates: a filled primary, a hairline alternative, a text
 * link, an icon square, a menu row. Weight is how loud it is; tone is what it
 * means. The two are independent, which is why there is no `danger` weight and
 * no `primary` tone.
 */
export function Action({
  weight = 'fill', tone = 'accent', size = 'md', shape = 'pill',
  iconOnly, title, disabled, as = 'button', href, onClick, children, style, ...rest
}) {
  const w = WEIGHT[weight] || WEIGHT.fill;
  const Tag = href ? 'a' : as;
  const square = shape === 'square' || iconOnly;
  const flat = weight === 'text' || weight === 'row';
  /* Optical tracking for the label, by the control's own type size. */
  const TRACK = { sm: 'var(--track-12-5)', md: 'var(--track-13-5)', lg: 'var(--track-14-5)' };
  const TRACK_TEXT = { sm: 'var(--track-12)', md: 'var(--track-12-5)', lg: 'var(--track-13)' };
  const s = {
    boxSizing: 'border-box', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)',
    letterSpacing: weight === 'text' ? TRACK_TEXT[size] : TRACK[size],
    display: 'inline-flex', alignItems: 'center', gap: 'var(--control-gap)',
    justifyContent: weight === 'row' ? 'flex-start' : 'center',
    textAlign: weight === 'row' ? 'start' : 'center', textDecoration: 'none',
    cursor: disabled ? 'default' : 'pointer', flex: 'none', lineHeight: 1.2, whiteSpace: 'nowrap',
    fontSize: weight === 'text' ? TFS[size] : FS[size],
    ...w,
    borderRadius: shape === 'block' ? 'var(--radius-md)' : shape === 'square' ? 'var(--radius-sm)' : 'var(--radius-pill)',
    ...(square ? { width: H[size], height: H[size], padding: 0 } : null),
    ...(!square && !flat ? { height: H[size], paddingInline: PX[size], paddingBlock: 0 } : null),
    ...(weight === 'text' ? { padding: 0, height: 'auto', borderRadius: 0 } : null),
    ...(weight === 'row' ? { width: '100%', flex: 'initial', padding: '8px 10px', height: 'auto',
      borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-bold)' } : null),
    ...(shape === 'block' ? { width: '100%', flex: 'initial' } : null),
    ...(disabled ? { background: flat ? 'transparent' : 'var(--disabled-bg)', color: 'var(--disabled-fg)', border: '0', boxShadow: 'none' } : null),
    ...style,
  };
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      href={href} data-tone={tone} data-i={disabled ? undefined : w.i}
      disabled={Tag === 'button' ? disabled : undefined}
      aria-disabled={Tag !== 'button' && disabled ? 'true' : undefined}
      title={title} aria-label={iconOnly ? title : undefined}
      data-trim={square ? undefined : 'cap'}
      onClick={disabled ? undefined : onClick} style={s} {...rest}
    >{children}</Tag>
  );
}
