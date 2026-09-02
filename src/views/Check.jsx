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
import { tokenizeVerse, matchQuote } from '../data/sourceHighlight';
import { verseText } from './verseText.js';
import { ExpandableNote } from './HelpsPanel.jsx';
import { t } from '../i18n';
import { Button, Callout, Drawer, Overline, ProgressBar } from '../ds/index.js';

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

// Exception-based (owner ruling 2026-08-29, issue #108): a checking resource
// is local in the normal flow, so "Ready / the pinned resource is on this
// computer" states the obvious and spends the card's best space doing it. A
// ready card is therefore a PLAIN card carrying what the tool does; the badge,
// the state explanation and the resource citation appear only when something
// is actually wrong. The citation still travels with the open session, which
// prints it in the tool header.
const TONE = {
  ready: { bg: 'var(--surface-card)', border: 'var(--border)', fg: 'var(--tc-valid-strong)' },
  fetch: { bg: 'var(--surface-accent-soft)', border: 'rgba(49,173,227,.4)', fg: 'var(--tc-suggest-fg)' },
  unavailable: { bg: 'var(--surface-warm)', border: 'rgba(229,157,51,.4)', fg: 'var(--tc-warn-text)' },
  unpinned: { bg: 'var(--surface-app)', border: 'var(--border-input)', fg: 'var(--text-secondary)' },
  'not-covered': { bg: 'var(--surface-app)', border: 'var(--border-input)', fg: 'var(--text-secondary)' },
};

/** The not-ready half of a tool card: which resource the tool wants, and the
 * one action that fixes it. A ready tool renders nothing here — its resource
 * is local, which is the normal case and not worth saying (owner ruling
 * 2026-08-29, #108). Kept out of ToolCard so that component stays inside the
 * staged-complexity gate. */
function ToolNeeds({ pre }) {
  const { actions } = useApp();
  // A warned fallback resolves to state 'ready' (the substitute IS local) while
  // `unavailablePrimary` names the pin that is missing. The warning names what
  // is absent; only the citation names what the checks will actually derive
  // from, so this is the one ready state that must still print it.
  if (pre.state === 'ready' && !pre.unavailablePrimary) return null;
  const pin = pre.resolution?.pin || pre.needs;
  const rung = pre.resolution?.rung;

  return (
    <>
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
    </>
  );
}

/* ---- #136 (D3d): the picker card's progress block — bar, count, next line,
 * dropped note — from the on-demand derivation (mockup L977–979). A missing
 * entry is still loading (quiet placeholder); an errored one is stated and
 * never blocks the card's open action (D30). ---- */

