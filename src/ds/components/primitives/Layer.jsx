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

function portal(node) {
  const RD = typeof window !== 'undefined' ? window.ReactDOM : null;
  if (RD && RD.createPortal) return RD.createPortal(node, document.body);
  return node; /* no react-dom on the page: renders in place, still position:fixed */
}
function has(d, k) { return Array.isArray(d) ? d.indexOf(k) !== -1 : String(d || '').indexOf(k) !== -1; }

/**
 * Everything that renders above the page: modals, drawers, menus, tooltips,
 * toast stacks. Layer owns the six behaviours those share and nothing else —
 * stacking depth, a scrim, dismissal, focus trapping, focus restoration and
 * scroll locking. What the panel looks like is a Surface; where it sits is a
 * placement. There is no Modal component because a modal is this with a scrim.
 */
export function Layer({
  open = true, level = 'overlay', scrim, placement = 'center', anchorTo, offset = 6, align = 'start',
  dismiss = 'scrim escape', trapFocus, lockScroll, restoreFocus = true, onDismiss,
  role, label, labelledBy, children, style, ...rest
}) {
  const depth = React.useContext(LayerDepth);
  const panelRef = React.useRef(null);
  const returnRef = React.useRef(null);
  const [rect, setRect] = React.useState(null);
  const anchored = placement === 'anchor';

  /* Held in a ref so an inline arrow at the call site — which every call site
     writes — cannot retrigger the effect below and re-register this layer. */
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  const wantEscape = has(dismiss, 'escape');
  const wantOutside = has(dismiss, 'outside');

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

  React.useEffect(() => {
    if (!open || !anchored || !anchorTo || !anchorTo.current) return undefined;
    const measure = () => setRect(anchorTo.current.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, anchored, anchorTo]);

  if (!open) return null;
  const z = 'calc(var(--z-' + level + ') + ' + depth * 10 + ')';

  const panel = (
    <div ref={panelRef} role={role} tabIndex={-1}
      aria-modal={role === 'dialog' || role === 'alertdialog' ? 'true' : undefined}
      aria-label={label} aria-labelledby={labelledBy}
      onClick={e => e.stopPropagation()}
      style={{
        outline: 'none', boxSizing: 'border-box', maxWidth: '100%',
        ...(anchored ? {
          position: 'fixed', zIndex: z,
          top: rect ? rect.bottom + offset : -9999,
          [align === 'end' ? 'right' : 'left']: rect ? (align === 'end' ? window.innerWidth - rect.right : rect.left) : 0,
        } : null),
        ...(placement === 'start' || placement === 'end' ? { height: '100%' } : null),
        ...style,
      }} {...rest}>{children}</div>
  );

  const body = <LayerDepth.Provider value={depth + 1}>{panel}</LayerDepth.Provider>;
  if (anchored) return portal(body);

  const JUSTIFY = { center: 'center', start: 'flex-start', end: 'flex-end', 'bottom-start': 'flex-start', 'bottom-end': 'flex-end' };
  const bottom = placement === 'bottom-start' || placement === 'bottom-end';
  return portal(
    <div
      onClick={has(dismiss, 'scrim') && onDismiss ? () => dismissRef.current('scrim') : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: z, display: 'flex',
        justifyContent: JUSTIFY[placement] || 'center',
        alignItems: bottom ? 'flex-end' : (placement === 'center' ? 'center' : 'stretch'),
        padding: placement === 'center' ? 28 : (bottom ? 24 : 0),
        background: scrim ? (SCRIM[scrim] || scrim) : undefined,
        pointerEvents: scrim ? 'auto' : 'none',
      }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', maxHeight: '100%', maxWidth: '100%' }}>{body}</div>
    </div>
  );
}
