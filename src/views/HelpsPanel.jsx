// The helps panel (D63): tN notes, tW key terms, tQ questions, the
// simplified text, and linked tA articles for the open chapter. Extracted
// from Understand (epic #104 fidelity, F2 2026-08-31) so Translate mounts the
// SAME panel — one implementation, two screens. F3: note and key-word cards
// publish a hover/click focus ({ verse, quote, occurrence }) that the source
// panes highlight through sourceHighlight.ts.
import React from 'react';
import { useApp } from '../state.jsx';
import { renderArticleBlocks } from '../data/articles';
import { t } from '../i18n';
import { verseText } from './verseText.js';
import { keyCarries } from './SourceVerse.jsx';
import { gatewayQuote, tokenizeVerse } from '../data/sourceHighlight';
import { Button, Callout, HelpCard, IconButton, Overline, Tabs } from '../ds/index.js';

// The leading verse number of a chapter key — span keys ("17-18") are real
// USFM verse bridges (see usfm/indexer.ts) and MUST NOT be dropped.
export const leadingNum = (key) => Number(String(key).split('-')[0]);

/** The focus payload a helps card publishes (F3): enough to find the quoted
 * words in the rendered source verse. */
const focusOf = (it) => ({
  id: it.contextId.checkId,
  verse: it.contextId.reference.verse,
  quote: it.contextId.quote,
  occurrence: it.contextId.occurrence,
});

