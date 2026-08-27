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

  if (!book) return null;
  const verses = book.byChapter[String(s.chapter)] || [];
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  const undrafted = verses.some((v) => !v.drafted);

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="community-checking">
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, background: 'var(--surface-muted)', padding: '34px 24px 60px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', background: '#fff', boxShadow: 'var(--shadow-page)', borderRadius: 4, padding: '64px 72px' }}>
          <p style={{ textAlign: 'center', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 4px' }}>{t('cc.eyebrow')}</p>
          <h1 style={{ textAlign: 'center', fontFamily: 'var(--font-scripture)', fontSize: 40, lineHeight: '48px', fontWeight: 'var(--fw-bold)', color: 'var(--uw-ocean)', margin: '0 0 6px' }}>{bookName(book.code)}</h1>
          <div style={{ height: 1, background: 'var(--border)', margin: '0 auto 30px', width: 70 }} />
          <div dir={dir} style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)', color: 'var(--text-scripture)', textAlign: 'justify', columnCount: Number(cols), columnGap: 28 }}>
            {dropCap ? <span style={{ float: 'inline-start', fontSize: 'var(--fs-dropcap)', lineHeight: 0.8, fontWeight: 'var(--fw-bold)', color: 'var(--accent)', marginInlineEnd: 10, marginTop: 6 }}>{s.chapter}</span> : null}
            {verses.map((v) => v.drafted && v.text
              ? <span key={v.n}>{verseNums ? <sup style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginInlineEnd: 2, verticalAlign: 'super' }}>{v.n}</sup> : null}{v.text} </span>
              : <span key={v.n} style={{ color: 'var(--text-tertiary)' }}><sup style={{ fontSize: 11, fontWeight: 700, verticalAlign: 'super' }}>{v.n}</sup>{t('cc.notYetDrafted')} </span>)}
          </div>
        </div>
      </main>
      <aside style={{ width: 'var(--rail-width-wide)', flex: 'none', background: '#fff', borderInlineStart: 'var(--stroke-hair) solid var(--border-hair)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
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
                  <FilterChip key={c} tone="ocean" selected={cols === c} onClick={() => setCols(c)}
                    style={{ padding: '5px 11px', fontSize: '11.5px', borderWidth: 1 }}>{c}</FilterChip>
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
