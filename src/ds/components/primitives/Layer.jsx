import React from 'react';

/* Depth, not a fixed ladder. A menu opened inside a drawer resolves its z-index
   as popover + 10, so it sits above that drawer without either component
   knowing the other exists. */
const LayerDepth = React.createContext(0);

const SCRIM = { modal: 'var(--scrim-modal)', drawer: 'var(--scrim-drawer)' };

/* Every layer that dismisses on Escape registers here while it is open. Escape
   belongs to the innermost layer only: a menu inside a dialog must close the menu
   and leave the dialog standing. stopPropagation cannot achieve that on its own —
   listeners bound to the same node (document) all fire regardless — so the
   handler asks the registry whether it is the innermost, and the winner calls
   stopImmediatePropagation.

   Ordering is by NESTING DEPTH, not by registration time. Registration order is
   not trustworthy: a parent that holds both layers' open state re-renders when
   the inner one opens, and if that re-registers the outer layer it lands last in
   the array while still being the outermost. Depth cannot drift that way. */
const escapeStack = [];
function isInnermost(token) {
  let max = -1;
  for (const t of escapeStack) if (t.depth > max) max = t.depth;
  /* Among equal depths — two sibling dialogs — the most recently opened wins. */
  for (let i = escapeStack.length - 1; i >= 0; i--) {
    if (escapeStack[i].depth === max) return escapeStack[i] === token;
  }
  return false;
}
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* --dur-panel existed in tokens/motion.css and nothing read it, so panels
   appeared rather than moved. Read once from the token rather than duplicated as
   a number here: the stylesheet stays the source of truth for how long a panel
   takes. */
let panelMs = null;
function exitDuration() {
  if (panelMs != null) return panelMs;
  if (typeof window === 'undefined') return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-panel').trim();
  panelMs = v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : 240;
  if (!panelMs || Number.isNaN(panelMs)) panelMs = 240;
  return panelMs;
}
function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* `container` lets an application name its own portal root. Without it the
   portal goes to document.body, and if react-dom is not on window at all the
   panel renders in place — where position:fixed still escapes normal flow, but a
   transformed ancestor re-establishes the containing block and the overlay is
   clipped again. That silent regression is why the prop exists. */
function portal(node, container) {
  const RD = typeof window !== 'undefined' ? window.ReactDOM : null;
  if (!RD || !RD.createPortal || typeof document === 'undefined') return node;
  const root = typeof container === 'string' ? document.querySelector(container) : (container || document.body);
  return RD.createPortal(node, root || document.body);
}
function has(d, k) { return Array.isArray(d) ? d.indexOf(k) !== -1 : String(d || '').indexOf(k) !== -1; }

const OPPOSITE = { bottom: 'top', top: 'bottom', start: 'end', end: 'start' };
const GUTTER = 8;

/* Anchored placement, with a flip. Everything logical — `side`, `align` — is
   resolved against the anchor's own computed direction and only then turned
   into left/top, which is the one place physical properties are unavoidable.
   Before this, placement was bottom-only and aligned with left/right, so a menu
   on the last row of a table opened downward into nothing and every RTL project
   aligned to the wrong edge. AUDIT.md CANNOT-EXPRESS #1 and #15. */
function place(rect, panel, side, align, offset, rtl) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const room = {
    bottom: vh - rect.bottom - offset - GUTTER,
    top: rect.top - offset - GUTTER,
    start: (rtl ? vw - rect.right : rect.left) - offset - GUTTER,
    end: (rtl ? rect.left : vw - rect.right) - offset - GUTTER,
  };
  const need = side === 'bottom' || side === 'top' ? panel.h : panel.w;
  let s = side;
  if (room[s] < need && room[OPPOSITE[s]] >= need) s = OPPOSITE[s];

  const clamp = (v, size, max) => Math.max(GUTTER, Math.min(v, max - size - GUTTER));
  let left, top;

  if (s === 'bottom' || s === 'top') {
    top = s === 'bottom' ? rect.bottom + offset : rect.top - offset - panel.h;
    /* Cross axis shifts to stay on screen; it never flips. A menu that jumped
       edges as you scrolled would be worse than one hanging slightly over. */
    const startEdge = rtl ? rect.right - panel.w : rect.left;
    const endEdge = rtl ? rect.left : rect.right - panel.w;
    left = align === 'end' ? endEdge
      : align === 'center' ? rect.left + rect.width / 2 - panel.w / 2
      : startEdge;
    left = clamp(left, panel.w, vw);
    top = Math.max(GUTTER, Math.min(top, vh - panel.h - GUTTER));
  } else {
    const before = rtl ? rect.right + offset : rect.left - offset - panel.w;
    const after = rtl ? rect.left - offset - panel.w : rect.right + offset;
    left = s === 'start' ? before : after;
    top = align === 'end' ? rect.bottom - panel.h
      : align === 'center' ? rect.top + rect.height / 2 - panel.h / 2
      : rect.top;
    top = clamp(top, panel.h, vh);
    left = Math.max(GUTTER, Math.min(left, vw - panel.w - GUTTER));
  }
  return { left, top, side: s };
}

