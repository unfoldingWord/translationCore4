// Community Checking — the publish flow's home inside Check (D63, epic #104 /
// #108). A typeset preview of the current book rendered from the project's own
// text, with working page-setup controls. The two exports are shown but
// DISABLED: they arrive with J7 later in Increment 4 (owner ruling 2026-08-27
// recorded in #108) — an honest state, not a dead end.
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { Button, FilterChip, Toggle, Overline, Callout } from '../ds/index.js';

export default function CommunityChecking() {
  const { s, book, actions } = useApp();
  const [cols, setCols] = React.useState('1');
  const [verseNums, setVerseNums] = React.useState(true);
  const [dropCap, setDropCap] = React.useState(true);

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
        <div style={{ maxWidth: 680, margin: '0 auto', background: '#fff', boxShadow: 'var(--shadow-page)', borderRadius: 4, padding: '64px 72px' }}>
          <p style={{ textAlign: 'center', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 4px' }}>{t('cc.eyebrow')}</p>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: '0 0 6px' }}>{bookName(book.code)}</h1>
          <div style={{ height: 1, background: 'var(--border)', margin: '0 auto 30px', width: 70 }} />
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
      <aside style={{ width: 'var(--rail-width-wide)', flex: 'none', background: 'var(--surface-card)', borderInlineStart: 'var(--stroke-hair) solid var(--border)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        <Button variant="ghost" onClick={() => actions.go('check')} style={{ alignSelf: 'flex-start' }}>{t('cc.back')}</Button>
        <h2 style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', margin: 0 }}>{t('cc.title')}</h2>
        {/* J7 delivers the real exports; until then the buttons state the truth. */}
        <Button shape="block" size="lg" disabled title={t('cc.exportsLater')}>{t('cc.exportPdf')}</Button>
        <Button shape="block" size="lg" variant="outline" disabled title={t('cc.exportsLater')}>{t('cc.exportUsfm')}</Button>
        <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: 0, lineHeight: 'var(--lh-body)' }}>{t('cc.exportsLater')}</p>
        <div style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--surface-app)' }}>
          <Overline style={{ letterSpacing: '.12em' }}>{t('cc.pageSetup')}</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)' }}>
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
