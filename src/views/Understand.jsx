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

/** S3 (adversarial round 19): cross-frame mode with ZERO refs is the SAFE
 * degraded state — the frame's mapping is unavailable or unknown, and the
 * passage is suppressed rather than shown under a numbering the project does
 * not have. This note says so. */
function FrameUnavailableNote({ understand, unitCount }) {
  const suppressed = understand?.sourceRefs != null && unitCount === 0 && !understand?.loading;
  if (!suppressed) return null;
  return (
    <Callout tone="warn" data-testid="understand-frame-unavailable" style={{ marginTop: 10 }}>
      {t('understand.frameUnavailable')}
    </Callout>
  );
}

/** The comprehension box (#106's only write): stages every divergent edit
 * into the note SaveScheduler (D65) and flushes on blur; everything else on
 * the screen is read-only. The scheduler buffer is the draft store — it
 * survives unmounts and identity flips (the old module stash and its
 * park/restore effects are gone with the defect classes they bred). */
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
  // book AND chapter are part of the identity. The DURABLE TARGET and the
  // source tab are part of it too (N2): ULT and UST can share a unit key
  // ('s1') with different ranges — a different displayed target is a
  // different editing context.
  const identity = `${book}|${chapter}|${s.sourceTab}|${unit.key}|${unit.project ? unit.project.verse : shown.targetVerse}`;
  // The save target's coordinates — a cross-frame unit's durable identity is
  // its verbatim PROJECT reference (I1), written unmapped (projectFrame).
  const target = unit.project
    ? { chapter: unit.project.chapter, verse: unit.project.verse, projectFrame: true, stored }
    : { chapter, verse: shown.targetVerse, projectFrame: false, stored };
  // A freshly MOUNTED box restores its staged draft from the scheduler
  // buffer (O1/P1 structurally): whatever was typed and not yet flushed —
  // or flushed and persisted — is the buffer's latest value.
  const [text, setText] = React.useState(() => actions.stagedNote(target) ?? stored);
  const identityRef = React.useRef(identity);
  const prevStoredRef = React.useRef(stored);
  React.useEffect(() => {
    const identityChanged = identityRef.current !== identity;
    identityRef.current = identity;
    if (identityChanged) {
      // The new target's editing context: its staged draft (if any) or its
      // stored note. The OLD target's draft needs no parking — every
      // divergent edit was already staged into the buffer (O1 structurally).
      setText(actions.stagedNote(target) ?? stored);
    } else if (text === prevStoredRef.current || text.trim() === stored.trim()) {
      // E1: follow a stored update only while the box shows the previous
      // stored value — a diverged draft stays.
      setText(stored);
    }
    prevStoredRef.current = stored;
  }, [stored, identity]);
  // Compare against the note the box DISPLAYS: notes are grow-only, so an
  // unchanged focus/blur must never append a duplicate (2026-08-27 Codex
  // review). unit.head is the RAW first verse key — a bridge ("4-5") keeps
  // its exact source-side key; the writer maps it into the project frame
  // before journaling (A1).
  // G1 (adversarial round 7): §8.5 v1 notes are grow-only — a CLEAR cannot
  // persist. An emptied box is NEVER staged; blur restores the saved note
  // and says why. Because the emptiness never reaches the buffer, no dirty
  // state can strand (round 22 — the class is gone, not patched).
  const [clearRefused, setClearRefused] = React.useState(false);
  const save = () => {
    if (text.trim() === '' && stored.trim() !== '') {
      setText(stored);
      setClearRefused(true);
      return;
    }
    if (text.trim() !== stored.trim()) actions.flushNotes();
  };
  return (
    <>
      <TextArea rows={2} value={text} disabled={!ready}
        onChange={(e) => {
          setText(e.target.value);
          setClearRefused(false);
          const next = e.target.value;
          // Stage every edit. An EMPTIED box REVERTS the target to the
          // scheduler's latest persisted value instead (G1 + round 32: a
          // clear never becomes a buffered write, and staging the
          // render-time stored snapshot could journal a STALE text over an
          // in-flight newer one — the version-aware revert cannot be
          // outrun). Typing back to the stored text still stages it — that
          // is the user's own typed content, and it abandons a failed draft
          // by comparison (K1).
          if (next.trim() === '') actions.revertNote(target);
          else actions.stageNote(target, next);
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
  const { actions } = useApp();
  const state = slot?.state ?? 'none';
  if (state === 'error') {
    // A malformed resource OR a failed read is THIS slot's error (A3,
    // round 31) — stated, never a false absence claim, never fatal to the
    // other tabs, and retryable in place (a transient transport failure
    // must not strand the tab until an unrelated navigation).
    return (
      <Callout tone="warn" role="alert" data-testid="helps-state-error" style={{ overflowWrap: 'anywhere' }}>
        {t('understand.helpError')} {slot.error}{' '}
        <Button size="sm" variant="outline" data-testid="helps-retry" onClick={() => actions.loadUnderstand()}>
          {t('app.retry')}
        </Button>
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

const itemsInChapter = (slot, chapter) =>
  slot?.state === 'ready'
    ? slot.items.filter((it) => Number(it.contextId.reference.chapter) === Number(chapter))
    : [];

const emptyChapter = (
  <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>
    {t('understand.noneForChapter')}
  </p>
);

/** Round 33: real tN notes exceed 400 characters (the shipped Titus fixture
 * carries 425-940+), and a silent cut removes the guidance's qualifications
 * and examples. Long bodies collapse to a preview with an accessible control
 * that reveals the exact full text. */
function ExpandableNote({ text }) {
  const [expanded, setExpanded] = React.useState(false);
  if (text.length <= 400) return text;
  return (
    <>
      {expanded ? text : `${text.slice(0, 400)}\u2026 `}
      <button type="button" data-testid="note-expand" aria-expanded={expanded}
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--accent)', padding: 0 }}>
        {expanded ? t('understand.showLess') : t('understand.showMore')}
      </button>
    </>
  );
}

function NotesTab({ slot, notes, actions }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return <>
    <SlotBanners slot={slot} />
    {notes.length === 0 ? emptyChapter : notes.map((n, i) => (
      <HelpCard key={`${n.contextId.checkId}-${i}`} kind="note" verse={n.contextId.reference.verse}
        title={n.contextId.quoteString || n.contextId.groupId} body={<ExpandableNote text={n.contextId.occurrenceNote} />}
        actionLabel={t('understand.academyLink')}
        onAction={n.contextId.groupId
          ? () => actions.loadHelpArticle({ kind: 'ta', slug: n.contextId.groupId, rung: slot.rung })
          : undefined} />
    ))}
  </>;
}

function WordsTab({ slot, words, actions }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return <>
    <SlotBanners slot={slot} />
    {words.length === 0 ? emptyChapter : words.map((w, i) => (
      <HelpCard key={`${w.contextId.checkId}-${i}`} kind="word" verse={w.contextId.reference.verse}
        title={w.contextId.quoteString || w.contextId.groupId} body={w.contextId.groupId}
        actionLabel={t('understand.wordLink')}
        onAction={() => actions.loadHelpArticle({ kind: 'tw', category: w.category, slug: w.contextId.groupId, rung: slot.rung })} />
    ))}
  </>;
}

function QuestionsTab({ slot, questions }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return <>
    <SlotBanners slot={slot} />
    {questions.length === 0 ? emptyChapter : questions.map((q, i) => (
      <div key={`${q.contextId.checkId}-${i}`} data-testid="understand-question"
        style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, background: '#fff' }}>
        <p style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '0 0 6px' }}>{q.question}</p>
        <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)', margin: 0 }}>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>{t('understand.answer')} · </span>{q.response}
        </p>
      </div>
    ))}
  </>;
}

