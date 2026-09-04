// Align view — C2.11 (J5), rebuilt for #129 on the mockup's editor card: a
// Gateway·ULT / Original anchor-mode toggle, a reference-text band, the WORD
// BANK of unplaced target words, and one WORD CARD per alignment group —
// click a banked word then a card (J5's flow, unchanged), or drag. Card
// headers drag onto each other to merge into a phrase; SPLIT undoes it.
//
// The RECORD stays original-language-anchored either way (§5.1, D65): the
// gateway mode is a LENS — each card's header shows the ULT word(s) aligned
// to its original word(s), read from the pane's own zaln data. It is only
// offered on an eng-framed project whose gateway pane carries this verse
// (#131 class otherwise).
//
// Every edit goes through the §5.1 sidecar via the store, with
// `targetVerseMd5` recording the draft it was made against (I-3) and
// occurrences normalized to integers at the boundary (I-2).
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { tokenizeVerse } from '../data/sourceHighlight';
import { verseText } from './verseText.js';
import { isSourceAbsent } from '../data/sourceState';
import { t } from '../i18n';
import { Button, Overline } from '../ds/index.js';

const dragPayload = (e) => {
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain'));
  } catch {
    return null;
  }
};
const setDragPayload = (e, data) => e.dataTransfer.setData('text/plain', JSON.stringify(data));
const allowDrop = (e) => e.preventDefault();

/** The ULT word(s) this card's original word(s) are aligned to — the gateway
 * lens's header label. Empty when the pane carries no alignment for them. */
const gwLabelFor = (topWords, gwTokens) =>
  (gwTokens ?? [])
    .filter((tok) => tok.word && tok.orig.some((o) =>
      topWords.some((tw) => tw.word === o.content && Number(tw.occurrence) === Number(o.occurrence))))
    .map((tok) => tok.text.trim())
    .join(' ');

/** Card header: the anchor label (gateway lens or original), the orig
 * sub-label under a gateway word, and SPLIT on a merged phrase. Draggable
 * onto another card to merge. */
