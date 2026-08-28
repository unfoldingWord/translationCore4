// New Bible modal — owner-approved design rebuilt on the design system (epic
// #104 / #109) bound to the state layer's `np` form (openNewProject/patchNp/
// createBible). The versification disclosure is not in the design but D25
// requires it available-yet-out-of-the-way, so it keeps the old wizard's
// collapsed form.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, TextField, Select, FilterChip, OptionCard, Overline, Button, Callout } from '../../ds/index.js';

// Single English gateway-language row — non-interactive this increment (the
// installed suite is the only option; the picker arrives with the resource
// manager increment). Rendered selected per the design.
export function GlRow() {
  return (
    <OptionCard selected recommended recommendedLabel={t('newBible.recommended')}
      title={t('newBible.glName')} description={t('newBible.glMeta')}
      trailing={t('sym.tick')} style={{ cursor: 'default' }} />
  );
}

export default function NewBible() {
  const { s, actions } = useApp();
  const np = s.np;
  if (s.modal !== 'newProject' || !np) return null;

  return (
    <Modal title={t('newBible.title')} subtitle={t('newBible.subtitle')}
      closeLabel={t('newBible.close')} onClose={actions.closeModal}
      footer={<>
        <Button variant="secondary" onClick={actions.closeModal}>{t('newBible.cancel')}</Button>
        <Button onClick={actions.createBible} disabled={np.busy}>{t('newBible.create')}</Button>
      </>}>
      <TextField id="nb-name" label={t('newBible.name')} value={np.name}
        placeholder={t('newBible.namePlaceholder')} onChange={(e) => actions.patchNp({ name: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 12 }}>
        <TextField id="nb-lang" label={t('newBible.langName')} value={np.langName}
          placeholder={t('newBible.langPlaceholder')} onChange={(e) => actions.patchNp({ langName: e.target.value })} />
        <TextField id="nb-code" label={t('newBible.code')} value={np.code}
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
        <p style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 'var(--lh-body)' }}>{t('newBible.glNote')}</p>
        <GlRow />
      </div>

      <Select id="nb-font" label={t('newBible.font')} value={np.font}
        onChange={(e) => actions.patchNp({ font: e.target.value })} options={SCRIPT_FONTS} />

      {/* Versification: available but out of the way (D25) — the design
          omits it, so it stays a collapsed disclosure. */}
      <div>
        <Button variant="ghost" onClick={() => actions.patchNp({ showAdvanced: !np.showAdvanced })}
          style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
          {np.showAdvanced ? '▾' : '▸'} {t('wizard.versification')}
        </Button>
        {np.showAdvanced && (
          <div style={{ marginTop: 8 }}>
            <Select aria-label={t('wizard.versification')} value={np.versification}
              onChange={(e) => actions.patchNp({ versification: e.target.value })}
              options={np.versifications.map((v) => ({ value: v, label: `${v}${v === 'eng' ? ` ${t('wizard.default')}` : ''}` }))}
              hint={t('wizard.versificationHint')} />
          </div>
        )}
      </div>

      {np.error && <Callout tone="warn" role="alert">{np.error}</Callout>}
    </Modal>
  );
}
