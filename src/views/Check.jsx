// Check view — Increment 2, J4. This slice is the SESSION PREFLIGHT (C2.2,
// FR-5): before any checking UI exists, the app must answer honestly whether
// this (tool, book) can be checked at all, and offer the guided fix.
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

const TOOLS = Object.keys(TOOL_SLOT);

const TONE = {
  ready: { bg: '#E8F7ED', border: 'rgba(60,143,92,.35)', fg: '#3C8F5C' },
  fetch: { bg: '#eaf6fc', border: 'rgba(49,173,227,.4)', fg: '#0F7FB0' },
  unavailable: { bg: '#F6EEDC', border: 'rgba(229,157,51,.4)', fg: '#8A6A22' },
  unpinned: { bg: '#F7FAFC', border: 'rgba(35,31,32,.14)', fg: '#4F5E6A' },
  'not-covered': { bg: '#F7FAFC', border: 'rgba(35,31,32,.14)', fg: '#4F5E6A' },
};

function ToolCard({ tool, pre, book }) {
  const { actions } = useApp();
  const tone = TONE[pre.state] ?? TONE.unpinned;
  const rung = pre.resolution?.rung;
  const pin = pre.resolution?.pin || pre.needs;

  return (
    <div data-testid={`preflight-${tool}`} data-state={pre.state}
      style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#014263' }}>{t(`check.tool.${tool}`)}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: tone.fg }}>
          {t(`check.state.${pre.state}`)}
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#4F5E6A', lineHeight: 1.55, margin: '0 0 10px' }}>
        {t(`check.explain.${pre.state}`, { book: bookName(book) })}
      </p>
      {pin && (
        <p style={{ fontSize: 11.5, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace', margin: '0 0 10px' }}>
          {pin.repoPath} · {pin.version}
          {rung ? ` · ${t(`check.rung.${rung}`)}` : ''}
        </p>
      )}
      {pre.state === 'fetch' && (
        <button type="button" onClick={actions.openSources} className="hovNewBible"
          style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 16px', borderRadius: 999, background: '#31ADE3', color: '#fff' }}>
          {t('check.fix.download')}
        </button>
      )}
      {pre.state === 'unavailable' && (
        <button type="button" onClick={actions.goOnline}
          style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 16px', borderRadius: 999, background: '#E59D33', color: '#fff' }}>
          {t('sources.goOnline')}
        </button>
      )}
      {(pre.state === 'unpinned' || pre.state === 'not-covered') && (
        <button type="button" onClick={actions.openSources} className="hovRow"
          style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 16px', borderRadius: 999, color: '#014263' }}>
          {t('check.fix.getResources')}
        </button>
      )}
      {/* B20 warned fallback (D41): the resolver opened the installed fallback
        * because the pinned PRIMARY is not on this computer. That is not silent —
        * say which primary is missing and offer to download it. The card still
        * opens (state 'ready'); the fallback never blocks. */}
      {pre.unavailablePrimary && (
        <div data-testid={`fallback-warning-${tool}`}
          style={{ fontSize: 12.5, color: '#8A6A22', background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px', margin: '0 0 10px', lineHeight: 1.5 }}>
          {t('check.fallbackWarn', {
            repo: pre.unavailablePrimary.repoPath,
            version: pre.unavailablePrimary.version,
          })}
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={actions.openSources} data-testid={`fetch-primary-${tool}`}
              style={{ border: '1px solid rgba(229,157,51,.5)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, padding: '6px 14px', borderRadius: 999, color: '#8A6A22' }}>
              {t('check.fix.download')}
            </button>
          </div>
        </div>
      )}
      {pre.state === 'ready' && (
        <button type="button" onClick={() => actions.openCheckTool(tool)} className="hovNewBible"
          data-testid={`open-${tool}`}
          style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 16px', borderRadius: 999, background: '#31ADE3', color: '#fff' }}>
          {t('check.open')}
        </button>
      )}
    </div>
  );
}

/** The help article behind the active item (C2.5), read from the installed
 * burrito. Absence is stated, never rendered as an empty panel. */
function ArticlePanel({ article }) {
  if (!article) return null;
  if (article.loading) {
    return <p style={{ fontSize: 12.5, color: '#8A99A4', margin: '0 0 14px' }}>{t('check.articleLoading')}</p>;
  }
  if (!article.found) {
    return (
      <p data-testid="article-missing" style={{ fontSize: 12.5, color: '#8A6A22', background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
        {t('check.articleMissing')}
      </p>
    );
  }
  const blocks = renderArticleBlocks(article.found.body).slice(0, 40);
  return (
    <details data-testid="article-panel" open
      style={{ border: '1px solid rgba(35,31,32,.12)', borderRadius: 12, padding: '14px 18px', background: '#fff', margin: '0 0 14px' }}>
      <summary style={{ fontSize: 13.5, fontWeight: 800, color: '#014263', cursor: 'pointer' }}>
        {article.found.title}
      </summary>
      <div style={{ marginTop: 10 }}>
        {blocks.map((b, i) => {
          if (b.kind === 'h') {
            return (
              <p key={i} style={{ fontSize: 12.5, fontWeight: 800, color: '#014263', margin: '12px 0 4px', letterSpacing: '.02em' }}>{b.text}</p>
            );
          }
          if (b.kind === 'li') {
            return (
              <p key={i} style={{ fontSize: 13, color: '#4F5E6A', lineHeight: 1.6, margin: '0 0 4px', paddingInlineStart: 14 }}>{b.text}</p>
            );
          }
          return (
            <p key={i} style={{ fontSize: 13, color: '#4F5E6A', lineHeight: 1.65, margin: '0 0 8px' }}>{b.text}</p>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace', margin: '10px 0 0' }}>
        {article.found.ipath}
      </p>
    </details>
  );
}

/** The check list for one tool: every derived item, its decision state, and
 * the item detail. Derived at load and never stored (§4.2). */
function CheckSession() {
  const { s, actions } = useApp();
  const cs = s.checkSession;

  // B23 — the tN/tW selection: the checker highlights the word(s) in their
  // translation that render the item's quote. Hooks run before the early
  // returns (rules-of-hooks). `verses` is on the session, so the target text
  // never pollutes the stored §5.2 record.
  const activeIndex = cs?.activeIndex ?? 0;
  const activeItem = cs?.items?.[activeIndex];
  const activeRef = activeItem
    ? `${activeItem.contextId.reference.chapter}:${activeItem.contextId.reference.verse}`
    : '';
  const targetText = (cs?.verses && cs.verses[activeRef]) || '';
  const words = React.useMemo(() => targetWords(targetText), [targetText]);
  const [sel, setSel] = React.useState(() => new Set());
  // Sync the tap-selection to the active item's stored selection when the item
  // (or its verse text) changes — NOT on `selections`, so a save does not fight
  // the user's live selection.
  // Deps are deliberate: re-sync when the ACTIVE ITEM or its verse text changes,
  // not on `selections` — a save must not fight the user's live tap-selection.
  React.useEffect(() => {
    setSel(new Set(tokenIndicesFromSelections(targetText, activeItem?.selections)));
  }, [activeIndex, cs?.tool, cs?.book, targetText]);

  if (cs?.loading) return <p style={{ fontSize: 14, color: '#8A99A4' }}>{t('check.deriving')}</p>;
  if (cs?.error) {
    return <p style={{ fontSize: 14, color: '#A21309', lineHeight: 1.6 }} data-testid="check-error">{cs.error}</p>;
  }
  if (!cs?.items) return null;

  // C2.9 — designed empty states. The tool is genuinely usable; this book just
  // has no checks in the pinned resource.
  if (cs.empty) {
    return (
      <div data-testid="check-empty" data-empty={cs.empty}>
        <button type="button" onClick={actions.closeCheckTool}
          style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '7px 14px', borderRadius: 999, color: '#4F5E6A', marginBottom: 16 }}>
          {t('check.back')}
        </button>
        <div style={{ border: '1.5px dashed rgba(35,31,32,.18)', borderRadius: 14, padding: '32px 26px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#014263', margin: '0 0 8px' }}>
            {t(`check.empty.${cs.empty}.title`)}
          </p>
          <p style={{ fontSize: 13.5, color: '#4F5E6A', lineHeight: 1.6, margin: '0 auto', maxWidth: 460 }}>
            {t(`check.empty.${cs.empty}.body`)}
          </p>
          {/* §5.2: the dropped count MUST be surfaced even when it emptied the
            * whole list — silently shrinking the denominator is not permitted. */}
          {cs.dropped && (
            <p data-testid="versification-dropped"
              style={{ fontSize: 12.5, color: '#8A6A22', margin: '14px auto 0', maxWidth: 460, lineHeight: 1.5 }}>
              {t('check.droppedNote', { count: cs.dropped.count, scheme: cs.dropped.scheme ?? '—' })}
            </p>
          )}
          {cs.resource && (
            <p style={{ fontSize: 11.5, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace', margin: '14px 0 0' }}>
              {cs.resource.repoPath} · {cs.resource.version}
            </p>
          )}
        </div>
      </div>
    );
  }

  const item = cs.items[cs.activeIndex];
  // Single source of truth with the progress meter — an Invalid triage counts
  // as decided in BOTH, and a carry-over invalidation counts in neither (B23).
  const decided = isDecided;
  const quote = Array.isArray(item?.contextId.quote)
    ? item.contextId.quote.map((w) => w.word).join(' ')
    : item?.contextId.quoteString;

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
  const triageStyle = (active, tone) => ({
    border: `1.5px solid ${active ? tone : 'rgba(35,31,32,.18)'}`,
    background: active ? tone : '#fff',
    color: active ? '#fff' : '#4F5E6A',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 800,
    fontSize: 13,
    padding: '9px 16px',
    borderRadius: 10,
  });

  return (
    <div data-testid="check-session">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={actions.closeCheckTool}
          style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '7px 14px', borderRadius: 999, color: '#4F5E6A' }}>
          {t('check.back')}
        </button>
        <div style={{ flex: 1 }} />
        <span data-testid="check-progress" style={{ fontSize: 13, fontWeight: 800, color: '#014263' }}>
          {t('check.progress', { decided: cs.progress.decided, total: cs.progress.total })}
        </span>
      </div>

      <div style={{ height: 6, borderRadius: 99, background: '#ECF2F5', overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ height: '100%', background: '#31ADE3', borderRadius: 99, width: `${cs.progress.total ? (cs.progress.decided / cs.progress.total) * 100 : 0}%` }} />
      </div>
      {/* #15: the denominator above EXCLUDES checks the project's versification
        * has no verse for. Dropping them silently would make "0 of 415" look
        * complete when the resource offered 417 — the same silence B20 fixed for
        * the fallback. Say the count and why. Null for an eng project, which is
        * every project whose numbering matches the resource suite. */}
      {cs.dropped && (
        <div data-testid="versification-dropped"
          style={{ fontSize: 12.5, color: '#8A6A22', background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px', margin: '0 0 10px', lineHeight: 1.5 }}>
          {t('check.droppedNote', { count: cs.dropped.count, scheme: cs.dropped.scheme ?? '—' })}
        </div>
      )}

      {cs.resource && (
        <p style={{ fontSize: 11.5, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace', margin: '0 0 16px' }}>
          {cs.resource.repoPath} · {cs.resource.version} · {t(`check.rung.${cs.resource.languageSet}`)}
        </p>
      )}

      {item && (
        <div style={{ border: '1px solid rgba(35,31,32,.12)', borderRadius: 12, padding: '18px 20px', background: '#fff', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#014263' }}>
              {t('check.ref', { c: item.contextId.reference.chapter, v: item.contextId.reference.verse })}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', background: '#ECF2F5', color: '#4F5E6A', borderRadius: 999, padding: '2px 8px' }}>
              {item.category}
            </span>
            <span style={{ fontSize: 11.5, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace' }}>{item.contextId.groupId}</span>
          </div>
          {/* Highlighted source: the quote the checker must find in the draft. */}
          <p lang="el" data-testid="check-quote" style={{ fontFamily: "'PT Serif',serif", fontSize: 20, lineHeight: 1.7, color: '#231F20', margin: '0 0 10px' }}>
            <span style={{ background: '#FFF1B8', borderRadius: 4, padding: '0 .12em' }}>{quote}</span>
          </p>
          {item.contextId.occurrenceNote && (
            <p data-testid="check-note" style={{ fontSize: 13.5, color: '#4F5E6A', lineHeight: 1.65, margin: '0 0 14px' }}>
              {item.contextId.occurrenceNote.slice(0, 400)}
            </p>
          )}

          {/* Your translation: tap the word(s) that render the quote (B23). */}
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#31ADE3', margin: '0 0 6px' }}>
            {t('check.yourTranslation')}
          </div>
          {words.length === 0 ? (
            <p data-testid="check-target" data-drafted="0" style={{ fontSize: 14, color: '#8A99A4', fontStyle: 'italic', margin: '0 0 14px' }}>
              {t('check.notDrafted')}
            </p>
          ) : (
            <>
              <p data-testid="check-target" data-drafted="1" style={{ fontFamily: "'PT Serif',serif", fontSize: 19, lineHeight: 1.9, color: '#231F20', margin: '0 0 8px' }}>
                {words.map((w, i) => (
                  <span key={i} data-testid={`tw-${i}`} data-selected={sel.has(i) ? '1' : '0'}
                    onClick={() => toggleWord(i)}
                    style={{ cursor: 'pointer', borderRadius: 4, padding: '0 .1em', marginInlineEnd: '.24em', background: sel.has(i) ? '#FFF1B8' : 'transparent' }}>
                    {w}
                  </span>
                ))}
              </p>
              <p style={{ fontSize: 12, color: '#8A99A4', margin: '0 0 14px' }}>{t('check.selectHint')}</p>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="mark-valid" onClick={markValid}
              style={triageStyle(item.status === 'valid', '#3C8F5C')}>
              {t('check.markValid')}
            </button>
            <button type="button" data-testid="mark-invalid" onClick={markInvalid}
              style={triageStyle(item.status === 'invalid', '#A21309')}>
              {t('check.markInvalid')}
            </button>
            <button type="button" data-testid="mark-todo" onClick={markTodo}
              style={triageStyle(item.status === 'todo', '#8A6A22')}>
              {t('check.markTodo')}
            </button>
          </div>
        </div>
      )}

      {cs.warning && (
        <div data-testid="resolution-warning"
          style={{ border: '1px solid rgba(229,157,51,.45)', background: '#F6EEDC', borderRadius: 10, padding: '12px 14px', margin: '0 0 14px' }}>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: '#8A6A22', margin: '0 0 4px' }}>
            {t(isLanguageSwitch(cs.warning) ? 'check.warnSwitch' : 'check.warnUpgrade')}
          </p>
          <p style={{ fontSize: 11.5, color: '#8A6A22', fontFamily: 'ui-monospace,Menlo,monospace', margin: 0, lineHeight: 1.5 }}>
            {t('check.warnDetail', {
              stored: `${cs.warning.stored.repoPath} ${cs.warning.stored.version ?? ''}`.trim(),
              now: `${cs.warning.current?.repoPath} ${cs.warning.current?.version}`,
            })}
          </p>
        </div>
      )}

      {cs.saveError && (
        <div data-testid="save-error"
          style={{ fontSize: 12.5, color: '#A21309', background: '#FDECEA', border: '1px solid rgba(162,19,9,.25)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('check.saveRefused')}
        </div>
      )}

      {cs.invalidated > 0 && (
        <p data-testid="invalidated-notice"
          style={{ fontSize: 12.5, color: '#A21309', background: '#FDECEA', border: '1px solid rgba(162,19,9,.25)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('check.invalidatedNotice', { n: cs.invalidated })}
        </p>
      )}

      <ArticlePanel article={cs.article} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }} data-testid="check-list">
        {cs.items.map((it, i) => (
          <button key={`${it.contextId.checkId}-${i}`} type="button" onClick={() => actions.setCheckIndex(i)}
            title={`${it.contextId.reference.chapter}:${it.contextId.reference.verse} · ${it.contextId.groupId}`}
            data-ref={`${it.contextId.reference.chapter}:${it.contextId.reference.verse}`}
            data-decided={decided(it) ? '1' : '0'}
            data-invalid={it.invalidated === true ? '1' : '0'}
            style={{
              border: i === cs.activeIndex ? '2px solid #31ADE3' : '1px solid rgba(35,31,32,.14)',
              background: it.invalidated === true ? '#FDECEA' : decided(it) ? '#E8F7ED' : '#fff',
              cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 800, fontSize: 10.5, width: 34, height: 28, borderRadius: 7,
              color: it.invalidated === true ? '#A21309' : decided(it) ? '#3C8F5C' : '#8A99A4',
              padding: 0,
            }}>
            {t('check.ref', { c: it.contextId.reference.chapter, v: it.contextId.reference.verse })}
          </button>
        ))}
      </div>
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
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#014263', margin: '0 0 18px' }}>
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
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#014263', margin: '0 0 18px' }}>
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
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#014263', margin: '0 0 6px', letterSpacing: '-.01em' }}>
          {t('check.title', { book: bookName(s.book) })}
        </h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 24px' }}>
          <p style={{ fontSize: 14, color: '#8A99A4', margin: 0, lineHeight: 1.55, flex: 1 }}>
            {t('check.subtitle')}
          </p>
          {/* The checking language is a property of the PROJECT (D30.2), so its
            * entry point belongs where the project is open — not only on Home
            * before a project is chosen. */}
          <button type="button" onClick={actions.openSources} data-testid="open-sources"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, color: '#31ADE3', padding: 0, whiteSpace: 'nowrap' }}>
            {t('nav.sources')} →
          </button>
        </div>

        {pre === null && <p style={{ fontSize: 14, color: '#8A99A4' }}>{t('check.checking')}</p>}

        {pre && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {TOOLS.map((tool) => (
              <ToolCard key={tool} tool={tool} pre={pre[tool]} book={s.book} />
            ))}
          </div>
        )}

        {/* D30.5: an unavailable (tool, book) never blocks other work. */}
        {pre && (
          <div style={{ border: '1px solid rgba(35,31,32,.12)', background: '#fff', borderRadius: 12, padding: '16px 18px', marginTop: 12 }}
            data-testid="align-card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#014263' }}>{t('nav.align')}</span>
            </div>
            <p style={{ fontSize: 13, color: '#4F5E6A', lineHeight: 1.55, margin: '0 0 10px' }}>
              {t('align.cardBody')}
            </p>
            <button type="button" onClick={actions.startAligning} className="hovNewBible"
              data-testid="open-align"
              style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, padding: '8px 16px', borderRadius: 999, background: '#31ADE3', color: '#fff' }}>
              {t('align.open')}
            </button>
          </div>
        )}

        {pre && Object.values(pre).some((p) => p.state !== 'ready') && (
          <p style={{ fontSize: 12.5, color: '#8A99A4', lineHeight: 1.6, margin: '20px 0 0' }}>
            {t('check.neverBlocks')}
          </p>
        )}
      </div>
    </main>
  );
}
