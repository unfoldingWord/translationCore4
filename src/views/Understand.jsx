// Understand — the read-first pass (D63, epic #104 / #106). The source
// passage (ULT/UST, by section or by verse) with its helps: tN notes, tW key
// terms, tQ questions, the simplified text, and linked tA articles. The ONLY
// control that writes to the project is the comprehension-notes box (owner
// ruling 2026-08-27): it persists through the §8.5 journal (note.add).
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import BookRail from './BookRail.jsx';
import { HelpsPanel, leadingNum, useLoadHelps, focusOf } from './HelpsPanel.jsx';
import { keyCarries, SourceVerse } from './SourceVerse.jsx';
import { absenceMessageKey, isSourceAbsent } from '../data/sourceState';
import { FilterChip, IconButton, Overline, Switcher, StatusDot, Callout, Button } from '../ds/index.js';
import { RailIcon } from './PanelIcons.jsx';
import { targetTypeFor, projectDir } from './scriptStyle.js';

// A USFM paragraph-level marker inside a verse's objects (usfm-js keeps `\p`,
// `\m`, `\q…`, list markers as paragraph objects in the verse where they
// fall; the list markers `lh`/`lf`/`lim` arrive without type "paragraph").
const isParaMark = (vo) => !!vo && (vo.type === 'paragraph' || /^(p|m|pi\d?|pm|pmo|nb|b|q\d?|li\d?|lh|lf|lim\d?)$/.test(vo.tag ?? ''));
const carriesText = (vo) => vo?.type === 'text' || vo?.type === 'word' || (vo?.text ?? '') !== '';
// The objects before a verse's first text (leading) and after its last (trailing).
const leading = (objs) => { const i = objs.findIndex(carriesText); return i === -1 ? objs : objs.slice(0, i); };
const trailing = (objs) => { let i = objs.length - 1; while (i >= 0 && !carriesText(objs[i])) i--; return objs.slice(i + 1); };

/** A unit's verse keys as they exist in the source chapter: a mapped range key
 * ("1-2") that the source keeps as separate verses expands to the verses it
 * spans (Codex review of #140). */
const verseKeysIn = (keys, chapterVerses) => keys.flatMap((k) => {
  if (chapterVerses[String(k)]) return [k];
  const m = String(k).match(/^(\d+)-(\d+)$/);
  if (!m) return [k];
  const out = [];
  for (let n = Number(m[1]); n <= Number(m[2]); n++) if (chapterVerses[String(n)]) out.push(String(n));
  return out.length ? out : [k];
});

/** Group a unit's verse keys into display paragraphs: a verse opens a new
 * paragraph when the previous verse ends with a paragraph marker or it starts
 * with one — the design's `para: true`. Display only, never re-serialized. */
const paragraphsOf = (keys, chapterVerses) => {
  const paras = [];
  keys.forEach((k, i) => {
    const objs = chapterVerses[String(k)]?.verseObjects ?? [];
    const prev = i > 0 ? chapterVerses[String(keys[i - 1])]?.verseObjects ?? [] : [];
    const breaks = i === 0 || trailing(prev).some(isParaMark) || leading(objs).some(isParaMark);
    if (breaks) paras.push([]);
    paras[paras.length - 1].push(k);
  });
  return paras;
};

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
function ComprehensionBox({ book, chapter, unit, mode }) {
  const { s, actions } = useApp();
  const dir = projectDir(s);
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
      {/* The design's box: scripture face at reading size, on the paper tint. */}
      <textarea data-i="field" rows={3} dir={dir} value={text} disabled={!ready}
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, border: 'var(--stroke) solid var(--border-input)', borderRadius: 'var(--radius-md)', padding: '11px 13px', outline: 'none', resize: 'vertical', ...targetTypeFor(s, 'verse'), color: 'var(--text-scripture)', background: 'var(--surface-app)' }}
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
        placeholder={mode === 'verse' ? t('understand.commentsPlaceholderVerse') : t('understand.commentsPlaceholder')} />
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


/** The design's unit label: "John 1:1–2", book chapter:range. */
const refLabel = (book, chapter, keys) => {
  const from = keys[0];
  const to = keys[keys.length - 1];
  const span = keys.length > 1 || String(from).includes('-')
    ? `${leadingNum(from)}–${String(to).includes('-') ? String(to).split('-')[1] : leadingNum(to)}`
    : String(from);
  return `${bookName(book.code)} ${chapter}:${span}`;
};

