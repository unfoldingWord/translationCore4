// Align view — C2.11 (J5). The owner's design: a WORD BANK of target words not
// yet placed, above a row of WORD CARDS, one per original-language word. Click
// a banked word, then click a card, to place it; click a placed word to send it
// back. (The design also supports dragging and merging cards into phrases;
// merge/split is phrase alignment and is not part of C2.11.)
//
// Every edit goes through the §5.1 sidecar via the store, with `targetVerseMd5`
// recording the draft it was made against (I-3) and occurrences normalized to
// integers at the boundary (I-2).
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';

function WordCard({ card, armed, onPlace, onRemove }) {
  const canDrop = armed !== null;
  return (
    <div
      data-testid={`align-card-${card.index}`}
      data-count={card.bottomWords.length}
      onClick={canDrop ? () => onPlace(card.index) : undefined}
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
      <div style={{ padding: '7px 10px 6px', background: '#F7FAFC', borderBottom: '1px solid rgba(35,31,32,.08)', textAlign: 'center' }}>
        <span lang="el" style={{ fontFamily: 'var(--font-greek)', fontSize: 16.5, fontWeight: 700, color: '#014263', whiteSpace: 'nowrap' }}>
          {card.topWords.map((w) => w.word).join(' ')}
        </span>
      </div>
      <div style={{ padding: 6, display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minHeight: 38, alignContent: 'flex-start' }}>
        {card.bottomWords.map((w) => (
          <button key={`${w.word}-${w.occurrence}`} type="button"
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

export default function Align() {
  const { s, actions } = useApp();
  const a = s.alignSession;

  React.useEffect(() => {
    actions.openAlign();
  }, [s.book, s.alignVerse, s.projectPins]);

  if (!s.book) return null;

  const back = (
    <button type="button" onClick={actions.closeAlign}
      style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '7px 14px', borderRadius: 999, color: '#4F5E6A' }}>
      {t('check.back')}
    </button>
  );

  if (!a || a.loading) {
    return <p style={{ fontSize: 14, color: '#8A99A4' }}>{t('align.loading')}</p>;
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
            {t(`align.unavailable.${a.unavailable}.body`, { book: bookName(s.book) })}
          </p>
        </div>
      </div>
    );
  }

  const placed = a.record.alignments.reduce((n, x) => n + x.bottomWords.length, 0);
  const total = placed + a.record.wordBank.length;

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

      {a.stale && (
        <p data-testid="align-stale" style={{ fontSize: 12.5, color: '#8A6A22', background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('align.stale')}
        </p>
      )}

      {/* Word bank — the target words not yet placed. */}
      <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(35,31,32,.1)', background: '#fff', marginBottom: 16 }}>
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
                <button key={`${w.word}-${w.occurrence}`} type="button"
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

      {/* One card per original-language word. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} dir={a.origDir}>
        {a.record.alignments.map((al, i) => (
          <WordCard key={`${al.topWords.map((w) => w.word).join('-')}-${i}`}
            card={{ ...al, index: i }}
            armed={a.armed ?? null}
            onPlace={actions.placeAlignWord}
            onRemove={actions.unplaceAlignWord} />
        ))}
      </div>
    </div>
  );
}