/* Roving focus inside the panel. role="menu" has a keyboard contract — arrows,
   Home/End, typeahead — and offering the role without honouring it is worse
   than not offering it, so `navigate` implements it rather than leaving each
   application to write its own. AUDIT.md CANNOT-EXPRESS #2. */
function useNavigation(panelRef, navigate, open) {
  React.useEffect(() => {
    if (!navigate || !open || !panelRef.current) return undefined;
    const node = panelRef.current;
    const items = () => Array.prototype.filter.call(node.querySelectorAll(FOCUSABLE), el => el.offsetParent !== null);
    const vertical = navigate !== 'horizontal';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const h = e => {
      const list = items();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      let target = -1;
      if (e.key === next) target = i < 0 ? 0 : (i + 1) % list.length;
      else if (e.key === prev) target = i <= 0 ? list.length - 1 : i - 1;
      else if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = list.length - 1;
      else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const c = e.key.toLowerCase();
        for (let n = 1; n <= list.length; n++) {
          const cand = list[(Math.max(i, 0) + n) % list.length];
          if ((cand.textContent || '').trim().toLowerCase().startsWith(c)) { target = list.indexOf(cand); break; }
        }
        if (target === -1) return;
      } else return;
      e.preventDefault();
      list[target].focus();
    };
    node.addEventListener('keydown', h);
    return () => node.removeEventListener('keydown', h);
  }, [navigate, open, panelRef]);
}

/**
 * Everything that renders above the page: modals, drawers, menus, tooltips,
 * toast stacks. Layer owns the behaviours those share and nothing else —
 * stacking depth, a scrim, dismissal, focus trapping, focus restoration, scroll
 * locking, anchored placement with a flip, an enter/exit transition and
 * optional roving keyboard navigation. What the panel looks like is a Surface;
 * where it sits is a placement. There is no Modal component because a modal is
 * this with a scrim.
 */
