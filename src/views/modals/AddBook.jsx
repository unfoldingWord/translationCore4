// Add-a-book modal — owner-approved design rebuilt on the design system (epic
// #104 / #109) bound to the state layer's `ab` form (openAddBook/patchAb/
// addBooks). Increment 1 ships the blank-book path; USFM and tC3 import rows
// are shown but disabled (honest state — they arrive with the import
// increment). The several-at-once grid is the owner's optional multi-pick
// addition.
import React from 'react';
import { useApp, SUITE_VERSION } from '../../state.jsx';
import { BOOK_NAMES, BOOK_CHAPTERS, bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Select, FilterChip, OptionCard, Overline, Button, Callout } from '../../ds/index.js';

const ALL_CODES = Object.keys(BOOK_NAMES);
const OT = ALL_CODES.slice(0, 39);
const NT = ALL_CODES.slice(39);

function BookGrid({ ab, actions, codes, title }) {
  return (
    <div style={{ marginTop: 10 }}>
      <Overline as="div" style={{ letterSpacing: '.1em', margin: '8px 0 6px' }}>{title}</Overline>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(118px,1fr))', gap: 6 }}>
        {codes.map((code) => {
          const on = !!ab.books[code];
          // Books already in the project cannot be selected (owner, 2026-07-31 —
          // deletion/replacement is a later increment's decision).
          const already = (ab.existing || []).includes(code);
          if (already) {
            return (
              <span key={code} title={t('addBook.alreadyIn')}
                style={{ border: 'var(--stroke-selected) solid var(--border-hair)', background: 'var(--surface-muted)', color: 'var(--uw-haze)', borderRadius: 'var(--radius-sm)', padding: '7px 8px', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', textAlign: 'start', fontFamily: 'var(--font-ui)' }}>
                {BOOK_NAMES[code]} {t('sym.tick')}
              </span>
            );
          }
          return (
            <FilterChip key={code} selected={on}
              onClick={() => actions.patchAb({ books: { ...ab.books, [code]: !on } })}
              style={{ borderRadius: 'var(--radius-sm)', padding: '7px 8px', fontSize: 'var(--fs-caption)', justifyContent: 'flex-start' }}>
              {BOOK_NAMES[code]}
            </FilterChip>
          );
        })}
      </div>
    </div>
  );
}

export default function AddBook() {
  const { s, actions } = useApp();
  const ab = s.ab;
  if (s.modal !== 'addBook' || !ab) return null;

  const picked = ab.multi ? Object.keys(ab.books).filter((k) => ab.books[k]) : [ab.book];
  const existingPicked = picked.filter((c) => (ab.existing || []).includes(c));
  const testament = NT.includes(ab.book) ? t('addBook.nt') : t('addBook.ot');

  return (
    <Modal width={600} title={t('addBook.title')}
      subtitle={<>{t('addBook.to')} <strong style={{ color: 'var(--uw-ocean)' }}>{ab.projName}</strong></>}
      closeLabel={t('newBible.close')} onClose={actions.closeModal}
      footer={ab.step === 'pick' ? <>
        <Button variant="secondary" onClick={() => actions.patchAb({ step: 'method', error: null })}>{t('addBook.back')}</Button>
        <Button onClick={actions.addBooks} disabled={ab.busy}>
          {ab.multi ? t('addBook.createN', { n: picked.length }) : t('addBook.create')}
        </Button>
      </> : null}>

      {ab.step === 'method' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 18 }}>
          <OptionCard icon="+" title={t('addBook.blankTitle')} description={t('addBook.blankDesc')}
            trailing="→" onClick={() => actions.patchAb({ step: 'pick' })} />
          <OptionCard icon={t('addBook.iconUsfm')} title={t('addBook.usfmTitle')} description={t('addBook.laterDesc')}
            trailing="→" disabled style={{ opacity: 0.5, cursor: 'default' }} />
          <OptionCard icon={t('addBook.iconTc3')} title={t('addBook.tc3Title')} description={t('addBook.laterDesc')}
            trailing="→" disabled style={{ opacity: 0.5, cursor: 'default' }} />
        </div>
      )}

      {ab.step === 'pick' && (
        <>
          <div>
            {!ab.multi && (
              <>
                <Select id="ab-book" label={t('addBook.book')} value={ab.book}
                  onChange={(e) => actions.patchAb({ book: e.target.value })}
                  options={ALL_CODES.map((code) => {
                    const already = (ab.existing || []).includes(code);
                    return { value: code, disabled: already, label: `${bookName(code)} (${code})${already ? ` ${t('sym.tick')}` : ''}` };
                  })} />
                <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', margin: '8px 0 0', lineHeight: 'var(--lh-body)' }}>
                  {t('addBook.info', { name: bookName(ab.book), chapters: BOOK_CHAPTERS[ab.book] ?? '?', testament })}
                </p>
              </>
            )}
            {ab.multi && (
              <>
                <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('addBook.book')}</Overline>
                <BookGrid ab={ab} actions={actions} codes={NT} title={t('addBook.nt')} />
                <BookGrid ab={ab} actions={actions} codes={OT} title={t('addBook.ot')} />
              </>
            )}
            <Button variant="ghost" onClick={() => actions.patchAb({ multi: !ab.multi })}
              style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', margin: '10px 0 0' }}>
              {ab.multi ? t('addBook.singleToggle') : t('addBook.multiToggle')}
            </Button>
            <Callout tone="info" style={{ marginTop: 10 }}>
              {t('addBook.sources', { version: SUITE_VERSION })}
            </Callout>
          </div>

          {existingPicked.length > 0 && (
            <Callout tone="warn">
              <strong>
                {existingPicked.length === 1
                  ? t('addBook.existsOne', { name: bookName(existingPicked[0]) })
                  : t('addBook.existsMany', { names: existingPicked.map((c) => bookName(c)).join(' · ') })}
              </strong>
              {t('addBook.existsRest')}
            </Callout>
          )}

          {ab.error && <Callout tone="warn" role="alert">{ab.error}</Callout>}
        </>
      )}
    </Modal>
  );
}
