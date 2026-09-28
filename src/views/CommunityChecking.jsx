// Community Checking — the publish flow's home inside Check (D63, epic #104 /
// #108). A typeset preview of the current book rendered from the project's own
// text, with working page-setup controls. The two exports are shown but
// DISABLED: they arrive with J7 later in Increment 4 (owner ruling 2026-08-27
// recorded in #108) — an honest state, not a dead end.
//
// An OBS project (#291, D74 §8) previews the stories the OBS PDF prints
// (#454, src/data/storyModel.ts printedStories): each drafted story's title,
// pictures, frame text and reference line, one line for each run of undrafted
// frames or stories, with the OBS-only page setup: the layout and pictures on
// or off.
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { DEFAULT_PAGE_SETUP } from '../data/export/pageSetup';
import { printedItems } from '../data/bookModel';
import PrintPages from './print/PrintPages.jsx';
import { frameGapText, storyGapText, storyTitle } from './print/PrintStories.jsx';
import { t } from '../i18n';
import { Button, FilterChip, Toggle, Overline, Callout } from '../ds/index.js';
import ExportMenu from './ExportMenu.jsx';

const PAGE = { maxWidth: 680, margin: '0 auto', background: '#fff', boxShadow: 'var(--shadow-page)', borderRadius: 4, padding: '64px 72px' };
const EYEBROW = { textAlign: 'center', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 4px' };
const H1 = { textAlign: 'center', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: '0 0 6px' };
const RULE = { height: 1, background: 'var(--border)', margin: '0 auto 30px', width: 70 };
const ASIDE = { width: 'var(--rail-width-wide)', flex: 'none', background: 'var(--surface-card)', borderInlineStart: 'var(--stroke-hair) solid var(--border)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' };
const SETUP_BOX = { border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' };
const SETUP_LIST = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)' };

function PageSetupChoiceRow({ label, labelId, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span id={labelId}>{label}</span>
      <span role="group" aria-labelledby={labelId} style={{ display: 'flex', gap: 4 }}>
        {options.map((option) => (
          <FilterChip key={option.value} type="button" selected={value === option.value}
            aria-pressed={value === option.value} onClick={() => onChange(option.value)}
            style={{ display: 'inline-block', padding: '5px 11px', fontSize: 'var(--fs-meta)', letterSpacing: 'var(--track-11-5)', borderWidth: 1,
              ...(value === option.value
                ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
                : { background: 'var(--surface-card)', color: 'var(--text-secondary)', borderColor: 'var(--border-input)' }) }}>{option.label}</FilterChip>
        ))}
      </span>
    </div>
  );
}

const GAP_LINE = { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-tertiary)', margin: '0 0 26px' };
const PREVIEW_NOTE = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' };

/** One drafted story's page: the title, then each drafted frame's picture and
 * text and one line for each run of undrafted frames (no picture), then the
 * reference line. In the wrapped layout (#11) the picture is a quarter of the
 * width at the frame's start corner (left for a left-to-right language, right
 * for right-to-left) and the text wraps it. Test ids inside a story repeat in
 * the next story: find them within their `cc-story` (`data-story` is its number). */
function StoryPage({ story, frames, images, pictures, layout, dir }) {
  const wrapped = layout === 'wrapped';
  const pictureStyle = wrapped
    ? { float: dir === 'rtl' ? 'right' : 'left', width: '25%', margin: dir === 'rtl' ? '0 0 6px 12px' : '0 12px 6px 0' }
    : { display: 'block', width: '100%', marginBottom: 12 };
  return (
    <div style={PAGE} data-testid="cc-story" data-story={story.number} data-pictures={pictures ? '1' : '0'} data-layout={layout}>
      <p style={EYEBROW}>{t('cc.eyebrow')}</p>
      <h1 style={H1} dir={dir}>{storyTitle(story)}</h1>
      <div style={RULE} />
      {frames.map((frame) => {
        if (frame.gap) return <p key={`gap-${frame.gap[0]}`} dir={dir} data-testid="cc-frame-gap" style={GAP_LINE}>{frameGapText(frame.gap)}</p>;
        const uri = images?.[String(frame.n)];
        return (
          <div key={frame.n} data-testid={`cc-frame-${frame.n}`} style={{ marginBottom: 26, ...(wrapped ? { display: 'flow-root' } : {}) }}>
            {pictures && uri && (
              <img data-testid={`cc-picture-${frame.n}`} src={uri} alt={t('storyDraft.imageAlt', { n: frame.n })}
                style={{ ...pictureStyle, borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }} />
            )}
            <p dir={dir} style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', textAlign: 'justify', whiteSpace: 'pre-wrap', margin: 0 }}>
              {frame.text}
            </p>
          </div>
        );
      })}
      {story.ref && (
        <p dir={dir} data-testid="cc-reference" style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', fontStyle: 'italic', color: 'var(--text-secondary)', margin: 0 }}>
          {story.ref}
        </p>
      )}
    </div>
  );
}

/** The OBS preview: the printed stories, read as the PDF reads them, the
 * Layout row (#11) and the pictures toggle. */
function StoryCommunityChecking({ pageSetup, updatePageSetup }) {
  const { s, actions } = useApp();
  const { pictures } = pageSetup;
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  // { items, pictures, undrafted } once read; { error } when the read failed.
  const [printed, setPrinted] = React.useState(null);
  // Read once for each project that opens the view; a read that a newer one
  // replaced is dropped. The action is held in a ref, so a new actions object
  // does not read again.
  const projectId = s.project?.id;
  const readRef = React.useRef(actions.readPrintStories);
  readRef.current = actions.readPrintStories;
  React.useEffect(() => {
    let current = true;
    setPrinted(null);
    Promise.resolve()
      .then(() => readRef.current())
      .then((result) => { if (current) setPrinted(result ?? { error: '' }); })
      .catch((error) => { if (current) setPrinted({ error: String(error?.message || error) }); });
    return () => { current = false; };
  }, [projectId]);
  if (!printed || printed.error !== undefined) {
    return (
      <div style={PREVIEW_NOTE} data-testid="community-checking">
        {printed ? `${t('cc.storiesLoadError')} ${printed.error}`.trim() : t('cc.storiesLoading')}
      </div>
    );
  }
  const { items, undrafted } = printed;
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="community-checking">
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-muted)', padding: '34px 24px 60px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {items.length === 0 && (
          <p data-testid="cc-nothing-drafted" style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }}>{t('cc.nothingDraftedObs')}</p>
        )}
        {items.map((item) => item.gap
          ? <p key={`gap-${item.gap[0]}`} dir={dir} data-testid="cc-story-gap" style={{ ...GAP_LINE, textAlign: 'center', margin: 0 }}>{storyGapText(item.gap)}</p>
          : <StoryPage key={item.story.number} story={item.story} frames={item.frames} images={printed.pictures[item.story.number]}
            pictures={pictures} layout={pageSetup.obsLayout} dir={dir} />)}
      </main>
      <aside style={ASIDE}>
        <Button variant="ghost" onClick={() => actions.go('check')} style={{ alignSelf: 'flex-start' }}>{t('cc.back')}</Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', margin: 0 }}>{t('cc.title')}</h2>
        <ExportMenu pageSetup={pageSetup} />
        <div style={SETUP_BOX}>
          <Overline style={{ letterSpacing: '.12em' }}>{t('cc.pageSetup')}</Overline>
          <div style={SETUP_LIST}>
            <PageSetupChoiceRow label={t('cc.layout')} labelId="cc-layout-label"
              options={[{ value: 'above', label: t('cc.layoutAbove') }, { value: 'wrapped', label: t('cc.layoutWrapped') }]}
              value={pageSetup.obsLayout} onChange={(obsLayout) => updatePageSetup({ obsLayout })} />
            <Toggle data-testid="cc-pictures" label={t('cc.pictures')} checked={pictures} onChange={() => updatePageSetup({ pictures: !pictures })} />
          </div>
        </div>
        {undrafted && (
          <Callout tone="kindle"><strong style={{ color: 'var(--uw-kindle)' }}>{t('cc.incompleteTitle')}</strong> {t('cc.incompleteBodyObs')}</Callout>
        )}
      </aside>
    </div>
  );
}

