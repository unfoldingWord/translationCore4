/* tC4 local (issue #446, owner decisions 2026-09-27): the native <select> is
   gone. This is a select-only combobox — a button that opens a listbox in an
   anchored Layer popover — because the approved look needs a search field
   inside the list, sticky group headers and multi-column rows, which a native
   select cannot hold. The name and the core props (label, options, value,
   onChange, hint, id) are unchanged so the old call sites migrate in place.
   The panel and row treatment follow Birch's dropdown prototype at the
   system's standard 36px field height. Recorded in ../../README.md. */

import React from 'react';
import { Field, FieldContext, useField } from '../primitives/Field.jsx';
import { Layer } from '../primitives/Layer.jsx';
import { Surface } from '../primitives/Surface.jsx';
import { Text } from '../primitives/Text.jsx';
import { Badge } from '../core/Badge.jsx';
import { SearchField } from './SearchField.jsx';

/* The component decides by option count, not per call site (owner decision):
   66-book lists get the search field, the 5-font and ~3-license lists do not. */
const SEARCH_AT = 10;

const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta'];

const norm = (o) => (typeof o === 'string' ? { value: o, label: o } : o);

/* Name contains the query, or the option's code starts with it — the two ways
   a translator knows a book ("john", "JHN"). */
function matches(o, q) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return o.label.toLowerCase().includes(s) || (o.code || '').toLowerCase().startsWith(s);
}

function Chevron({ open }) {
  return (
    <span aria-hidden="true" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-tertiary)', flex: 'none' }}>
      {open ? '▴' : '▾'}
    </span>
  );
}

function Row({ opt, id, selected, highlighted, onChoose, onHighlight }) {
  return (
    <div role="option" id={id} aria-selected={selected ? 'true' : 'false'}
      aria-disabled={opt.disabled ? 'true' : undefined}
      onMouseEnter={onHighlight}
      onClick={opt.disabled ? undefined : onChoose}
      style={{
        boxSizing: 'border-box', height: 36, display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
        background: selected && highlighted ? 'var(--uw-inspire-100)'
          : selected ? 'var(--surface-accent-soft)'
          : highlighted ? 'var(--uw-frost)' : undefined,
        cursor: opt.disabled ? 'default' : 'pointer',
      }}>
      <span aria-hidden="true" style={{ width: 14, flex: 'none', color: 'var(--text-accent)', fontWeight: 900, fontSize: 'var(--fs-ui-sm)' }}>
        {selected ? '✓' : ''}
      </span>
      <span style={{
        flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)',
        color: opt.disabled ? 'var(--disabled-fg)' : selected ? 'var(--text-heading)' : 'var(--text-body)',
      }}>{opt.label}</span>
      {opt.badge ? <Badge tone="neutral" size="sm" style={{ flex: 'none' }}>{opt.badge}</Badge> : null}
      {opt.meta ? <span style={{ flex: 'none', fontSize: 'var(--fs-label)', color: 'var(--text-tertiary)' }}>{opt.meta}</span> : null}
      {opt.code ? <span style={{ flex: 'none', fontSize: 'var(--fs-badge)', letterSpacing: 'var(--tracking-label)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-tertiary)' }}>{opt.code}</span> : null}
    </div>
  );
}

