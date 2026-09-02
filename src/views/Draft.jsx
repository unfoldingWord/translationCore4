// Translate (internal view state stays `draft`) — the drafting screen rebuilt
// on the design system (epic #104 / #107). Function unchanged: same editing,
// same save behavior, same actions; only the skin moved to tokens/components.
import React, { useRef, useEffect } from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { FilterChip, IconButton, Overline, Button } from '../ds/index.js';
import BookRail from './BookRail.jsx';
import { HelpsPanel, useLoadHelps } from './HelpsPanel.jsx';
import { SourceVerse } from './SourceVerse.jsx';
import { verseText as sourceText } from './verseText.js';

const hair = 'var(--stroke-hair) solid var(--border-hair)';

// The design's editing card. Blur on the textarea still saves-and-closes
// (journeys blur to save); the Save/Cancel buttons carry onMouseDown
// preventDefault so the textarea's blur does not fire first and close the
// editor before the click lands — without it Cancel would be swallowed by the
// blur-close and never restore the verse.
function VerseEditor({ chapter, verse, dir }) {
  const { actions } = useApp();
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div style={{ border: 'var(--stroke-selected) solid var(--accent)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: '#fff', boxShadow: 'var(--shadow-raised)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <sup style={{ fontFamily: 'var(--font-scripture)', fontSize: 13, fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>{verse.n}</sup>
        <Overline tone="accent">{t('draft.drafting')}</Overline>
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
          fontFamily: 'var(--font-scripture)',
          // The editor types at the SAME size the drafted verse displays at
          // (--fs-verse-md, the mockup's editing-card size): at -sm the text
          // shrank the moment a verse was clicked and grew again on save.
          fontSize: 'var(--fs-verse-md)',
          lineHeight: 'var(--lh-verse-md)',
          color: 'var(--text-scripture)',
          background: 'transparent',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={actions.blurVerse}>
          {t('draft.saveVerse')}
        </Button>
        <Button variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => actions.cancelVerse(chapter, verse.n)}
          style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
          {t('draft.cancelVerse')}
        </Button>
      </div>
    </div>
  );
}

/** Translate's source pane is frame-naive: it indexes the source by PROJECT
 * coordinates (#131). In a cross-frame project (understand.sourceRefs
 * non-null) the pane may show a different verse than the number implies, so a
 * help's highlight must never land on it — suppress focus until the pane
 * resolves through the mapped rows (2026-08-31 Codex adversarial re-review). */
const crossFrameSafeFocus = (s) =>
  s.understand?.sourceRefs != null ? null : (s.helpsHover ?? s.helpsActive);

export default function Draft() {
  const { s, book, sourceModel, actions } = useApp();
  useLoadHelps();

  if (!book) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }}>
        {s.bookError ? `${t('draft.loadError')} ${s.bookError}` : t('draft.loading')}
      </div>
    );
  }

  const verses = book.byChapter[String(s.chapter)] || [];
  const paneFocus = crossFrameSafeFocus(s);
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {s.rail && <BookRail />}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: hair, background: '#fff', flex: 'none' }}>
          <IconButton title={t('draft.toggleRail')} onClick={actions.toggleRail}>≡</IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0 }}>{bookName(book.code)} {s.chapter}</h2>
          <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)' }}>{t('nav.draft')}</span>
          <div style={{ flex: 1 }} />
          <IconButton title={t('draft.toggleHelps')} onClick={actions.toggleHelps}>≣</IconButton>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '10px 26px 8px', borderInlineEnd: hair, display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* ULT/UST source tabs (C1b.3 — the orig pane comes with the alignment increment) */}
              {(s.sourcePanes ?? []).map((id) => (
                <FilterChip key={id} data-testid={`source-tab-${id}`} tone="ocean" selected={s.sourceTab === id} onClick={() => actions.setSourceTab(id)}
                  style={{ padding: '4px 10px', fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', borderWidth: 1 }}>
                  {t(`source.${id}`, {}, id.toUpperCase())}
                </FilterChip>
              ))}
              {(s.sources?.[s.sourceTab]?.version || null) && (
                // Round 37: the badge names the PANE's own pinned version —
                // never the machine suite's literal.
                <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)', marginInlineStart: 6 }}>{t('draft.pinned', { version: s.sources[s.sourceTab].version })}</span>
              )}
            </div>
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '15px 26px 8px' }}>
              <Overline tone="accent" style={{ letterSpacing: '.13em' }}>{s.project?.name} · {s.project?.languageTag}</Overline>
            </div>

            {verses.map((v) => {
              const srcVerse = sourceModel && sourceModel !== 'missing' ? sourceModel[String(s.chapter)]?.[v.n] : null;
              const srcTxt = srcVerse ? sourceText(srcVerse) : null;
              return (
                <React.Fragment key={v.n}>
                  <div style={{ padding: '14px 26px 20px', borderInlineEnd: hair, borderTop: 'var(--stroke-hair) solid var(--border-hair)' }}>
                    {sourceModel === 'missing' ? (
                      <p style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--uw-haze)', fontStyle: 'italic', margin: '6px 0 0' }}>
                        <sup style={{ fontFamily: 'var(--font-scripture)', fontSize: 13, fontWeight: 'var(--fw-bold)', marginInlineEnd: 3 }}>{v.n}</sup>{t('source.unavailable')}
                      </p>
                    ) : srcTxt ? (
                      <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', margin: 0 }}>
                        <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        <SourceVerse vObj={srcVerse} verseKey={v.n} focus={paneFocus} />
                      </p>
                    ) : (
                      <p style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--uw-haze)', fontStyle: 'italic', margin: '6px 0 0' }}>
                        <sup style={{ fontFamily: 'var(--font-scripture)', fontSize: 13, fontWeight: 'var(--fw-bold)', marginInlineEnd: 3 }}>{v.n}</sup>{t('draft.sourcesLoad')}
                      </p>
                    )}
                  </div>
                  <div style={{ padding: '14px 26px 20px', borderTop: 'var(--stroke-hair) solid var(--border-hair)', position: 'relative' }}>
                    {s.editing?.key === `${s.chapter}:${v.n}` ? (
                      <VerseEditor chapter={s.chapter} verse={v} dir={dir} />
                    ) : v.drafted ? (
                      <p onClick={() => actions.startVerse(s.chapter, v.n)} title={t('draft.editVerse')}
                        style={{ direction: dir, textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', margin: 0, cursor: 'text' }}>
                        <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        {v.text}
                      </p>
                    ) : (
                      <div style={{ border: 'var(--stroke-selected) dashed var(--border-dashed)', borderRadius: 'var(--radius-md)', padding: '16px 18px', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <sup style={{ fontFamily: 'var(--font-scripture)', fontSize: 13, fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>{v.n}</sup>
                        <span>
                          {t('draft.notYet')}
                          <button type="button" onClick={() => actions.startVerse(s.chapter, v.n)}
                            style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 'var(--fw-bold)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-ui)', padding: 0 }}>
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
      {s.helps && <HelpsPanel chapter={s.chapter} />}
    </div>
  );
}