function ArticleView({ article, onClose, onRetry }) {
  if (!article) return null;
  return (
    <div style={{ borderTop: 'var(--stroke-hair) solid var(--border-hair)', padding: 16, overflow: 'auto', maxHeight: '45%', flex: 'none', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>
          {article.loading ? t('check.articleLoading') : article.found?.title ?? ''}
        </span>
        <IconButton size={26} title={t('common.close')} onClick={onClose}>✕</IconButton>
      </div>
      {!article.loading && article.error && (
        // Round 35: a failed read is a stated, retryable error — never a
        // false "this article does not exist" claim (D30).
        <Callout tone="warn" role="alert" data-testid="understand-article-error" style={{ overflowWrap: 'anywhere' }}>
          {t('understand.articleError')} {article.error}{' '}
          <Button size="sm" variant="outline" data-testid="article-retry" onClick={onRetry}>
            {t('app.retry')}
          </Button>
        </Callout>
      )}
      {!article.loading && !article.error && !article.found && (
        <Callout tone="warn" data-testid="understand-article-missing">{t('check.articleMissing')}</Callout>
      )}
      {!article.loading && article.found && (
        <div data-testid="understand-article">
          {renderArticleBlocks(article.found.body).map((b, i) => (
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

const PREVIEW_CHARS = 400;

/** Shorten RENDERED blocks, never the markdown source. A cut taken on the
 * source lands inside a token — 12 notes in the two vendored Titus fixtures cut
 * inside `[[rc://…]]` or a `[label](target)` link, leaving a dangling `[1 ` on
 * screen. After renderArticleBlocks the text carries no syntax at all, so a cut
 * here can only ever fall between words. */
function previewBlocks(blocks, limit) {
  const out = [];
  let used = 0;
  for (const b of blocks) {
    const room = limit - used;
    if (room <= 0) break;
    if (b.text.length <= room) {
      out.push(b);
      used += b.text.length;
      continue;
    }
    const slice = b.text.slice(0, room);
    // Cut on a word boundary. A budget too small to hold even this block's
    // FIRST whole word would leave a fragment on screen ("… Prophecy delayed
    // Acc…", en_tn@v86 JON 4:intro), so stop before the block instead.
    if (!/\s/.test(slice)) break;
    out.push({ ...b, text: `${slice.replace(/\s+\S*$/, '')}…` });
    used = limit;
    break;
  }
  // When the loop stopped before a block rather than inside one, the ellipsis
  // still has to say that something follows.
  const last = out[out.length - 1];
  if (last && out.length < blocks.length && !last.text.endsWith('…')) {
    out[out.length - 1] = { ...last, text: `${last.text}…` };
  }
  return out;
}

/** Note-body markdown, rendered with the same block shapes the Academy article
 * panel uses above — headings, list items and paragraphs. Inline `<span>`s, not
 * `<p>`s: the last block has to sit on the same line as the Show more control. */
function NoteBlocks({ blocks }) {
  return (
    <>
      {blocks.map((b, i) => (
        <span key={i} style={{
          display: 'block',
          fontWeight: b.kind === 'h' ? 'var(--fw-heavy)' : 'var(--fw-regular)',
          color: b.kind === 'h' ? 'var(--uw-ocean)' : 'inherit',
          margin: b.kind === 'h' ? '8px 0 2px' : '0 0 6px',
          paddingInlineStart: b.kind === 'li' ? 14 : 0,
        }}>{b.kind === 'li' ? `• ${b.text}` : b.text}</span>
      ))}
    </>
  );
}

/** Round 33: real tN notes exceed 400 characters (the shipped Titus fixture
 * carries 425-940+), and a silent cut removes the guidance's qualifications
 * and examples. Long bodies collapse to a preview with an accessible control
 * that reveals the exact full text. */
function ExpandableNote({ text }) {
  const [expanded, setExpanded] = React.useState(false);
  // TSV note bodies are markdown: `##` headings, `**` emphasis, `[[rc://\u2026]]`
  // links \u2014 and their line breaks arrive ESCAPED (a literal backslash-n) where
  // an Academy article carries real ones. They were printed raw. The blocks
  // render through the same renderer the article panel above uses, so the two
  // can never drift.
  const all = renderArticleBlocks(text.replace(/\\n/g, '\n'));
  const total = all.reduce((n, b) => n + b.text.length, 0);
  const long = total > PREVIEW_CHARS;
  const blocks = <NoteBlocks blocks={long && !expanded ? previewBlocks(all, PREVIEW_CHARS) : all} />;
  if (!long) return blocks;
  return (
    <>
      {blocks}
      <button type="button" data-testid="note-expand" aria-expanded={expanded}
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--accent)', padding: 0 }}>
        {expanded ? t('understand.showLess') : t('understand.showMore')}
      </button>
    </>
  );
}

function NotesTab({ slot, notes, actions, cardFocus }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return <>
    <SlotBanners slot={slot} />
    {notes.length === 0 ? emptyChapter : notes.map((n, i) => (
      <HelpCard key={`${n.contextId.checkId}-${i}`} kind="note" verse={n.contextId.reference.verse}
        active={cardFocus.activeId === n.contextId.checkId}
        onClick={() => cardFocus.focus(focusOf(n))}
        onMouseEnter={() => cardFocus.hover(focusOf(n))} onMouseLeave={() => cardFocus.hover(null)}
        title={cardFocus.glTitle(n) || n.contextId.quoteString || n.contextId.groupId} body={<ExpandableNote text={n.contextId.occurrenceNote} />}
        actionLabel={t('understand.academyLink')}
        onAction={n.contextId.groupId
          ? () => actions.loadHelpArticle({ kind: 'ta', slug: n.contextId.groupId, rung: slot.rung })
          : undefined} />
    ))}
  </>;
}

function WordsTab({ slot, words, actions, cardFocus }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return <>
    <SlotBanners slot={slot} />
    {words.length === 0 ? emptyChapter : words.map((w, i) => (
      <HelpCard key={`${w.contextId.checkId}-${i}`} kind="word" verse={w.contextId.reference.verse}
        active={cardFocus.activeId === w.contextId.checkId}
        onClick={() => cardFocus.focus(focusOf(w))}
        onMouseEnter={() => cardFocus.hover(focusOf(w))} onMouseLeave={() => cardFocus.hover(null)}
        title={cardFocus.glTitle(w) || w.contextId.quoteString || w.contextId.groupId} body={w.contextId.groupId}
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
        .filter((r) => !r.unmapped && !r.crossBook)
        .map((r) => `${r.c}:${r.v} ${verseText(simplified.chapters?.[String(r.c)]?.[String(r.v)])}`)
    : Object.entries(simplified.chapters?.[String(chapter)] ?? {})
        .filter(([k]) => /^\d/.test(k))
        .sort(([a], [b]) => leadingNum(a) - leadingNum(b))
        .map(([k, v]) => `${k} ${verseText(v)}`);
  return verses.join(' ') || t('understand.noneForChapter');
};

function SimplifiedTab({ slot, sourceRefs, chapter }) {
  if (slot?.state !== 'ready') return <><SlotBanners slot={slot} /><SlotState slot={slot} /></>;
  return (<>
    <SlotBanners slot={slot} />
    <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' }} data-testid="understand-simplified">
      <Overline>{t('understand.simplifiedTitle')}</Overline>
      <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)', margin: '10px 0 0' }}>
        {simplifiedChapterText(slot, sourceRefs, chapter)}
      </p>
    </div>
  </>);
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

/** Round 37: a chapter whose refs all map into ANOTHER book has no helps
 * HERE by construction — say that, never "nothing for this chapter". */
const chapterAllCrossBook = (u, chapter) => {
  const refs = u?.sourceRefs?.[String(chapter)];
  return !!refs && refs.length > 0 && refs.every((r) => r.crossBook);
};

function HelpsTab({ tab, u, chapter, actions, cardFocus }) {
  if (chapterAllCrossBook(u, chapter)) {
    return (
      <Callout tone="info" data-testid="helps-cross-book" style={{ overflowWrap: 'anywhere' }}>
        {t('understand.helpsCrossBook', { to: u.sourceRefs[String(chapter)][0].to })}
      </Callout>
    );
  }
  const notes = itemsInChapter(u?.notes, chapter);
  if (tab === 'notes') return <NotesTab slot={u?.notes} notes={notes} actions={actions} cardFocus={cardFocus} />;
  if (tab === 'words') return <WordsTab slot={u?.words} words={itemsInChapter(u?.words, chapter)} actions={actions} cardFocus={cardFocus} />;
  if (tab === 'questions') return <QuestionsTab slot={u?.questions} questions={itemsInChapter(u?.questions, chapter)} />;
  if (tab === 'simplified') return <SimplifiedTab slot={u?.simplified} sourceRefs={u?.sourceRefs} chapter={chapter} />;
  const slugs = [...new Set(notes.map((n) => n.contextId.groupId))].filter(Boolean);
  return <AcademyTab notesSlot={u?.notes} slugs={slugs} actions={actions} />;
}

/** Card titles show the GATEWAY rendering of the quote (owner ruling
 * 2026-08-31): the shipped TSV7 helps carry no GLQuote column, so the gateway
 * text is derived from the active pane's alignment; the original-language
 * quoteString is only the fallback when nothing resolves. */
const glTitleFor = (src, chapter, refRows) => {
  // Per-verse token cache + per-item title cache: hover re-renders the whole
  // panel through the app reducer, and titles must not recompute per hover
  // (2026-08-31 review R5). Both caches live only as long as the useMemo in
  // HelpsPanel keeps this resolver — a pane or chapter switch drops them.
  const tokens = new Map();
  const titles = new Map();
  const chapterOf = (c) => (src && src !== 'missing' ? src.chapters?.[String(c)] ?? {} : {});
  return (it) => {
    const id = `${it.contextId.checkId}:${it.contextId.reference.verse}:${it.contextId.quoteString ?? ''}:${it.contextId.occurrence ?? 1}`;
    if (titles.has(id)) return titles.get(id);
    // The item's reference is PROJECT-frame. refRows (understand.sourceRefs
    // for this chapter) is non-null exactly when the source lives in another
    // frame — resolve through its mapped rows; identity indexing is valid
    // only in same-frame mode (2026-08-31 Codex adversarial finding).
    const cands = refRows
      ? refRows
          .filter((r) => r.pv != null && keyCarries(String(r.pv), it.contextId.reference.verse))
          .map((r) => ({ c: r.c, v: r.v }))
      : [{ c: chapter, v: it.contextId.reference.verse }];
    let title = null;
    for (const cand of cands) {
      const srcChapter = chapterOf(cand.c);
      const key = Object.keys(srcChapter).find((k) => keyCarries(k, cand.v));
      if (!key) continue;
      const tKey = `${cand.c}:${key}`;
      if (!tokens.has(tKey)) tokens.set(tKey, tokenizeVerse(srcChapter[key]));
      title = gatewayQuote(
        tokens.get(tKey),
        it.contextId.quote?.length ? it.contextId.quote : (it.contextId.quoteString ?? ''),
        it.contextId.occurrence ?? 1,
      );
      if (title) break;
    }
    titles.set(id, title);
    return title;
  };
};

/** The mapped project↔source rows for this chapter, or null in CONFIRMED
 * same-frame mode (the sourceRefs null contract) — null lets glTitleFor index
 * the source at the project coordinates directly. */
const mappedRows = (u, chapter) => (u?.sourceRefs != null ? (u.sourceRefs[String(chapter)] ?? []) : null);

/** Load the derived helps for the open book. Shared by Understand and
 * Translate so the dependency story cannot fork (2026-08-31 review R2). The
 * deps' rationale is unchanged from Understand's original effect (O2, round
 * 20 F2, round 33) with ONE change: bookRaw participates as PRESENCE, not
 * content. openBook nulls it before publishing bytes (state.jsx), so the flag
 * flips on every open — but editVerse replaces non-null with non-null, so
 * typing in Translate no longer re-derives the helps per keystroke. The cost:
 * a structural edit that changes verse keys mid-session is not re-mapped
 * until the next chapter/book change (cross-frame projects only — #118). */
export function useLoadHelps() {
  const { s, actions } = useApp();
  const bookBytesReady = s.bookRaw != null;
  React.useEffect(() => {
    actions.loadUnderstand();
  }, [s.book, bookBytesReady, s.projectPins, s.projectPinsLoaded, s.netEnabled, s.installEpoch]);
}

export function HelpsPanel({ chapter }) {
  const { s, actions } = useApp();
  const u = s.understand;
  const tab = s.helpsTab;
  // F3 focus wiring: hover is transient, click toggles the sticky focus.
  const src = s.sources?.[s.sourceTab];
  const refRows = mappedRows(u, chapter);
  const glTitle = React.useMemo(() => glTitleFor(src, chapter, refRows), [src, chapter, refRows]);
  const cardFocus = { activeId: s.helpsActive?.id ?? null, hover: actions.hoverHelp, focus: actions.focusHelp, glTitle };
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
        {!loading && !u?.error && <HelpsTab tab={tab} u={u} chapter={chapter} actions={actions} cardFocus={cardFocus} />}
      </div>
      <ArticleView article={u?.article} onClose={actions.closeHelpArticle} onRetry={() => u?.article?.request && actions.loadHelpArticle(u.article.request)} />
    </aside>
  );
}
