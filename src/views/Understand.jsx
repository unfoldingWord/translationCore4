// Understand — the read-first pass (D63, epic #104 / #106). The source
// passage (ULT/UST, by section or by verse) with its helps: tN notes, tW key
// terms, tQ questions, the simplified text, and linked tA articles. The ONLY
// control that writes to the project is the comprehension-notes box (owner
// ruling 2026-08-27): it persists through the §8.5 journal (note.add).
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { renderArticleBlocks } from '../data/articles';
import { t } from '../i18n';
import BookRail from './BookRail.jsx';
import { verseText } from './verseText.js';
import { FilterChip, IconButton, Overline, SegmentedControl, StatusDot, Tabs, TextArea, HelpCard, Callout, Button } from '../ds/index.js';

// The leading verse number of a chapter key — span keys ("17-18") are real
// USFM verse bridges (see usfm/indexer.ts) and MUST NOT be dropped.
const leadingNum = (key) => Number(String(key).split('-')[0]);

// Section starts for one chapter, from the source's own \ts\* chunk markers.
// Display-only: a source without markers yields one whole-chapter section.
const sectionStarts = (raw, chapter) => {
  if (!raw) return [];
  const chapters = raw.split(/\\c\s+(\d+)/);
  const i = chapters.findIndex((part, idx) => idx % 2 === 1 && Number(part) === Number(chapter));
  if (i === -1) return [];
  const body = chapters[i + 1] ?? '';
  const starts = [];
  // A \ts\* often sits BEFORE \c (closing the previous chunk), so the
  // chapter's first verse always starts a section even when no in-body marker
  // precedes it.
  const first = body.match(/\\v\s+(\d+)/);
  if (first) starts.push(Number(first[1]));
  for (const seg of body.split(/\\ts\\\*/).slice(1)) {
    const m = seg.match(/\\v\s+(\d+)/);
    if (m && !starts.includes(Number(m[1]))) starts.push(Number(m[1]));
  }
  return starts.sort((a, b) => a - b);
};

/** The last verse number a chapter key reaches ("4-5" → 5, "4" → 4). */
const trailingNum = (key) => Number(String(key).split('-').pop());

/** The latest comprehension note within a unit's verse range. Retrieval is by
 * NUMERIC MEMBERSHIP, not by exact head key: ULT and UST chunk chapters
 * differently AND bridge verses differently (one source's "4","5" is the
 * other's "4-5"), so a note journaled under one form must still surface under
 * the other (2026-08-27 reviews). Notes are grow-only (§8.5), so "latest" is
 * the highest ts among the notes landing in the unit's range. */
const latestUnitNote = (comprehension, chapter, unit) => {
  if (!comprehension || unit.verses.length === 0) return null;
  const lo = leadingNum(unit.verses[0]);
  const hi = trailingNum(unit.verses[unit.verses.length - 1]);
  let best = null;
  for (const [key, n] of Object.entries(comprehension)) {
    const [c, ...rest] = key.split(':');
    if (Number(c) !== Number(chapter)) continue;
    const v = leadingNum(rest.join(':'));
    if (v < lo || v > hi) continue;
    if (!best || String(n.ts) > String(best.ts)) best = n;
  }
  return best;
};

/** The comprehension box (#106's only write): saves on blur through
 * actions.saveComprehension; everything else on the screen is read-only. */
