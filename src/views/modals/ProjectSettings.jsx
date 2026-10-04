// Project-settings modal — owner-approved design rebuilt on the design system
// (epic #104 / #109) bound to the state layer's `st` form (openSettings/
// patchSt/saveSettings). Name / language name / code are display-only this
// increment: metadata is not writable over the platform HTTP API (D28
// addendum). Text direction + script font persist to checking/settings.json.
// The Checking language card chooses the project's gateway-language package
// (#412): the installed packages that cover its books, the current one marked;
// a choice opens the J13 consequence dialogue before anything is written.
import React from 'react';
import { useApp, SCRIPT_FONTS } from '../../state.jsx';
import { t } from '../../i18n';
import { GATEWAYS } from '../../data/gateways';
import { samePath } from '../../data/resolve';
import { pinnedGateway } from '../../data/gatewayChange';
import { Modal, TextField, Select, FilterChip, Overline, Button, Callout, OptionCard, Badge, Text } from '../../ds/index.js';

const isGateway = (g, gl) => !!gl && g.id === gl.languageId && samePath(g.org, gl.owner);

/** The packages to choose from, and the project's current one from its pins. */
function GatewayCard({ s, st, actions }) {
  // The open project's live pins, so a confirmed change shows at once; while
  // they are not read yet, the pins Settings read from disk.
  const pins = (s.project?.id === st.repoPath ? s.projectPins : null) ?? st.gw.pins;
  // No pins is no current package: nothing is marked, and English stays a choice.
  const gl = pinnedGateway(pins);
  const known = gl && GATEWAYS.find((g) => isGateway(g, gl));
  return (
    <div data-testid="settings-gateway">
      <Overline as="span" style={{ display: 'block', marginBottom: 6 }}>{t('newBible.checkingLanguage')}</Overline>
      {(gl || (!st.gw.loading && !st.gw.error)) && (
        <Text role="caption" data-testid="settings-gateway-current" style={{ display: 'block', marginBottom: 8 }}>
          {gl ? t('settings.gatewayCurrent', { lang: known ? known.name : gl.languageId, org: gl.owner }) : t('settings.gatewayUnset')}
        </Text>
      )}
      {st.gw.loading && <Text role="caption" tone="muted">{t('settings.gatewayLoading')}</Text>}
      {st.gw.error && <Callout tone="warn" role="alert" data-testid="settings-gateway-error" style={{ overflowWrap: 'anywhere' }}>{st.gw.error}</Callout>}
      {s.gatewayError && !s.gatewayPreview && (
        <Callout tone="warn" role="alert" data-testid="gateway-preview-error" style={{ overflowWrap: 'anywhere', marginBottom: 8 }}>
          {t('sources.gatewayPreviewError')} {s.gatewayError}
        </Callout>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {st.gw.options.map((g) => {
          const current = isGateway(g, gl);
          return (
            <OptionCard key={g.key} data-testid={`settings-gateway-${g.key}`} data-current={current ? '1' : '0'}
              selected={current} title={<span dir={g.dir}>{g.autonym}</span>} meta={g.name} description={g.org}
              trailing={current ? <Badge tone="accentSoft" size="sm">{t('settings.gatewayCurrentBadge')}</Badge> : '→'}
              onClick={current ? undefined : () => actions.chooseSettingsGateway(g)}
              style={current ? { cursor: 'default' } : undefined} />
          );
        })}
      </div>
      <Button variant="ghost" size="sm" data-testid="settings-manage-sources" onClick={actions.manageSettingsSources} style={{ marginTop: 8 }}>
        {t('settings.manageSources')} →
      </Button>
    </div>
  );
}

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

      <GatewayCard s={s} st={st} actions={actions} />

      <Select id="st-font" label={t('newBible.font')} value={st.font}
        onChange={(e) => actions.patchSt({ font: e.target.value })} options={SCRIPT_FONTS} />

      {st.error && <Callout tone="warn" role="alert">{st.error}</Callout>}
    </Modal>
  );
}
