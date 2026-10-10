// Add-a-book modal — owner-approved design rebuilt on the design system (epic
// #104 / #109) bound to the state layer's `ab` form (openAddBook/patchAb/
// addBooks): the blank-book path, and the from-USFM-files path (#484), which
// adds only books the project does not have. Import makes a new project from
// files, from Home (#361); import into an existing project (replace a book) is
// #365. The several-at-once grid is the owner's optional multi-pick addition.
import React from 'react';
import { useApp, SUITE_VERSION } from '../../state.jsx';
import { BOOK_NAMES, BOOK_CHAPTERS, bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Select, FilterChip, OptionCard, Overline, Button, Callout, DropZone, Surface, Text, IconButton, StatusDot } from '../../ds/index.js';

const ALL_CODES = Object.keys(BOOK_NAMES);
const OT = ALL_CODES.slice(0, 39);
const NT = ALL_CODES.slice(39);

function BookGrid({ ab, actions, codes, title }) {
  return (
    <div style={{ marginTop: 10 }}>
      <Overline as="div" style={{ letterSpacing: 'var(--tracking-label)', margin: '8px 0 6px' }}>{title}</Overline>
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

/** The from-USFM-files step (#484): drop or choose files, see each file's
 * verdict the moment it lands (the parse is in-memory and quick), add the
 * valid ones. Modeled on Import's FilesStep; the per-row dot is the import
 * review's check idiom. */
function UsfmStep({ ab, actions }) {
  const inputRef = React.useRef(null);
  const add = (list) => { if (list?.length) actions.abAddUsfmFiles([...list]); };
  return (
    <div data-testid="ab-usfm" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 18 }}>
      <input ref={inputRef} type="file" multiple accept=".usfm,.sfm,.txt" data-testid="ab-usfm-input" hidden
        onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <DropZone title={t('importer.kind.usfm.drop')} hint={t('importer.kind.usfm.hint')} data-testid="ab-usfm-drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer?.files); }} />
      {(ab.files || []).map((f, i) => (
        <Surface key={`${f.name}-${i}`} fill="card" border="line" radius="md" pad="10px 10px 10px 14px"
          data-testid="ab-usfm-file" data-status={f.refusal ? 'refused' : 'valid'}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <StatusDot status={f.refusal ? 'warn' : 'valid'} size={8} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Text role="strong" truncate>{f.name}</Text>
              <Text role="caption" tone={f.refusal ? undefined : 'muted'}>
                {f.refusal ?? t('addBook.usfmWillAdd', { name: bookName(f.code) })}
              </Text>
            </div>
            <IconButton variant="plain" title={t('importer.files.remove')} onClick={() => actions.abRemoveUsfmFile(i)}>✕</IconButton>
          </div>
        </Surface>
      ))}
      {ab.error && <Callout tone="warn" role="alert">{ab.error}</Callout>}
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
  const validFiles = (ab.files || []).filter((f) => !f.refusal);

  return (
    <Modal width={600} title={t('addBook.title')}
      subtitle={<>{t('addBook.to')} <strong style={{ color: 'var(--uw-ocean)' }}>{ab.projName}</strong></>}
      closeLabel={t('newBible.close')} onClose={actions.closeModal}
      footer={ab.step === 'pick' ? <>
        <Button variant="secondary" onClick={() => actions.patchAb({ step: 'method', error: null })}>{t('addBook.back')}</Button>
        <Button onClick={actions.addBooks} disabled={ab.busy}>
          {ab.multi ? t('addBook.createN', { n: picked.length }) : t('addBook.create')}
        </Button>
      </> : ab.step === 'usfm' ? <>
        <Button variant="secondary" onClick={() => actions.patchAb({ step: 'method', error: null })}>{t('addBook.back')}</Button>
        <Button onClick={actions.addUsfmBooks} disabled={ab.busy || validFiles.length === 0} data-testid="ab-usfm-add">
          {validFiles.length > 1 ? t('addBook.addN', { n: validFiles.length }) : t('addBook.addOne')}
        </Button>
      </> : null}>

      {ab.step === 'method' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 18 }}>
          <OptionCard icon="+" title={t('addBook.blankTitle')} description={t('addBook.blankDesc')}
            trailing="→" onClick={() => actions.patchAb({ step: 'pick' })} />
          <OptionCard icon={t('importer.kind.usfm.icon')} title={t('addBook.usfmTitle')} description={t('addBook.usfmDesc')}
            trailing="→" data-testid="ab-usfm-option" onClick={() => actions.patchAb({ step: 'usfm', error: null })} />
        </div>
      )}

      {ab.step === 'usfm' && <UsfmStep ab={ab} actions={actions} />}

      {ab.step === 'pick' && (
        <>
          <div>
            {!ab.multi && (
              <>
                <Select id="ab-book" label={t('addBook.book')} value={ab.book}
                  onChange={(e) => actions.patchAb({ book: e.target.value })}
                  searchPlaceholder={t('addBook.findBook')} noMatchesLabel={t('addBook.noMatches')} clearLabel={t('common.clear')}
                  options={ALL_CODES.map((code) => {
                    const already = (ab.existing || []).includes(code);
                    return {
                      value: code, label: bookName(code), code,
                      meta: t('addBook.chaptersShort', { n: BOOK_CHAPTERS[code] ?? '?' }),
                      group: NT.includes(code) ? t('addBook.nt') : t('addBook.ot'),
                      disabled: already,
                      badge: already ? t('addBook.inThisBible') : undefined,
                    };
                  })} />
                <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', margin: '8px 0 0', lineHeight: 'var(--lh-body)' }}>
                  {t(BOOK_CHAPTERS[ab.book] === 1 ? 'addBook.infoOne' : 'addBook.info', { name: bookName(ab.book), chapters: BOOK_CHAPTERS[ab.book] ?? '?', testament })}
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
