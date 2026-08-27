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
import { FilterChip, IconButton, Overline, SegmentedControl, StatusDot, Tabs, TextArea, HelpCard, Callout, Button } from '../ds/index.js';

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

const verseText = (vObj) => {
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

/** The comprehension box (#106's only write): saves on blur through
 * actions.saveComprehension; everything else on the screen is read-only. */
function ComprehensionBox({ chapter, headVerse }) {
  const { s, actions } = useApp();
  const stored = s.understand?.comprehension?.[`${chapter}:${headVerse}`] ?? '';
  const [text, setText] = React.useState(stored);
  React.useEffect(() => { setText(stored); }, [stored, chapter, headVerse]);
  return (
    <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)}
      onBlur={() => actions.saveComprehension(chapter, headVerse, text)}
      placeholder={t('understand.commentsPlaceholder')} />
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

function HelpsPanel({ chapter }) {
  const { s, actions } = useApp();
  const u = s.understand;
  const tab = s.helpsTab;
  const inChapter = (slot) =>
    slot?.state === 'ready'
      ? slot.items.filter((it) => Number(it.contextId.reference.chapter) === Number(chapter))
      : [];
  const notes = inChapter(u?.notes);
  const words = inChapter(u?.words);
  const questions = inChapter(u?.questions);
  const ust = s.sources.ust;
  // tA modules linked from this chapter's notes, deduped, in first-note order.
  const academySlugs = [...new Set(notes.map((n) => n.contextId.groupId))];
  const empty = <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>{t('understand.noneForChapter')}</p>;

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
        {tab === 'notes' && (u?.notes?.state !== 'ready' ? <SlotState slot={u?.notes} /> : notes.length === 0 ? empty
          : notes.map((n, i) => (
            <HelpCard key={`${n.contextId.checkId}-${i}`} kind="note" verse={n.contextId.reference.verse}
              title={n.contextId.quoteString || n.contextId.groupId} body={n.contextId.occurrenceNote.slice(0, 400)}
              actionLabel={t('understand.academyLink')}
              onAction={() => actions.loadHelpArticle({ kind: 'ta', slug: n.contextId.groupId, rung: u.notes.rung })} />
          )))}
        {tab === 'words' && (u?.words?.state !== 'ready' ? <SlotState slot={u?.words} /> : words.length === 0 ? empty
          : words.map((w, i) => (
            <HelpCard key={`${w.contextId.checkId}-${i}`} kind="word" verse={w.contextId.reference.verse}
              title={w.contextId.quoteString || w.contextId.groupId} body={w.contextId.groupId}
              actionLabel={t('understand.wordLink')}
              onAction={() => actions.loadHelpArticle({ kind: 'tw', category: w.category, slug: w.contextId.groupId, rung: u.words.rung })} />
          )))}
        {tab === 'questions' && (u?.questions?.state !== 'ready' ? <SlotState slot={u?.questions} /> : questions.length === 0 ? empty
          : questions.map((q, i) => (
            <div key={`${q.contextId.checkId}-${i}`} data-testid="understand-question"
              style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, background: '#fff' }}>
              <p style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '0 0 6px' }}>{q.question}</p>
              <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)', margin: 0 }}>
                <span style={{ color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>{t('understand.answer')} · </span>{q.response}
              </p>
            </div>
          )))}
        {tab === 'simplified' && (
          ust && ust !== 'missing' ? (
            <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' }} data-testid="understand-simplified">
              <Overline>{t('understand.simplifiedTitle')}</Overline>
              <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)', margin: '10px 0 0' }}>
                {Object.entries(ust.chapters?.[String(chapter)] ?? {})
                  .filter(([k]) => /^\d/.test(k))
                  .map(([k, v]) => `${k} ${verseText(v)}`)
                  .join(' ') || t('understand.sourceMissing')}
              </p>
            </div>
          ) : <Callout tone="info">{t('understand.sourceMissing')}</Callout>
        )}
        {tab === 'academy' && (u?.notes?.state !== 'ready' ? <SlotState slot={u?.notes} /> : academySlugs.length === 0 ? empty
          : academySlugs.map((slug) => (
            <Button key={slug} variant="secondary" onClick={() => actions.loadHelpArticle({ kind: 'ta', slug, rung: u.notes.rung })}
              style={{ justifyContent: 'space-between', width: '100%', borderRadius: 'var(--radius-lg)', textAlign: 'start' }}>
              <span>{slug}</span><span style={{ color: 'var(--accent)' }}>→</span>
            </Button>
          )))}
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
  const verseNums = Object.keys(srcChapters).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  const starts = mode === 'section' && src && src !== 'missing' ? sectionStarts(src.raw, chapter) : [];
  const units = [];
  if (mode === 'section' && starts.length > 0) {
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] - 1 : Infinity;
      const vs = verseNums.filter((n) => n >= from && n <= to);
      if (vs.length) units.push({ key: `s${from}`, head: vs[0], label: vs.length > 1 ? `${t('understand.byVerse')}s ${vs[0]}–${vs[vs.length - 1]}` : `${t('understand.byVerse')} ${vs[0]}`, verses: vs });
    }
  } else if (mode === 'section') {
    if (verseNums.length) units.push({ key: 'whole', head: verseNums[0], label: `${bookName(book.code)} ${chapter}`, verses: verseNums });
  } else {
    for (const n of verseNums) units.push({ key: `v${n}`, head: n, label: `${t('understand.byVerse')} ${n}`, verses: [n] });
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
                  {s.understand?.comprehension?.[`${chapter}:${u.head}`] ? <StatusDot status="valid" size={7} /> : null}
                </div>
                <p style={{ direction: 'ltr', textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', margin: '10px 0 12px' }}>
                  {u.verses.map((n) => (
                    <React.Fragment key={n}>
                      <sup style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', marginInlineEnd: 3, verticalAlign: 'super' }}>{n}</sup>
                      {verseText(srcChapters[String(n)])}{' '}
                    </React.Fragment>
                  ))}
                </p>
                <ComprehensionBox chapter={chapter} headVerse={u.head} />
              </div>
            ))}
          </div>
        </div>
      </main>
      <HelpsPanel chapter={chapter} />
    </div>
  );
}
