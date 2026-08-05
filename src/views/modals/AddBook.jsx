// Add-a-book modal — owner-approved design (translationCore.dc.html lines
// 255-318) bound to the state layer's `ab` form (openAddBook/patchAb/addBooks).
// Increment 1 ships the blank-book path; USFM and tC3 import rows are shown
// but disabled (honest state — they arrive with the import increment). The
// several-at-once grid is the owner's optional multi-pick addition.
import React from 'react';
import { useApp, SUITE_VERSION } from '../../state.jsx';
import { BOOK_NAMES, BOOK_CHAPTERS, bookName } from '../../data/bookNames';
import { t } from '../../i18n';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(1,38,56,.55)', zIndex: 80,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
};
const card = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600,
  maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(1,38,56,.4)',
};
const label = {
  display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '.1em',
  textTransform: 'uppercase', color: '#8A99A4', margin: '0 0 6px',
};
const input = {
  width: '100%', boxSizing: 'border-box', border: '1px solid rgba(35,31,32,.16)',
  borderRadius: 9, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14,
  color: '#1E2C36', background: '#fff', outline: 'none',
};
const backBtn = {
  border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px',
  borderRadius: 999, color: '#4F5E6A',
};

const ALL_CODES = Object.keys(BOOK_NAMES);
const OT = ALL_CODES.slice(0, 39);
const NT = ALL_CODES.slice(39);

function MethodRow({ icon, title, desc, disabled, onClick }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      className={disabled ? undefined : 'hovInspireBg'}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, textAlign: 'start',
        border: '1.5px solid rgba(35,31,32,.12)', background: '#fff',
        cursor: disabled ? 'default' : 'pointer', borderRadius: 12,
        padding: '15px 16px', fontFamily: 'inherit', width: '100%',
        opacity: disabled ? 0.5 : 1,
      }}>
      <span style={{ width: 42, height: 42, borderRadius: 10, background: '#eaf6fc', color: '#31ADE3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, letterSpacing: '.02em', flex: 'none' }}>
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: '#014263' }}>{title}</span>
        <span style={{ fontSize: 12.5, color: '#4F5E6A', lineHeight: 1.45 }}>{desc}</span>
      </span>
      <span style={{ color: '#8A99A4', fontWeight: 800, flex: 'none' }}>→</span>
    </button>
  );
}

