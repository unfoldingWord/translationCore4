// Check view — Increment 2, J4 — rebuilt on the design system (epic #104 /
// #108). This slice is the SESSION PREFLIGHT (C2.2, FR-5): before any checking
// UI exists, the app must answer honestly whether this (tool, book) can be
// checked at all, and offer the guided fix.
//
// The five states come straight from `data/resolve.ts` (D30):
//   ready         — the resolved pin is local; the session can open
//   fetch         — pinned version absent + online -> download it
//   unavailable   — pinned version absent + offline -> FIRST-CLASS state, not
//                   an error, and it never blocks drafting or other books
//   unpinned      — the project has no pins for this tool yet
//   not-covered   — pins are local, but neither rung covers this book
import React from 'react';
import { useApp } from '../state.jsx';
import { TOOL_SLOT } from '../data/resolve';
import { isDecided } from '../data/derive';
import { bookName } from '../data/bookNames';
import { renderArticleBlocks } from '../data/articles';
import Align from './Align.jsx';
import { isLanguageSwitch } from '../data/revalidate';
import { targetWords, selectionsFromTokens, tokenIndicesFromSelections } from '../data/selections';
import { t } from '../i18n';
import { Button, Card, Callout, Overline, ProgressBar, Badge } from '../ds/index.js';

const TOOLS = Object.keys(TOOL_SLOT);
const mono = { fontFamily: 'var(--font-mono)' };

/* #15 / §5.2: the dropped count MUST be surfaced wherever checks are shown —
 * silently shrinking the denominator is not permitted. ONE component for the
 * two render sites (empty state and live session), so the message and the
 * testid can never drift apart; only the container styling differs. */
function DroppedNote({ dropped, style }) {
  if (!dropped) return null;
  return (
    <div data-testid="versification-dropped"
      style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-warn-text)', lineHeight: 'var(--lh-body)', ...style }}>
      {t('check.droppedNote', { count: dropped.count, scheme: dropped.scheme ?? '—' })}
    </div>
  );
}

const TONE = {
  ready: { bg: 'var(--tc-valid-surface)', border: 'rgba(60,143,92,.35)', fg: 'var(--tc-valid-strong)' },
  fetch: { bg: 'var(--surface-accent-soft)', border: 'rgba(49,173,227,.4)', fg: 'var(--tc-suggest-fg)' },
  unavailable: { bg: 'var(--surface-warm)', border: 'rgba(229,157,51,.4)', fg: 'var(--tc-warn-text)' },
  unpinned: { bg: 'var(--surface-app)', border: 'var(--border-input)', fg: 'var(--text-secondary)' },
  'not-covered': { bg: 'var(--surface-app)', border: 'var(--border-input)', fg: 'var(--text-secondary)' },
};