const CTA_STYLE = { display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-ui)', color: 'var(--text-accent)' };
const cardCaption = { fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', margin: '0 0 2px' };

// The design's tool card: a raised 16px card, 19px black title, description
// that fills, then the progress block and the CTA.
const PICKER_CARD = { border: 'var(--stroke) solid var(--border)', background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', padding: 22, textAlign: 'start', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-card)' };
const PICKER_TITLE = { fontSize: 'var(--fs-title-lg)', letterSpacing: 'var(--track-19)', fontWeight: 'var(--fw-black)', color: 'var(--text-heading)', margin: '0 0 6px' };
const PICKER_DESC = { fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 18px', flex: 1 };

/** The CTA text by state (mockup L1951): Start / Continue / Review. */
export function ctaFor(entry) {
  if (!entry || entry.error != null || !entry.total) return t('check.open');
  if (entry.done === 0) return t('check.cta.start');
  if (entry.done >= entry.total) return t('check.cta.review');
  return t('check.cta.continue');
}

function nextLineFor(entry, kind) {
  if (!entry || entry.error != null || !entry.total) return '';
  if (entry.done >= entry.total) return t('check.allResolved');
  if (kind === 'align') return entry.nextRef ? t('align.nextVerse', { ref: entry.nextRef }) : '';
  const it = entry.nextItem;
  if (!it) return '';
  return t('check.next', { quote: quoteOf(it) || it.contextId.groupId, c: it.contextId.reference.chapter, v: it.contextId.reference.verse });
}

function CardProgress({ entry, kind = 'check' }) {
  const countLabel = () => {
    if (!entry) return '—';
    if (entry.error != null) return t('check.progressError');
    if (!entry.total) return t('check.noItems');
    const args = { decided: entry.done, done: entry.done, total: entry.total };
    return kind === 'align' ? t('align.progressVerses', args) : t('check.progress', args);
  };
  const next = nextLineFor(entry, kind);
  return (
    <div data-testid={`picker-progress-${kind}`} data-loaded={entry ? '1' : '0'} style={{ marginBottom: 16 }}>
      <ProgressBar tone="valid" value={entry?.total ? (entry.done / entry.total) * 100 : 0} height={6} style={{ marginBottom: 9 }} />
      <p style={{ ...cardCaption, fontWeight: 'var(--fw-bold)', color: entry?.error != null ? 'var(--tc-warn-text)' : 'var(--text-secondary)' }}>
        {countLabel()}
      </p>
      {next !== '' && (
        <p style={{ ...cardCaption, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{next}</p>
      )}
      {/* #15: a denominator shrunk by versification is never silent. */}
      <DroppedNote dropped={entry?.dropped} style={{ marginTop: 4 }} />
    </div>
  );
}

/** Whole-card activation with keyboard parity (review round 1): a clickable
 * div needs role, tab stop, and Enter/Space — sighted-mouse-only cards are
 * not acceptable. */
const clickableCard = (open) => ({
  onClick: open,
  role: 'button',
  tabIndex: 0,
  onKeyDown: (e) => {
    // Only the card's OWN key events activate it (review round 2): a nested
    // button's Enter/Space bubbles here and must stay the button's alone —
    // the click path already stops propagation; the key path must match.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  },
});

function ToolCard({ tool, pre, book, progress }) {
  const { actions } = useApp();
  const tone = TONE[pre.state] ?? TONE.unpinned;
  const ready = pre.state === 'ready';
  const open = () => actions.openCheckTool(tool);

  return (
    <div data-testid={`preflight-${tool}`} data-state={pre.state} data-tc={ready ? 'card' : undefined}
      {...(ready ? clickableCard(open) : {})}
      style={{ ...PICKER_CARD, border: `var(--stroke) solid ${tone.border}`, background: tone.bg, boxShadow: ready ? 'var(--shadow-card)' : 'none', cursor: ready ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, ...PICKER_TITLE }}>
        <span>{t(`check.tool.${tool}`)}</span>
        {!ready && (
          <span style={{ fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: '.06em', textTransform: 'uppercase', color: tone.fg }}>
            {t(`check.state.${pre.state}`)}
          </span>
        )}
      </div>
      <p style={PICKER_DESC}>
        {ready ? t(`check.desc.${tool}`) : t(`check.explain.${pre.state}`, { book: bookName(book) })}
      </p>
      <ToolNeeds pre={pre} />
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
            {/* Inside a whole-card click target (review round 1): the nested
              * action must not ALSO open the tool. */}
            <Button size="sm" variant="secondary" data-testid={`fetch-primary-${tool}`}
              onClick={(e) => { e.stopPropagation(); actions.openSources(); }}
              style={{ color: 'var(--tc-warn-text)', borderColor: 'rgba(229,157,51,.5)' }}>
              {t('check.fix.download')}
            </Button>
          </div>
        </Callout>
      )}
      {pre.state === 'ready' && (
        <>
          <CardProgress entry={progress} />
          {/* The card is the control (role=button); the CTA is its label, not
            * a nested button (Codex round 1, a11y). Clicks bubble to the card. */}
          <span data-testid={`open-${tool}`} style={{ ...CTA_STYLE, alignSelf: 'flex-start' }}>
            {ctaFor(progress)} {'→'}
          </span>
        </>
      )}
    </div>
  );
}

/** The help article behind the active item (C2.5), read from the installed
 * burrito — presented as the mockup's right-side Drawer (F1, INVENTORY §6),
 * not an inline card. Absence is stated, never rendered as an empty panel. */
function ArticleBody({ article }) {
  if (!article || article.loading) {
    return <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', margin: 0 }}>{t('check.articleLoading')}</p>;
  }
  if (article.error) {
    // Catch-to-absence sweep (D30): a failed read is stated and retryable —
    // never "article missing". Selecting the item again re-requests it (the
    // same-key guard admits errored articles).
    return (
      <Callout tone="warn" role="alert" data-testid="article-error" style={{ overflowWrap: 'anywhere' }}>
        {t('understand.articleError')} {article.error}
      </Callout>
    );
  }
  if (!article.found) {
    return <Callout tone="warn" data-testid="article-missing">{t('check.articleMissing')}</Callout>;
  }
  // Round 37: never truncate real guidance — the committed en_ta fixture
  // already exceeds the old 40-block cap.
  const blocks = renderArticleBlocks(article.found.body);
  return (
    <div data-testid="article-panel">
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          return (
            <p key={i} style={{ fontSize: 'var(--fs-caption-lg)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', margin: '12px 0 4px', letterSpacing: '.02em' }}>{b.text}</p>
          );
        }
        if (b.kind === 'li') {
          return (
            <p key={i} style={{ fontSize: 'var(--fs-body)', color: 'var(--text-body)', lineHeight: 1.7, margin: '0 0 4px', paddingInlineStart: 14 }}>{b.text}</p>
          );
        }
        return (
          <p key={i} style={{ fontSize: 'var(--fs-body)', color: 'var(--text-body)', lineHeight: 1.7, margin: '0 0 16px' }}>{b.text}</p>
        );
      })}
      <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-tertiary)', ...mono, margin: '10px 0 0' }}>
        {article.found.ipath}
      </p>
    </div>
  );
}

/* The design system's own end-edge slide-over ('Translation Academy' is its
 * documented purpose); the article prose inherits the document direction. */