const crossFrameUnits = (refs, book) => refs.map((r) => r.unmapped
  ? { key: `u${r.unmapped}`, unmapped: r.unmapped }
  : r.crossBook
  ? { key: `x${r.crossBook}`, crossBook: r.crossBook, to: r.to }
  : { key: `m${r.pc}:${r.pv}`, srcChapter: r.c, head: r.v, project: { chapter: r.pc, verse: r.pv }, label: `${bookName(book.code)} ${r.c}:${r.v}`, verses: [r.v] });

const sectionUnits = (starts, verseKeys, book, chapter) => {
  const units = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : Infinity;
    const keys = verseKeys.filter((k) => leadingNum(k) >= from && leadingNum(k) <= to);
    if (keys.length) units.push({ key: `s${from}`, head: keys[0], label: refLabel(book, chapter, keys), verses: keys });
  }
  return units;
};

const understandUnits = ({ s, book, chapter, src, srcChapters, mode }) => {
  const verseKeys = Object.keys(srcChapters)
    .filter((k) => /^\d+(-\d+)?$/.test(k))
    .sort((a, b) => leadingNum(a) - leadingNum(b));
  const crossFrame = s.understand?.sourceRefs != null;
  if (crossFrame) return crossFrameUnits(s.understand.sourceRefs[String(chapter)] ?? [], book);
  const starts = mode === 'section' && src && !isSourceAbsent(src) ? sectionStarts(src.raw, chapter) : [];
  if (mode === 'section' && starts.length > 0) return sectionUnits(starts, verseKeys, book, chapter);
  if (mode === 'section') return verseKeys.length
    ? [{ key: 'whole', head: verseKeys[0], label: `${bookName(book.code)} ${chapter}`, verses: verseKeys }]
    : [];
  return verseKeys.map((k) => ({ key: `v${k}`, head: k, label: refLabel(book, chapter, [k]), verses: [k] }));
};

/** Cross-frame units render SOURCE-frame verse keys, but help references were
 * mapped into the PROJECT frame (deriveForProject) — comparing them raw
 * suppresses every highlight (2026-08-31 Codex adversarial finding). A mapped
 * unit carries its own project↔source row, so translate the focus through it:
 * focus applies iff it names THIS unit's project verse, and the pane then
 * highlights at the unit's source key. */
const paneFocus = (rawFocus, unit) => {
  if (!unit.project) return rawFocus;
  if (rawFocus == null || !keyCarries(String(unit.project.verse), rawFocus.verse)) return null;
  return { ...rawFocus, verse: unit.verses[0] };
};

// The design's two unit states: the focused unit is a raised card, the rest
// sit flat on the page.
const UNIT_FOCUSED = { background: 'var(--surface-card)', border: 'var(--stroke) solid var(--accent-ring)', boxShadow: '0 2px 10px rgba(1,66,99,.07)' };
const UNIT_REST = { background: 'transparent', border: 'var(--stroke) solid transparent', boxShadow: 'none' };

/** A unit with no passage to show: the project verse has no place in the
 * source numbering, or maps into another book. Round 36: a cross-BOOK mapping
 * is stated — rendering this book's text at another book's numbers would show
 * unrelated scripture under a box that journals permanently. */
const unitNotice = (unit) => {
  if (unit.unmapped) return t('understand.verseUnmapped', { ref: unit.unmapped });
  if (unit.crossBook) return t('understand.verseCrossBook', { ref: unit.crossBook, to: unit.to });
  return null;
};

const unitHasNote = (s, chapter, unit) => (unit.project
  ? !!s.understand?.comprehension?.[`${unit.project.chapter}:${unit.project.verse}`]
  : displayedUnitNote(s.understand?.comprehension, chapter, unit).hasAny);

const unitChapterVerses = (unit, src, srcChapters) => {
  if (unit.srcChapter == null) return srcChapters;
  return src && !isSourceAbsent(src) ? src.chapters?.[String(unit.srcChapter)] ?? {} : {};
};