function ToolCard({ tool, pre, book }) {
  const { actions } = useApp();
  const tone = TONE[pre.state] ?? TONE.unpinned;
  const rung = pre.resolution?.rung;
  const pin = pre.resolution?.pin || pre.needs;

  return (
    <div data-testid={`preflight-${tool}`} data-state={pre.state}
      style={{ border: `var(--stroke) solid ${tone.border}`, background: tone.bg, borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{t(`check.tool.${tool}`)}</span>
        <span style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: '.06em', textTransform: 'uppercase', color: tone.fg }}>
          {t(`check.state.${pre.state}`)}
        </span>
      </div>
      <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 10px' }}>
        {t(`check.explain.${pre.state}`, { book: bookName(book) })}
      </p>
      {pin && (
        <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', ...mono, margin: '0 0 10px' }}>
          {pin.repoPath} · {pin.version}
          {rung ? ` · ${t(`check.rung.${rung}`)}` : ''}
        </p>
      )}
      {pre.state === 'fetch' && (
        <Button size="sm" onClick={actions.openSources}>{t('check.fix.download')}</Button>
      )}
      {pre.state === 'unavailable' && (
        <Button size="sm" onClick={actions.goOnline} style={{ background: 'var(--uw-kindle)' }}>{t('sources.goOnline')}</Button>
      )}
      {(pre.state === 'unpinned' || pre.state === 'not-covered') && (
        <Button size="sm" variant="secondary" onClick={actions.openSources} style={{ color: 'var(--uw-ocean)' }}>{t('check.fix.getResources')}</Button>
      )}
      {/* B20 warned fallback (D41): the resolver opened the installed fallback
        * because the pinned PRIMARY is not on this computer. That is not silent —
        * say which primary is missing and offer to download it. The card still
        * opens (state 'ready'); the fallback never blocks. */}
      {pre.unavailablePrimary && (
        <Callout tone="warn" data-testid={`fallback-warning-${tool}`} style={{ margin: '0 0 10px' }}>
          {t('check.fallbackWarn', {
            repo: pre.unavailablePrimary.repoPath,
            version: pre.unavailablePrimary.version,
          })}
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={actions.openSources} data-testid={`fetch-primary-${tool}`}
              style={{ color: 'var(--tc-warn-text)', borderColor: 'rgba(229,157,51,.5)' }}>
              {t('check.fix.download')}
            </Button>
          </div>
        </Callout>
      )}
      {pre.state === 'ready' && (
        <Button size="sm" onClick={() => actions.openCheckTool(tool)} data-testid={`open-${tool}`}>
          {t('check.open')}
        </Button>
      )}
    </div>
  );
}

/** The help article behind the active item (C2.5), read from the installed
 * burrito. Absence is stated, never rendered as an empty panel. */