function Dropdown({ options, value, onChange, disabled: disabledProp,
  searchPlaceholder, noMatchesLabel = 'No matches', ...rest }) {
  const f = useField() || {};
  const disabled = disabledProp != null ? disabledProp : f.disabled;
  const buttonRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const [width, setWidth] = React.useState(null);
  /* A native select's popup eats the outside click that closes it: the user
     dismisses the list without activating whatever sat under the pointer — a
     dialog's scrim, its Cancel, the field itself. Layer closes the list on
     the outside MOUSEDOWN, so the CLICK that follows would still land there
     (and a scrim click would take the whole dialog down with the list). The
     dismiss marks that press and this capture listener consumes its click.
     A new mousedown clears a mark whose click never fired (a long drag, a
     right-click), and so does a keydown: a click that Enter or Space makes
     comes after its keydown and is not part of the dismissing press. */
  const swallowClick = React.useRef(false);

  const opts = React.useMemo(() => options.map(norm), [options]);
  const searchable = opts.length >= SEARCH_AT;
  const visible = React.useMemo(
    () => (searchable ? opts.filter((o) => matches(o, query)) : opts),
    [opts, searchable, query],
  );

  const idBase = f.id || 'tc-dd';
  const listId = idBase + '-list';
  const optId = (o) => idBase + '-opt-' + opts.indexOf(o);
  const current = opts.find((o) => o.value === value);

  /* Sections in option order; options without a group form one headerless run. */
  const sections = React.useMemo(() => {
    const out = [];
    for (const o of visible) {
      const g = o.group || null;
      const last = out[out.length - 1];
      if (!last || last.name !== g) out.push({ name: g, items: [o] });
      else last.items.push(o);
    }
    return out;
  }, [visible]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    /* query is empty at open, so visible === opts */
    const at = opts.findIndex((o) => o.value === value);
    setHi(at >= 0 ? at : 0);
    if (buttonRef.current) setWidth(buttonRef.current.getBoundingClientRect().width);
    setOpen(true);
  };
  /* The field takes the focus back after a choice or Esc. A close because the
     focus left (Tab) or because of a press outside leaves the focus there, so
     the Layer does not restore it. */
  const close = (refocus) => {
    if (refocus && buttonRef.current) buttonRef.current.focus();
    setOpen(false);
  };
  const onFocusOut = (e) => {
    const to = e.relatedTarget;
    if (!open || to === buttonRef.current || (to && panelRef.current && panelRef.current.contains(to))) return;
    close();
  };

  const choose = (o) => {
    if (o.disabled) return;
    onChange && onChange({ target: { value: o.value } });
    close(true);
  };

  const move = (delta) => setHi((i) => Math.max(0, Math.min(visible.length - 1, i + delta)));

  const jump = (ch) => {
    const c = ch.toLowerCase();
    for (let n = 1; n <= visible.length; n++) {
      const i = (hi + n) % visible.length;
      if (visible[i].label.toLowerCase().startsWith(c)) { setHi(i); return; }
    }
  };

  React.useEffect(() => {
    const eat = (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const arm = () => { swallowClick.current = false; };
    /* A modifier held through the outside click repeats its keydown (Windows),
       and that must not let the click through. */
    const armKey = (e) => { if (!MODIFIERS.includes(e.key)) arm(); };
    document.addEventListener('click', eat, true);
    document.addEventListener('mousedown', arm, true);
    document.addEventListener('keydown', armKey, true);
    return () => {
      document.removeEventListener('keydown', armKey, true);
      document.removeEventListener('click', eat, true);
      document.removeEventListener('mousedown', arm, true);
    };
  }, []);

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    const inSearch = e.target instanceof HTMLInputElement;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    /* In the search field, Home and End move the text cursor. */
    else if (e.key === 'Home' && !inSearch) { e.preventDefault(); setHi(0); }
    else if (e.key === 'End' && !inSearch) { e.preventDefault(); setHi(Math.max(0, visible.length - 1)); }
    else if (e.key === 'Enter') {
      /* Enter on another button inside the panel (the search field's Clear) is
         that button's own activation, not a choice of the highlighted row. */
      const t = e.target;
      if (t !== buttonRef.current && t instanceof Element && t.closest('button')) return;
      e.preventDefault();
      if (visible[hi]) choose(visible[hi]);
    }
    else if (!searchable && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      jump(e.key);
    }
  };

  /* The search field takes focus when the panel opens. Not autoFocus: the
     Layer keeps its panel `visibility: hidden` until it has measured it for
     placement, and a hidden element silently refuses focus — so this retries
     over the first frames until the focus actually lands. */
  React.useEffect(() => {
    if (!open || !searchable) return undefined;
    let done = false;
    const attempt = () => {
      if (done) return;
      const input = panelRef.current && panelRef.current.querySelector('input');
      if (input) {
        input.focus();
        if (document.activeElement === input) done = true;
      }
    };
    attempt();
    /* Timers, not requestAnimationFrame: rAF stalls in a hidden window, and
       the panel only becomes focusable one commit after it opens. */
    const timers = [0, 40, 160].map((ms) => setTimeout(attempt, ms));
    return () => { done = true; timers.forEach(clearTimeout); };
  }, [open, searchable]);

  /* A closed list stays drawn while the Layer animates it out. It is inert in
     that time, so Tab cannot land in a search field that is about to go. */
  React.useEffect(() => {
    if (panelRef.current) panelRef.current.toggleAttribute('inert', !open);
  }, [open]);

  /* The highlighted row is kept in view as the highlight moves. */
  React.useEffect(() => {
    if (!open || !visible[hi] || !panelRef.current) return;
    const el = panelRef.current.querySelector('[id="' + optId(visible[hi]) + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [open, hi, query]);

  const active = open && visible[hi] ? optId(visible[hi]) : undefined;

  return (
    <>
      <button ref={buttonRef} type="button" id={f.id} disabled={disabled}
        role="combobox" aria-expanded={open ? 'true' : 'false'} aria-controls={listId}
        aria-haspopup="listbox" aria-describedby={f.describedBy}
        aria-activedescendant={searchable ? undefined : active}
        onClick={() => { if (!open) openList(); }}
        onKeyDown={onKeyDown}
        onBlur={onFocusOut}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        {...rest}
        style={{
          boxSizing: 'border-box', width: '100%', height: 'var(--control-h-md)',
          display: 'flex', alignItems: 'center', gap: 8, paddingInline: 12,
          background: disabled ? 'var(--disabled-bg)' : 'var(--surface-card)',
          border: 'var(--stroke) solid ' + (open || hover ? 'var(--accent)' : 'var(--border-input)'),
          borderRadius: 'var(--radius-input)', fontFamily: 'var(--font-ui)',
          cursor: disabled ? 'default' : 'pointer', textAlign: 'start',
          ...rest.style,
        }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-body)',
          }}>{current ? current.label : ''}</span>
          {current && current.code ? (
            <span style={{ flex: 'none', fontSize: 'var(--fs-badge)', letterSpacing: 'var(--tracking-label)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-tertiary)' }}>
              {current.code}
            </span>
          ) : null}
        </span>
        <Chevron open={open} />
      </button>

      <Layer open={open} level="popover" placement="anchor" anchorTo={buttonRef}
        offset={6} align="start" dismiss="outside escape"
        /* On the Layer's own panel (it has tabIndex -1), not only on ours: a
           press anywhere in the popover keeps the focus where it is (the
           field or the search), so it does not count as the focus leaving.
           That includes the second press of a double-click on a row while
           the closed list animates out (our panel is inert then, so the
           press lands on the Layer's panel). */
        onMouseDown={(e) => { if (!(e.target instanceof Element && e.target.closest('input, button'))) e.preventDefault(); }}
        restoreFocus={false}
        onDismiss={(why) => {
          if (why === 'outside') {
            swallowClick.current = true;
            /* A press on something that takes no focus (the scrim) leaves it on
               <body>, outside the dialog's trap: give it back to the field. */
            setTimeout(() => {
              if ((!document.activeElement || document.activeElement === document.body) && buttonRef.current) buttonRef.current.focus();
            }, 0);
          }
          close(why === 'escape');
        }}>
        <div ref={panelRef} onBlur={onFocusOut}>
          <Surface fill="card" border="line" radius="lg" elevation="hover"
            style={{ width: width || undefined, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {searchable ? (
              <div style={{ padding: '8px 8px 6px' }} onKeyDown={onKeyDown}>
                {/* Not inside the field's context: the search input takes no id
                    from it (the id is the field button's) and has its own name. */}
                <FieldContext.Provider value={null}>
                <SearchField value={query} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
                  aria-controls={listId} aria-activedescendant={active}
                  onChange={(e) => { setQuery(e.target.value); setHi(0); }}
                  onClear={() => {
                    setQuery('');
                    setHi(0);
                    /* Clear leaves the page with the empty filter. Without this
                       the focus falls to <body>, and typing and the arrow keys
                       stop reaching the list. */
                    const input = panelRef.current && panelRef.current.querySelector('input');
                    if (input) input.focus();
                  }} />
                </FieldContext.Provider>
              </div>
            ) : null}
            <div role="listbox" id={listId} style={{ maxHeight: 340, overflowY: 'auto', padding: '0 6px 6px' }}>
              {visible.length === 0 ? (
                <div style={{ padding: '12px 10px' }}>
                  <Text role="caption" tone="muted">{noMatchesLabel}</Text>
                </div>
              ) : sections.map((sec, si) => {
                const rows = sec.items.map((o) => (
                  <Row key={String(o.value)} opt={o} id={optId(o)}
                    selected={o.value === value} highlighted={visible[hi] === o}
                    onChoose={() => choose(o)} onHighlight={() => setHi(visible.indexOf(o))} />
                ));
                return sec.name ? (
                  <div key={sec.name} role="group" aria-label={sec.name}>
                    <div style={{
                      position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-card)',
                      padding: '10px 10px 6px', display: 'flex', gap: 6, alignItems: 'baseline',
                    }}>
                      <Text role="overline" tone="muted" style={{ display: 'inline' }}>{sec.name}</Text>
                      <Text role="labelNum">{sec.items.length}</Text>
                    </div>
                    {rows}
                  </div>
                ) : <React.Fragment key={'s' + si}>{rows}</React.Fragment>;
              })}
            </div>
          </Surface>
        </div>
      </Layer>
    </>
  );
}

/** Select-only combobox for enumerations (books, script fonts, licenses).
 * An option may carry `disabled`, `code` (trailing code on the field and the
 * row), `meta` (small trailing text on the row), `badge` (a neutral pill on
 * the row) and `group` (a sticky header label). Lists of 10 or more options
 * open with a search field; `searchPlaceholder` and `noMatchesLabel` localize
 * it. `onChange` receives `{ target: { value } }`, as the native shim did. */
export function Select({ label, options = [], hint, id, style, ...rest }) {
  return (
    <Field label={label} hint={hint} id={id} style={style}>
      <Dropdown options={options} {...rest} />
    </Field>
  );
}