const simplifiedChapterText = (simplified, sourceRefs, chapter) => {
  const mapped = sourceRefs?.[String(chapter)];
  const verses = mapped
    ? mapped
        .filter((r) => !r.unmapped)
        .map((r) => `${r.c}:${r.v} ${verseText(simplified.chapters?.[String(r.c)]?.[String(r.v)])}`)
    : Object.entries(simplified.chapters?.[String(chapter)] ?? {})
        .filter(([k]) => /^\d/.test(k))
        .sort(([a], [b]) => leadingNum(a) - leadingNum(b))
        .map(([k, v]) => `${k} ${verseText(v)}`);
  return verses.join(' ') || t('understand.noneForChapter');
};

function SimplifiedTab({ slot, sourceRefs, chapter }) {
  if (slot?.state !== 'ready') return <SlotState slot={slot} />;
  return (
    <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' }} data-testid="understand-simplified">
      <Overline>{t('understand.simplifiedTitle')}</Overline>
      <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)', margin: '10px 0 0' }}>
        {simplifiedChapterText(slot, sourceRefs, chapter)}
      </p>
    </div>
  );
}

function AcademyTab({ notesSlot, slugs, actions }) {
  if (notesSlot?.state !== 'ready') return <SlotState slot={notesSlot} />;
  if (slugs.length === 0) return emptyChapter;
  return slugs.map((slug) => (
    <Button key={slug} variant="secondary" onClick={() => actions.loadHelpArticle({ kind: 'ta', slug, rung: notesSlot.rung })}
      style={{ justifyContent: 'space-between', width: '100%', borderRadius: 'var(--radius-lg)', textAlign: 'start' }}>
      <span>{slug}</span><span style={{ color: 'var(--accent)' }}>→</span>
    </Button>
  ));
}

