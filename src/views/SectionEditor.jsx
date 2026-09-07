// The design's section editing card (#141): "Drafting 9–10" with a
// `Type | Place verse numbers` switch. Type holds the section as text; Place
// shows every word as a span and every verse as a pin (VerseMarker), with a
// "To place" bank for the unplaced pins. The card keeps its draft locally —
// nothing is written until Save, which sends each verse through editVerse
// (state.saveSection). The pure rules live in sectionDraft.js.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { Button, Overline, Switcher, VerseMarker } from '../ds/index.js';
import { canDrop, parseDraft, sectionVerses, serializeDraft, spanEnd } from './sectionDraft.js';

const SUP = { fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' };
const WORD = { display: 'inline-block', borderRadius: 'var(--radius-xs)', padding: '0 .06em' };

/** The initial Type-mode text. An undrafted section starts empty — "type it
 * straight through". Once any verse is drafted, EVERY verse gets its own
 * numbered line, a stub verse an empty one: without it a stub first verse
 * would take the next verse's words (Codex review, round 1). */
const initialText = (verses) => (verses.some((v) => v.drafted)
  ? verses.map((v) => (v.drafted ? `${v.n} ${v.body}` : `${v.n} `)).join('\n')
  : '');

/** The hover title of a word while a pin is in hand: why it can or cannot land here. */
const wordTitle = (held, pinAt, ok, w) => {
  if (held == null) return '';
  if (pinAt) return t('draft.occupied', { n: pinAt });
  return ok ? t('draft.beginAt', { n: held, w }) : t('draft.cannotPass', { n: held });
};

/** What sits before a word: the held pin's ghost where it may land, then every
 * pin of a verse that begins here (the fixed first number as a plain
 * superscript; a stub verse's pin can share the index of the next). */
function PinBefore({ i, first, pinsAt, held, hover, ok, drop, pick }) {
  return (
    <>
      {hover === i && held != null && ok && (
        // The ghost shows where the held pin would land. It is positioned OUT of
        // the flow (the word's wrapper is the containing block): an in-flow ghost
        // shifted the text under the pointer on every hover, so a click aimed at
        // a word landed beside it. It takes the drop too (press or release).
        <VerseMarker n={held} state="dragging" onPickUp={() => drop(i)} onPointerUp={() => drop(i)} aria-hidden="true" tabIndex={-1}
          style={{ position: 'absolute', insetInlineEnd: '100%', top: '50%', transform: 'translateY(-60%)', zIndex: 1 }} />
      )}
      {pinsAt.map((k) => (k === first
        ? <sup key={k} title={t('draft.firstFixed', { n: first })} style={SUP}>{first}</sup>
        : <VerseMarker key={k} n={k} state="idle" data-testid={`pin-${k}`} onPickUp={() => pick(k)} style={{ marginInlineEnd: '.12em' }} />))}
    </>
  );
}

/** One word in Place mode: the pin (or ghost, or fixed number) before it, then
 * the word itself, a real control while a pin is in hand and may land here. */
function PlaceWord({ w, i, keys, markers, held, hover, setHover, drop, pick, cancel, dir }) {
  const pinsAt = keys.filter((k) => markers[k] === i && k !== held);
  const pinAt = pinsAt[pinsAt.length - 1];
  const ok = held != null && canDrop(markers, keys, held, i);
  const over = held != null ? () => setHover(i) : undefined;
  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && ok) { e.preventDefault(); drop(i); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };
  return (
    <>
      <PinBefore i={i} first={keys[0]} pinsAt={pinsAt} held={held} hover={hover} ok={ok} drop={drop} pick={pick} />
      <span
        dir={dir}
        role={ok ? 'button' : undefined}
        tabIndex={ok ? 0 : -1}
        aria-label={ok ? t('draft.beginAt', { n: held, w }) : undefined}
        title={wordTitle(held, pinAt, ok, w)}
        onMouseEnter={over}
        onFocus={over}
        onClick={ok ? () => drop(i) : undefined}
        // D70.3 is a drag: press the pin, move, release on the word. The pin's
        // pointerdown picks it up, so the release here places it; a plain
        // click still places it too.
        onPointerUp={ok ? () => drop(i) : undefined}
        onKeyDown={held != null ? onKeyDown : undefined}
        style={{ ...WORD, cursor: held == null ? 'default' : ok ? 'copy' : 'not-allowed' }}>
        {w}
      </span>
    </>
  );
}