function UnderstandUnit({ unit, s, src, srcChapters, book, chapter, mode, focused, onFocus }) {
  const notice = unitNotice(unit);
  if (notice) {
    return (
      <Callout tone="info" data-testid={`understand-unit-${unit.key}`} style={{ marginBottom: 18 }}>{notice}</Callout>
    );
  }
  const hasNote = unitHasNote(s, chapter, unit);
  const chapterVerses = unitChapterVerses(unit, src, srcChapters);
  const focus = paneFocus(s.helpsHover ?? s.helpsActive, unit);
  const keysIn = verseKeysIn(unit.verses, chapterVerses);
  return (
    // Focusable and keyboard-operable (Enter / Space on the unit itself; the
    // box and buttons inside keep their own keys) — Codex review of #140.
    <div data-testid={`understand-unit-${unit.key}`} data-focused={focused ? 'true' : undefined} onClick={onFocus}
      tabIndex={0} aria-current={focused ? 'true' : undefined}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onFocus(); } }}
      style={{ marginBottom: 18, borderRadius: 'var(--radius-xl)', padding: '12px 16px 14px', cursor: 'pointer', ...(focused ? UNIT_FOCUSED : UNIT_REST) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: 'var(--stroke-hair) solid var(--border)' }}>
        <Overline>{unit.label}</Overline><div style={{ flex: 1 }} />
        {hasNote ? <StatusDot status="valid" size={7} /> : null}
      </div>
      {paragraphsOf(keysIn, chapterVerses).map((keys) => (
        <p key={keys[0]} style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)', color: 'var(--text-scripture)', margin: '10px 0' }}>
          {keys.map((k) => (
            <React.Fragment key={k}>
              <sup style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{k}</sup>
              <SourceVerse vObj={chapterVerses[String(k)]} verseKey={k} focus={focus} />{' '}
            </React.Fragment>
          ))}
        </p>
      ))}
      <ComprehensionBox book={book.code} chapter={unit.srcChapter ?? chapter} unit={unit} mode={mode} />
    </div>
  );
}

/** Focusing a unit also selects the first help card in its verse range (the
 * design's `firstHelpIn`): notes first, then key words. Help references are
 * PROJECT-frame, so a mapped unit matches on its project reference and a
 * same-frame unit on its source keys (Codex review of #140). */
const firstHelpIn = (s, chapter, unit) => {
  const ready = (slot) => (slot?.state === 'ready' ? slot.items : []);
  const items = [...ready(s.understand?.notes), ...ready(s.understand?.words)];
  const c = unit.project ? unit.project.chapter : chapter;
  const carries = (v) => (unit.project
    ? keyCarries(String(unit.project.verse), v)
    : unit.verses.some((k) => keyCarries(k, v)));
  return items.find((it) => Number(it.contextId.reference.chapter) === Number(c)
    && carries(it.contextId.reference.verse)) ?? null;
};

/** The passage area's status callouts: pins error, save error, pane
 * states (no-panes, missing, failed), loading. One component so the
 * Understand shell stays under the complexity gate. */
function PassageStatus({ s, src, actions }) {
  return (
    <>
            {s.projectPinsError && (
              // Round 34: a rejected pins read is a stated, retryable error —
              // never a false "the package lacks these resources" claim.
              <Callout tone="warn" role="alert" data-testid="pins-error" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>
                {t('understand.pinsError')} {s.projectPinsError}{' '}
                <Button size="sm" variant="outline" data-testid="pins-retry" onClick={() => actions.retryProjectPins()}>
                  {t('app.retry')}
                </Button>
              </Callout>
            )}
            {s.understand?.saveError && (
              <Callout tone="warn" role="alert" data-testid="understand-save-error" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>
                <strong>{t('understand.saveFailed')}</strong> {s.understand.saveError}
              </Callout>
            )}
            {s.sourcePanes && s.sourcePanes.length === 0 && (
              // §5.3: absence is legal — stated, never the machine defaults.
              <Callout tone="info" data-testid="no-source-panes" style={{ marginTop: 10 }}>{t('understand.noSourcePanes')}</Callout>
            )}
            {isSourceAbsent(src) && (
              <Callout tone="info" style={{ marginTop: 10 }}>{t(absenceMessageKey(src))}</Callout>
            )}
            {src?.error && (
              // Catch-to-absence sweep (D30/A3): a failed pane read is a
              // stated, retryable error — never "not available for this book".
              <Callout tone="warn" role="alert" data-testid="source-pane-error" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>
                {t('understand.sourceError')} {src.error}{' '}
                <Button size="sm" variant="outline" data-testid="source-retry" onClick={() => actions.reloadSourcePanes()}>
                  {t('app.retry')}
                </Button>
              </Callout>
            )}
            {!src && s.sourcePanes?.length !== 0 && (
              // A project with NO panes ([] — the stated no-source-panes state
              // above) has nothing pending: rendering the loading line beside
              // that callout contradicted it and never resolved (issue #123).
              <p style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)', marginTop: 10 }}>{t('understand.loading')}</p>
            )}
    </>
  );
}

