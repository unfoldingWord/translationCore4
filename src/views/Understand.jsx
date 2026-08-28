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

/** Every comprehension note whose target lands in the unit's numeric range,
 * as [verseKey, note] pairs. Membership matters because ULT and UST chunk and
 * bridge differently (one source's "4","5" is the other's "4-5"), so a note
 * journaled under one form must still SURFACE under the other. */
const unitNotes = (comprehension, chapter, unit) => {
  if (!comprehension || unit.verses.length === 0) return [];
  const lo = leadingNum(unit.verses[0]);
  const hi = trailingNum(unit.verses[unit.verses.length - 1]);
  const found = [];
  for (const [key, n] of Object.entries(comprehension)) {
    const [c, ...rest] = key.split(':');
    if (Number(c) !== Number(chapter)) continue;
    const v = rest.join(':');
    if (leadingNum(v) < lo || leadingNum(v) > hi) continue;
    found.push([v, n]);
  }
  return found;
};

/** Which note a unit's box DISPLAYS and EDITS — exact durable identities only
 * (M2, adversarial round 13): an exact head match wins; otherwise a single
 * in-range note is shown and edits CONTINUE that note's own target (the
 * chunk-drift case); with several distinct targets and no exact match the box
 * shows none — never a timestamp pick saved under a different identity. */
const displayedUnitNote = (comprehension, chapter, unit) => {
  const entries = unitNotes(comprehension, chapter, unit);
  const exact = entries.find(([v]) => String(v) === String(unit.head));
  const shown = exact ?? (entries.length === 1 ? entries[0] : null);
  return {
    text: shown ? shown[1].text : '',
    targetVerse: shown ? shown[0] : unit.head,
    hasAny: entries.length > 0,
    hiddenCount: entries.length - (shown ? 1 : 0),
  };
};

/** Unsaved drafts parked when a box's DURABLE TARGET changes underneath it
 * (O1, adversarial round 15): keyed by project|book|chapter:verse, restored by
 * whichever box next shows that target (e.g. the Verse-view box after an
 * exact-head note displaced the section box's display). Cleared on save,
 * dismissal, or when the stash equals the stored text. Module-level: survives
 * remounts, never touches the journal. */
const draftStash = new Map();

/** The comprehension box (#106's only write): saves on blur through
 * actions.saveComprehension; everything else on the screen is read-only. */