function AcademyDrawer({ article, cat, onClose }) {
  return (
    <Drawer data-testid="academy-drawer" width="var(--drawer-width)" onClose={onClose}
      eyebrow={t('check.academyEyebrow', { cat })}
      title={article?.found?.title ?? t('check.academyFallback')}>
      <ArticleBody article={article} />
    </Drawer>
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

/* The mockup's three large block triage buttons (F1): each carries its own
 * tone both idle and active, not the old small white outline pills. */
const TRIAGE_TONES = {
  valid: { activeBg: 'var(--tc-valid-strong)', idleFg: 'var(--tc-valid-strong)', idleBorder: 'rgba(88,193,122,.55)' },
  invalid: { activeBg: 'var(--tc-invalid)', idleFg: 'var(--tc-invalid)', idleBorder: 'var(--border-danger)' },
  todo: { activeBg: 'var(--uw-black)', idleFg: 'var(--text-secondary)', idleBorder: 'var(--border-strong)' },
};
const triageStyle = (active, tone) => ({
  border: `var(--stroke-selected) solid ${active ? tone.activeBg : tone.idleBorder}`,
  background: active ? tone.activeBg : 'var(--surface-card)',
  color: active ? 'var(--text-inverse)' : tone.idleFg,
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  fontWeight: 'var(--fw-heavy)',
  fontSize: 'var(--fs-ui-md)',
  padding: '11px 20px',
  borderRadius: 'var(--radius-md)',
});

const paneLabelRow = { padding: '16px 20px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)' };
const paneAbsent = (text) => (
  <p style={{ fontSize: 'var(--fs-ui-md)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '8px 0 0' }}>{text}</p>
);

/** The compare card's ORIGINAL-language row: the full source verse behind the
 * quote (INVENTORY §6 — the labeled row the old card never had). */
function OrigPane({ orig, c, v }) {
  if (!orig) return null; // one whole-book read is in flight
  const ot = orig.testament === 'ot';
  let body;
  if (orig.state === 'ready') {
    const text = verseText(orig.chapters?.[String(c)]?.[String(v)]);
    body = text ? (
      <p dir={ot ? 'rtl' : 'ltr'} lang={ot ? 'hbo' : 'el'}
        style={{ textAlign: 'start', fontFamily: ot ? 'var(--font-hebrew)' : 'var(--font-greek)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', margin: '8px 0 0' }}>
        {text}
      </p>
    ) : paneAbsent(t('check.paneAbsent'));
  } else if (orig.state === 'cross-frame') {
    // #131 class: the project's numbering differs from the source's frame.
    body = paneAbsent(t('check.crossFrame'));
  } else if (orig.state === 'error') {
    body = paneAbsent(orig.error);
  } else {
    body = paneAbsent(t('check.origUnavailable'));
  }
  return (
    <div data-testid="orig-pane" style={paneLabelRow}>
      <Overline tone="muted">{t(`check.origLabel.${orig.testament}`)}</Overline>
      {body}
    </div>
  );
}

/** Why the gateway pane has no verse to show — or null while pane ids / the
 * book text are still loading. Missing and a transient read error stay
 * distinct statements (D30). */
function ultAbsence(source, sourcePanes, crossFrame) {
  // #131 class: the project's numbering differs from the source's frame.
  if (crossFrame) return t('check.crossFrame');
  // Round 37 (§5.3): a project may legally declare no extraScripture.
  if (sourcePanes && sourcePanes.length === 0) return t('check.noGateway');
  if (sourcePanes === null || source === undefined) return null;
  if (source === 'missing') return t('check.ultUnavailable');
  if (source?.error) return source.error;
  return t('check.paneAbsent');
}

/** The gateway verse to render — never indexed cross-frame: a non-eng
 * project's (c, v) is in the PROJECT's numbering, not this book's. An
 * eng-framed project indexes its panes directly, the same frame-naive read
 * Translate's source pane makes — an extraScripture pin whose OWN frame
 * differs is #131's scope, here as there. */
const ultVerseObj = (source, crossFrame, c, v) =>
  !crossFrame && source && source !== 'missing' && !source.error
    ? source.chapters?.[String(c)]?.[String(v)]
    : null;

/** The compare card's GATEWAY row: the project's §5.3 extraScripture verse
 * with the quote's tokens highlighted through the alignment (same matcher as
 * the helps panel). Pane ids are the project's own — 'ult' is preferred when
 * present, otherwise the first declared pane; a project with none states so. */
function UltPane({ sources, sourcePanes, item, c, v, crossFrame }) {
  const paneId = sourcePanes?.includes('ult') ? 'ult' : sourcePanes?.[0];
  const source = paneId ? sources?.[paneId] : undefined;
  const vObj = ultVerseObj(source, crossFrame, c, v);
  const tokens = React.useMemo(() => (vObj ? tokenizeVerse(vObj) : []), [vObj]);
  const hits = React.useMemo(
    () => (tokens.length
      ? matchQuote(tokens, item.contextId.quote ?? item.contextId.quoteString ?? '', item.contextId.occurrence ?? 1)
      : new Set()),
    [tokens, item],
  );
  let body;
  if (tokens.length) {
    // Token stream rendered the SourceVerse way: raw text nodes with <mark>
    // on the quote's hits, so the USFM's own spacing survives.
    body = (
      <p data-testid="ult-pane-text" dir="auto" style={{ textAlign: 'start', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', margin: '8px 0 0' }}>
        {tokens.map((tok, i) =>
          hits.has(i) ? (
            <mark key={i} data-testid="ult-hl" style={{ background: 'var(--tc-highlight-soft)', color: 'var(--text-heading)', borderRadius: 'var(--radius-xs)', padding: '0 .06em' }}>
              {tok.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{tok.text}</React.Fragment>
          ),
        )}
      </p>
    );
  } else {
    const absent = ultAbsence(source, sourcePanes, crossFrame);
    body = absent == null ? null : paneAbsent(absent);
  }
  return (
    <div data-testid="ult-pane" style={{ ...paneLabelRow, background: 'var(--surface-app)' }}>
      <Overline tone="muted">
        {paneId && paneId !== 'ult' ? t('check.gatewayLabel', { name: paneId.toUpperCase() }) : t('check.ultLabel')}
      </Overline>
      {body}
    </div>
  );
}

/** The detail column (F1): ref + item counter header, serif phrase h1, the
 * "What to check" note box, the Academy link, the compare card, and the three
 * block triage buttons — the mockup's L1044–1196 region. */
function CheckDetail({ cs, item, sources, sourcePanes, words, sel, toggleWord, markValid, markInvalid, markTodo, onOpenAcademy, onNav }) {
  const c = item.contextId.reference.chapter;
  const v = item.contextId.reference.verse;
  const quote = quoteOf(item);
  const idx = cs.activeIndex;
  const canPrev = idx > 0;
  const canNext = idx < cs.items.length - 1;
  const navStyle = (enabled) => ({
    border: 'var(--stroke) solid', background: 'var(--surface-card)', fontFamily: 'inherit',
    fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-ui-sm)', width: 30, height: 30, borderRadius: 'var(--radius-sm)',
    color: enabled ? 'var(--text-heading)' : 'var(--uw-mist)',
    borderColor: enabled ? 'var(--border-strong)' : 'var(--border)',
    cursor: enabled ? 'pointer' : 'default',
  });

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 32px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)' }}>
          {bookName(cs.book)} {t('check.ref', { c, v })}
        </span>
        <div style={{ flex: 1 }} />
        <span data-testid="check-item-counter" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {t('check.itemOf', { n: idx + 1, total: cs.items.length })}
        </span>
        <button type="button" data-testid="check-prev" title={t('check.prevItem')} disabled={!canPrev}
          onClick={() => canPrev && onNav(idx - 1)} style={navStyle(canPrev)}>←</button>
        <button type="button" data-testid="check-next" title={t('check.nextItem')} disabled={!canNext}
          onClick={() => canNext && onNav(idx + 1)} style={navStyle(canNext)}>→</button>
      </div>

      <h1 data-testid="check-quote" style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: '0 0 14px' }}>
        “{quote}”
      </h1>

      {item.contextId.occurrenceNote && (
        <div data-testid="check-note" style={{ maxWidth: '62ch', marginBottom: 8, borderRadius: 'var(--radius-lg)', padding: '16px 18px', background: 'var(--surface-warm)', border: 'var(--stroke) solid var(--tc-warn-border)' }}>
          <Overline style={{ color: 'var(--tc-warn-text-2)' }}>{t('check.whatToCheck')}</Overline>
          <div style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', lineHeight: 'var(--lh-body)', fontWeight: 'var(--fw-medium)', color: 'var(--uw-ink)', margin: '7px 0 0' }}>
            {/* Keyed by item: the expanded/collapsed state must not leak from
              * one check to the next. */}
            <ExpandableNote key={idx} text={item.contextId.occurrenceNote} />
          </div>
        </div>
      )}

      <Button variant="ghost" data-testid="open-academy" onClick={onOpenAcademy} style={{ margin: '0 0 24px' }}>
        {t('check.learnMore', { title: cs.article?.found?.title ?? t('check.academyFallback') })}
      </Button>

      <CheckSessionNotices cs={cs} />

      {/* The compare card: original → gateway → your translation, one stacked
        * card (mockup L1152–1187). */}
      <div style={{ background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <OrigPane orig={cs.orig} c={c} v={v} />
        <UltPane sources={sources} sourcePanes={sourcePanes} item={item} c={c} v={v} crossFrame={cs.crossFrame} />
        <div style={{ padding: '16px 20px' }}>
          <Overline tone="accent">{t('check.yourTranslation')}</Overline>
          {words.length === 0 ? (
            <p data-testid="check-target" data-drafted="0" style={{ fontSize: 'var(--fs-ui-md)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '8px 0 0' }}>
              {t('check.notDrafted')}
            </p>
          ) : (
            <>
              <p data-testid="check-target" data-drafted="1" style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-title-lg)', lineHeight: 1.9, color: 'var(--text-scripture)', margin: '8px 0 0' }}>
                {words.map((w, i) => (
                  <span key={i} data-testid={`tw-${i}`} data-selected={sel.has(i) ? '1' : '0'}
                    onClick={() => toggleWord(i)}
                    style={{ cursor: 'pointer', borderRadius: 4, padding: '0 .1em', marginInlineEnd: '.22em', background: sel.has(i) ? 'var(--tc-highlight-soft)' : 'transparent' }}>
                    {w}
                  </span>
                ))}
              </p>
              <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>{t('check.selectHint')}</p>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
        <button type="button" data-testid="mark-valid" onClick={markValid}
          style={triageStyle(item.status === 'valid', TRIAGE_TONES.valid)}>
          {t('check.markValid')}
        </button>
        <button type="button" data-testid="mark-invalid" onClick={markInvalid}
          style={triageStyle(item.status === 'invalid', TRIAGE_TONES.invalid)}>
          {t('check.markInvalid')}
        </button>
        <button type="button" data-testid="mark-todo" onClick={markTodo}
          style={triageStyle(item.status === 'todo', TRIAGE_TONES.todo)}>
          {t('check.markTodo')}
        </button>
      </div>
    </div>
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

/* ---- Left rail (F1): tool header, progress, filter + sort chips, and the
 * status-dot item list — the mockup's 300px aside (L999–1042). ---- */

const railChip = (on) => ({
  border: 'var(--stroke) solid',
  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'var(--fw-bold)',
  fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', padding: '5px 10px',
  borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
  background: on ? 'var(--uw-ocean)' : 'var(--surface-card)',
  color: on ? 'var(--text-inverse)' : 'var(--text-secondary)',
  borderColor: on ? 'var(--uw-ocean)' : 'var(--border-input)',
});

const statusOf = (it) => (it.status === 'valid' || it.status === 'invalid' ? it.status : 'todo');
const DOT = { valid: 'var(--tc-valid)', invalid: 'var(--tc-invalid)', todo: 'var(--text-tertiary)' };

/** Sort modes per tool (mockup L1971–2000): tW groups by term or lists by
 * verse; tN lists by verse or groups by category. */
const SORTS = {
  translationWords: { modes: ['byWord', 'byVerse'], default: 'byWord' },
  translationNotes: { modes: ['byVerse', 'byCategory'], default: 'byVerse' },
};

/** Reference fields are number | string (derive.ts CheckReference): 'front',
 * comma lists and letter verses are legal — they sort ahead of any number
 * instead of poisoning the comparator with NaN. */
const refNum = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : -1;
};

export function railGroupsOf({ items, sortMode, book }) {
  const rows = items.slice().sort((a, z) =>
    refNum(a.it.contextId.reference.chapter) - refNum(z.it.contextId.reference.chapter)
    || refNum(a.it.contextId.reference.verse) - refNum(z.it.contextId.reference.verse));
  if (sortMode === 'byWord') {
    const terms = [...new Set(rows.map((r) => r.it.contextId.groupId))].sort((a, z) => a.localeCompare(z));
    return terms.map((term) => ({ label: term, rows: rows.filter((r) => r.it.contextId.groupId === term) }));
  }
  if (sortMode === 'byCategory') {
    const cats = [...new Set(rows.map((r) => r.it.category))];
    return cats.map((cat) => ({ label: cat, rows: rows.filter((r) => r.it.category === cat) }));
  }
  return [{ label: bookName(book), rows }];
}

function CheckRail({ cs, filter, setFilter, sortMode, setSortMode, onSelect }) {
  const { actions } = useApp();
  const decided = isDecided;
  const indexed = cs.items.map((it, i) => ({ it, i }));
  const counts = {
    all: indexed.length,
    todo: indexed.filter(({ it }) => !decided(it)).length,
    invalid: indexed.filter(({ it }) => it.status === 'invalid').length,
  };
  const filtered = indexed.filter(({ it }) =>
    filter === 'all' ? true : filter === 'todo' ? !decided(it) : it.status === 'invalid');
  const sorts = SORTS[cs.tool];
  const groups = railGroupsOf({ items: filtered, tool: cs.tool, sortMode, book: cs.book });

  return (
    <aside data-testid="check-rail" style={{ width: 'var(--rail-width-wide)', flex: 'none', background: 'var(--surface-card)', borderInlineEnd: 'var(--stroke-hair) solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', flex: 'none' }}>
        <Button variant="ghost" size="sm" onClick={actions.closeCheckTool} style={{ padding: 0, marginBottom: 8 }}>
          {t('check.back')}
        </Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', fontWeight: 'var(--fw-black)', color: 'var(--text-heading)', margin: '0 0 2px' }}>
          {t(`check.tool.${cs.tool}`)}
        </h2>
        <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '0 0 10px', fontWeight: 'var(--fw-medium)' }}>
          {bookName(cs.book)}
        </p>
        <ProgressBar tone="valid" value={cs.progress.total ? (cs.progress.decided / cs.progress.total) * 100 : 0} height={7} />
        <p data-testid="check-progress" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-secondary)', margin: '8px 0 12px', fontWeight: 'var(--fw-medium)' }}>
          {t('check.progress', { decided: cs.progress.decided, total: cs.progress.total })}
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'todo', 'invalid'].map((k) => (
            <button key={k} type="button" data-trim="cap" data-testid={`filter-${k}`} onClick={() => setFilter(k)} style={railChip(filter === k)}>
              {t(`check.filter.${k}`)} · {counts[k]}
            </button>
          ))}
        </div>
        {sorts && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <Overline tone="muted">{t('check.sort')}</Overline>
            {sorts.modes.map((m) => (
              <button key={m} type="button" data-trim="cap" data-testid={`sort-${m}`} onClick={() => setSortMode(m)} style={railChip(sortMode === m)}>
                {t(`check.sort.${m}`)}
              </button>
            ))}
          </div>
        )}
        {/* #15: the dropped count travels with the progress it qualifies. */}
        <DroppedNote dropped={cs.dropped} style={{ marginTop: 10 }} />
        {cs.resource && (
          <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-tertiary)', ...mono, margin: '10px 0 0', overflowWrap: 'anywhere' }}>
            {cs.resource.repoPath} · {cs.resource.version} · {t(`check.rung.${cs.resource.languageSet}`)}
          </p>
        )}
      </div>
      <div data-testid="check-list" style={{ flex: 1, overflow: 'auto', padding: 14, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map((grp) => (
          <div key={grp.label}>
            <Overline tone="muted" as="p" style={{ margin: '0 0 6px' }}>{grp.label}</Overline>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {grp.rows.map(({ it, i }) => {
                const st = statusOf(it);
                const activeRow = i === cs.activeIndex;
                return (
                  <button key={`${it.contextId.checkId}-${i}`} type="button" data-tc="rail-item" data-tc-selected={activeRow ? 'true' : undefined} onClick={() => onSelect(i)}
                    title={`${it.contextId.reference.chapter}:${it.contextId.reference.verse} · ${it.contextId.groupId}`}
                    data-ref={`${it.contextId.reference.chapter}:${it.contextId.reference.verse}`}
                    data-decided={decided(it) ? '1' : '0'}
                    data-invalid={it.invalidated === true ? '1' : '0'}
                    style={{
                      border: `var(--stroke) solid ${activeRow ? 'var(--accent)' : 'var(--border)'}`,
                      textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
                      borderRadius: 'var(--radius-md)', padding: '10px 12px', width: '100%',
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: activeRow ? 'var(--surface-accent-soft)' : 'var(--surface-card)',
                    }}>
                    <span style={{ width: 9, height: 9, borderRadius: 'var(--radius-pill)', flex: 'none', background: it.invalidated === true ? DOT.invalid : DOT[st] }} />
                    <span style={{ flex: 1, fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      “{quoteOf(it) || it.contextId.groupId}”
                    </span>
                    <span style={{ fontSize: 'var(--fs-badge)', letterSpacing: 'var(--track-10)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {t('check.ref', { c: it.contextId.reference.chapter, v: it.contextId.reference.verse })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p data-testid="rail-empty" style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '6px 2px' }}>
            {t('check.railEmpty')}
          </p>
        )}
      </div>
      <div style={{ padding: '12px 16px', borderTop: 'var(--stroke-hair) solid var(--border-hair)' }}>
        {/* Close the session before leaving: a kept-alive session would render
          * stale target text and decisions after the user edits in Translate —
          * re-opening the tool re-derives and re-runs invalidation. */}
        <Button variant="ghost" size="sm" style={{ padding: 0 }}
          onClick={() => { actions.closeCheckTool(); actions.go('draft'); }}>
          {t('check.backToTranslating')}
        </Button>
      </div>
    </aside>
  );
}

/* ---- Align workspace (#129): the third checking tool on the same rail+detail
 * architecture. The rail lists every verse of the book with its derived
 * alignment status (valid = fully placed, invalid = draft changed under the
 * record, todo = unplaced words, undrafted = nothing to align yet); the
 * detail pane hosts the existing editor unchanged — every write still goes
 * through the §5.1 sidecar (D65). ---- */

const ALIGN_FILTERS = {
  all: () => true,
  todo: (it) => it.status === 'todo' || it.status === 'undrafted',
  invalid: (it) => it.status === 'invalid',
};

function AlignRail({ index, activeRef, filter, setFilter, onSelect }) {
  const { s, actions } = useApp();
  const items = index?.items ?? [];
  const counts = Object.fromEntries(
    Object.entries(ALIGN_FILTERS).map(([k, fn]) => [k, items.filter(fn).length]),
  );
  const filtered = items.filter(ALIGN_FILTERS[filter]);
  const drafted = items.filter((it) => it.status !== 'undrafted');
  const done = drafted.filter((it) => it.status === 'valid').length;

  return (
    <aside data-testid="align-rail" style={{ width: 'var(--rail-width-wide)', flex: 'none', background: 'var(--surface-card)', borderInlineEnd: 'var(--stroke-hair) solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', flex: 'none' }}>
        <Button variant="ghost" size="sm" onClick={actions.closeAlign} style={{ padding: 0, marginBottom: 8 }}>
          {t('check.back')}
        </Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', fontWeight: 'var(--fw-black)', color: 'var(--text-heading)', margin: '0 0 2px' }}>
          {t('nav.align')}
        </h2>
        <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '0 0 10px', fontWeight: 'var(--fw-medium)' }}>
          {bookName(s.book)}
        </p>
        <ProgressBar tone="valid" value={drafted.length ? (done / drafted.length) * 100 : 0} height={7} />
        <p data-testid="align-rail-progress" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-secondary)', margin: '8px 0 12px', fontWeight: 'var(--fw-medium)' }}>
          {t('align.progressVerses', { done, total: drafted.length })}
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(ALIGN_FILTERS).map((k) => (
            <button key={k} type="button" data-trim="cap" data-testid={`align-filter-${k}`} onClick={() => setFilter(k)} style={railChip(filter === k)}>
              {t(`check.filter.${k}`)} · {counts[k]}
            </button>
          ))}
        </div>
        {index?.error && (
          <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-invalid)', lineHeight: 'var(--lh-body)', margin: '10px 0 0', overflowWrap: 'anywhere' }}>
            {index.error}
          </p>
        )}
      </div>
      <div data-testid="align-verse-list" style={{ flex: 1, overflow: 'auto', padding: 14, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((it) => {
          const undrafted = it.status === 'undrafted';
          const activeRow = it.ref === activeRef;
          return (
            <button key={it.ref} type="button" disabled={undrafted} data-tc={undrafted ? undefined : 'rail-item'} data-tc-selected={activeRow ? 'true' : undefined}
              onClick={() => !undrafted && onSelect(it.ref)}
              data-ref={it.ref} data-status={it.status}
              style={{
                border: `var(--stroke) solid ${activeRow ? 'var(--accent)' : 'var(--border)'}`,
                textAlign: 'start', cursor: undrafted ? 'default' : 'pointer', fontFamily: 'inherit',
                borderRadius: 'var(--radius-md)', padding: '10px 12px', width: '100%',
                display: 'flex', alignItems: 'center', gap: 10,
                background: activeRow ? 'var(--surface-accent-soft)' : 'var(--surface-card)',
                opacity: undrafted ? 0.55 : 1,
              }}>
              <span style={{ width: 9, height: 9, borderRadius: 'var(--radius-pill)', flex: 'none', background: DOT[it.status] ?? 'var(--uw-mist)' }} />
              <span style={{ fontSize: 'var(--fs-badge)', letterSpacing: 'var(--track-10)', fontWeight: 'var(--fw-bold)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                {it.ref}
              </span>
              <span style={{ flex: 1, fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: undrafted ? 'italic' : 'normal' }}>
                {undrafted ? t('align.notDraftedShort') : it.text}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p data-testid="align-rail-empty" style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: '6px 2px' }}>
            {t('check.railEmpty')}
          </p>
        )}
      </div>
      <div style={{ padding: '12px 16px', borderTop: 'var(--stroke-hair) solid var(--border-hair)' }}>
        <Button variant="ghost" size="sm" style={{ padding: 0 }}
          onClick={() => { actions.closeAlign(); actions.go('draft'); }}>
          {t('check.backToTranslating')}
        </Button>
      </div>
    </aside>
  );
}

function AlignWorkspace() {
  const { s, actions } = useApp();
  const [filter, setFilter] = React.useState('all');
  // The rail's statuses derive from the sidecar + the draft: refresh when the
  // verse changes and after each edit lands on the session record.
  React.useEffect(() => {
    actions.loadAlignIndex();
  }, [s.book, s.alignVerse, s.alignSession?.record]);

  const activeRef = s.alignVerse ?? s.alignSession?.ref ?? null;
  return (
    <div data-testid="align-workspace" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <AlignRail index={s.alignIndex} activeRef={activeRef} filter={filter} setFilter={setFilter}
        onSelect={(ref) => actions.setAlignVerse(ref)} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-app)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 32px 60px' }}>
          <Align embedded />
        </div>
      </main>
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

  // View-only rail state (F1). Filter and sort reset when the tool or book
  // changes; the Academy drawer closes with them.
  const [filter, setFilter] = React.useState('all');
  const [sortMode, setSortMode] = React.useState(SORTS[tool]?.default);
  const [academyOpen, setAcademyOpen] = React.useState(false);
  React.useEffect(() => {
    setFilter('all');
    setSortMode(SORTS[tool]?.default);
    setAcademyOpen(false);
  }, [tool, book]);

  const centered = (child) => (
    <main style={{ flex: 1, overflow: 'auto', padding: '32px 40px 64px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>{child}</div>
    </main>
  );
  if (cs?.loading) return centered(<p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)' }}>{t('check.deriving')}</p>);
  if (cs?.error) {
    return centered(<p style={{ fontSize: 'var(--fs-ui)', color: 'var(--tc-invalid)', lineHeight: 'var(--lh-body)' }} data-testid="check-error">{cs.error}</p>);
  }
  if (!cs?.items) return null;

  // C2.9 — designed empty states. The tool is genuinely usable; this book just
  // has no checks in the pinned resource.
  if (cs.empty) return centered(<CheckEmpty cs={cs} actions={actions} />);

  const item = cs.items[cs.activeIndex];

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

  /* #15 note carried into the rail: the progress denominator EXCLUDES checks
   * the project's versification has no verse for — DroppedNote states the
   * count beside it, never a silently smaller total. */
  return (
    <div data-testid="check-session" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <CheckRail cs={cs} filter={filter} setFilter={setFilter}
        sortMode={sortMode} setSortMode={setSortMode}
        onSelect={(i) => actions.setCheckIndex(i)} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-app)' }}>
        {item && (
          <CheckDetail cs={cs} item={item} sources={s.sources} sourcePanes={s.sourcePanes} words={words} sel={sel}
            toggleWord={toggleWord} markValid={markValid} markInvalid={markInvalid} markTodo={markTodo}
            onOpenAcademy={() => setAcademyOpen(true)}
            onNav={(i) => actions.setCheckIndex(i)} />
        )}
      </main>
      {academyOpen && (
        <AcademyDrawer article={cs.article} cat={item?.category} onClose={() => setAcademyOpen(false)} />
      )}
    </div>
  );
}

export default function Check() {
  const { s, actions } = useApp();
  const pre = s.preflight;

  React.useEffect(() => {
    actions.runPreflight();
  }, [s.book, s.projectPins, s.netEnabled, s.tick]);

  // #136 (D3d): derive the picker cards' progress on demand — on entering
  // the picker and on returning to it (a closed session flips atPicker back
  // on, so counts reflect the decisions just made). Never stored (§4.2).
  // bookRaw is a dependency (review round 1): preflight can finish before
  // the book read, and a derivation against a null draft would both fail the
  // Align entry and revalidate the tools against nothing.
  const atPicker = !s.checkTool && !s.aligning;
  React.useEffect(() => {
    if (pre && atPicker && s.bookRaw) actions.loadPickerProgress();
  }, [pre, atPicker, s.bookRaw]);

  if (!s.book) return null;

  // #129: Align opens inside the same rail+detail workspace as the derived
  // tools — no separate top-level Align screen.
  if (s.aligning) return <AlignWorkspace />;

  // F1 (epic #104 fidelity): the session owns the whole area — a 300px rail
  // and the detail column, the mockup's two-pane workspace. The tool name and
  // book moved into the rail header.
  if (s.checkTool) return <CheckSession />;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '44px 40px 64px', background: 'var(--surface-app)' }}>
      {/* --measure-page is the token defined for "home + tool picker"
        * (ds/tokens/spacing.css); the picker was pinned to 760px, too narrow
        * for the mockup's card grid to reach its three columns. */}
      <div style={{ maxWidth: 'var(--measure-page)', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-h1)', letterSpacing: 'var(--track-32)', margin: '0 0 6px' }}>
          {t('check.title')}
        </h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 30px' }}>
          <p style={{ fontSize: 'var(--fs-body)', letterSpacing: 'var(--track-15)', color: 'var(--text-secondary)', margin: 0, maxWidth: 640, flex: 1 }}>
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

        {/* One responsive card grid, as the mockup lays the picker out
          * (App.jsx L445: repeat(auto-fit,minmax(270px,1fr))). Every checking
          * tool is a peer here — the two derived tools, Align (D30.5: an
          * unavailable (tool, book) never blocks other work) and, since D63 /
          * #108 retired the Publish tab, Community Checking, whose card is its
          * only entry. */}
        {pre && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 16 }}>
            {TOOLS.map((tool) => (
              <ToolCard key={tool} tool={tool} pre={pre[tool]} book={s.book}
                progress={s.pickerProgress?.[tool]} />
            ))}

            <div data-testid="align-card" data-tc="card"
              {...clickableCard(actions.startAligning)}
              style={{ ...PICKER_CARD, cursor: 'pointer' }}>
              <div style={PICKER_TITLE}>{t('nav.align')}</div>
              <p style={PICKER_DESC}>{t('align.cardBody')}</p>
              <CardProgress entry={s.pickerProgress?.align} kind="align" />
              <span data-testid="open-align" style={{ ...CTA_STYLE, alignSelf: 'flex-start' }}>
                {ctaFor(s.pickerProgress?.align)} {'→'}
              </span>
            </div>

            <div data-testid="community-checking-card" data-tc="card"
              {...clickableCard(() => actions.go('publish'))}
              style={{ ...PICKER_CARD, cursor: 'pointer' }}>
              <div style={PICKER_TITLE}>{t('cc.title')}</div>
              <p style={PICKER_DESC}>{t('cc.cardDesc')}</p>
              {/* The design's progress block: a whole-chapter pass has no count
                * yet, so the bar stays empty and the next line names the read. */}
              <div style={{ marginBottom: 16 }}>
                <ProgressBar tone="valid" value={0} height={6} style={{ marginBottom: 9 }} />
                <p style={{ ...cardCaption, fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }}>{t('cc.wholeChapter')}</p>
                <p style={{ ...cardCaption, color: 'var(--text-tertiary)' }}>{t('cc.nextRead', { ref: `${bookName(s.book)} ${s.chapter}` })}</p>
              </div>
              <span data-testid="open-community-checking" style={{ ...CTA_STYLE, alignSelf: 'flex-start' }}>
                {t('cc.open')}
              </span>
            </div>
          </div>
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