function HelpsTab({ tab, u, chapter, actions }) {
  const notes = itemsInChapter(u?.notes, chapter);
  if (tab === 'notes') return <NotesTab slot={u?.notes} notes={notes} actions={actions} />;
  if (tab === 'words') return <WordsTab slot={u?.words} words={itemsInChapter(u?.words, chapter)} actions={actions} />;
  if (tab === 'questions') return <QuestionsTab slot={u?.questions} questions={itemsInChapter(u?.questions, chapter)} />;
  if (tab === 'simplified') return <SimplifiedTab slot={u?.simplified} sourceRefs={u?.sourceRefs} chapter={chapter} />;
  const slugs = [...new Set(notes.map((n) => n.contextId.groupId))].filter(Boolean);
  return <AcademyTab notesSlot={u?.notes} slugs={slugs} actions={actions} />;
}

function HelpsPanel({ chapter }) {
  const { s, actions } = useApp();
  const u = s.understand;
  const tab = s.helpsTab;
  const loading = !u || u.loading;
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
        {!loading && !u?.error && <HelpsTab tab={tab} u={u} chapter={chapter} actions={actions} />}
      </div>
      <ArticleView article={u?.article} onClose={actions.closeHelpArticle} />
    </aside>
  );
}

const unitRangeLabel = (keys) => {
  const from = keys[0];
  const to = keys[keys.length - 1];
  return keys.length > 1 || String(from).includes('-')
    ? t('understand.versesRange', { from: leadingNum(from), to: String(to).includes('-') ? String(to).split('-')[1] : leadingNum(to) })
    : t('understand.verseOne', { n: from });
};

const crossFrameUnits = (refs, book) => refs.map((r) => r.unmapped
  ? { key: `u${r.unmapped}`, unmapped: r.unmapped }
  : { key: `m${r.pc}:${r.pv}`, srcChapter: r.c, head: r.v, project: { chapter: r.pc, verse: r.pv }, label: `${bookName(book.code)} ${r.c}:${r.v}`, verses: [r.v] });

const sectionUnits = (starts, verseKeys) => {
  const units = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : Infinity;
    const keys = verseKeys.filter((k) => leadingNum(k) >= from && leadingNum(k) <= to);
    if (keys.length) units.push({ key: `s${from}`, head: keys[0], label: unitRangeLabel(keys), verses: keys });
  }
  return units;
};

const understandUnits = ({ s, book, chapter, src, srcChapters, mode }) => {
  const verseKeys = Object.keys(srcChapters)
    .filter((k) => /^\d+(-\d+)?$/.test(k))
    .sort((a, b) => leadingNum(a) - leadingNum(b));
  const crossFrame = s.understand?.sourceRefs != null;
  if (crossFrame) return crossFrameUnits(s.understand.sourceRefs[String(chapter)] ?? [], book);
  const starts = mode === 'section' && src && src !== 'missing' ? sectionStarts(src.raw, chapter) : [];
  if (mode === 'section' && starts.length > 0) return sectionUnits(starts, verseKeys);
  if (mode === 'section') return verseKeys.length
    ? [{ key: 'whole', head: verseKeys[0], label: `${bookName(book.code)} ${chapter}`, verses: verseKeys }]
    : [];
  return verseKeys.map((k) => ({ key: `v${k}`, head: k, label: unitRangeLabel([k]), verses: [k] }));
};

