// Translate (internal view state stays `draft`) — the drafting screen on the
// design system (epic #104 / #107). Since #141 the page is laid out like
// Understand: one row per translator section (the source's `\ts\*` grouping,
// sections.js), verses running on as paragraphs. Drafting happens at section
// level in SectionEditor (Type / Place verse numbers); the verse-by-verse
// card (VerseEditor) stays for revising one verse alone.
import React, { useRef, useEffect } from 'react';
import { useApp, isOldTestament } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { FilterChip, IconButton, Overline, Button } from '../ds/index.js';
import { RailIcon, HelpsIcon } from './PanelIcons.jsx';
import { targetTypeFor, projectDir } from './scriptStyle.js';
import BookRail from './BookRail.jsx';
import { HelpsPanel, useLoadHelps } from './HelpsPanel.jsx';
import { editingFocus } from './helpsFocus.js';
import { SourceVerse } from './SourceVerse.jsx';
import { verseText as sourceText } from './verseText.js';
import { absenceMessageKey, isSourceAbsent } from '../data/sourceState';
import { paragraphLevel, paragraphsOf, rangeSpan, sectionRanges, sectionStarts } from './sections.js';
import { SectionEditor } from './SectionEditor.jsx';

const hair = 'var(--stroke-hair) solid var(--border-hair)';
const SUP = { fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' };
const CELL = { padding: '14px 26px 20px', borderTop: hair };

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
          // and grew again on save.
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

/** The chapter's sections as verse-key ranges. Same-frame: the active source's
 * `\ts\*` starts (the grouping Understand shows), else the book's own `\ts\*`
 * milestones (CONTEXT.md: Section), else one whole-chapter section.
 * Cross-frame: the source numbering is not the project's, so one section per
 * verse — the rule Understand applies (D30 honesty). */
const chapterSections = (s, verses) => {
  const keys = verses.map((v) => v.n);
  if (s.understand?.sourceRefs != null) return keys.map((k) => [k]);
  const src = s.sources?.[s.sourceTab];
  // sectionStarts always seeds the chapter's first verse, so the fallback
  // asks whether the text carries any `\ts\*` at all (Codex review, round 1).
  const marked = (raw) => /\\ts\\\*/.test(String(raw ?? ''));
  const source = src && !isSourceAbsent(src) && marked(src.raw) ? src.raw : marked(s.bookRaw) ? s.bookRaw : null;
  return sectionRanges(source ? sectionStarts(source, s.chapter) : [], keys);
};

/** Group a section's target verses into display paragraphs through sections.js (#54). */
const targetParagraphs = (verses) => paragraphsOf(verses);
const indentStyle = (level) => (level === 1 ? { paddingInlineStart: '1.5em' } : level === 2 ? { paddingInlineStart: '3em' } : {});

function SourceCell({ s, bookCode, keys, sourceModel, paneFocus, label }) {
  const chapterVerses = sourceModel && !isSourceAbsent(sourceModel) ? sourceModel[String(s.chapter)] ?? {} : {};
  const italic = { fontSize: 'var(--fs-ui-sm)', color: 'var(--uw-haze)', fontStyle: 'italic', margin: '6px 0 0' };
  const isOrig = s.sourceTab === 'orig';
  const testament = s.sources?.orig?.testament ?? (isOldTestament(bookCode) ? 'ot' : 'nt');
  const ot = testament === 'ot';
  return (
    <div style={{ ...CELL, borderInlineEnd: hair }}>
      <Overline tone="muted" style={{ marginBottom: 6 }}>{label}</Overline>
      {isSourceAbsent(sourceModel) ? (
        <p style={italic}>{t(absenceMessageKey(sourceModel))}</p>
      ) : paragraphsOf(keys, chapterVerses).map((para) => (
        <p key={para[0]} dir={isOrig ? (ot ? 'rtl' : 'ltr') : undefined} lang={isOrig ? (ot ? 'hbo' : 'el') : undefined}
          style={{ direction: isOrig ? (ot ? 'rtl' : 'ltr') : 'ltr', textAlign: 'start', fontFamily: isOrig ? (ot ? 'var(--font-hebrew)' : 'var(--font-greek)') : 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)', color: 'var(--text-scripture)', margin: '0 0 10px' }}>
          {para.map((k) => {
            const srcVerse = chapterVerses[String(k)];
            return (
              <React.Fragment key={k}>
                <sup style={SUP}>{k}</sup>
                {srcVerse && sourceText(srcVerse) ? (
                  <><SourceVerse vObj={srcVerse} verseKey={k} focus={paneFocus} />{' '}</>
                ) : (
                  <span style={{ ...italic, margin: 0, marginInlineEnd: '.3em' }}>{t('draft.sourcesLoad')}</span>
                )}
              </React.Fragment>
            );
          })}
        </p>
      ))}
    </div>
  );
}

/** One target verse inside a paragraph: drafted words (click = revise this
 * verse alone), the design's inline "Draft verse N" pill, or the "Editing
 * below" pill while its own card is open under the paragraph. */
function TargetVerse({ v, chapter, editing, actions }) {
  if (editing) {
    return (
      <span style={{ display: 'inline-block', borderRadius: 'var(--radius-sm)', padding: '2px 10px', marginInlineEnd: '.3em', background: 'var(--surface-accent-soft)', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-accent)', verticalAlign: 'middle' }}>
        {t('draft.editingBelow')}
      </span>
    );
  }
  if (v.drafted) {
    return (
      // Real spaces between the word spans: the verse's text content stays the
      // sentence (copy, find, the journeys' getByText), not the words run together.
      <span title={t('draft.editVerse')} onClick={() => actions.startVerse(chapter, v.n)} style={{ cursor: 'text' }}>
        {v.text.split(/\s+/).filter(Boolean).map((w, i) => (
          <React.Fragment key={i}>
            <span data-i="quiet" style={{ display: 'inline-block', borderRadius: 'var(--radius-xs)', padding: '0 .06em' }}>{w}</span>{' '}
          </React.Fragment>
        ))}
      </span>
    );
  }
  // The accessible name stays "start this verse" (journeys J1/J14).
  return (
    <button type="button" data-i="choice" data-tone="accent" aria-label={t('draft.startVerse')} onClick={() => actions.startVerse(chapter, v.n)}
      style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', background: 'transparent', borderRadius: 'var(--radius-sm)', padding: '2px 10px', marginInlineEnd: '.3em', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', verticalAlign: 'middle' }}>
      {t('draft.draftVerse', { n: v.n })}
    </button>
  );
}

function TargetCell({ s, verses, keys, byKey, span, dir, type, editType, actions }) {
  const editingKey = s.editing?.key;
  // The open card keeps the verse set it was opened with (startSection's
  // keys), whatever the rows regroup to after a source switch — the row that
  // holds its first verse hosts it (Codex review, round 1).
  const editKeys = s.editing?.keys;
  const sectionOpen = !!editKeys && editingKey === `${s.chapter}:s${editKeys[0]}` && keys.includes(editKeys[0]);
  const verseOpen = verses.find((v) => editingKey === `${s.chapter}:${v.n}`);
  return (
    <div style={{ ...CELL, position: 'relative' }}>
      {sectionOpen ? (
        <SectionEditor chapter={s.chapter} keys={editKeys} verses={editKeys.map((k) => byKey.get(k)).filter(Boolean)} span={rangeSpan(editKeys)} dir={dir} editType={editType} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6, minHeight: 14 }}>
            <Button variant="ghost" size="sm" onClick={() => actions.startSection(s.chapter, keys)}
              style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
              {t('draft.draftSection', { span })}
            </Button>
          </div>
          {targetParagraphs(verses).map((para) => (
            <p key={para[0].n} style={{ direction: dir, textAlign: 'start', ...type, color: 'var(--text-scripture)', margin: '0 0 10px', ...indentStyle(paragraphLevel(para)) }}>
              {para.map((v) => (
                <React.Fragment key={v.n}>
                  <sup style={SUP}>{v.n}</sup>
                  <TargetVerse v={v} chapter={s.chapter} editing={verseOpen?.n === v.n} actions={actions} />
                </React.Fragment>
              ))}
            </p>
          ))}
          {verseOpen && <VerseEditor chapter={s.chapter} verse={verseOpen} dir={dir} type={type} />}
        </>
      )}
    </div>
  );
}

