import React from 'react';

const FILL = {
  none:  'transparent',
  solid: 'var(--tone-fill)',
  soft:  'var(--tone-soft)',
  card:  'var(--surface-card)',
  app:   'var(--surface-app)',
  muted: 'var(--surface-muted)',
  quiet: 'var(--fill-quiet)',
  paper: '#fff',
};
const FG = { solid: 'var(--tone-on-fill)', soft: 'var(--tone-on-soft)' };
const RADIUS = { none: '0', xs: 'var(--radius-xs)', chip: 'var(--radius-chip)', sm: 'var(--radius-sm)',
  input: 'var(--radius-input)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)',
  '2xl': 'var(--radius-2xl)', pill: 'var(--radius-pill)',
  /* Set by the enclosing Surface. Falls back only if there isn't one. */
  inner: 'var(--radius-inner, var(--radius-sm))' };
/* The VALUE of the concentric radius is a calc() over the real tokens, so it cannot
   drift if a radius step or a stroke weight is retuned. */
const STROKE_VAR = { none: '0px', hair: 'var(--stroke-hair)', line: 'var(--stroke)',
  input: 'var(--stroke)', strong: 'var(--stroke)', tone: 'var(--stroke)',
  choice: 'var(--stroke-selected)', dashed: 'var(--stroke-selected)',
  'dashed-tone': 'var(--stroke-selected)' };

/* These numbers exist ONLY to answer "does the rule bind?" — r > 0 — which calc()
   cannot express and CSS gives no way to branch on. They never reach a rendered
   value, so a half-pixel of staleness here can at worst misjudge a corner that was
   within half a pixel of free anyway. */
const RADIUS_PX = { none: 0, xs: 4, chip: 7, sm: 8, input: 9, md: 10, lg: 12, xl: 14, '2xl': 16 };
const STROKE_PX = { none: 0, hair: 1, line: 1, input: 1, strong: 1, tone: 1,
  choice: 1.5, dashed: 1.5, 'dashed-tone': 1.5 };

/* Padding as [block, inline] px. Accepts a number, a PAD token, or a CSS shorthand
   string, because an inset that differs per axis gives an ELLIPTICAL inner corner
   and the two axes have to be carried separately. */
function padPair(pad) {
  if (pad == null) return null;
  if (typeof pad === 'number') return [pad, pad];
  if (PAD[pad] != null) return [PAD[pad], PAD[pad]];
  const n = (String(pad).match(/-?[\d.]+/g) || []).map(Number);
  if (!n.length) return null;
  return n.length === 1 ? [n[0], n[0]] : [n[0], n[1]];
}

/* A scale key resolves to its token; a raw CSS length passes through. Anything else
   is a typo, and it must not resolve to nothing — an unrecognised value makes the
   browser drop the declaration, which computes to SQUARE corners: the one wrong
   answer that looks deliberate. Fall back to the scale and say so once. */