function ArticlePanel({ article }) {
  if (!article) return null;
  if (article.loading) {
    return <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', margin: '0 0 14px' }}>{t('check.articleLoading')}</p>;
  }
  if (article.error) {
    // Catch-to-absence sweep (D30): a failed read is stated and retryable —
    // never "article missing". Selecting the item again re-requests it (the
    // same-key guard admits errored articles).
    return (
      <Callout tone="warn" role="alert" data-testid="article-error" style={{ margin: '0 0 14px', overflowWrap: 'anywhere' }}>
        {t('understand.articleError')} {article.error}
      </Callout>
    );
  }
  if (!article.found) {
    return (
      <Callout tone="warn" data-testid="article-missing" style={{ margin: '0 0 14px' }}>
        {t('check.articleMissing')}
      </Callout>
    );
  }
  // Round 37: never truncate real guidance — the committed en_ta fixture
  // already exceeds the old 40-block cap.
  const blocks = renderArticleBlocks(article.found.body);
  return (
    <details data-testid="article-panel" open
      style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', background: '#fff', margin: '0 0 14px' }}>
      <summary style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', cursor: 'pointer' }}>
        {article.found.title}
      </summary>
      <div style={{ marginTop: 10 }}>
        {blocks.map((b, i) => {
          if (b.kind === 'h') {
            return (
              <p key={i} style={{ fontSize: 'var(--fs-caption-lg)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '12px 0 4px', letterSpacing: '.02em' }}>{b.text}</p>
            );
          }
          if (b.kind === 'li') {
            return (
              <p key={i} style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 4px', paddingInlineStart: 14 }}>{b.text}</p>
            );
          }
          return (
            <p key={i} style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 8px' }}>{b.text}</p>
          );
        })}
      </div>
      <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-tertiary)', ...mono, margin: '10px 0 0' }}>
        {article.found.ipath}
      </p>
    </details>
  );
}

/** The check list for one tool: every derived item, its decision state, and
 * the item detail. Derived at load and never stored (§4.2). */
function CheckEmpty({ cs, actions }) {
  return (
    <div data-testid="check-empty" data-empty={cs.empty}>
      <Button variant="secondary" size="sm" onClick={actions.closeCheckTool} style={{ marginBottom: 16 }}>
        {t('check.back')}
      </Button>
      <div style={{ border: 'var(--stroke-selected) dashed var(--border-dashed)', borderRadius: 'var(--radius-xl)', padding: '32px 26px', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '0 0 8px' }}>
          {t(`check.empty.${cs.empty}.title`)}
        </p>
        <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 auto', maxWidth: 460 }}>
          {t(`check.empty.${cs.empty}.body`)}
        </p>
        {/* Surfaced even when the drop emptied the whole list. */}
        <DroppedNote dropped={cs.dropped} style={{ margin: '14px auto 0', maxWidth: 460 }} />
        {cs.resource && (
          <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', ...mono, margin: '14px 0 0' }}>
            {cs.resource.repoPath} · {cs.resource.version}
          </p>
        )}
      </div>
    </div>
    );
}

const triageStyle = (active, tone) => ({
  border: `var(--stroke-selected) solid ${active ? tone : 'var(--border-strong)'}`,
  background: active ? tone : '#fff',
  color: active ? '#fff' : 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  fontWeight: 'var(--fw-heavy)',
  fontSize: 'var(--fs-ui-sm)',
  letterSpacing: 'var(--track-13)',
  padding: '9px 16px',
  borderRadius: 'var(--radius-md)',
});

function CheckItemCard({ item, quote, words, sel, toggleWord, markValid, markInvalid, markTodo }) {
  return (
        <Card variant="flat" padding="18px 20px" style={{ border: 'var(--stroke) solid var(--border)', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-black)', color: 'var(--uw-ocean)' }}>
              {t('check.ref', { c: item.contextId.reference.chapter, v: item.contextId.reference.verse })}
            </span>
            <Badge tone="neutral">{item.category}</Badge>
            <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', ...mono }}>{item.contextId.groupId}</span>
          </div>
          {/* Highlighted source: the quote the checker must find in the draft. */}
          <p lang="el" data-testid="check-quote" style={{ fontFamily: 'var(--font-greek)', fontSize: 20, lineHeight: 1.7, color: 'var(--text-scripture)', margin: '0 0 10px' }}>
            <span style={{ background: 'var(--tc-highlight-soft)', borderRadius: 4, padding: '0 .12em' }}>{quote}</span>
          </p>
          {item.contextId.occurrenceNote && (
            <p data-testid="check-note" style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 14px' }}>
              {item.contextId.occurrenceNote.slice(0, 400)}
            </p>
          )}

          {/* Your translation: tap the word(s) that render the quote (B23). */}
          <Overline tone="accent" style={{ letterSpacing: '.08em', margin: '0 0 6px', display: 'block' }}>
            {t('check.yourTranslation')}
          </Overline>
          {words.length === 0 ? (
            <p data-testid="check-target" data-drafted="0" style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '0 0 14px' }}>
              {t('check.notDrafted')}
            </p>
          ) : (
            <>
              <p data-testid="check-target" data-drafted="1" style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', margin: '0 0 8px' }}>
                {words.map((w, i) => (
                  <span key={i} data-testid={`tw-${i}`} data-selected={sel.has(i) ? '1' : '0'}
                    onClick={() => toggleWord(i)}
                    style={{ cursor: 'pointer', borderRadius: 4, padding: '0 .1em', marginInlineEnd: '.24em', background: sel.has(i) ? 'var(--tc-highlight-soft)' : 'transparent' }}>
                    {w}
                  </span>
                ))}
              </p>
              <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '0 0 14px' }}>{t('check.selectHint')}</p>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="mark-valid" onClick={markValid}
              style={triageStyle(item.status === 'valid', 'var(--tc-valid-strong)')}>
              {t('check.markValid')}
            </button>
            <button type="button" data-testid="mark-invalid" onClick={markInvalid}
              style={triageStyle(item.status === 'invalid', 'var(--tc-invalid)')}>
              {t('check.markInvalid')}
            </button>
            <button type="button" data-testid="mark-todo" onClick={markTodo}
              style={triageStyle(item.status === 'todo', 'var(--tc-warn-text)')}>
              {t('check.markTodo')}
            </button>
          </div>
        </Card>
  );
}

