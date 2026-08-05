// New Bible modal — owner-approved design (translationCore.dc.html lines
// 119-184) bound to the state layer's `np` form (openNewProject/patchNp/
// createBible). The versification disclosure is not in the design but D25
// requires it available-yet-out-of-the-way, so it keeps the old wizard's
// collapsed form.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
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
const dirBtn = (selected) => ({
  flex: 1, border: '1.5px solid', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 800, fontSize: 13, padding: 10, borderRadius: 10,
  borderColor: selected ? '#31ADE3' : 'rgba(35,31,32,.16)',
  background: selected ? '#eaf6fc' : '#fff',
  color: selected ? '#014263' : '#4F5E6A',
});
const cancelBtn = {
  border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px',
  borderRadius: 999, color: '#4F5E6A',
};

// Single English gateway-language row — non-interactive this increment (the
// installed suite is the only option; the picker arrives with the resource
// manager increment). Rendered selected per the design.
export function GlRow() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
      border: '1.5px solid #31ADE3', background: '#eaf6fc', borderRadius: 10,
      padding: '10px 12px', width: '100%', boxSizing: 'border-box',
    }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#014263' }}>{t('newBible.glName')}</span>
        <span style={{ fontSize: 11.5, color: '#8A99A4', fontWeight: 600 }}>{t('newBible.glMeta')}</span>
      </span>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', background: '#eaf6fc', color: '#31ADE3', borderRadius: 999, padding: '3px 8px', flex: 'none' }}>
        {t('newBible.recommended')}
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, flex: 'none', color: '#31ADE3' }}>{t('sym.tick')}</span>
    </div>
  );
}

export default function NewBible() {
  const { s, actions } = useApp();
  const np = s.np;
  if (s.modal !== 'newProject' || !np) return null;

  return (
    <div onClick={actions.closeModal} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#014263', margin: '0 0 4px' }}>{t('newBible.title')}</h3>
            <p style={{ fontSize: 13, color: '#4F5E6A', margin: 0 }}>{t('newBible.subtitle')}</p>
          </div>
          <button onClick={actions.closeModal} type="button" title={t('newBible.close')}
            style={{ border: 0, background: '#ECF2F5', cursor: 'pointer', width: 28, height: 28, borderRadius: 99, fontSize: 13, color: '#4F5E6A', flex: 'none' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '18px 24px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={label} htmlFor="nb-name">{t('newBible.name')}</label>
            <input id="nb-name" style={input} value={np.name} placeholder={t('newBible.namePlaceholder')}
              onChange={(e) => actions.patchNp({ name: e.target.value })} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
            <div>
              <label style={label} htmlFor="nb-lang">{t('newBible.langName')}</label>
              <input id="nb-lang" style={input} value={np.langName} placeholder={t('newBible.langPlaceholder')}
                onChange={(e) => actions.patchNp({ langName: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="nb-code">{t('newBible.code')}</label>
              <input id="nb-code" style={input} value={np.code} placeholder={t('newBible.codePlaceholder')}
                onChange={(e) => actions.patchNp({ code: e.target.value })} />
            </div>
          </div>

          <div>
            <span style={label}>{t('newBible.direction')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => actions.patchNp({ dir: 'ltr' })} style={dirBtn(np.dir === 'ltr')}>
                {t('wizard.ltr')}
              </button>
              <button type="button" onClick={() => actions.patchNp({ dir: 'rtl' })} style={dirBtn(np.dir === 'rtl')}>
                {t('wizard.rtl')}
              </button>
            </div>
          </div>

          <div>
            <span style={label}>{t('newBible.checkingLanguage')}</span>
            <p style={{ fontSize: 12.5, color: '#4F5E6A', margin: '0 0 8px', lineHeight: 1.5 }}>{t('newBible.glNote')}</p>
            <GlRow />
          </div>

          <div>
            <label style={label} htmlFor="nb-font">{t('newBible.font')}</label>
            <select id="nb-font" style={input} value={np.font} onChange={(e) => actions.patchNp({ font: e.target.value })}>
              {SCRIPT_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Versification: available but out of the way (D25) — the design
              omits it, so it stays a collapsed disclosure. */}
          <div>
            <button type="button" onClick={() => actions.patchNp({ showAdvanced: !np.showAdvanced })}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: '#31ADE3', padding: 0 }}>
              {np.showAdvanced ? '▾' : '▸'} {t('wizard.versification')}
            </button>
            {np.showAdvanced && (
              <div style={{ marginTop: 8 }}>
                <select aria-label={t('wizard.versification')} style={input} value={np.versification}
                  onChange={(e) => actions.patchNp({ versification: e.target.value })}>
                  {np.versifications.map((v) => (
                    <option key={v} value={v}>{v}{v === 'eng' ? ` ${t('wizard.default')}` : ''}</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: '#8A99A4', margin: '6px 0 0' }}>{t('wizard.versificationHint')}</p>
              </div>
            )}
          </div>

          {np.error && (
            <div role="alert" style={{ border: '1px solid #E59D33', background: '#FDF3E3', color: '#8A5B12', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
              {np.error}
            </div>
          )}
        </div>

        <div style={{ padding: '18px 24px 22px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={actions.closeModal} type="button" style={cancelBtn}>{t('newBible.cancel')}</button>
          <button onClick={actions.createBible} type="button" disabled={np.busy}
            style={{ border: 0, cursor: np.busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, background: '#31ADE3', color: '#fff', opacity: np.busy ? 0.6 : 1 }}>
            {t('newBible.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