function UnderstandUnit({ unit, s, src, srcChapters, book, chapter }) {
  if (unit.unmapped) {
    return (
      <Callout tone="info" data-testid={`understand-unit-${unit.key}`} style={{ marginTop: 18 }}>
        {t('understand.verseUnmapped', { ref: unit.unmapped })}
      </Callout>
    );
  }
  const hasNote = unit.project
    ? s.understand?.comprehension?.[`${unit.project.chapter}:${unit.project.verse}`]
    : displayedUnitNote(s.understand?.comprehension, chapter, unit).hasAny;
  const chapterVerses = unit.srcChapter != null
    ? (src && src !== 'missing' ? src.chapters?.[String(unit.srcChapter)] ?? {} : {})
    : srcChapters;
  return (
    <div data-testid={`understand-unit-${unit.key}`} style={{ marginTop: 18, borderRadius: 'var(--radius-xl)', padding: '12px 16px', background: '#fff', border: 'var(--stroke) solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: 'var(--stroke) solid var(--border)' }}>
        <Overline>{unit.label}</Overline><div style={{ flex: 1 }} />
        {hasNote ? <StatusDot status="valid" size={7} /> : null}
      </div>
      <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', margin: '10px 0 12px' }}>
        {unit.verses.map((k) => (
          <React.Fragment key={k}>
            <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{k}</sup>
            {verseText(chapterVerses[String(k)])}{' '}
          </React.Fragment>
        ))}
      </p>
      <ComprehensionBox book={book.code} chapter={unit.srcChapter ?? chapter} unit={unit} />
    </div>
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
    // installEpoch (round 20 F2): a successful install can leave projectPins
    // byte-identical (the pin already existed; only the machine's holdings
    // changed) — without it a downloaded resource stays "fetch" until reload.
    // projectPinsLoaded (round 33): pins loaded-but-ABSENT is a legal state
    // the screen proceeds in — the flag's flip is what re-runs the load.
  }, [s.book, s.bookRaw, s.projectPins, s.projectPinsLoaded, s.netEnabled, s.installEpoch]);

  if (!book) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }}>
        {s.bookError ? `${t('draft.loadError')} ${s.bookError}` : t('draft.loading')}
      </div>
    );
  }

  const chapter = s.chapter;
  const crossFrame = s.understand?.sourceRefs != null;
  const src = s.sources[s.sourceTab];
  const srcChapters = src && src !== 'missing' ? src.chapters?.[String(chapter)] ?? {} : {};
  const units = understandUnits({ s, book, chapter, src, srcChapters, mode });

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
              {crossFrame ? (
                // Round 32 (D30 honesty): cross-frame units are one-per-project-
                // verse — a Section/Verse control would be two labels for one
                // rendering. State the designed limitation instead of lying.
                <Overline data-testid="understand-verse-only" style={{ letterSpacing: '.1em' }}>{t('understand.crossFrameVerseOnly')}</Overline>
              ) : (
                <>
                  <Overline style={{ letterSpacing: '.1em' }}>{t('understand.commentsBy')}</Overline>
                  <SegmentedControl size="sm" tone="ocean" value={mode} onChange={setMode}
                    options={[{ value: 'section', label: t('understand.bySection') }, { value: 'verse', label: t('understand.byVerse') }]} />
                </>
              )}
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
            <FrameUnavailableNote understand={s.understand} unitCount={units.length} />
            {units.map((unit) => (
              <UnderstandUnit key={unit.key} unit={unit} s={s} src={src} srcChapters={srcChapters} book={book} chapter={chapter} />
            ))}
          </div>
        </div>
      </main>
      <HelpsPanel chapter={chapter} />
    </div>
  );
}