function CheckSessionNotices({ cs }) {
  return (
    <>
      {cs.warning && (
        <Callout tone="warn" data-testid="resolution-warning" style={{ margin: '0 0 14px' }}>
          <p style={{ fontSize: 'var(--fs-caption-lg)', fontWeight: 'var(--fw-heavy)', margin: '0 0 4px' }}>
            {t(isLanguageSwitch(cs.warning) ? 'check.warnSwitch' : 'check.warnUpgrade')}
          </p>
          <p style={{ fontSize: 'var(--fs-meta)', ...mono, margin: 0, lineHeight: 'var(--lh-body)' }}>
            {t('check.warnDetail', {
              stored: `${cs.warning.stored.repoPath} ${cs.warning.stored.version ?? ''}`.trim(),
              now: `${cs.warning.current?.repoPath} ${cs.warning.current?.version}`,
            })}
          </p>
        </Callout>
      )}

      {cs.saveError && (
        <div data-testid="save-error"
          style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-invalid)', background: 'var(--tc-invalid-surface)', border: 'var(--stroke) solid rgba(162,19,9,.25)', borderRadius: 'var(--radius-md)', padding: '10px 12px', margin: '0 0 14px', lineHeight: 'var(--lh-body)' }}>
          {t('check.saveRefused')}
        </div>
      )}

      {cs.invalidated > 0 && (
        <p data-testid="invalidated-notice"
          style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-invalid)', background: 'var(--tc-invalid-surface)', border: 'var(--stroke) solid rgba(162,19,9,.25)', borderRadius: 'var(--radius-md)', padding: '10px 12px', margin: '0 0 14px', lineHeight: 'var(--lh-body)' }}>
          {t('check.invalidatedNotice', { n: cs.invalidated })}
        </p>
      )}
    </>
  );
}

function CheckItemGrid({ cs, decided, onSelect }) {
  return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }} data-testid="check-list">
        {cs.items.map((it, i) => (
          <button key={`${it.contextId.checkId}-${i}`} type="button" onClick={() => onSelect(i)}
            title={`${it.contextId.reference.chapter}:${it.contextId.reference.verse} · ${it.contextId.groupId}`}
            data-ref={`${it.contextId.reference.chapter}:${it.contextId.reference.verse}`}
            data-decided={decided(it) ? '1' : '0'}
            data-invalid={it.invalidated === true ? '1' : '0'}
            style={{
              border: i === cs.activeIndex ? 'var(--stroke-control) solid var(--accent)' : 'var(--stroke) solid var(--border-input)',
              background: it.invalidated === true ? 'var(--tc-invalid-surface)' : decided(it) ? 'var(--tc-valid-surface)' : '#fff',
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
              fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-label)', width: 34, height: 28, borderRadius: 'var(--radius-xs)',
              color: it.invalidated === true ? 'var(--tc-invalid)' : decided(it) ? 'var(--tc-valid-strong)' : 'var(--text-tertiary)',
              padding: 0,
            }}>
            {t('check.ref', { c: it.contextId.reference.chapter, v: it.contextId.reference.verse })}
          </button>
        ))}
      </div>
  );
}

/** The active item's view primitives (B23): index, item, its ref, and the
 * draft verse text — `verses` is on the session, so the target text never
 * pollutes the stored §5.2 record. */
function sessionView(cs) {
  const activeIndex = cs?.activeIndex ?? 0;
  const activeItem = cs?.items?.[activeIndex];
  const activeRef = activeItem
    ? `${activeItem.contextId.reference.chapter}:${activeItem.contextId.reference.verse}`
    : '';
  const targetText = (cs?.verses && cs.verses[activeRef]) || '';
  return { activeIndex, activeItem, targetText, tool: cs?.tool, book: cs?.book };
}

/** The item's source quote — tN carries a word array, tW a plain string. */
const quoteOf = (item) =>
  Array.isArray(item?.contextId.quote)
    ? item.contextId.quote.map((w) => w.word).join(' ')
    : item?.contextId.quoteString;