/** Place mode: the bank of unplaced pins, then the words with their pins. */
function PlaceView({ keys, words, markers, setMarkers, dir, editType }) {
  const [held, setHeld] = useState(null);
  const [hover, setHover] = useState(null);
  const bank = keys.filter((k) => markers[k] === undefined);
  // Pick a pin up (or put the held one back); Escape on a word also puts it back.
  const pick = (k) => { setHeld((h) => (h === k ? null : k)); setHover(null); };
  const cancel = () => { setHeld(null); setHover(null); };
  const drop = (i) => {
    if (held == null || !canDrop(markers, keys, held, i)) return;
    setMarkers({ ...markers, [held]: i });
    setHeld(null);
    setHover(null);
  };
  const preview = held != null && hover != null ? [hover, spanEnd(markers, hover, held, words.length)] : null;
  return (
    <div>
      <div data-testid="pin-bank" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--surface-warm)', border: 'var(--stroke) solid var(--tc-warn-border)', marginBottom: 12 }}>
        <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', fontWeight: 'var(--fw-heavy)', color: 'var(--tc-warn-text-2)', flex: 'none' }}>{t('draft.toPlace')}</span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap', minHeight: 32 }}>
          {bank.map((k) => (
            <VerseMarker key={k} n={k} data-testid={`pin-${k}`} state={held === k ? 'dragging' : 'idle'} onPickUp={() => pick(k)} />
          ))}
          {bank.length === 0 && words.length > 0 && (
            <span style={{ fontStyle: 'italic', fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)' }}>{t('draft.bankEmpty')}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }} />
        <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', color: 'var(--tc-warn-text-2)', flex: 'none' }}>
          {held != null ? t('draft.dropHint', { n: held }) : bank.length ? t('draft.pickHint') : ''}
        </span>
      </div>
      {words.length === 0 ? (
        <span style={{ fontStyle: 'italic', fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)' }}>{t('draft.markerEmpty')}</span>
      ) : (
        <p dir={dir} data-testid="place-words" style={{ textAlign: 'start', ...editType, color: 'var(--text-scripture)', margin: 0 }}>
          {words.map((w, i) => (
            <React.Fragment key={i}>
              <span style={{ position: 'relative', ...(preview && i >= preview[0] && i < preview[1] ? { background: 'var(--tc-highlight-soft)', borderRadius: 'var(--radius-xs)' } : {}) }}>
                <PlaceWord w={w} i={i} keys={keys} markers={markers} held={held} hover={hover} setHover={setHover} drop={drop} pick={pick} cancel={cancel} dir={dir} />
              </span>{' '}
            </React.Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

export function SectionEditor({ chapter, keys, verses, span, dir, editType }) {
  const { actions } = useApp();
  const [mode, setMode] = useState('type');
  const [text, setText] = useState(() => initialText(verses));
  const [placed, setPlaced] = useState({ words: [], seps: [], markers: {} });
  const ref = useRef(null);
  useEffect(() => { if (mode === 'type') ref.current?.focus(); }, [mode]);

  const switchMode = (next) => {
    if (next === mode) return;
    if (next === 'place') setPlaced(parseDraft(text, keys));
    else setText(serializeDraft(placed.words, placed.seps, placed.markers, keys));
    setMode(next);
  };
  const draft = mode === 'place' ? placed : parseDraft(text, keys);
  const canSave = draft.words.length > 0;
  const save = () => {
    if (!canSave) return;
    actions.saveSection(chapter, keys, sectionVerses(draft.words, draft.seps, draft.markers, keys));
  };

  return (
    <div data-testid="section-editor" style={{ border: 'var(--stroke-selected) solid var(--accent)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--surface-card)', boxShadow: '0 2px 8px rgba(49,173,227,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <Overline tone="accent">{t('draft.drafting')} {span}</Overline>
        <Switcher indicator="pill" size="sm" tone="ocean" value={mode} onChange={switchMode} label={t('draft.drafting')}
          options={[{ value: 'type', label: t('draft.modeType') }, { value: 'place', label: t('draft.modePlace') }]} />
        {mode === 'type' && (
          <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)' }}>{t('draft.typeHint')}</span>
        )}
      </div>
      {mode === 'type' ? (
        <textarea
          ref={ref}
          aria-label={t('draft.sectionLabel', { span })}
          dir={dir}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('draft.sectionPlaceholder')}
          rows={6}
          style={{ width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', resize: 'vertical', ...editType, color: 'var(--text-scripture)', background: 'transparent' }}
        />
      ) : (
        <PlaceView keys={keys} words={placed.words} markers={placed.markers} setMarkers={(markers) => setPlaced({ ...placed, markers })} dir={dir} editType={editType} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Button size="sm" disabled={!canSave} onClick={save}>{t('draft.saveSection')}</Button>
        <Button variant="ghost" onClick={actions.blurVerse}
          style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
          {t('draft.cancelVerse')}
        </Button>
      </div>
    </div>
  );
}