export default function Understand() {
  const { s, book, actions } = useApp();
  const [mode, setMode] = React.useState('section');
  const [activeKey, setActiveKey] = React.useState(null);
  useLoadHelps();
  // Unit keys repeat across chapters and books ("v2", "s1"): a navigation
  // returns focus to the new context's first unit.
  React.useEffect(() => { setActiveKey(null); }, [s.chapter, s.book]);

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
  const srcChapters = src && !isSourceAbsent(src) ? src.chapters?.[String(chapter)] ?? {} : {};
  const units = understandUnits({ s, book, chapter, src, srcChapters, mode });
  // The focused unit: the one clicked, else the first (the design's default).
  const focusedKey = units.some((u) => u.key === activeKey) ? activeKey : units[0]?.key;
  const focusUnit = (unit) => {
    setActiveKey(unit.key);
    const item = firstHelpIn(s, chapter, unit);
    // A unit with no help clears a stale card selection (focusHelp(null)).
    if (item ? s.helpsActive?.id !== item.contextId.checkId : s.helpsActive) actions.focusHelp(item ? focusOf(item) : null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="understand">
      {s.rail && <BookRail />}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 26px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', background: 'var(--surface-card)', flex: 'none', minWidth: 0, overflow: 'hidden' }}>
          <IconButton title={t('draft.toggleRail')} onClick={actions.toggleRail}><RailIcon /></IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0, flex: 'none' }}>{bookName(book.code)} {chapter}</h2>
          <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('understand.note')}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, background: 'var(--surface-app)' }}>
          <div style={{ maxWidth: 'var(--measure-read)', margin: '0 auto', padding: '22px 26px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              {(s.sourcePanes ?? []).map((id) => (
                // Round 37 (§5.3): the panes are the PROJECT's extraScripture
                // pins — ids and count come from them, never a hardcoded pair.
                // The design's source pills: Inspire fill when active, heading
                // text on white otherwise; block display so the cap trim applies.
                <FilterChip key={id} data-testid={`source-tab-${id}`} selected={s.sourceTab === id} onClick={() => actions.setSourceTab(id)}
                  style={{ display: 'inline-block', padding: '4px 10px', fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', borderWidth: 1,
                    ...(s.sourceTab === id
                      ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
                      : { background: 'var(--surface-card)', color: 'var(--text-heading)', borderColor: 'var(--border-input)' }) }}>
                  {t(`source.${id}`, {}, id.toUpperCase())}
                </FilterChip>
              ))}
              <div style={{ flex: 1 }} />
              {crossFrame ? (
                // Round 32 (D30 honesty): cross-frame units are one-per-project-
                // verse — a Section/Verse control would be two labels for one
                // rendering. State the designed limitation instead of lying.
                <Overline data-testid="understand-verse-only">{t('understand.crossFrameVerseOnly')}</Overline>
              ) : (
                <>
                  <Overline>{t('understand.commentsBy')}</Overline>
                  <Switcher indicator="pill" size="sm" tone="ocean" value={mode} onChange={setMode}
                    options={[{ value: 'section', label: t('understand.bySection') }, { value: 'verse', label: t('understand.byVerse') }]} />
                </>
              )}
            </div>
            {(s.sourcePanes ?? []).includes(s.sourceTab) && (
              <p data-testid="understand-source-name" style={{ fontSize: 'var(--fs-meta)', letterSpacing: 'var(--track-11-5)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)', margin: '0 0 14px' }}>
                {t(`source.${s.sourceTab}.name`, {}, String(s.sourceTab).toUpperCase())}
              </p>
            )}
            <PassageStatus s={s} src={src} actions={actions} />
            <FrameUnavailableNote understand={s.understand} unitCount={units.length} />
            {units.map((unit) => (
              <UnderstandUnit key={unit.key} unit={unit} s={s} src={src} srcChapters={srcChapters} book={book} chapter={chapter}
                mode={mode} focused={unit.key === focusedKey} onFocus={() => focusUnit(unit)} />
            ))}
          </div>
        </div>
      </main>
      <HelpsPanel chapter={chapter} />
    </div>
  );
}
