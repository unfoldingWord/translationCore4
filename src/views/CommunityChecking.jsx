// Community Checking — the publish flow's home inside Check (D63, epic #104 /
// #108). A typeset preview of the current book rendered from the project's own
// text, with working page-setup controls. The two exports are shown but
// DISABLED: they arrive with J7 later in Increment 4 (owner ruling 2026-08-27
// recorded in #108) — an honest state, not a dead end.
//
// An OBS project (#291, D74 §8) previews the open STORY as its pages: title,
// picture, frame text, reference line, with one OBS-only page-setup toggle,
// pictures on or off. The PDF file itself is J23 (Increment 8).
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
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

/** The story pages: the title, then each frame's picture and text, then the
 * reference line. An undrafted frame is stated, never skipped silently. */
function StoryPages({ story, images, pictures, dir }) {
  return (
    <div style={PAGE} data-testid="cc-story" data-pictures={pictures ? '1' : '0'}>
      <p style={EYEBROW}>{t('cc.eyebrow')}</p>
      <h1 style={H1} dir={dir}>{story.title || t('storyDraft.storyNumber', { n: story.number })}</h1>
      <div style={RULE} />
      {story.frames.map((frame, i) => {
        const image = images?.[String(i + 1)];
        return (
          <div key={i + 1} data-testid={`cc-frame-${i + 1}`} style={{ marginBottom: 26 }}>
            {pictures && image?.uri && (
              <img data-testid={`cc-picture-${i + 1}`} src={image.uri} alt={t('storyDraft.imageAlt', { n: i + 1 })}
                style={{ display: 'block', width: '100%', borderRadius: 'var(--radius-md)', marginBottom: 12, background: 'var(--surface-sunken)' }} />
            )}
            <p dir={dir} style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: frame.text ? 'var(--text-scripture)' : 'var(--text-tertiary)', textAlign: 'justify', whiteSpace: 'pre-wrap', margin: 0 }}>
              {frame.text || t('cc.notYetDraftedFrame')}
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

/** The OBS preview: the open story, one page-setup toggle (pictures). */
function StoryCommunityChecking() {
  const { s, actions } = useApp();
  const [pictures, setPictures] = React.useState(true);
  const story = s.story;
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  if (!story) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui)' }} data-testid="community-checking">
        {s.storyError ? s.storyError : t('storyDraft.loading')}
      </div>
    );
  }
  const undrafted = story.frames.some((frame) => !frame.text);
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="community-checking">
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-muted)', padding: '34px 24px 60px' }}>
        <StoryPages story={story} images={s.storyImages} pictures={pictures} dir={dir} />
      </main>
      <aside style={ASIDE}>
        <Button variant="ghost" onClick={() => actions.go('check')} style={{ alignSelf: 'flex-start' }}>{t('cc.back')}</Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', margin: 0 }}>{t('cc.title')}</h2>
        <ExportMenu />
        <div style={SETUP_BOX}>
          <Overline style={{ letterSpacing: '.12em' }}>{t('cc.pageSetup')}</Overline>
          <div style={SETUP_LIST}>
            <Toggle data-testid="cc-pictures" label={t('cc.pictures')} checked={pictures} onChange={() => setPictures(!pictures)} />
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
  const [cols, setCols] = React.useState('1');
  const [verseNums, setVerseNums] = React.useState(true);
  const [dropCap, setDropCap] = React.useState(true);

  if (s.project?.flavor === 'textStories') return <StoryCommunityChecking />;

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
  const chapters = book.chapterNums.map((c) => ({ c, verses: book.byChapter[String(c)] || [] }));
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  const undrafted = chapters.some(({ verses }) => verses.some((v) => !v.drafted));

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="community-checking">
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-muted)', padding: '34px 24px 60px' }}>
        <div style={PAGE}>
          <p style={EYEBROW}>{t('cc.eyebrow')}</p>
          <h1 style={H1}>{bookName(book.code)}</h1>
          <div style={RULE} />
          {chapters.map(({ c, verses }) => (
            <div key={c} dir={dir} style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-md)', lineHeight: 'var(--lh-verse-md)', color: 'var(--text-scripture)', textAlign: 'justify', columnCount: Number(cols), columnGap: 28, marginBottom: 26 }}>
              {dropCap ? <span style={{ float: 'inline-start', fontSize: 'var(--fs-dropcap)', lineHeight: 0.8, fontWeight: 'var(--fw-bold)', color: 'var(--text-accent)', marginInlineEnd: 10, marginTop: 6 }}>{c}</span> : null}
              {verses.map((v) => v.drafted && v.text
                ? <span key={v.n}>{verseNums ? <sup style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginInlineEnd: 2, verticalAlign: 'super' }}>{v.n}</sup> : null}{v.text} </span>
                : <span key={v.n} style={{ color: 'var(--text-tertiary)' }}><sup style={{ fontSize: 11, fontWeight: 700, verticalAlign: 'super' }}>{v.n}</sup>{t('cc.notYetDrafted')} </span>)}
            </div>
          ))}
        </div>
      </main>
      <aside style={ASIDE}>
        <Button variant="ghost" onClick={() => actions.go('check')} style={{ alignSelf: 'flex-start' }}>{t('cc.back')}</Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', margin: 0 }}>{t('cc.title')}</h2>
        <ExportMenu />
        <div style={SETUP_BOX}>
          <Overline style={{ letterSpacing: '.12em' }}>{t('cc.pageSetup')}</Overline>
          <div style={SETUP_LIST}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{t('cc.columns')}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                {['1', '2'].map((c) => (
                  // The design's page-setup pills: Inspire fill when active.
                  <FilterChip key={c} selected={cols === c} onClick={() => setCols(c)}
                    style={{ display: 'inline-block', padding: '5px 11px', fontSize: 'var(--fs-meta)', letterSpacing: 'var(--track-11-5)', borderWidth: 1,
                      ...(cols === c
                        ? { background: 'var(--accent)', color: 'var(--text-inverse)', borderColor: 'var(--accent)' }
                        : { background: 'var(--surface-card)', color: 'var(--text-secondary)', borderColor: 'var(--border-input)' }) }}>{c}</FilterChip>
                ))}
              </span>
            </div>
            <Toggle label={t('cc.dropCap')} checked={dropCap} onChange={() => setDropCap(!dropCap)} />
            <Toggle label={t('cc.verseNumbers')} checked={verseNums} onChange={() => setVerseNums(!verseNums)} />
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
