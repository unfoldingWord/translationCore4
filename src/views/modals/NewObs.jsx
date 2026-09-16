// New Open Bible Stories modal (J20, #287; D74). The same language block as
// New Bible — name, language, direction, checking language, font — and nothing
// about books, stories or versification: the scope is always all fifty stories
// (BURRITO-SPEC R-10.2.2), and an OBS project has no versification frame.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, TextField, Select, FilterChip, Overline, Button, Callout } from '../../ds/index.js';
import { GlRow } from './NewBible.jsx';

export default function NewObs() {
  const { s, actions } = useApp();
  const np = s.np;
  if (s.modal !== 'newObs' || !np) return null;

  return (
    <Modal title={t('newObs.title')} subtitle={t('newObs.subtitle')}
      closeLabel={t('newBible.close')} onClose={actions.closeModal}
      footer={<>
        <Button variant="secondary" onClick={actions.closeModal}>{t('newBible.cancel')}</Button>
        <Button onClick={actions.createObs} disabled={np.busy}>{t('newObs.create')}</Button>
      </>}>
      <TextField id="no-name" label={t('newObs.name')} value={np.name}
        placeholder={t('newObs.namePlaceholder')} onChange={(e) => actions.patchNp({ name: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
        <TextField id="no-lang" label={t('newBible.langName')} value={np.langName}
          placeholder={t('newBible.langPlaceholder')} onChange={(e) => actions.patchNp({ langName: e.target.value })} />
        <TextField id="no-code" label={t('newBible.code')} value={np.code}
          placeholder={t('newBible.codePlaceholder')} onChange={(e) => actions.patchNp({ code: e.target.value })} />
      </div>

      <div>
        <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('newBible.direction')}</Overline>
        <div style={{ display: 'flex', gap: 8 }}>
          <FilterChip selected={np.dir === 'ltr'} onClick={() => actions.patchNp({ dir: 'ltr' })}
            style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--radius-md)' }}>{t('wizard.ltr')}</FilterChip>
          <FilterChip selected={np.dir === 'rtl'} onClick={() => actions.patchNp({ dir: 'rtl' })}
            style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--radius-md)' }}>{t('wizard.rtl')}</FilterChip>
        </div>
      </div>

      <div>
        <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('newBible.checkingLanguage')}</Overline>
        <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 'var(--lh-body)' }}>{t('newObs.glNote')}</p>
        <GlRow />
      </div>

      <Select id="no-font" label={t('newBible.font')} value={np.font}
        onChange={(e) => actions.patchNp({ font: e.target.value })} options={SCRIPT_FONTS} />

      {np.error && <Callout tone="warn" role="alert">{np.error}</Callout>}
    </Modal>
  );
}
