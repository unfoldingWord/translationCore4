// Project-settings modal — owner-approved design (translationCore.dc.html
// lines 186-253) bound to the state layer's `st` form (openSettings/patchSt/
// saveSettings). Name / language name / code are display-only this increment:
// metadata is not writable over the platform HTTP API (D28 addendum). Text
// direction + script font persist to checking/settings.json.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
import { GlRow } from './NewBible.jsx';
import { t } from '../../i18n';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(1,38,56,.55)', zIndex: 80,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
};
const card = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
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
const disabledInput = { ...input, background: '#F7FAFC', color: '#8A99A4' };
const dirBtn = (selected) => ({
  flex: 1, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 800, fontSize: 13, padding: 10, borderRadius: 10,
  borderColor: selected ? '#31ADE3' : 'rgba(35,31,32,.16)',
  background: selected ? '#eaf6fc' : '#fff',
  color: selected ? '#014263' : '#4F5E6A',
});

export default function ProjectSettings() {
  const { s, actions } = useApp();
  const st = s.st;
  if (s.modal !== 'settings' || !st) return null;
  const saveDisabled = st.busy || !st.loaded;

  return (
    <div onClick={actions.closeModal} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#014263', margin: '0 0 4px' }}>{t('settings.title')}</h3>
            <p style={{ fontSize: 13, color: '#4F5E6A', margin: 0 }}>
              {t('settings.subtitle', { name: st.projName, n: st.bookCount })}
            </p>
          </div>
          <button onClick={actions.closeModal} type="button" title={t('newBible.close')}
            style={{ border: 0, background: '#ECF2F5', cursor: 'pointer', width: 28, height: 28, borderRadius: 99, fontSize: 13, color: '#4F5E6A', flex: 'none' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '18px 24px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={label} htmlFor="st-name">{t('newBible.name')}</label>
            <input id="st-name" style={disabledInput} value={st.name} disabled />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
            <div>
              <label style={label} htmlFor="st-lang">{t('newBible.langName')}</label>
              <input id="st-lang" style={disabledInput} value={st.langName} disabled />
            </div>
            <div>
              <label style={label} htmlFor="st-code">{t('newBible.code')}</label>
              <input id="st-code" style={disabledInput} value={st.code} disabled />
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#8A99A4', margin: '-8px 0 0' }}>{t('settings.renameNote')}</p>

          <div>
            <span style={label}>{t('newBible.direction')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => actions.patchSt({ dir: 'ltr' })} style={dirBtn(st.dir === 'ltr')}>
                {t('wizard.ltr')}
              </button>
              <button type="button" onClick={() => actions.patchSt({ dir: 'rtl' })} style={dirBtn(st.dir === 'rtl')}>
                {t('wizard.rtl')}
              </button>
            </div>
          </div>

          <div>
            <span style={label}>{t('newBible.checkingLanguage')}</span>
            <GlRow />
          </div>

          <div>
            <label style={label} htmlFor="st-font">{t('newBible.font')}</label>
            <select id="st-font" style={input} value={st.font} onChange={(e) => actions.patchSt({ font: e.target.value })}>
              {SCRIPT_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {st.error && (
            <div role="alert" style={{ border: '1px solid #E59D33', background: '#FDF3E3', color: '#8A5B12', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
              {st.error}
            </div>
          )}
        </div>

        <div style={{ padding: '18px 24px 22px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={actions.closeModal} type="button"
            style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, color: '#4F5E6A' }}>
            {t('newBible.cancel')}
          </button>
          <button onClick={actions.saveSettings} type="button" disabled={saveDisabled}
            style={{ border: 0, cursor: saveDisabled ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, background: '#31ADE3', color: '#fff', opacity: saveDisabled ? 0.6 : 1 }}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
