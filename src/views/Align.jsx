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
import { t } from '../i18n';

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
      style={{ padding: '7px 10px 6px', background: '#F7FAFC', borderBottom: '1px solid rgba(35,31,32,.08)', textAlign: 'center', cursor: 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span lang={usingGw ? undefined : 'el'}
          style={{ fontFamily: usingGw ? 'var(--font-ui)' : 'var(--font-greek)', fontSize: 16.5, fontWeight: 700, color: '#014263', whiteSpace: 'nowrap' }}>
          {usingGw ? gwLabel : origLabel}
        </span>
        {card.topWords.length > 1 && (
          <button type="button" data-testid={`align-split-${card.index}`}
            onClick={(e) => { e.stopPropagation(); onSplit(card.index); }}
            title={t('align.splitHint')}
            style={{ border: '1px solid rgba(35,31,32,.2)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 9, letterSpacing: '.08em', padding: '2px 6px', borderRadius: 6, color: '#4F5E6A' }}>
            {t('align.split')}
          </button>
        )}
      </span>
      {usingGw && (
        <span lang="el" title={t('align.subHint')}
          style={{ fontFamily: 'var(--font-greek)', fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {origLabel}
        </span>
      )}
    </div>
  );
}

function WordCard({ card, armed, mode, gwTokens, onPlace, onRemove, onDropOnCard, onSplit }) {
  const canDrop = armed !== null;
  return (
    <div
      data-testid={`align-card-${card.index}`}
      data-count={card.bottomWords.length}
      onClick={canDrop ? () => onPlace(card.index) : undefined}
      onDragOver={allowDrop}
      onDrop={(e) => { e.preventDefault(); onDropOnCard(card.index, dragPayload(e)); }}
      style={{
        border: `1.5px solid ${canDrop ? '#31ADE3' : 'rgba(35,31,32,.14)'}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 86,
        overflow: 'hidden',
        cursor: canDrop ? 'pointer' : 'default',
        background: canDrop ? '#F0FAFE' : '#fff',
      }}
    >
      <CardHeader card={card} mode={mode} gwTokens={gwTokens} onSplit={onSplit} />
      <div style={{ padding: 6, display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minHeight: 38, alignContent: 'flex-start' }}>
        {card.bottomWords.map((w) => (
          <button key={`${w.word}-${w.occurrence}`} type="button" draggable
            onDragStart={(e) => setDragPayload(e, { kind: 'placed', from: card.index, word: w })}
            onClick={(e) => { e.stopPropagation(); onRemove(card.index, w); }}
            title={t('align.clickToUnalign')}
            style={{ fontFamily: 'var(--font-scripture)', fontSize: 14, color: '#231F20', background: '#fff', border: '1px solid rgba(35,31,32,.16)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {w.word}
          </button>
        ))}
        {card.bottomWords.length === 0 && (
          <span style={{ flex: 1, border: '1.5px dashed rgba(35,31,32,.14)', borderRadius: 7, minHeight: 26 }} />
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
  return src && src !== 'missing' && !src.error ? src.chapters?.[String(c)]?.[String(v)] : null;
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
    return <p style={{ fontSize: 14, color: '#8A99A4' }}>{t('align.loading')}</p>;
  }
  if (a.error) {
    // Catch-to-absence sweep (D30): a failed source read is a stated,
    // retryable error — never the 'missing' download prompt.
    return (
      <div data-testid="align-error">
        <div style={{ marginBottom: 16 }}>{back}</div>
        <div style={{ border: '1.5px dashed rgba(35,31,32,.18)', borderRadius: 14, padding: '30px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#014263', margin: '0 0 8px' }}>{t('align.error.title')}</p>
          <p style={{ fontSize: 13.5, color: '#4F5E6A', lineHeight: 1.6, margin: '0 0 12px', overflowWrap: 'anywhere' }}>{a.error}</p>
          <button type="button" data-testid="align-retry" onClick={onRetry}
            style={{ border: '1.5px solid #014263', background: 'transparent', color: '#014263', borderRadius: 8, padding: '6px 14px', fontWeight: 800, cursor: 'pointer' }}>
            {t('app.retry')}
          </button>
        </div>
      </div>
    );
  }
  if (a.unavailable) {
    return (
      <div data-testid="align-unavailable">
        <div style={{ marginBottom: 16 }}>{back}</div>
        <div style={{ border: '1.5px dashed rgba(35,31,32,.18)', borderRadius: 14, padding: '30px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#014263', margin: '0 0 8px' }}>
            {t(`align.unavailable.${a.unavailable}.title`)}
          </p>
          <p style={{ fontSize: 13.5, color: '#4F5E6A', lineHeight: 1.6, margin: 0 }}>
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
        style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', padding: 0, margin: '0 0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
        <button type="button" data-testid="align-mode-gw" disabled={!gwAvailable}
          onClick={() => setMode('gw')} title={t('align.modeGwHint')}
          style={{ ...modeChip(effMode === 'gw'), opacity: gwAvailable ? 1 : 0.5, cursor: gwAvailable ? 'pointer' : 'default' }}>
          {t('align.modeGw')}
        </button>
        <button type="button" data-testid="align-mode-orig"
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
      <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
        {effMode === 'gw' ? t('check.ultLabel') : t(`check.origLabel.${a.testament ?? 'nt'}`)}
      </span>
      <p dir={effMode === 'orig' ? a.origDir : 'ltr'}
        style={{ textAlign: 'start', fontFamily: effMode === 'orig' ? 'var(--font-greek)' : 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
        {text}
      </p>
    </div>
  );
}

const modeChip = (on) => ({
  border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800,
  fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', padding: '6px 13px',
  borderRadius: 'var(--radius-pill)',
  background: on ? 'var(--surface-card)' : 'transparent',
  color: on ? 'var(--text-heading)' : 'var(--text-secondary)',
  boxShadow: on ? '0 1px 2px rgba(1,66,99,.2)' : 'none',
});

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
    <button type="button" onClick={actions.closeAlign}
      style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '7px 14px', borderRadius: 999, color: '#4F5E6A' }}>
      {t('check.back')}
    </button>
  );

  if (isBlocked(a)) {
    return <AlignBlocked a={a} back={back} book={s.book} onRetry={() => actions.openAlign()} />;
  }

  const placed = a.record.alignments.reduce((n, x) => n + x.bottomWords.length, 0);
  const total = placed + a.record.wordBank.length;

  const onDropOnCard = (index, payload) => {
    if (!payload) return;
    if (payload.kind === 'bank') actions.placeAlignWordAt(index, payload.word);
    else if (payload.kind === 'placed') actions.moveAlignWord(payload.from, index, payload.word);
    else if (payload.kind === 'card') actions.mergeAlignCards(payload.from, index);
  };
  const onDropOnBank = (e) => {
    e.preventDefault();
    const payload = dragPayload(e);
    if (payload?.kind === 'placed') actions.unplaceAlignWord(payload.from, payload.word);
  };

  return (
    <div data-testid="align-session">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {back}
        <span style={{ fontSize: 13, fontWeight: 800, color: '#014263' }}>
          {t('align.ref', { book: bookName(s.book), ref: a.ref })}
        </span>
        <div style={{ flex: 1 }} />
        <span data-testid="align-progress" style={{ fontSize: 12.5, fontWeight: 700, color: '#8A99A4' }}>
          {t('align.placed', { placed, total })}
        </span>
      </div>

      <HowToggle />

      {a.stale && (
        <p data-testid="align-stale" style={{ fontSize: 12.5, color: '#8A6A22', background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('align.stale')}
        </p>
      )}

      <div style={{ background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <ModeBar effMode={effMode} gwAvailable={gwAvailable} testament={a.testament ?? 'nt'} setMode={setMode} />
        <RefBand effMode={effMode} gwTokens={gwTokens} a={a} />

        {/* Word bank — the target words not yet placed. */}
        <div onDragOver={allowDrop} onDrop={onDropOnBank}
          style={{ padding: '14px 20px 16px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase', color: '#31ADE3' }}>
              {t('align.bank')}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: '#8A99A4' }}>
              {a.armed ? t('align.hintArmed') : t('align.hintIdle')}
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
                    data-armed={isArmed ? '1' : '0'}
                    style={{
                      fontFamily: 'var(--font-scripture)', fontSize: 15, borderRadius: 8, padding: '5px 11px',
                      cursor: 'pointer',
                      border: isArmed ? '2px solid #31ADE3' : '1px solid rgba(35,31,32,.16)',
                      background: isArmed ? '#eaf6fc' : '#fff',
                      color: '#231F20',
                    }}>
                    {w.word}
                  </button>
                );
              })}
            </div>
          ) : (
            <p data-testid="align-bank-empty" style={{ fontSize: 13, color: '#8A99A4', fontStyle: 'italic', margin: 0 }}>
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