function ComprehensionBox({ book, chapter, unit }) {
  const { s, actions } = useApp();
  // DISABLED until the persisted notes have actually been read (A3, 2026-08-27
  // adversarial review): a writable empty box over an unread grow-only store
  // invites irreversible duplicates. null = not read; {} = read and empty.
  const ready = s.understand?.comprehension != null;
  // J2: a cross-frame unit reads its EXACT project reference — fan-out units
  // (two project verses, one source ref) keep their own distinct notes.
  // Same-frame units follow the exact-identity display rule (M2).
  const shown = unit.project
    ? {
        text: s.understand?.comprehension?.[`${unit.project.chapter}:${unit.project.verse}`]?.text ?? '',
        targetVerse: unit.project.verse,
        hiddenCount: 0,
      }
    : displayedUnitNote(s.understand?.comprehension, chapter, unit);
  const stored = shown.text;
  // The box's target identity is FULLY scoped (F1, adversarial round 6):
  // unit keys like "s1"/"v1"/"whole" repeat across chapters and books, so
  // book AND chapter are part of the identity — a chapter switch always
  // resets to the new target's stored value and never re-marks the previous
  // chapter's draft dirty under the new one. (Blur has already fired the
  // previous target's save by the time the identity changes.)
  // The DURABLE TARGET and the source tab are part of the identity (N2,
  // adversarial round 14): ULT and UST can share a unit key ('s1') with
  // different ranges, and a same-key unit whose displayed note targets a
  // DIFFERENT verse is a different editing context — the draft must reset,
  // never carry over to be journaled under the new target.
  const identity = `${book}|${chapter}|${s.sourceTab}|${unit.key}|${unit.project ? unit.project.verse : shown.targetVerse}`;
  // A cross-frame unit's durable identity is its PROJECT reference (I1).
  const dirtyKey = unit.project
    ? `${book}|${unit.project.chapter}:${unit.project.verse}`
    : `${book}|${chapter}:${shown.targetVerse}`;
  // E1 (adversarial round 5): a stored update must never CLOBBER a draft the
  // user has typed since — sync from stored only while the box still shows
  // the previous stored value; a diverged draft stays, and its dirty mark is
  // re-asserted (the state layer clears dirty on ITS latest save's success,
  // which cannot see text typed after that save started).
  const stashKey = `${s.project?.repoPath}|${dirtyKey}`;
  // A freshly MOUNTED box also restores a parked draft (O1): a target that
  // lost its section-box display reappears as a Verse-view unit, and its
  // unsaved text must come back with it.
  const [text, setText] = React.useState(() => {
    const stash = draftStash.get(stashKey);
    return stash != null && stash.trim() !== stored.trim() ? stash : stored;
  });
  React.useEffect(() => {
    const stash = draftStash.get(stashKey);
    if (stash != null && stash.trim() !== stored.trim()) actions.setNoteDirty(dirtyKey, true);
    else if (stash != null) draftStash.delete(stashKey);
    // mount-only: later target changes go through the identity effect below
  }, []);
  const prevStoredRef = React.useRef(stored);
  const identityRef = React.useRef(identity);
  const prevStashKeyRef = React.useRef(stashKey);
  React.useEffect(() => {
    const identityChanged = identityRef.current !== identity;
    identityRef.current = identity;
    if (identityChanged) {
      // O1: park a diverged draft under its OLD durable target before
      // switching — its dirty flag stays set, and the box that next shows
      // that target restores it. The draft is never silently discarded.
      if (text !== prevStoredRef.current && text.trim() !== prevStoredRef.current.trim()) {
        draftStash.set(prevStashKeyRef.current, text);
      }
      const stash = draftStash.get(stashKey);
      if (stash != null && stash.trim() !== stored.trim()) {
        setText(stash);
        actions.setNoteDirty(dirtyKey, true);
      } else {
        draftStash.delete(stashKey);
        setText(stored);
      }
    } else if (text === prevStoredRef.current) {
      setText(stored);
    } else if (text.trim() !== stored.trim()) {
      actions.setNoteDirty(dirtyKey, true);
    }
    prevStoredRef.current = stored;
    prevStashKeyRef.current = stashKey;
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
  // The save target's coordinates — also the failure-ledger identity (K1).
  // Editing a DISPLAYED note continues that note's own durable target (M2);
  // a fresh note targets the unit head.
  const target = unit.project
    ? { chapter: unit.project.chapter, verse: unit.project.verse }
    : { chapter, verse: shown.targetVerse };
  const save = () => {
    if (text.trim() === stored.trim()) {
      // Reverted to the stored text: an earlier FAILED write for this target
      // is abandoned — dismiss it, or navigation stays blocked and Retry
      // would append the abandoned draft (K1).
      draftStash.delete(stashKey);
      actions.dismissNoteError(target.chapter, target.verse);
      return;
    }
    if (text.trim() === '' && stored.trim() !== '') {
      setText(stored);
      draftStash.delete(stashKey);
      actions.setNoteDirty(dirtyKey, false);
      actions.dismissNoteError(target.chapter, target.verse);
      setClearRefused(true);
      return;
    }
    draftStash.delete(stashKey); // the write (or its failure ledger) owns the text now
    if (unit.project) {
      // I1/J2: the exact project-frame reference is written VERBATIM and is
      // also the storage/echo key.
      actions.saveComprehension(unit.project.chapter, unit.project.verse, text, { projectFrame: true });
    } else {
      // M2: the displayed note's own target — never re-keyed to the head.
      actions.saveComprehension(chapter, shown.targetVerse, text);
    }
  };
  return (
    <>
      <TextArea rows={2} value={text} disabled={!ready}
        onChange={(e) => {
          setText(e.target.value);
          setClearRefused(false);
          const diverged = e.target.value.trim() !== stored.trim();
          // Keyed per fully-scoped target (C2/F2): this box's flag, nobody else's.
          actions.setNoteDirty(dirtyKey, diverged);
          // Typing back to the stored text abandons a failed draft (K1).
          if (!diverged) actions.dismissNoteError(target.chapter, target.verse);
        }}
        onBlur={save}
        placeholder={t('understand.commentsPlaceholder')} />
      {clearRefused && (
        <p data-testid="understand-clear-refused" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--tc-warn-text)', margin: '6px 0 0' }}>
          {t('understand.cannotClear')}
        </p>
      )}
      {shown.hiddenCount > 0 && (
        // M2: several distinct saved notes live inside this section — say so
        // and point at Verse view; never pick one by timestamp.
        <p data-testid="understand-notes-in-section" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
          {t('understand.notesInSection', { n: shown.hiddenCount })}
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
                    {(u?.sourceRefs?.[String(chapter)]
                      // H1: a cross-frame project reads the simplified text at
                      // the MAPPED source references, never at its own number.
                      ? u.sourceRefs[String(chapter)]
                          .filter((r) => !r.unmapped)
                          .map((r) => `${r.c}:${r.v} ${verseText(simplified.chapters?.[String(r.c)]?.[String(r.v)])}`)
                      : Object.entries(simplified.chapters?.[String(chapter)] ?? {})
                          .filter(([k]) => /^\d/.test(k))
                          .sort(([a], [b]) => leadingNum(a) - leadingNum(b))
                          .map(([k, v]) => `${k} ${verseText(v)}`))
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
    // bookRaw is a dependency (O2): openBook publishes the book before its
    // bytes; a cross-frame project needs the bytes to build sourceRefs, and
    // without the re-run it would render nothing for the new book.
  }, [s.book, s.bookRaw, s.projectPins, s.netEnabled]);

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
  // H1 (adversarial round 8): a cross-frame project must NOT index the
  // eng-frame source with its own chapter number. loadUnderstand supplies
  // per-project-chapter SOURCE references (mapped once per load); each ref
  // becomes its own unit labeled with the source reference, and an
  // unmappable project verse is stated, never guessed. Same-frame projects
  // (sourceRefs null — the uW default) keep the section/verse chunking.
  // sourceRefs != null means CROSS-FRAME — even with no refs yet (O2): the
  // view must never fall back to indexing the eng source with project-frame
  // chapter numbers while the book bytes load.
  const crossFrame = s.understand?.sourceRefs != null;
  const crossRefs = crossFrame ? s.understand.sourceRefs[String(chapter)] ?? [] : null;
  if (crossFrame) {
    for (const r of crossRefs) {
      if (r.unmapped) {
        units.push({ key: `u${r.unmapped}`, unmapped: r.unmapped });
      } else {
        // Keyed by the PROJECT ref (I1): fan-out gives two project verses the
        // same source ref, and each must stay its own unit with its own
        // exact journal identity.
        units.push({ key: `m${r.pc}:${r.pv}`, srcChapter: r.c, head: r.v, project: { chapter: r.pc, verse: r.pv }, label: `${bookName(book.code)} ${r.c}:${r.v}`, verses: [r.v] });
      }
    }
  } else if (mode === 'section' && starts.length > 0) {
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
            {units.map((u) => u.unmapped ? (
              <Callout key={u.key} tone="info" data-testid={`understand-unit-${u.key}`} style={{ marginTop: 18 }}>
                {t('understand.verseUnmapped', { ref: u.unmapped })}
              </Callout>
            ) : (
              <div key={u.key} data-testid={`understand-unit-${u.key}`} style={{ marginTop: 18, borderRadius: 'var(--radius-xl)', padding: '12px 16px', background: '#fff', border: 'var(--stroke) solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: 'var(--stroke) solid var(--border)' }}>
                  <Overline>{u.label}</Overline>
                  <div style={{ flex: 1 }} />
                  {(u.project
                    ? s.understand?.comprehension?.[`${u.project.chapter}:${u.project.verse}`]
                    : displayedUnitNote(s.understand?.comprehension, chapter, u).hasAny)
                    ? <StatusDot status="valid" size={7} /> : null}
                </div>
                <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', margin: '10px 0 12px' }}>
                  {u.verses.map((k) => {
                    // Cross-frame units carry their SOURCE chapter (H1).
                    const chapVerses = u.srcChapter != null
                      ? (src && src !== 'missing' ? src.chapters?.[String(u.srcChapter)] ?? {} : {})
                      : srcChapters;
                    return (
                      <React.Fragment key={k}>
                        <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{k}</sup>
                        {verseText(chapVerses[String(k)])}{' '}
                      </React.Fragment>
                    );
                  })}
                </p>
                <ComprehensionBox book={book.code} chapter={u.srcChapter ?? chapter} unit={u} />
              </div>
            ))}
          </div>
        </div>
      </main>
      <HelpsPanel chapter={chapter} />
    </div>
  );
}