function ComprehensionBox({ book, chapter, unit }) {
  const { s, actions } = useApp();
  // DISABLED until the persisted notes have actually been read (A3, 2026-08-27
  // adversarial review): a writable empty box over an unread grow-only store
  // invites irreversible duplicates. null = not read; {} = read and empty.
  const ready = s.understand?.comprehension != null;
  const stored = latestUnitNote(s.understand?.comprehension, chapter, unit)?.text ?? '';
  const [text, setText] = React.useState(stored);
  // The box's target identity is FULLY scoped (F1, adversarial round 6):
  // unit keys like "s1"/"v1"/"whole" repeat across chapters and books, so
  // book AND chapter are part of the identity — a chapter switch always
  // resets to the new target's stored value and never re-marks the previous
  // chapter's draft dirty under the new one. (Blur has already fired the
  // previous target's save by the time the identity changes.)
  const identity = `${book}|${chapter}|${unit.key}`;
  const dirtyKey = `${book}|${chapter}:${unit.head}`;
  // E1 (adversarial round 5): a stored update must never CLOBBER a draft the
  // user has typed since — sync from stored only while the box still shows
  // the previous stored value; a diverged draft stays, and its dirty mark is
  // re-asserted (the state layer clears dirty on ITS latest save's success,
  // which cannot see text typed after that save started).
  const prevStoredRef = React.useRef(stored);
  const identityRef = React.useRef(identity);
  React.useEffect(() => {
    const identityChanged = identityRef.current !== identity;
    identityRef.current = identity;
    if (identityChanged || text === prevStoredRef.current) {
      setText(stored);
    } else if (text.trim() !== stored.trim()) {
      actions.setNoteDirty(dirtyKey, true);
    }
    prevStoredRef.current = stored;
  }, [stored, identity]);
  // Compare against the note the box DISPLAYS: notes are grow-only, so an
  // unchanged focus/blur must never append a duplicate (2026-08-27 Codex
  // review). unit.head is the RAW first verse key — a bridge ("4-5") keeps
  // its exact source-side key; the save action maps it into the project
  // frame before journaling (A1).
  // Dirty is NOT cleared here (B1): only a SUCCESSFUL persist clears it, in
  // saveComprehension — otherwise a failed write after a tab switch loses
  // the unload warning too.
  // G1 (adversarial round 7): §8.5 v1 notes are grow-only — a CLEAR cannot
  // persist. Rejecting it silently would strand the dirty flag and resurrect
  // the old text later; instead the box restores the saved note, says why,
  // and reconciles its dirty mark.
  const [clearRefused, setClearRefused] = React.useState(false);
  const save = () => {
    if (text.trim() === stored.trim()) return;
    if (text.trim() === '' && stored.trim() !== '') {
      setText(stored);
      actions.setNoteDirty(dirtyKey, false);
      setClearRefused(true);
      return;
    }
    actions.saveComprehension(chapter, unit.head, text);
  };
  return (
    <>
      <TextArea rows={2} value={text} disabled={!ready}
        onChange={(e) => {
          setText(e.target.value);
          setClearRefused(false);
          // Keyed per fully-scoped target (C2/F2): this box's flag, nobody else's.
          actions.setNoteDirty(dirtyKey, e.target.value.trim() !== stored.trim());
        }}
        onBlur={save}
        placeholder={t('understand.commentsPlaceholder')} />
      {clearRefused && (
        <p data-testid="understand-clear-refused" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--tc-warn-text)', margin: '6px 0 0' }}>
          {t('understand.cannotClear')}
        </p>
      )}
    </>
  );
}

