/* tC4 local (issue #492): a text field that offers suggestions for what is
   typed. The Select is select-only: its value is always one of its options.
   Here the typed text is the value, and a suggestion is an offer — the caller
   decides what a choice fills in. The list is the Select's: the same Layer
   popover, the same Row. The caller passes the suggestions for the current
   value, so the field knows nothing about where they come from.
   Recorded in ../../README.md. */

import React from 'react';
import { Field, useField } from '../primitives/Field.jsx';
import { Input } from '../primitives/Input.jsx';
import { Layer } from '../primitives/Layer.jsx';
import { Surface } from '../primitives/Surface.jsx';
import { Row } from './Select.jsx';

function Suggest({ suggestions, onChange, onChoose, ...rest }) {
  const f = useField() || {};
  const boxRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  /* No row is highlighted until an arrow key moves there: Enter with nothing
     highlighted leaves the typed text alone. */
  const [hi, setHi] = React.useState(-1);
  const [width, setWidth] = React.useState(null);

  const shown = open && suggestions.length > 0;
  const listId = (f.id || 'tc-sg') + '-list';
  const optId = (i) => (f.id || 'tc-sg') + '-opt-' + i;

  const show = () => {
    if (boxRef.current) setWidth(boxRef.current.getBoundingClientRect().width);
    setOpen(true);
  };
  const close = () => { setOpen(false); setHi(-1); };

  /* A row drawn under a pointer that is at rest must not become the highlight:
     Enter would then replace the typed text with a row the user never went to.
     So the first pointer position seen in an open list is only remembered, and
     a row is highlighted when the pointer is next seen somewhere else. */
  const pointer = React.useRef(null);
  React.useEffect(() => { if (!shown) pointer.current = null; }, [shown]);
  const onMouseMove = (e) => {
    const was = pointer.current;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!was || (was.x === e.clientX && was.y === e.clientY)) return;
    const row = e.target instanceof Element && e.target.closest('[role="option"]');
    if (row) setHi(Array.prototype.indexOf.call(row.parentNode.children, row));
  };
  const choose = (o) => { onChoose && onChoose(o); close(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      if (!shown) show();
      setHi((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && shown) {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && shown && suggestions[hi]) {
      e.preventDefault();
      choose(suggestions[hi]);
    }
  };

  /* The highlighted row is kept in view as the highlight moves. */
  React.useEffect(() => {
    if (!shown || hi < 0 || !panelRef.current) return;
    const el = panelRef.current.querySelector('[id="' + optId(hi) + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [shown, hi]);

  return (
    <>
      {/* The field is part of the open list, not "outside" it: a press in it
          moves the text cursor and leaves the list open. */}
      <div ref={boxRef} onMouseDown={(e) => { if (shown) e.stopPropagation(); }}>
        <Input role="combobox" autoComplete="off" aria-autocomplete="list"
          aria-expanded={shown ? 'true' : 'false'} aria-controls={listId}
          aria-activedescendant={shown && hi >= 0 ? optId(hi) : undefined}
          onChange={(e) => { onChange && onChange(e); setHi(-1); show(); }}
          onKeyDown={onKeyDown} onBlur={close} {...rest} />
      </div>

      {shown ? <Layer open level="popover" placement="anchor" anchorTo={boxRef}
        offset={6} align="start" dismiss="outside escape" animate={false}
        /* A press in the list keeps the focus in the field. */
        onMouseDown={(e) => e.preventDefault()}
        restoreFocus={false} onDismiss={close}>
        <div ref={panelRef}>
          <Surface fill="card" border="line" radius="lg" elevation="hover"
            style={{ width: width || undefined, overflow: 'hidden' }}>
            {/* tabIndex: a list that scrolls is a Tab stop of its own in the
                browser; Tab from the field must go to the next field. */}
            <div role="listbox" id={listId} tabIndex={-1} onMouseMove={onMouseMove} onMouseLeave={() => setHi(-1)}
              style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
              {suggestions.map((o, i) => (
                <Row key={String(o.value)} opt={o} id={optId(i)} selected={false}
                  highlighted={i === hi} onChoose={() => choose(o)} />
              ))}
            </div>
          </Surface>
        </div>
      </Layer> : null}
    </>
  );
}

/** Labelled text input with a list of suggestions under it. The text is the
 * value: `onChange` receives the input's event, as a TextField's does.
 * `suggestions` are rows for the current value (`value`, `label`, and the
 * optional `meta` and `code` of a Select option); the list shows while the
 * user types and there is at least one. Arrow keys move, Enter or a press
 * chooses and calls `onChoose(suggestion)`, Esc closes the list. */
export function SuggestField({ label, hint, id, style, suggestions = [], ...rest }) {
  return (
    <Field label={label} hint={hint} id={id} style={style}>
      <Suggest suggestions={suggestions} {...rest} />
    </Field>
  );
}