function CheckSession() {
  const { s, actions } = useApp();
  const cs = s.checkSession;

  const { activeIndex, activeItem, targetText, tool, book } = sessionView(cs);
  const words = React.useMemo(() => targetWords(targetText), [targetText]);
  const [sel, setSel] = React.useState(() => new Set());
  // Sync the tap-selection to the active item's stored selection when the item
  // (or its verse text) changes — NOT on `selections`, so a save does not
  // fight the user's live tap-selection.
  React.useEffect(() => {
    setSel(new Set(tokenIndicesFromSelections(targetText, activeItem?.selections)));
  }, [activeIndex, tool, book, targetText]);

  if (cs?.loading) return <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)' }}>{t('check.deriving')}</p>;
  if (cs?.error) {
    return <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--tc-invalid)', lineHeight: 'var(--lh-body)' }} data-testid="check-error">{cs.error}</p>;
  }
  if (!cs?.items) return null;

  // C2.9 — designed empty states. The tool is genuinely usable; this book just
  // has no checks in the pinned resource.
  if (cs.empty) return <CheckEmpty cs={cs} actions={actions} />;

  const item = cs.items[cs.activeIndex];
  // Single source of truth with the progress meter — an Invalid triage counts
  // as decided in BOTH, and a carry-over invalidation counts in neither (B23).
  const decided = isDecided;
  const quote = quoteOf(item);

  const toggleWord = (i) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const markValid = () => {
    const selections = selectionsFromTokens(targetText, [...sel].sort((a, b) => a - b));
    actions.recordDecision(
      selections.length
        ? { selections, nothingToSelect: false, status: 'valid' }
        : { selections: false, nothingToSelect: true, status: 'valid' },
    );
  };
  const markInvalid = () =>
    actions.recordDecision({ selections: false, nothingToSelect: false, status: 'invalid' });
  const markTodo = () => actions.recordDecision({ status: 'todo' });

  return (
    <div data-testid="check-session">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button variant="secondary" size="sm" onClick={actions.closeCheckTool}>
          {t('check.back')}
        </Button>
        <div style={{ flex: 1 }} />
        <span data-testid="check-progress" style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>
          {t('check.progress', { decided: cs.progress.decided, total: cs.progress.total })}
        </span>
      </div>

      <ProgressBar value={cs.progress.total ? (cs.progress.decided / cs.progress.total) * 100 : 0}
        height={6} style={{ marginBottom: 18 }} />
      {/* #15: the denominator above EXCLUDES checks the project's versification
        * has no verse for. Dropping them silently would make "0 of 415" look
        * complete when the resource offered 417 — the same silence B20 fixed for
        * the fallback. Null for an eng project, which is every project whose
        * numbering matches the resource suite. */}
      <DroppedNote dropped={cs.dropped}
        style={{ background: 'var(--surface-warm)', border: 'var(--stroke) solid rgba(229,157,51,.35)', borderRadius: 'var(--radius-md)', padding: '10px 12px', margin: '0 0 10px' }} />

      {cs.resource && (
        <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-tertiary)', ...mono, margin: '0 0 16px' }}>
          {cs.resource.repoPath} · {cs.resource.version} · {t(`check.rung.${cs.resource.languageSet}`)}
        </p>
      )}

      {item && (
        <CheckItemCard item={item} quote={quote} words={words} sel={sel} toggleWord={toggleWord}
          markValid={markValid} markInvalid={markInvalid} markTodo={markTodo} />
      )}

      <CheckSessionNotices cs={cs} />

      <ArticlePanel article={cs.article} />

      <CheckItemGrid cs={cs} decided={decided} onSelect={(i) => actions.setCheckIndex(i)} />
    </div>
  );
}