function BookGrid({ ab, actions, codes, title }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8A99A4', letterSpacing: '.1em', textTransform: 'uppercase', margin: '8px 0 6px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(118px,1fr))', gap: 6 }}>
        {codes.map((code) => {
          const on = !!ab.books[code];
          // Books already in the project cannot be selected (owner, 2026-07-31 —
          // deletion/replacement is a later increment's decision).
          const already = (ab.existing || []).includes(code);
          if (already) {
            return (
              <span key={code} title={t('addBook.alreadyIn')}
                style={{ border: '1.5px solid rgba(35,31,32,.06)', background: '#F2F5F7', color: '#B7C2C9', borderRadius: 8, padding: '7px 8px', fontSize: 12, fontWeight: 700, textAlign: 'start', fontFamily: 'inherit' }}>
                {BOOK_NAMES[code]} {t('sym.tick')}
              </span>
            );
          }
          return (
            <button key={code} type="button"
              onClick={() => actions.patchAb({ books: { ...ab.books, [code]: !on } })}
              style={{ cursor: 'pointer', border: `1.5px solid ${on ? '#31ADE3' : 'rgba(35,31,32,.12)'}`, background: on ? '#eaf6fc' : '#fff', color: on ? '#014263' : '#4F5E6A', borderRadius: 8, padding: '7px 8px', fontSize: 12, fontWeight: 700, textAlign: 'start', fontFamily: 'inherit' }}>
              {BOOK_NAMES[code]}
            </button>
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
    <div onClick={actions.closeModal} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#014263', margin: '0 0 4px' }}>{t('addBook.title')}</h3>
            <p style={{ fontSize: 13, color: '#4F5E6A', margin: 0 }}>
              {t('addBook.to')} <strong style={{ color: '#014263' }}>{ab.projName}</strong>
            </p>
          </div>
          <button onClick={actions.closeModal} type="button" title={t('newBible.close')}
            style={{ border: 0, background: '#ECF2F5', cursor: 'pointer', width: 28, height: 28, borderRadius: 99, fontSize: 13, color: '#4F5E6A', flex: 'none' }}>
            ✕
          </button>
        </div>

        {ab.step === 'method' && (
          <div style={{ padding: '18px 24px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MethodRow icon="+" title={t('addBook.blankTitle')} desc={t('addBook.blankDesc')}
              onClick={() => actions.patchAb({ step: 'pick' })} />
            <MethodRow icon={t('addBook.iconUsfm')} title={t('addBook.usfmTitle')} desc={t('addBook.laterDesc')} disabled />
            <MethodRow icon={t('addBook.iconTc3')} title={t('addBook.tc3Title')} desc={t('addBook.laterDesc')} disabled />
          </div>
        )}

        {ab.step === 'pick' && (
          <>
            <div style={{ padding: '18px 24px 4px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                {!ab.multi && (
                  <>
                    <label style={label} htmlFor="ab-book">{t('addBook.book')}</label>
                    <select id="ab-book" style={input} value={ab.book}
                      onChange={(e) => actions.patchAb({ book: e.target.value })}>
                      {ALL_CODES.map((code) => {
                        const already = (ab.existing || []).includes(code);
                        return (
                          <option key={code} value={code} disabled={already}>
                            {bookName(code)} ({code}){already ? ` ${t('sym.tick')}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <p style={{ fontSize: 12.5, color: '#8A99A4', margin: '8px 0 0', lineHeight: 1.5 }}>
                      {t('addBook.info', { name: bookName(ab.book), chapters: BOOK_CHAPTERS[ab.book] ?? '?', testament })}
                    </p>
                  </>
                )}
                {ab.multi && (
                  <>
                    <span style={label}>{t('addBook.book')}</span>
                    <BookGrid ab={ab} actions={actions} codes={NT} title={t('addBook.nt')} />
                    <BookGrid ab={ab} actions={actions} codes={OT} title={t('addBook.ot')} />
                  </>
                )}
                <button type="button" onClick={() => actions.patchAb({ multi: !ab.multi })}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, color: '#31ADE3', padding: 0, margin: '10px 0 0' }}>
                  {ab.multi ? t('addBook.singleToggle') : t('addBook.multiToggle')}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, border: '1px solid rgba(35,31,32,.09)', background: '#F7FAFC', borderRadius: 10, padding: '10px 12px' }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: '#4F5E6A', lineHeight: 1.45 }}>
                    {t('addBook.sources', { version: SUITE_VERSION })}
                  </span>
                </div>
              </div>

              {existingPicked.length > 0 && (
                <div style={{ border: '1px solid rgba(229,157,51,.45)', background: '#FCF6EA', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: '#8A5B12', lineHeight: 1.5 }}>
                  <strong>
                    {existingPicked.length === 1
                      ? t('addBook.existsOne', { name: bookName(existingPicked[0]) })
                      : t('addBook.existsMany', { names: existingPicked.map((c) => bookName(c)).join(' · ') })}
                  </strong>
                  {t('addBook.existsRest')}
                </div>
              )}

              {ab.error && (
                <div role="alert" style={{ border: '1px solid #E59D33', background: '#FDF3E3', color: '#8A5B12', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                  {ab.error}
                </div>
              )}
            </div>

            <div style={{ padding: '18px 24px 22px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => actions.patchAb({ step: 'method', error: null })} style={backBtn}>
                {t('addBook.back')}
              </button>
              <button type="button" onClick={actions.addBooks} disabled={ab.busy}
                style={{ border: 0, cursor: ab.busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, background: '#31ADE3', color: '#fff', opacity: ab.busy ? 0.6 : 1 }}>
                {ab.multi ? t('addBook.createN', { n: picked.length }) : t('addBook.create')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