function ArticleView({ article, onClose }) {
  if (!article) return null;
  return (
    <div style={{ borderTop: 'var(--stroke-hair) solid var(--border-hair)', padding: 16, overflow: 'auto', maxHeight: '45%', flex: 'none', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>
          {article.loading ? t('check.articleLoading') : article.found?.title ?? ''}
        </span>
        <IconButton size={26} title={t('common.close')} onClick={onClose}>✕</IconButton>
      </div>
      {!article.loading && !article.found && (
        <Callout tone="warn" data-testid="understand-article-missing">{t('check.articleMissing')}</Callout>
      )}
      {!article.loading && article.found && (
        <div data-testid="understand-article">
          {renderArticleBlocks(article.found.body).slice(0, 40).map((b, i) => (
            <p key={i} style={{
              fontSize: b.kind === 'h' ? 'var(--fs-caption-lg)' : 'var(--fs-ui-sm)',
              fontWeight: b.kind === 'h' ? 'var(--fw-heavy)' : 'var(--fw-regular)',
              color: b.kind === 'h' ? 'var(--uw-ocean)' : 'var(--text-secondary)',
              lineHeight: 'var(--lh-body)', margin: b.kind === 'h' ? '12px 0 4px' : '0 0 8px',
              paddingInlineStart: b.kind === 'li' ? 14 : 0,
            }}>{b.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** One helps slot's designed non-ready state — absence is stated, never blank. */
function SlotState({ slot }) {
  const state = slot?.state ?? 'none';
  if (state === 'error') {
    // A malformed resource is THIS slot's error (A3) — stated, never a false
    // absence claim, and never fatal to the other tabs.
    return (
      <Callout tone="warn" role="alert" data-testid="helps-state-error" style={{ overflowWrap: 'anywhere' }}>
        {t('understand.helpError')} {slot.error}
      </Callout>
    );
  }
  const map = {
    none: t('understand.helpNone'),
    unavailable: t('understand.helpUnavailable'),
    fetch: t('understand.helpFetch'),
    missing: t('understand.helpMissing'),
  };
  const text = map[state] ?? (state.startsWith('versification-') ? t(`check.empty.${state}.title`) : t('understand.helpNone'));
  return (
    <Callout tone="info" data-testid={`helps-state-${state}`}>{text}</Callout>
  );
}

/** #15 / B20 banners shared by every ready tab: the versification-dropped
 * count MUST be surfaced wherever derived items are shown, and a fallback
 * answering for an absent primary is never silent. */
function SlotBanners({ slot }) {
  if (slot?.state !== 'ready') return null;
  return (
    <>
      {slot.unavailablePrimary && (
        <Callout tone="warn" data-testid="understand-fallback-warning">
          {t('understand.helpFallback')}
        </Callout>
      )}
      {slot.dropped && (
        <Callout tone="warn" data-testid="understand-dropped">
          {t('check.droppedNote', { count: slot.dropped.count, scheme: slot.dropped.scheme ?? '—' })}
        </Callout>
      )}
    </>
  );
}

function HelpsPanel({ chapter }) {
  const { s, actions } = useApp();
  const u = s.understand;
  const tab = s.helpsTab;
  const loading = !u || u.loading;
  const inChapter = (slot) =>
    slot?.state === 'ready'
      ? slot.items.filter((it) => Number(it.contextId.reference.chapter) === Number(chapter))
      : [];
  const notes = inChapter(u?.notes);
  const words = inChapter(u?.words);
  const questions = inChapter(u?.questions);
  // tA modules linked from this chapter's notes, deduped, in first-note order.
  // A plain note (no SupportReference — kept for this read-only surface) has
  // groupId '' and links nowhere.
  const academySlugs = [...new Set(notes.map((n) => n.contextId.groupId))].filter(Boolean);
  const empty = <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>{t('understand.noneForChapter')}</p>;
  const simplified = u?.simplified;

  return (
    <aside data-testid="helps-panel" style={{ width: 'var(--helps-width)', flex: 'none', background: 'var(--surface-panel)', borderInlineStart: 'var(--stroke-hair) solid var(--border-hair)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Tabs value={tab} onChange={actions.setHelpsTab} tabs={[
        { value: 'notes', label: t('helps.notes') },
        { value: 'words', label: t('helps.words') },
        { value: 'questions', label: t('helps.questions') },
        { value: 'simplified', label: t('helps.simplified') },
        { value: 'academy', label: t('helps.academy') },
      ]} />
      <div style={{ flex: 1, overflow: 'auto', padding: 16, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Loading and a failed load are their OWN states — never rendered as
            "the package lacks this resource" (D30 honesty; 2026-08-27 review). */}
        {loading && (
          <p data-testid="helps-loading" style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', margin: 0 }}>{t('understand.loading')}</p>
        )}
        {!loading && u?.error && (
          <Callout tone="warn" role="alert" data-testid="understand-error" style={{ overflowWrap: 'anywhere' }}>{u.error}</Callout>
        )}
        {!loading && !u?.error && (
          <>
            {tab === 'notes' && (<>
              <SlotBanners slot={u?.notes} />
              {u?.notes?.state !== 'ready' ? <SlotState slot={u?.notes} /> : notes.length === 0 ? empty
                : notes.map((n, i) => (
                  <HelpCard key={`${n.contextId.checkId}-${i}`} kind="note" verse={n.contextId.reference.verse}
                    title={n.contextId.quoteString || n.contextId.groupId} body={n.contextId.occurrenceNote.slice(0, 400)}
                    actionLabel={t('understand.academyLink')}
                    onAction={n.contextId.groupId
                      ? () => actions.loadHelpArticle({ kind: 'ta', slug: n.contextId.groupId, rung: u.notes.rung })
                      : undefined} />
                ))}
            </>)}
            {tab === 'words' && (<>
              <SlotBanners slot={u?.words} />
              {u?.words?.state !== 'ready' ? <SlotState slot={u?.words} /> : words.length === 0 ? empty
                : words.map((w, i) => (
                  <HelpCard key={`${w.contextId.checkId}-${i}`} kind="word" verse={w.contextId.reference.verse}
                    title={w.contextId.quoteString || w.contextId.groupId} body={w.contextId.groupId}
                    actionLabel={t('understand.wordLink')}
                    onAction={() => actions.loadHelpArticle({ kind: 'tw', category: w.category, slug: w.contextId.groupId, rung: u.words.rung })} />
                ))}
            </>)}
            {tab === 'questions' && (<>
              <SlotBanners slot={u?.questions} />
              {u?.questions?.state !== 'ready' ? <SlotState slot={u?.questions} /> : questions.length === 0 ? empty
                : questions.map((q, i) => (
                  <div key={`${q.contextId.checkId}-${i}`} data-testid="understand-question"
                    style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, background: '#fff' }}>
                    <p style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '0 0 6px' }}>{q.question}</p>
                    <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)', margin: 0 }}>
                      <span style={{ color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>{t('understand.answer')} · </span>{q.response}
                    </p>
                  </div>
                ))}
            </>)}
            {tab === 'simplified' && (
              // D64: the content is the resolved simplifiedText slot — the
              // gateway's own simplified Bible when its set pins one.
              simplified?.state === 'ready' ? (
                <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' }} data-testid="understand-simplified">
                  <Overline>{t('understand.simplifiedTitle')}</Overline>
                  <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)', margin: '10px 0 0' }}>
                    {Object.entries(simplified.chapters?.[String(chapter)] ?? {})
                      .filter(([k]) => /^\d/.test(k))
                      .sort(([a], [b]) => leadingNum(a) - leadingNum(b))
                      .map(([k, v]) => `${k} ${verseText(v)}`)
                      .join(' ') || t('understand.noneForChapter')}
                  </p>
                </div>
              ) : <SlotState slot={simplified} />
            )}
            {tab === 'academy' && (<>
              {u?.notes?.state !== 'ready' ? <SlotState slot={u?.notes} /> : academySlugs.length === 0 ? empty
                : academySlugs.map((slug) => (
                  <Button key={slug} variant="secondary" onClick={() => actions.loadHelpArticle({ kind: 'ta', slug, rung: u.notes.rung })}
                    style={{ justifyContent: 'space-between', width: '100%', borderRadius: 'var(--radius-lg)', textAlign: 'start' }}>
                    <span>{slug}</span><span style={{ color: 'var(--accent)' }}>→</span>
                  </Button>
                ))}
            </>)}
          </>
        )}
      </div>
      <ArticleView article={u?.article} onClose={actions.closeHelpArticle} />
    </aside>
  );
}

export default function Understand() {
  const { s, book, actions } = useApp();
  const [mode, setMode] = React.useState('section');
  React.useEffect(() => {
    actions.loadUnderstand();
  }, [s.book, s.projectPins, s.netEnabled]);

  if (!book) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }}>
        {s.bookError ? `${t('draft.loadError')} ${s.bookError}` : t('draft.loading')}
      </div>
    );
  }

  const chapter = s.chapter;
  const src = s.sources[s.sourceTab];
  const srcChapters = src && src !== 'missing' ? src.chapters?.[String(chapter)] ?? {} : {};
  // Chapter keys INCLUDING verse bridges ("17-18") — a span is a real verse
  // that must render (2026-08-27 review); ordered by leading number.
  const verseKeys = Object.keys(srcChapters)
    .filter((k) => /^\d+(-\d+)?$/.test(k))
    .sort((a, b) => leadingNum(a) - leadingNum(b));
  const starts = mode === 'section' && src && src !== 'missing' ? sectionStarts(src.raw, chapter) : [];
  const rangeLabel = (keys) => {
    const from = keys[0];
    const to = keys[keys.length - 1];
    return keys.length > 1 || String(from).includes('-')
      ? t('understand.versesRange', { from: leadingNum(from), to: String(to).includes('-') ? String(to).split('-')[1] : leadingNum(to) })
      : t('understand.verseOne', { n: from });
  };
  const units = [];
  if (mode === 'section' && starts.length > 0) {
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] - 1 : Infinity;
      const keys = verseKeys.filter((k) => leadingNum(k) >= from && leadingNum(k) <= to);
      if (keys.length) units.push({ key: `s${from}`, head: keys[0], label: rangeLabel(keys), verses: keys });
    }
  } else if (mode === 'section') {
    if (verseKeys.length) units.push({ key: 'whole', head: verseKeys[0], label: `${bookName(book.code)} ${chapter}`, verses: verseKeys });
  } else {
    for (const k of verseKeys) units.push({ key: `v${k}`, head: k, label: rangeLabel([k]), verses: [k] });
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="understand">
      {s.rail && <BookRail />}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', background: '#fff', flex: 'none' }}>
          <IconButton title={t('draft.toggleRail')} onClick={actions.toggleRail}>≡</IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0 }}>{bookName(book.code)} {chapter}</h2>
          <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('understand.note')}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, background: 'var(--surface-app)' }}>
          <div style={{ maxWidth: 'var(--measure-read)', margin: '0 auto', padding: '22px 26px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              {['ult', 'ust'].map((id) => (
                <FilterChip key={id} tone="ocean" selected={s.sourceTab === id} onClick={() => actions.setSourceTab(id)}
                  style={{ padding: '4px 10px', fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', borderWidth: 1 }}>
                  {t(`source.${id}`)}
                </FilterChip>
              ))}
              <div style={{ flex: 1 }} />
              <Overline style={{ letterSpacing: '.1em' }}>{t('understand.commentsBy')}</Overline>
              <SegmentedControl size="sm" tone="ocean" value={mode} onChange={setMode}
                options={[{ value: 'section', label: t('understand.bySection') }, { value: 'verse', label: t('understand.byVerse') }]} />
            </div>
            {(s.understand?.unmappedNotes ?? 0) > 0 && (
              // B2: notes whose project-frame identity has no place in this
              // source's numbering are COUNTED, never shown under a guessed
              // verse.
              <Callout tone="warn" data-testid="understand-unmapped-notes" style={{ marginTop: 10 }}>
                {t('understand.unmappedNotes', { n: s.understand.unmappedNotes })}
              </Callout>
            )}
            {s.understand?.saveError && (
              <Callout tone="warn" role="alert" data-testid="understand-save-error" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>
                <strong>{t('understand.saveFailed')}</strong> {s.understand.saveError}
              </Callout>
            )}
            {src === 'missing' && (
              <Callout tone="info" style={{ marginTop: 10 }}>{t('understand.sourceMissing')}</Callout>
            )}
            {!src && (
              <p style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)', marginTop: 10 }}>{t('understand.loading')}</p>
            )}
            {units.map((u) => (
              <div key={u.key} data-testid={`understand-unit-${u.key}`} style={{ marginTop: 18, borderRadius: 'var(--radius-xl)', padding: '12px 16px', background: '#fff', border: 'var(--stroke) solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: 'var(--stroke) solid var(--border)' }}>
                  <Overline>{u.label}</Overline>
                  <div style={{ flex: 1 }} />
                  {latestUnitNote(s.understand?.comprehension, chapter, u) ? <StatusDot status="valid" size={7} /> : null}
                </div>
                <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', margin: '10px 0 12px' }}>
                  {u.verses.map((k) => (
                    <React.Fragment key={k}>
                      <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{k}</sup>
                      {verseText(srcChapters[String(k)])}{' '}
                    </React.Fragment>
                  ))}
                </p>
                <ComprehensionBox book={book.code} chapter={chapter} unit={u} />
              </div>
            ))}
          </div>
        </div>
      </main>
      <HelpsPanel chapter={chapter} />
    </div>
  );
}