export default function Check() {
  const { s, actions } = useApp();
  const pre = s.preflight;

  React.useEffect(() => {
    actions.runPreflight();
  }, [s.book, s.projectPins, s.netEnabled, s.tick]);

  if (!s.book) return null;

  if (s.aligning) {
    return (
      <main style={{ flex: 1, overflow: 'auto', padding: '32px 40px 64px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{ fontSize: 'var(--fs-h2)', letterSpacing: 'var(--track-22)', margin: '0 0 18px' }}>
            {t('nav.align')}
          </h1>
          <Align />
        </div>
      </main>
    );
  }

  if (s.checkTool) {
    return (
      <main style={{ flex: 1, overflow: 'auto', padding: '32px 40px 64px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h1 style={{ fontSize: 'var(--fs-h2)', letterSpacing: 'var(--track-22)', margin: '0 0 18px' }}>
            {t(`check.tool.${s.checkTool}`)} · {bookName(s.book)}
          </h1>
          <CheckSession />
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '32px 40px 64px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-h1)', letterSpacing: 'var(--track-32)', margin: '0 0 6px' }}>
          {t('check.title', { book: bookName(s.book) })}
        </h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 24px' }}>
          <p style={{ fontSize: 'var(--fs-ui)', letterSpacing: 'var(--track-13-5)', color: 'var(--text-tertiary)', margin: 0, lineHeight: 'var(--lh-body)', flex: 1 }}>
            {t('check.subtitle')}
          </p>
          {/* The checking language is a property of the PROJECT (D30.2), so its
            * entry point belongs where the project is open — not only on Home
            * before a project is chosen. */}
          <Button variant="ghost" onClick={actions.openSources} data-testid="open-sources"
            style={{ fontSize: 'var(--fs-caption-lg)', whiteSpace: 'nowrap' }}>
            {t('nav.sources')} →
          </Button>
        </div>
        {s.preflightError && (
          // Catch-to-absence sweep (D30): an identity-read outage is stated
          // and retryable — never every tool shown 'unavailable'.
          <Callout tone="warn" role="alert" data-testid="preflight-error" style={{ marginBottom: 16, overflowWrap: 'anywhere' }}>
            {t('check.preflightError')} {s.preflightError}{' '}
            <Button size="sm" variant="outline" data-testid="preflight-retry" onClick={() => actions.runPreflight()}>
              {t('app.retry')}
            </Button>
          </Callout>
        )}

        {pre === null && !s.preflightError && (
          <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)' }}>{t('check.checking')}</p>
        )}

        {pre && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {TOOLS.map((tool) => (
              <ToolCard key={tool} tool={tool} pre={pre[tool]} book={s.book} />
            ))}
          </div>
        )}

        {/* D30.5: an unavailable (tool, book) never blocks other work. */}
        {pre && (
          <Card variant="flat" padding="16px 18px" data-testid="align-card"
            style={{ border: 'var(--stroke) solid var(--border)', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{t('nav.align')}</span>
            </div>
            <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 10px' }}>
              {t('align.cardBody')}
            </p>
            <Button size="sm" onClick={actions.startAligning} data-testid="open-align">
              {t('align.open')}
            </Button>
          </Card>
        )}

        {/* D63 / #108: Publish is no longer a top-level tab — Community
          * Checking is a checking tool, and this card is its only entry. */}
        {pre && (
          <Card variant="flat" padding="16px 18px" data-testid="community-checking-card"
            style={{ border: 'var(--stroke) solid var(--border)', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 'var(--fs-ui-md)', letterSpacing: 'var(--track-14)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{t('cc.title')}</span>
            </div>
            <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: '0 0 10px' }}>
              {t('cc.cardDesc')}
            </p>
            <Button size="sm" onClick={() => actions.go('publish')} data-testid="open-community-checking">
              {t('cc.open')}
            </Button>
          </Card>
        )}

        {pre && Object.values(pre).some((p) => p.state !== 'ready') && (
          <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', lineHeight: 'var(--lh-body)', margin: '20px 0 0' }}>
            {t('check.neverBlocks')}
          </p>
        )}
      </div>
    </main>
  );
}
