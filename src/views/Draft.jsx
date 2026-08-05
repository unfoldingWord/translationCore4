import React, { useRef, useEffect } from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { SUITE_VERSION } from '../state.jsx';
import { t } from '../i18n';

const hair = '1px solid rgba(35,31,32,.07)';
const serif = "'PT Serif',Georgia,serif";

// Plain display text for one source verse (verseObjects from usfm-js — aligned
// USFM collapses to its text/word content; display only, never re-serialized).
const sourceText = (vObj) => {
  const walk = (vos) =>
    (vos || [])
      .map((vo) => {
        if (vo.type === 'footnote' || vo.tag === 'f') return '';
        if (vo.text != null && vo.type !== 'section') return vo.text;
        if (vo.children) return walk(vo.children);
        return '';
      })
      .join('');
  return walk(vObj?.verseObjects).replace(/\s+/g, ' ').trim();
};

// The design's editing card (translationCore.dc.html lines 635-647).
// Blur on the textarea still saves-and-closes (journeys blur to save); the
// Save/Cancel buttons carry onMouseDown preventDefault so the textarea's blur
// does not fire first and close the editor before the click lands — without
// it Cancel would be swallowed by the blur-close and never restore the verse.
function VerseEditor({ chapter, verse, dir }) {
  const { actions } = useApp();
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div style={{ border: '1.5px solid #31ADE3', borderRadius: 10, padding: '12px 14px', background: '#fff', boxShadow: '0 2px 8px rgba(49,173,227,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <sup style={{ fontFamily: serif, fontSize: 13, fontWeight: 700, color: '#8A99A4' }}>{verse.n}</sup>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#31ADE3' }}>{t('draft.drafting')}</span>
      </div>
      <textarea
        ref={ref}
        aria-label={t('draft.verseLabel', { n: verse.n })}
        dir={dir}
        defaultValue={verse.drafted ? verse.body : ''}
        placeholder={t('draft.placeholder')}
        onChange={(e) => actions.editVerse(chapter, verse.n, e.target.value)}
        onBlur={actions.blurVerse}
        rows={3}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: 0,
          outline: 'none',
          resize: 'vertical',
          fontFamily: serif,
          fontSize: 19,
          lineHeight: 1.7,
          color: '#231F20',
          background: 'transparent',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={actions.blurVerse}
          style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 18px', borderRadius: 999, background: '#31ADE3', color: '#fff' }}>
          {t('draft.saveVerse')}
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => actions.cancelVerse(chapter, verse.n)}
          style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, color: '#8A99A4', padding: 0 }}>
          {t('draft.cancelVerse')}
        </button>
      </div>
    </div>
  );
}