export function Layer({
  open = true, level = 'overlay', scrim, placement = 'center', anchorTo, offset = 6,
  align = 'start', side = 'bottom',
  dismiss = 'scrim escape', trapFocus, lockScroll, restoreFocus = true, onDismiss,
  navigate, animate = true, container, scrimProps,
  role, label, labelledBy, children, style, ...rest
}) {
  const depth = React.useContext(LayerDepth);
  const panelRef = React.useRef(null);
  const returnRef = React.useRef(null);
  const [rect, setRect] = React.useState(null);
  const [panelSize, setPanelSize] = React.useState(null);
  const [rtl, setRtl] = React.useState(false);
  const anchored = placement === 'anchor';

  /* Two flags, because a panel that has been asked to close must stop behaving
     like an open layer immediately — no Escape, no focus trap — while its node
     stays mounted long enough to animate out. */
  const [mounted, setMounted] = React.useState(open);
  const [shown, setShown] = React.useState(false);

  /* Held in a ref so an inline arrow at the call site — which every call site
     writes — cannot retrigger the effect below and re-register this layer. */
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  const wantEscape = has(dismiss, 'escape');
  const wantOutside = has(dismiss, 'outside');

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    if (!animate || reducedMotion()) { setMounted(false); return undefined; }
    const t = setTimeout(() => setMounted(false), exitDuration());
    return () => clearTimeout(t);
  }, [open, animate]);

  React.useEffect(() => {
    if (!open) return undefined;
    if (restoreFocus || trapFocus) returnRef.current = document.activeElement;
    const cleanups = [];

    if (trapFocus && panelRef.current) {
      const first = panelRef.current.querySelector(FOCUSABLE);
      (first || panelRef.current).focus();
    }
    if (wantEscape) {
      const token = { depth };
      escapeStack.push(token);
      const h = e => {
        if (e.key !== 'Escape') return;
        /* No handler means nothing to dismiss — never swallow the key. */
        if (!dismissRef.current || !isInnermost(token)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (dismissRef.current) dismissRef.current('escape');
      };
      document.addEventListener('keydown', h, true);
      cleanups.push(() => {
        document.removeEventListener('keydown', h, true);
        const i = escapeStack.indexOf(token);
        if (i !== -1) escapeStack.splice(i, 1);
      });
    }
    if (wantOutside) {
      const h = e => {
        if (panelRef.current && !panelRef.current.contains(e.target) && dismissRef.current) dismissRef.current('outside');
      };
      document.addEventListener('mousedown', h);
      cleanups.push(() => document.removeEventListener('mousedown', h));
    }
    if (lockScroll) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      cleanups.push(() => { document.body.style.overflow = prev; });
    }
    if (trapFocus) {
      const h = e => {
        if (e.key !== 'Tab' || !panelRef.current) return;
        const items = Array.prototype.filter.call(panelRef.current.querySelectorAll(FOCUSABLE), el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', h, true);
      cleanups.push(() => document.removeEventListener('keydown', h, true));
    }
    return () => {
      cleanups.forEach(fn => fn());
      if ((restoreFocus || trapFocus) && returnRef.current && returnRef.current.focus) returnRef.current.focus();
    };
  }, [open, trapFocus, lockScroll, restoreFocus, wantEscape, wantOutside, depth]);

  useNavigation(panelRef, navigate, open);

  /* Anchored layers measure twice: the trigger, for where to go, and the panel
     itself, because a flip cannot be decided without knowing how tall it is. */
  React.useEffect(() => {
    if (!mounted || !anchored || !anchorTo || !anchorTo.current) return undefined;
    const el = anchorTo.current;
    const measure = () => {
      setRect(el.getBoundingClientRect());
      setRtl(getComputedStyle(el).direction === 'rtl');
      if (panelRef.current) {
        const p = panelRef.current.getBoundingClientRect();
        setPanelSize(prev => (prev && Math.abs(prev.w - p.width) < 1 && Math.abs(prev.h - p.height) < 1)
          ? prev : { w: p.width, h: p.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [mounted, anchored, anchorTo, children]);

  if (!mounted) return null;
  const z = 'calc(var(--z-' + level + ') + ' + depth * 10 + ')';
  const still = !animate || reducedMotion();
  const pos = anchored && rect && panelSize ? place(rect, panelSize, side, align, offset, rtl) : null;

  /* Motion is per placement, because what "arriving" means differs: a dialog
     scales up in place, a drawer slides from its edge, a toast rises. */
  const dir = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1;
  const away = anchored
    ? 'translateY(' + ((pos && pos.side === 'top') ? 4 : -4) + 'px)'
    : placement === 'end' ? 'translateX(' + (100 * dir) + '%)'
    : placement === 'start' ? 'translateX(' + (-100 * dir) + '%)'
    : placement === 'bottom-start' || placement === 'bottom-end' ? 'translateY(12px)'
    : 'scale(.97)';
  const motion = still ? null : {
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : away,
    transition: 'opacity var(--dur-panel) var(--ease-standard), transform var(--dur-panel) var(--ease-standard)',
  };

  const panel = (
    <div ref={panelRef} role={role} tabIndex={-1}
      aria-modal={role === 'dialog' || role === 'alertdialog' ? 'true' : undefined}
      aria-label={label} aria-labelledby={labelledBy}
      data-side={anchored && pos ? pos.side : undefined}
      onClick={e => e.stopPropagation()}
      style={{
        outline: 'none', boxSizing: 'border-box', maxWidth: '100%',
        ...(anchored ? {
          position: 'fixed', zIndex: z,
          top: pos ? pos.top : -9999,
          left: pos ? pos.left : 0,
          visibility: pos ? undefined : 'hidden',
        } : null),
        ...(placement === 'start' || placement === 'end' ? { height: '100%' } : null),
        ...motion,
        ...style,
      }} {...rest}>{children}</div>
  );

  const body = <LayerDepth.Provider value={depth + 1}>{panel}</LayerDepth.Provider>;
  if (anchored) return portal(body, container);

  const JUSTIFY = { center: 'center', start: 'flex-start', end: 'flex-end', 'bottom-start': 'flex-start', 'bottom-end': 'flex-end' };
  const bottom = placement === 'bottom-start' || placement === 'bottom-end';
  /* tC4 local: `scrimProps` lands extra attributes (a test id) on the scrim,
     the way the pre-primitive Modal and Drawer spread their rest props. */
  return portal(
    <div {...scrimProps}
      onClick={has(dismiss, 'scrim') && onDismiss ? () => dismissRef.current('scrim') : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: z, display: 'flex',
        justifyContent: JUSTIFY[placement] || 'center',
        alignItems: bottom ? 'flex-end' : (placement === 'center' ? 'center' : 'stretch'),
        padding: placement === 'center' ? 28 : (bottom ? 24 : 0),
        background: scrim ? (SCRIM[scrim] || scrim) : undefined,
        pointerEvents: scrim ? 'auto' : 'none',
        ...(scrim && !still ? {
          opacity: shown ? 1 : 0,
          transition: 'opacity var(--dur-panel) var(--ease-standard)',
        } : null),
      }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', maxHeight: '100%', maxWidth: '100%' }}>{body}</div>
    </div>,
    container
  );
}
