// Project-settings modal — owner-approved design rebuilt on the design system
// (epic #104 / #109) bound to the state layer's `st` form (openSettings/
// patchSt/saveSettings). Name / language name / code are display-only this
// increment: metadata is not writable over the platform HTTP API (D28
// addendum). Text direction + script font persist to checking/settings.json.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
import { GlRow } from './NewBible.jsx';
import { t } from '../../i18n';
import { Modal, TextField, Select, FilterChip, Overline, Button, Callout } from '../../ds/index.js';

export default function ProjectSettings() {
  const { s, actions } = useApp();
  const st = s.st;
  if (s.modal !== 'settings' || !st) return null;
  const saveDisabled = st.busy || !st.loaded;

  return (
    <Modal title={t('settings.title')} subtitle={t('settings.subtitle', { name: st.projName, n: st.bookCount })}
      closeLabel={t('newBible.close')} onClose={actions.closeModal}
      footer={<>
        <Button variant="secondary" onClick={actions.closeModal}>{t('newBible.cancel')}</Button>
        <Button onClick={actions.saveSettings} disabled={saveDisabled}>{t('settings.save')}</Button>
      </>}>
      <TextField id="st-name" label={t('newBible.name')} value={st.name} disabled onChange={() => {}} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
        <TextField id="st-lang" label={t('newBible.langName')} value={st.langName} disabled onChange={() => {}} />
        <TextField id="st-code" label={t('newBible.code')} value={st.code} disabled onChange={() => {}} />
      </div>
      <p style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--text-tertiary)', margin: '-8px 0 0' }}>{t('settings.renameNote')}</p>

      <div>
        <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('newBible.direction')}</Overline>
        <div style={{ display: 'flex', gap: 8 }}>
          <FilterChip selected={st.dir === 'ltr'} onClick={() => actions.patchSt({ dir: 'ltr' })}
            style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--radius-md)' }}>{t('wizard.ltr')}</FilterChip>
          <FilterChip selected={st.dir === 'rtl'} onClick={() => actions.patchSt({ dir: 'rtl' })}
            style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--radius-md)' }}>{t('wizard.rtl')}</FilterChip>
        </div>
      </div>

      <div>
        <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('newBible.checkingLanguage')}</Overline>
        <GlRow />
      </div>

      <Select id="st-font" label={t('newBible.font')} value={st.font}
        onChange={(e) => actions.patchSt({ font: e.target.value })} options={SCRIPT_FONTS} />

      {st.error && <Callout tone="warn" role="alert">{st.error}</Callout>}
    </Modal>
  );
}