const chipStyle = (active) => ({
  display: 'inline-block',
  padding: '3px 9px',
  fontSize: 'var(--fs-label)',
  letterSpacing: 'var(--track-11)',
  borderWidth: 1,
  ...(active
    ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
    : { background: 'var(--surface-card)', color: 'var(--text-heading)', borderColor: 'var(--border-input)' }),
});

function SourceTabs({ s, actions, origTestament }) {
  const isOrig = s.sourceTab === 'orig';
  const showCaption = (s.sourcePanes ?? []).includes(s.sourceTab) || isOrig;
  const captionName = isOrig
    ? t(`source.orig.${origTestament}.name`)
    : t(`source.${s.sourceTab}.name`, {}, String(s.sourceTab).toUpperCase());
  const version = s.sources?.[s.sourceTab]?.version;

  return (
    <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px', borderInlineEnd: hair }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {(s.sourcePanes ?? []).map((id) => (
          <FilterChip key={id} data-testid={`source-tab-${id}`} selected={s.sourceTab === id} onClick={() => actions.setSourceTab(id)} style={chipStyle(s.sourceTab === id)}>
            {t(`source.${id}`, {}, id.toUpperCase())}
          </FilterChip>
        ))}
        {s.sources?.orig && (
          <FilterChip data-testid="source-tab-orig" selected={isOrig} onClick={() => actions.setSourceTab('orig')} style={chipStyle(isOrig)}>
            {t(`source.orig.${origTestament}`)}
          </FilterChip>
        )}
      </div>
      {showCaption && (
        <span data-testid="source-name" style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>
          {captionName}
          {version ? ` · ${t('draft.pinned', { version })}` : ''}
        </span>
      )}
    </div>
  );
}

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
  // The section card types one step down (the design's --fs-verse-md at the
  // reading leading); Nastaliq keeps its own step.
  const editType = { ...type, fontSize: type.fontSize === 'var(--fs-verse-lg)' ? 'var(--fs-verse-md)' : type.fontSize };
  const byKey = new Map(verses.map((v) => [v.n, v]));
  const sections = chapterSections(s, verses);
  const origTestament = s.sources?.orig?.testament ?? (isOldTestament(book.code) ? 'ot' : 'nt');

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
            <SourceTabs s={s} actions={actions} origTestament={origTestament} />
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px' }}>
              <Overline tone="accent">{s.project?.name} · {s.project?.languageTag}</Overline>
            </div>

            {sections.map((keys) => {
              const span = rangeSpan(keys);
              const sectionVerses = keys.map((k) => byKey.get(k));
              return (
                <React.Fragment key={keys[0]}>
                  <SourceCell s={s} bookCode={book.code} keys={keys} sourceModel={sourceModel} paneFocus={paneFocus} label={`${bookName(book.code)} ${s.chapter}:${span}`} />
                  <TargetCell s={s} verses={sectionVerses} keys={keys} byKey={byKey} span={span} dir={dir} type={type} editType={editType} actions={actions} />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </main>
      {s.helps && <HelpsPanel chapter={s.chapter} focusVerses={editingFocus(s.editing, s.chapter)} />}
    </div>
  );
}