function CardHeader({ card, mode, gwTokens, onSplit }) {
  const origLabel = card.topWords.map((w) => w.word).join(' ');
  const gwLabel = mode === 'gw' ? gwLabelFor(card.topWords, gwTokens) : '';
  const usingGw = mode === 'gw' && gwLabel !== '';
  return (
    <div draggable
      onDragStart={(e) => { e.stopPropagation(); setDragPayload(e, { kind: 'card', from: card.index }); }}
      title={t('align.mergeHint')}
      style={{ padding: '7px 10px 6px', background: 'var(--surface-app)', borderBottom: 'var(--stroke-hair) solid var(--border)', textAlign: 'center', cursor: 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span lang={usingGw ? undefined : 'el'}
          style={{ fontFamily: usingGw ? 'var(--font-scripture)' : 'var(--font-greek)', fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', whiteSpace: 'nowrap' }}>
          {usingGw ? gwLabel : origLabel}
        </span>
        {card.topWords.length > 1 && (
          <Button variant="secondary" size="sm" data-testid={`align-split-${card.index}`}
            onClick={(e) => { e.stopPropagation(); onSplit(card.index); }}
            title={t('align.splitHint')}>
            {t('align.split')}
          </Button>
        )}
      </span>
      {usingGw && (
        <span lang="el" title={t('align.subHint')}
          style={{ fontFamily: 'var(--font-greek)', fontSize: 'var(--fs-meta)', letterSpacing: 'var(--track-11-5)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {origLabel}
        </span>
      )}
    </div>
  );
}

// The design's three card states: a drop hovering over it, a word armed for
// placement (any card may take it), and at rest.
const cardState = (over, armed) => (over
  ? { borderColor: 'var(--accent)', background: 'var(--surface-accent-soft)' }
  : armed
    ? { borderColor: 'rgba(49,173,227,.55)', background: 'var(--surface-card)', cursor: 'pointer' }
    : { borderColor: 'var(--border-input)', background: 'var(--surface-card)' });

function WordCard({ card, armed, mode, gwTokens, onPlace, onRemove, onDropOnCard, onSplit }) {
  const canDrop = armed !== null;
  const [over, setOver] = React.useState(false);
  return (
    <div
      data-testid={`align-card-${card.index}`}
      data-count={card.bottomWords.length}
      onClick={canDrop ? () => onPlace(card.index) : undefined}
      onDragEnter={() => setOver(true)}
      // Drag events bubble from the header and the placed-word chips: only a
      // leave that actually exits the card clears the highlight (Codex round 1).
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDragOver={allowDrop}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropOnCard(card.index, dragPayload(e)); }}
      style={{
        border: 'var(--stroke-selected) solid',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 78,
        overflow: 'hidden',
        ...cardState(over, canDrop),
      }}
    >
      <CardHeader card={card} mode={mode} gwTokens={gwTokens} onSplit={onSplit} />
      <div style={{ padding: 6, display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minHeight: 38, alignItems: 'flex-start', alignContent: 'flex-start' }}>
        {card.bottomWords.map((w) => (
          <button key={`${w.word}-${w.occurrence}`} type="button" draggable
            onDragStart={(e) => setDragPayload(e, { kind: 'placed', from: card.index, word: w })}
            onClick={(e) => { e.stopPropagation(); onRemove(card.index, w); }}
            title={t('align.clickToUnalign')}
            style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-ui-md)', color: 'var(--text-scripture)', background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border-input)', borderRadius: 'var(--radius-chip)', padding: '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(1,66,99,.08)' }}>
            {w.word}
          </button>
        ))}
        {card.bottomWords.length === 0 && (
          <span style={{ flex: 1, border: 'var(--stroke-selected) dashed var(--border-input)', borderRadius: 'var(--radius-chip)', minHeight: 26 }} />
        )}
      </div>
    </div>
  );
}

/** The gateway lens's tokens for one verse: the pane's own zaln-linked token
 * stream. Only an eng-framed project may index the pane by the session ref
 * (#131 class); null when the pane, verse, or alignment data is absent. */
function gatewayPaneVerse(sources, sourcePanes, c, v) {
  const paneId = sourcePanes?.includes('ult') ? 'ult' : sourcePanes?.[0];
  const src = paneId ? sources?.[paneId] : undefined;
  return src && !isSourceAbsent(src) && !src.error ? src.chapters?.[String(c)]?.[String(v)] : null;
}

function gatewayTokensFor(a, sources, sourcePanes) {
  if (!a?.ref || a.frameName !== 'eng') return null;
  const [c, v] = a.ref.split(':');
  const vObj = gatewayPaneVerse(sources, sourcePanes, c, v);
  const tokens = vObj ? tokenizeVerse(vObj) : null;
  return tokens?.some((tok) => tok.word && tok.orig.length) ? tokens : null;
}

/** The session states AlignBlocked renders instead of the editor. */
const isBlocked = (a) => !a || a.loading || a.error || a.unavailable;

/** The loading / error / unavailable states — null when the session is live. */
function AlignBlocked({ a, back, book, onRetry }) {
  if (!a || a.loading) {
    return <p style={{ fontSize: 'var(--fs-ui-md)', color: 'var(--text-tertiary)' }}>{t('align.loading')}</p>;
  }
  if (a.error) {
    // Catch-to-absence sweep (D30): a failed source read is a stated,
    // retryable error — never the 'missing' download prompt.
    return (
      <div data-testid="align-error">
        <div style={{ marginBottom: 16 }}>{back}</div>
        <div style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: '30px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-heading)', margin: '0 0 8px' }}>{t('align.error.title')}</p>
          <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px', overflowWrap: 'anywhere' }}>{a.error}</p>
          <Button size="sm" variant="outline" data-testid="align-retry" onClick={onRetry}>
            {t('app.retry')}
          </Button>
        </div>
      </div>
    );
  }
  if (a.unavailable) {
    return (
      <div data-testid="align-unavailable">
        <div style={{ marginBottom: 16 }}>{back}</div>
        <div style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: '30px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-heading)', margin: '0 0 8px' }}>
            {t(`align.unavailable.${a.unavailable}.title`)}
          </p>
          <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            {t(`align.unavailable.${a.unavailable}.body`, { book: bookName(book) })}
          </p>
        </div>
      </div>
    );
  }
  return null;
}

/** "How alignment works" — the mockup's info toggle in place of the derived
 * tools' "What to check" card. */
function HowToggle() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="align-how" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', padding: 0, margin: '0 0 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden style={{ width: 16, height: 16, borderRadius: 'var(--radius-pill)', border: 'var(--stroke-selected) solid currentColor', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-badge)', fontWeight: 800, flex: 'none' }}>{'ℹ'}</span>
        {t('align.howTitle')}
      </button>
      {open && (
        <p style={{ fontSize: 'var(--fs-ui)', lineHeight: 1.6, color: 'var(--text-secondary)', margin: '-6px 0 14px', maxWidth: '62ch' }}>
          {t('align.howBody')}
        </p>
      )}
    </>
  );
}

/** Anchor-mode toggle (mockup L1075–1081). Gateway is a LENS over the same
 * original-anchored record; it needs the pane's zaln data. */
