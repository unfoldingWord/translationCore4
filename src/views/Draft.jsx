// Translate (internal view state stays `draft`) — the drafting screen rebuilt
// on the design system (epic #104 / #107). Function unchanged: same editing,
// same save behavior, same actions; only the skin moved to tokens/components.
import React, { useRef, useEffect } from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { FilterChip, IconButton, Overline, Button } from '../ds/index.js';
import { RailIcon, HelpsIcon } from './PanelIcons.jsx';
import { targetTypeFor, projectDir } from './scriptStyle.js';
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
function VerseEditor({ chapter, verse, dir, type }) {
  const { actions } = useApp();
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div style={{ border: 'var(--stroke-selected) solid var(--accent)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--surface-card)', boxShadow: '0 2px 8px rgba(49,173,227,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Overline tone="accent">{t('draft.drafting')} {verse.n}</Overline>
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
          // The editor types in the SAME face and size the drafted verse
          // displays at (the project's script at the design's reading step):
          // at a smaller size the text shrank the moment a verse was clicked
          // and grew again on save. The design's 19.5px editor is the section
          // card's (#141).
          ...type,
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
  const dir = projectDir(s);
  // Target-language type from the project's script font (Nastaliq takes its own step).
  const type = targetTypeFor(s, 'lg');

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {s.rail && <BookRail />}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: hair, background: 'var(--surface-card)', flex: 'none' }}>
          <IconButton title={t('draft.toggleRail')} onClick={actions.toggleRail}><RailIcon /></IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0 }}>{bookName(book.code)} {s.chapter}</h2>
          <div style={{ flex: 1 }} />
          <IconButton title={t('draft.toggleHelps')} onClick={actions.toggleHelps}><HelpsIcon /></IconButton>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px', borderInlineEnd: hair }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {/* ULT/UST source tabs (C1b.3 — the orig pane comes with the alignment increment).
                    The design's pills: Inspire fill when active, heading text on white otherwise. */}
                {(s.sourcePanes ?? []).map((id) => (
                  <FilterChip key={id} data-testid={`source-tab-${id}`} selected={s.sourceTab === id} onClick={() => actions.setSourceTab(id)}
                    style={{ display: 'inline-block', padding: '3px 9px', fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', borderWidth: 1,
                      ...(s.sourceTab === id
                        ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
                        : { background: 'var(--surface-card)', color: 'var(--text-heading)', borderColor: 'var(--border-input)' }) }}>
                    {t(`source.${id}`, {}, id.toUpperCase())}
                  </FilterChip>
                ))}
              </div>
              {s.sourceTab && (
                // The design names the active source; Round 37's pinned
                // version travels with it (the PANE's own version, never the
                // machine suite's literal).
                <span data-testid="source-name" style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>
                  {t(`source.${s.sourceTab}.name`, {}, String(s.sourceTab).toUpperCase())}
                  {s.sources?.[s.sourceTab]?.version ? ` · ${t('draft.pinned', { version: s.sources[s.sourceTab].version })}` : ''}
                </span>
              )}
            </div>
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px' }}>
              <Overline tone="accent">{s.project?.name} · {s.project?.languageTag}</Overline>
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
                      <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)', color: 'var(--text-scripture)', margin: 0 }}>
                        <sup style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
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
                      <VerseEditor chapter={s.chapter} verse={v} dir={dir} type={type} />
                    ) : v.drafted ? (
                      <p onClick={() => actions.startVerse(s.chapter, v.n)} title={t('draft.editVerse')}
                        style={{ direction: dir, textAlign: 'start', ...type, color: 'var(--text-scripture)', margin: 0, cursor: 'text' }}>
                        <sup style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        {v.text}
                      </p>
                    ) : (
                      // The design's undrafted verse: the number, then an inline
                      // dashed "Draft verse N" pill in the paragraph flow. The
                      // accessible name stays "start this verse" (journeys J1/J14).
                      <p style={{ direction: dir, textAlign: 'start', ...type, margin: 0 }}>
                        <sup style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{v.n}</sup>
                        <button type="button" data-tc="surface" aria-label={t('draft.startVerse')} onClick={() => actions.startVerse(s.chapter, v.n)}
                          style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', background: 'transparent', borderRadius: 'var(--radius-sm)', padding: '2px 10px', marginInlineEnd: '.3em', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', verticalAlign: 'middle' }}>
                          {t('draft.draftVerse', { n: v.n })}
                        </button>
                      </p>
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