const CSS_LEN = /^(0$|[.\d]|calc\(|var\(|clamp\(|min\(|max\()/;
const warned = {};
function resolveRadius(v) {
  if (v == null) return RADIUS.lg;
  if (RADIUS[v]) return RADIUS[v];
  if (typeof v === 'number') return v + 'px';
  if (typeof v === 'string' && CSS_LEN.test(v.trim())) return v;
  if (!warned[v] && typeof console !== 'undefined') {
    warned[v] = 1;
    console.warn('Surface: unknown radius "' + v + '" — falling back to --radius-lg. '
      + 'Valid: ' + Object.keys(RADIUS).join(', ') + ', a CSS length, or a number.');
  }
  return RADIUS.lg;
}
const SHADOW = { none: 'none', chip: 'var(--shadow-chip)', raised: 'var(--shadow-raised)', card: 'var(--shadow-card)',
  hover: 'var(--shadow-hover)', hero: 'var(--shadow-hero)', page: 'var(--shadow-page)',
  modal: 'var(--shadow-modal)', drawer: 'var(--shadow-drawer)', focus: 'var(--shadow-focus)' };
const PAD = { none: 0, xs: 8, sm: 12, md: 14, lg: 22, xl: 24 };
/* Solid fills dark enough that everything inside must switch to the dark context. */
const DARK_FILL = { ocean: 1, accent: 1, valid: 1, invalid: 1 };

function border(kind, selected) {
  if (!kind || kind === 'none') return 0;
  if (kind === 'hair')   return 'var(--stroke-hair) solid var(--line)';
  if (kind === 'line')   return 'var(--stroke) solid var(--line)';
  if (kind === 'input')  return 'var(--stroke) solid var(--line-strong)';
  if (kind === 'strong') return 'var(--stroke) solid var(--border-strong)';
  if (kind === 'tone')   return 'var(--stroke) solid var(--tone-border)';
  /* Selectable things carry 1.5px at rest AND selected, so choosing never shifts layout. */
  if (kind === 'choice') return 'var(--stroke-selected) solid ' + (selected ? 'var(--tone-border)' : 'var(--line-strong)');
  if (kind === 'dashed') return 'var(--stroke-selected) dashed var(--border-dashed)';
  if (kind === 'dashed-tone') return 'var(--stroke-selected) dashed var(--tone-border)';
  return kind;
}

/**
 * A bounded region of the interface: a fill, an edge, a corner, a shadow, a tone.
 * Every panel, card, pill, notice, sheet, row and bubble in the product is one of
 * these — the differences between them are values, not components.
 */
export function Surface({
  as = 'div', tone, fill = 'none', border: borderKind = 'none', radius = 'lg',
  elevation = 'none', pad, interactive, selected, disabled, on,
  onClick, children, style, ...rest
}) {
  const Tag = as;
  const dark = on || (fill === 'solid' && DARK_FILL[tone] ? 'dark' : undefined);
  const padding = typeof pad === 'number' ? pad
    : pad == null ? undefined
    : PAD[pad] != null ? PAD[pad]
    : pad;   /* a CSS shorthand string passes straight through */

  /* ---- Concentric corners ----
     Two nested rounded rectangles share a corner arc centre only when

         r = R - b - d

     R the outer border-box radius, b the outer border width, d the inset from the
     outer padding box to the child's border box. Derivation: the outer arc centre
     sits at (R, R) from the corner; the child's sits at (b + d + r, b + d + r);
     concentric means those coincide. Get it wrong and the gap between the two arcs
     is not constant — it pinches at the 45 degree line, which is the tell.

     Three exact consequences, each of which the first version of this got wrong:

     - b counts. CSS already draws the outer element's PADDING-box corner at R - b,
       so the child measures from there, not from R.
     - There is no floor. If r <= 0 the child's corner lies outside the outer arc's
       influence and its radius is genuinely free — publishing a "close enough" 4px
       there invents a non-concentric value and calls it concentric.
     - An inset that differs per axis has no concentric circle, only an ellipse:
       rx = R - b - d_inline, ry = R - b - d_block, which is CSS's own
       "radius / radius" form and exactly how it derives its inner border curves.

     Published as --radius-inner so a child asks for radius="inner" rather than the
     caller doing arithmetic. Only published when the rule actually binds. A pill
     stays a pill. The calculation reads the pad prop, so a padding set through
     style instead is invisible to it.

     The emitted value is a calc() over the radius and stroke TOKENS, not a computed
     number, so retuning --radius-2xl or --stroke moves every concentric corner with
     it. Only the bind test is numeric. */
  const outerPx = RADIUS_PX[radius];
  const strokePx = STROKE_PX[borderKind] != null ? STROKE_PX[borderKind] : 0;
  const pp = padPair(pad);
  let innerRadius = null;
  if (radius === 'pill') innerRadius = 'var(--radius-pill)';
  else if (outerPx != null && pp) {
    const binds = (outerPx - strokePx - pp[1]) > 0 && (outerPx - strokePx - pp[0]) > 0;
    if (binds) {
      const R = RADIUS[radius], b = STROKE_VAR[borderKind] || '0px';
      const rx = 'calc(' + R + ' - ' + b + ' - ' + pp[1] + 'px)';
      const ry = 'calc(' + R + ' - ' + b + ' - ' + pp[0] + 'px)';
      innerRadius = pp[0] === pp[1] ? rx : rx + ' / ' + ry;
    }
  }
  /* A Surface you can click is a control: it takes focus and answers Enter and Space. */
  const control = onClick && Tag !== 'button' && Tag !== 'a';
  return (
    <Tag
      data-tone={tone}
      data-on={dark}
      data-i={disabled ? undefined : interactive}
      data-selected={selected ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
      {...(control ? {
        role: 'button', tabIndex: disabled ? -1 : 0,
        onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
      } : null)}
      style={{
        boxSizing: 'border-box',
        ...(innerRadius ? { '--radius-inner': innerRadius } : null),
        background: selected && (fill === 'none' || fill === 'card' || fill === 'paper') ? 'var(--tone-soft)' : FILL[fill],
        color: selected && fill !== 'solid' ? 'var(--tone-on-soft)' : FG[fill],
        border: border(borderKind, selected),
        borderRadius: resolveRadius(radius),
        boxShadow: SHADOW[elevation] || elevation,
        padding, cursor: onClick && !disabled ? 'pointer' : undefined,
        opacity: disabled ? .6 : undefined,
        ...style,
      }}
      {...rest}
    >{children}</Tag>
  );
}
