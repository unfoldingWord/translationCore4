// Resource updates — the J12 "Check for updates" section of the sources modal
// (D72 point 5, issue #256).
//
// On demand and online only: the user asks, DCS answers, and each language set
// shows its own offer with an Upgrade button. Accepting installs the release
// (sha-verified, all or nothing) and opens the UpgradeSet confirmation with
// the D36 carry-over counts; the pins move only there. Nothing on this
// surface writes to the project.
import React from 'react';
import { useApp } from '../../state.jsx';
import { releaseDateLabel } from '../../data/upgrade';
import { t } from '../../i18n';
import { Overline, Button, Callout } from '../../ds/index.js';

const repoName = (repoPath) => repoPath.split('/').pop();

function OfferCard({ rung, offer, set, installing, onUpgrade }) {
  const lang = set?.gatewayLanguage?.languageId ?? '';
  const busy = installing === rung;
  return (
    <div data-testid={`upgrade-offer-${rung}`} data-upgrades={offer.upgrades.length}
      style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', fontSize: 'var(--fs-ui-sm)' }}>
          {t(`upgrade.set.${rung}`, { lang })}
        </span>
        <div style={{ flex: 1 }} />
        {offer.upgrades.length > 0 ? (
          <Button size="sm" data-testid={`upgrade-set-${rung}`} disabled={!!installing} onClick={() => onUpgrade(rung)}>
            {busy ? t('upgrade.installing') : t('upgrade.upgradeSet', { n: offer.upgrades.length })}
          </Button>
        ) : (
          <span data-testid={`upgrade-current-${rung}`} style={{ fontSize: 'var(--fs-caption)', color: 'var(--tc-valid-strong)', fontWeight: 'var(--fw-bold)' }}>
            {t('upgrade.upToDate')}
          </span>
        )}
      </div>
      {offer.upgrades.map((u) => (
        <div key={u.repoPath} data-testid="upgrade-row" style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {t('upgrade.row', {
            repo: repoName(u.repoPath),
            from: u.from.version ?? u.from.sha.slice(0, 12),
            to: u.to.version,
            date: releaseDateLabel(u.publishedAt),
          })}
        </div>
      ))}
    </div>
  );
}

export default function ResourceUpdates() {
  const { s, actions } = useApp();
  const up = s.upgrade;
  const sets = s.projectPins?.languageSets;
  if (!s.project || !sets || !up) return null;
  return (
    <div data-testid="resource-updates" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Overline as="span">{t('upgrade.title')}</Overline>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" data-testid="check-updates" disabled={!s.netEnabled || up.checking}
          title={s.netEnabled ? undefined : t('upgrade.offline')} onClick={actions.checkForUpdates}>
          {up.checking ? t('upgrade.checking') : t('upgrade.check')}
        </Button>
      </div>
      {!s.netEnabled && (
        <p data-testid="upgrade-offline" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-tertiary)', margin: 0 }}>{t('upgrade.offline')}</p>
      )}
      {up.progress && (
        <p data-testid="upgrade-progress" style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-secondary)', fontWeight: 'var(--fw-bold)', margin: 0 }}>{up.progress}</p>
      )}
      {up.error && (
        <Callout tone="warn" role="alert" data-testid="upgrade-error" style={{ overflowWrap: 'anywhere' }}>{up.error}</Callout>
      )}
      {up.offers && Object.keys(up.offers).map((rung) => (
        <OfferCard key={rung} rung={rung} offer={up.offers[rung]} set={sets[rung]} installing={up.installing} onUpgrade={actions.upgradeSet} />
      ))}
    </div>
  );
}