function ModeBar({ effMode, gwAvailable, testament, setMode }) {
  return (
    <div style={{ padding: '12px 20px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', background: 'var(--surface-app)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-muted)', borderRadius: 'var(--radius-pill)' }}>
        <button type="button" data-trim="cap" data-testid="align-mode-gw" disabled={!gwAvailable}
          onClick={() => setMode('gw')} title={t('align.modeGwHint')}
          style={{ ...modeChip(effMode === 'gw'), opacity: gwAvailable ? 1 : 0.5, cursor: gwAvailable ? 'pointer' : 'default' }}>
          {t('align.modeGw')}
        </button>
        <button type="button" data-trim="cap" data-testid="align-mode-orig"
          onClick={() => setMode('orig')} title={t('align.modeOrigHint')}
          style={modeChip(effMode === 'orig')}>
          {t(`align.modeOrig.${testament}`)}
        </button>
      </div>
      <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', lineHeight: 1.4, flex: 1, minWidth: 200 }}>
        {gwAvailable ? t(effMode === 'gw' ? 'align.modeGwHint' : 'align.modeOrigHint') : t('align.modeGwUnavailable')}
      </span>
    </div>
  );
}

/** The anchor language's full verse (mockup's reference band). */
function RefBand({ effMode, gwTokens, a }) {
  const text = effMode === 'gw'
    ? (gwTokens ?? []).map((tok) => tok.text).join('').replace(/\s+/g, ' ').trim()
    : verseText({ verseObjects: a.origObjects });
  if (!text) return null;
  return (
    <div data-testid="align-ref-text" style={{ padding: '13px 20px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)' }}>
      <Overline>{effMode === 'gw' ? t('check.ultLabel') : t(`check.origLabel.${a.testament ?? 'nt'}`)}</Overline>
      <p dir={effMode === 'orig' ? a.origDir : 'ltr'}
        style={{ textAlign: 'start', fontFamily: effMode === 'orig' ? 'var(--font-greek)' : 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
        {text}
      </p>
    </div>
  );
}

// The design's anchor-mode pill: Inspire fill when on, heading text when off.
const modeChip = (on) => ({
  border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'var(--fw-heavy)',
  fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', padding: '6px 13px',
  borderRadius: 'var(--radius-pill)',
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? 'var(--text-inverse)' : 'var(--text-heading)',
  boxShadow: on ? 'var(--shadow-raised)' : 'none',
});

/** The design's detail header: reference, "Item n of total", previous / next
 * verse — over the drafted verses of the book (the rail's own list). */
function AlignHeader({ a, index, book, actions }) {
  const items = (index?.items ?? []).filter((it) => it.status !== 'undrafted');
  const idx = items.findIndex((it) => it.ref === a.ref);
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < items.length - 1;
  const nav = (enabled) => ({
    border: 'var(--stroke) solid', background: 'var(--surface-card)', fontFamily: 'inherit',
    fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-ui-sm)', width: 30, height: 30, borderRadius: 'var(--radius-sm)',
    color: enabled ? 'var(--text-heading)' : 'var(--uw-mist)',
    borderColor: enabled ? 'var(--border-strong)' : 'var(--border)',
    cursor: enabled ? 'pointer' : 'default',
  });
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>
          {t('align.ref', { book: bookName(book), ref: a.ref })}
        </span>
        <div style={{ flex: 1 }} />
        {idx >= 0 && (
          <span data-testid="align-item-counter" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            {t('check.itemOf', { n: idx + 1, total: items.length })}
          </span>
        )}
        <button type="button" data-testid="align-prev" title={t('check.prevItem')} disabled={!canPrev}
          onClick={() => canPrev && actions.setAlignVerse(items[idx - 1].ref)} style={nav(canPrev)}>←</button>
        <button type="button" data-testid="align-next" title={t('check.nextItem')} disabled={!canNext}
          onClick={() => canNext && actions.setAlignVerse(items[idx + 1].ref)} style={nav(canNext)}>→</button>
      </div>
      <h1 style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: '0 0 14px' }}>
        “{t('align.ref', { book: bookName(book), ref: a.ref })}”
      </h1>
    </>
  );
}