export default function Draft() {
  const { s, book, sourceModel, actions } = useApp();

  if (!book) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A99A4', fontSize: 14 }}>
        {s.bookError ? `${t('draft.loadError')} ${s.bookError}` : t('draft.loading')}
      </div>
    );
  }

  const verses = book.byChapter[String(s.chapter)] || [];
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {s.rail && (
        <aside style={{ width: 230, flex: 'none', background: '#fff', borderInlineEnd: '1px solid rgba(35,31,32,.09)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '16px 16px 10px' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8A99A4' }}>{t('draft.books')} · {(s.project?.bookCodes || []).length}</span>
          </div>
          {/* Design update (owner, 2026-07-31): the chapter grid nests under
              the ACTIVE book row — no separate chapters section. */}
          <div style={{ padding: '0 10px 14px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', flex: 1, minHeight: 0 }}>
            {(s.project?.bookCodes || []).map((code) => {
              const active = code === book.code;
              // Every row shows its draft bar: the active book live, the rest
              // from the Home progress cache when it has been loaded.
              const pct = active ? book.draftPct : s.progressByProject[s.project.id]?.[code];
              return (
                // Design update (owner, 2026-07-31): the active book and its
                // chapter grid share ONE tinted group.
                <div key={code} style={{ borderRadius: 10, background: active ? '#eaf6fc' : 'transparent' }}>
                  <button onClick={() => actions.openBook(code)} type="button" className={active ? 'hovRowActive' : 'hovRow'}
                    style={{ border: 0, textAlign: 'start', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', display: 'block', width: '100%', background: 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#014263' }}>{bookName(code)}</span>
                      {pct != null && <span style={{ fontSize: 10, fontWeight: 700, color: '#8A99A4' }}>{pct}%</span>}
                    </div>
                    <div style={{ height: 5, borderRadius: 99, background: '#ECF2F5', overflow: 'hidden', marginTop: 7 }}>
                      <div style={{ height: '100%', background: '#31ADE3', borderRadius: 99, width: `${pct ?? 0}%` }} />
                    </div>
                  </button>
                  {active && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: '2px 12px 12px' }}>
                      {book.chapterNums.map((c) => {
                        const sel = c === s.chapter;
                        // Design: selected = solid Inspire; chapter 1 keeps a
                        // subtle tint inside the group; the rest are white chips.
                        const chip = sel
                          ? { background: '#31ADE3', color: '#fff', borderColor: '#31ADE3' }
                          : c === 1
                            ? { background: '#eaf6fc', color: '#014263', borderColor: '#cfecf8' }
                            : { background: '#fff', color: '#8A99A4', borderColor: 'rgba(35,31,32,.10)' };
                        return (
                          <button key={c} onClick={() => actions.setChapter(c)} type="button"
                            style={{ cursor: 'pointer', fontWeight: 800, fontSize: 12, height: 32, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', ...chip }}>{c}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: hair, background: '#fff', flex: 'none' }}>
          <button onClick={actions.toggleRail} type="button" title={t('draft.toggleRail')} style={{ border: '1px solid rgba(35,31,32,.12)', background: '#fff', cursor: 'pointer', borderRadius: 8, width: 32, height: 32, fontSize: 14, color: '#4F5E6A' }}>≡</button>
          <h2 style={{ fontSize: 17, fontWeight: 900, color: '#014263', margin: 0 }}>{bookName(book.code)} {s.chapter}</h2>
          <span style={{ fontSize: 12, color: '#8A99A4' }}>{t('nav.draft')}</span>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ position: 'sticky', top: 0, background: '#F7FAFC', zIndex: 2, padding: '10px 26px 8px', borderInlineEnd: hair, display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* ULT/UST source tabs (C1b.3 — the orig pane comes with the alignment increment) */}
              {['ult', 'ust'].map((id) => (
                <button key={id} type="button" onClick={() => actions.setSourceTab(id)}
                  style={{ cursor: 'pointer', border: 0, borderRadius: 999, padding: '5px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
                    background: s.sourceTab === id ? '#014263' : '#ECF2F5', color: s.sourceTab === id ? '#fff' : '#8A99A4' }}>
                  {t(`source.${id}`)}
                </button>
              ))}
              <span style={{ fontSize: 11, color: '#8A99A4', fontWeight: 600, marginInlineStart: 6 }}>{t('draft.pinned', { version: SUITE_VERSION })}</span>
            </div>
            <div style={{ position: 'sticky', top: 0, background: '#F7FAFC', zIndex: 2, padding: '15px 26px 8px' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase', color: '#31ADE3' }}>{s.project?.name} · {s.project?.languageTag}</span>
            </div>

            {verses.map((v) => {
              const srcVerse = sourceModel && sourceModel !== 'missing' ? sourceModel[String(s.chapter)]?.[v.n] : null;
              const srcTxt = srcVerse ? sourceText(srcVerse) : null;
              return (
                <React.Fragment key={v.n}>
                  <div style={{ padding: '14px 26px 20px', borderInlineEnd: hair, borderTop: '1px solid rgba(35,31,32,.05)' }}>
                    {sourceModel === 'missing' ? (
                      <p style={{ fontSize: 13, color: '#B7C2C9', fontStyle: 'italic', margin: '6px 0 0' }}>
                        <sup style={{ fontFamily: serif, fontSize: 13, fontWeight: 700, marginInlineEnd: 3 }}>{v.n}</sup>{t('source.unavailable')}
                      </p>
                    ) : srcTxt ? (
                      <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: serif, fontSize: 19, lineHeight: 1.9, color: '#231F20', margin: 0 }}>
                        <sup style={{ fontSize: 11, fontWeight: 700, color: '#8A99A4', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        {srcTxt}
                      </p>
                    ) : (
                      <p style={{ fontSize: 13, color: '#B7C2C9', fontStyle: 'italic', margin: '6px 0 0' }}>
                        <sup style={{ fontFamily: serif, fontSize: 13, fontWeight: 700, marginInlineEnd: 3 }}>{v.n}</sup>{t('draft.sourcesLoad')}
                      </p>
                    )}
                  </div>
                  <div style={{ padding: '14px 26px 20px', borderTop: '1px solid rgba(35,31,32,.05)', position: 'relative' }}>
                    {s.editing?.key === `${s.chapter}:${v.n}` ? (
                      <VerseEditor chapter={s.chapter} verse={v} dir={dir} />
                    ) : v.drafted ? (
                      <p onClick={() => actions.startVerse(s.chapter, v.n)} title={t('draft.editVerse')}
                        style={{ direction: dir, textAlign: 'start', fontFamily: serif, fontSize: 21, lineHeight: 1.9, color: '#231F20', margin: 0, cursor: 'text' }}>
                        <sup style={{ fontSize: 11, fontWeight: 700, color: '#8A99A4', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        {v.text}
                      </p>
                    ) : (
                      <div style={{ border: '1.5px dashed rgba(35,31,32,.16)', borderRadius: 10, padding: '16px 18px', color: '#8A99A4', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <sup style={{ fontFamily: serif, fontSize: 13, fontWeight: 700, color: '#8A99A4' }}>{v.n}</sup>
                        <span>
                          {t('draft.notYet')}
                          <button type="button" onClick={() => actions.startVerse(s.chapter, v.n)}
                            style={{ border: 0, background: 'transparent', color: '#31ADE3', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, padding: 0 }}>
                            {t('draft.startVerse')}
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