export default function CommunityChecking() {
  const { s, book, actions } = useApp();
  const [pageSetup, setPageSetup] = React.useState(() => ({ ...DEFAULT_PAGE_SETUP }));

  const updatePageSetup = (patch) => setPageSetup((current) => ({ ...current, ...patch }));

  if (s.project?.flavor === 'textStories') return <StoryCommunityChecking pageSetup={pageSetup} updatePageSetup={updatePageSetup} />;

  // The card promises the BOOK as a whole (mockup: "Read the book as a
  // whole"), so the preview typesets every chapter, not the open one
  // (2026-08-27 review). A book still loading states so instead of vanishing.
  if (!book) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }} data-testid="community-checking">
        {s.bookError ? `${t('draft.loadError')} ${s.bookError}` : t('draft.loading')}
      </div>
    );
  }
  // The PDF's rule and the PDF's pages (#20): printedItems (each chapter with a
  // drafted verse, one line for each run of undrafted chapters between them) set
  // on sheets by PrintPages; the callout still counts every verse.
  const items = printedItems(book.byChapter, book.chapterNums);
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  const undrafted = book.chapterNums.some((c) => (book.byChapter[String(c)] || []).some((v) => !v.drafted));

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="community-checking">
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-muted)', padding: '34px 24px 60px' }}>
        <PrintPages title={bookName(book.code)} items={items} pageSetup={pageSetup} dir={dir}
          empty={<p data-testid="cc-nothing-drafted" style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }}>{t('cc.nothingDrafted')}</p>} />
      </main>
      <aside style={ASIDE}>
        <Button variant="ghost" onClick={() => actions.go('check')} style={{ alignSelf: 'flex-start' }}>{t('cc.back')}</Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', margin: 0 }}>{t('cc.title')}</h2>
        <ExportMenu pageSetup={pageSetup} />
        <div style={SETUP_BOX}>
          <Overline style={{ letterSpacing: '.12em' }}>{t('cc.pageSetup')}</Overline>
          <div style={SETUP_LIST}>
            <PageSetupChoiceRow label={t('cc.columns')} labelId="cc-columns-label"
              options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]}
              value={pageSetup.columns} onChange={(columns) => updatePageSetup({ columns })} />
            <PageSetupChoiceRow label={t('cc.spacing')} labelId="cc-spacing-label"
              options={[{ value: 'single', label: t('cc.spacingSingle') }, { value: 'double', label: t('cc.spacingDouble') }]}
              value={pageSetup.spacing} onChange={(spacing) => updatePageSetup({ spacing })} />
            <PageSetupChoiceRow label={t('cc.paper')} labelId="cc-paper-label"
              options={[{ value: 'a4', label: t('cc.paperA4') }, { value: 'letter', label: t('cc.paperLetter') }]}
              value={pageSetup.paper} onChange={(paper) => updatePageSetup({ paper })} />
            <Toggle label={t('cc.dropCap')} checked={pageSetup.dropCapChapters} onChange={() => updatePageSetup({ dropCapChapters: !pageSetup.dropCapChapters })} />
            <Toggle label={t('cc.verseNumbers')} checked={pageSetup.verseNumbers} onChange={() => updatePageSetup({ verseNumbers: !pageSetup.verseNumbers })} />
            <Toggle label={t('cc.footnotes')} disabled />
          </div>
        </div>
        {undrafted && (
          <Callout tone="kindle"><strong style={{ color: 'var(--uw-kindle)' }}>{t('cc.incompleteTitle')}</strong> {t('cc.incompleteBody')}</Callout>
        )}
      </aside>
    </div>
  );
}