export default function Align({ embedded = false }) {
  const { s, actions } = useApp();
  const a = s.alignSession;
  const [mode, setMode] = React.useState('gw');

  React.useEffect(() => {
    actions.openAlign();
  }, [s.book, s.alignVerse, s.projectPins]);

  const gwTokens = React.useMemo(
    () => gatewayTokensFor(a, s.sources, s.sourcePanes),
    [a?.ref, a?.frameName, s.sources, s.sourcePanes],
  );
  const gwAvailable = !!gwTokens;
  const effMode = gwAvailable && mode === 'gw' ? 'gw' : 'orig';

  if (!s.book) return null;

  const back = embedded ? null : (
    <Button variant="secondary" size="sm" onClick={actions.closeAlign}>{t('check.back')}</Button>
  );

  if (isBlocked(a)) {
    return <AlignBlocked a={a} back={back} book={s.book} onRetry={() => actions.openAlign()} />;
  }

  const placed = a.record.alignments.reduce((n, x) => n + x.bottomWords.length, 0);
  const total = placed + a.record.wordBank.length;

  // Payloads cross a string boundary — validate the shape, never assume it
  // (a malformed drop must be a no-op, not a crash in the record algebra).
  const hasWord = (p) => typeof p?.word?.word === 'string';
  const hasFrom = (p) => typeof p?.from === 'number';
  const onDropOnCard = (index, payload) => {
    if (payload?.kind === 'bank' && hasWord(payload)) actions.placeAlignWordAt(index, payload.word);
    else if (payload?.kind === 'placed' && hasWord(payload) && hasFrom(payload)) actions.moveAlignWord(payload.from, index, payload.word);
    else if (payload?.kind === 'card' && hasFrom(payload)) actions.mergeAlignCards(payload.from, index);
  };
  const onDropOnBank = (e) => {
    e.preventDefault();
    const payload = dragPayload(e);
    if (payload?.kind === 'placed' && hasWord(payload) && hasFrom(payload)) {
      actions.unplaceAlignWord(payload.from, payload.word);
    }
  };

  return (
    <div data-testid="align-session">
      {back && <div style={{ marginBottom: 14 }}>{back}</div>}
      <AlignHeader a={a} index={s.alignIndex} book={s.book} actions={actions} />

      <HowToggle />

      {a.stale && (
        <p data-testid="align-stale" style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-warn-text)', background: 'var(--surface-warm)', border: 'var(--stroke) solid var(--tc-warn-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('align.stale')}
        </p>
      )}

      <div style={{ background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <ModeBar effMode={effMode} gwAvailable={gwAvailable} testament={a.testament ?? 'nt'} setMode={setMode} />
        <RefBand effMode={effMode} gwTokens={gwTokens} a={a} />

        {/* Word bank — the target words not yet placed, on the paper tint. */}
        <div onDragOver={allowDrop} onDrop={onDropOnBank}
          style={{ padding: '14px 20px 16px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', background: 'var(--surface-app)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Overline tone="accent">{t('align.bank')}</Overline>
            <div style={{ flex: 1 }} />
            <span data-testid="align-progress" style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>
              {t('align.placed', { placed, total })}
            </span>
          </div>
          {a.record.wordBank.length > 0 ? (
            <div data-testid="align-bank" style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }} dir={a.targetDir}>
              {a.record.wordBank.map((w) => {
                const isArmed = a.armed && a.armed.word === w.word
                  && Number(a.armed.occurrence) === Number(w.occurrence);
                return (
                  <button key={`${w.word}-${w.occurrence}`} type="button" draggable
                    onDragStart={(e) => setDragPayload(e, { kind: 'bank', word: w })}
                    onClick={() => actions.armAlignWord(isArmed ? null : w)}
                    title={a.armed ? t('align.hintArmed') : t('align.hintIdle')}
                    data-armed={isArmed ? '1' : '0'}
                    style={{
                      fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-body)', borderRadius: 'var(--radius-sm)', padding: '5px 11px',
                      cursor: 'pointer', border: 'var(--stroke) solid var(--accent)',
                      ...(isArmed
                        ? { background: 'var(--accent)', color: 'var(--text-inverse)', boxShadow: 'var(--shadow-focus)' }
                        : { background: 'var(--surface-card)', color: 'var(--text-heading)', boxShadow: 'var(--shadow-chip)' }),
                    }}>
                    {w.word}
                  </button>
                );
              })}
            </div>
          ) : (
            <p data-testid="align-bank-empty" style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>
              {t('align.bankEmpty')}
            </p>
          )}
        </div>

        {/* One card per alignment group (a merged card carries a phrase). */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '16px 20px 20px' }} dir={a.origDir}>
          {a.record.alignments.map((al, i) => (
            <WordCard key={`${al.topWords.map((w) => w.word).join('-')}-${i}`}
              card={{ ...al, index: i }}
              armed={a.armed ?? null}
              mode={effMode}
              gwTokens={gwTokens}
              onPlace={actions.placeAlignWord}
              onRemove={actions.unplaceAlignWord}
              onDropOnCard={onDropOnCard}
              onSplit={actions.splitAlignCard} />
          ))}
        </div>
      </div>
    </div>
  );
}
