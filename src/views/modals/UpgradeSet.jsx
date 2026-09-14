// Release-upgrade confirmation (J12, D72 point 5 / D36) — issue #256.
//
// The release is already installed and sha-verified when this opens; what
// the user confirms here is the pin move and its exact cost: per (tool, book),
// how many decisions carry over and how many come back as work. Cancel leaves
// the pins, the decision files and the old release exactly as they are.
import React from 'react';
import { useApp } from '../../state.jsx';
import { bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Button, Callout } from '../../ds/index.js';

const repoName = (repoPath) => repoPath.split('/').pop();

function PlanRows({ preview }) {
  return (
    <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }} data-testid="upgrade-plan">
      {preview.consequences.affected.map((a) => {
        const p = (preview.plan ?? []).find((x) => x.tool === a.tool && x.book === a.book);
        return (
          <li key={`${a.tool}:${a.book}`}
            style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {p
              ? t('gateway.carryOver', { book: bookName(a.book), tool: t(`check.tool.${a.tool}`), carried: p.carried, invalidated: p.invalidated })
              : t('gateway.affectedRow', { book: bookName(a.book), tool: t(`check.tool.${a.tool}`), n: a.decisions, resource: repoName(a.checkedAgainst.repoPath) })}
          </li>
        );
      })}
    </ul>
  );
}

/** The release moves, then the D36 cost — headline, explanation, per-book rows. */
function Consequences({ preview }) {
  const harmless = preview.consequences.harmless;
  return (
    <>
      <ul style={{ margin: 0, paddingInlineStart: 18 }} data-testid="upgrade-moves">
        {preview.offer.upgrades.map((u) => (
          <li key={u.repoPath} style={{ fontSize: 'var(--fs-caption-lg)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {t('upgrade.move', { repo: repoName(u.repoPath), from: u.from.version ?? u.from.sha.slice(0, 12), to: u.to.version })}
          </li>
        ))}
      </ul>
      <p data-testid="upgrade-headline"
        style={{ fontSize: 'var(--fs-ui)', letterSpacing: 'var(--track-13-5)', color: harmless ? 'var(--tc-valid-strong)' : 'var(--tc-warn-text)', fontWeight: 'var(--fw-bold)', lineHeight: 'var(--lh-body)', margin: 0 }}>
        {harmless ? t('upgrade.harmless') : t('upgrade.headline', { n: preview.consequences.decisionsAtRisk })}
      </p>
      {!harmless && (
        <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0 }}>
          {t('upgrade.detail')}
        </p>
      )}
      {!harmless && <PlanRows preview={preview} />}
    </>
  );
}

/** Same rule as the gateway dialogue: a book neither rung covers after the
 * change blocks it, and the remedy differs by reason. */
function BlockedCallout({ blocked }) {
  const reasoned = blocked.find((b) => b.reason);
  return (
    <Callout tone="warn" role="alert" data-testid="upgrade-blocked">
      {t(reasoned ? `gateway.blocked-${reasoned.reason}` : 'gateway.blocked', {
        books: blocked.map((b) => `${bookName(b.book)} (${t(`check.tool.${b.tool}`)})`).join(', '),
      })}
    </Callout>
  );
}

const applyStyle = (blocked, harmless) => {
  if (blocked) return { background: 'var(--uw-haze)', boxShadow: 'none' };
  return harmless ? null : { background: 'var(--uw-kindle)' };
};

export default function UpgradeSet() {
  const { s, actions } = useApp();
  const preview = s.upgrade?.preview;
  if (!preview) return null;
  const harmless = preview.consequences.harmless;
  const blocked = (preview.blocked?.length ?? 0) > 0;
  const lang = preview.next.languageSets[preview.rung]?.gatewayLanguage?.languageId ?? '';

  return (
    <Modal data-testid="upgrade-confirm" data-kind={preview.offer.kind ?? 'upgrade'}
      title={preview.offer.kind === 'repin'
        ? t('fix.repin.confirmTitle', { set: t(`upgrade.set.${preview.rung}`, { lang }) })
        : t('upgrade.confirmTitle', { set: t(`upgrade.set.${preview.rung}`, { lang }) })}
      closeLabel={t('common.close')} onClose={actions.cancelUpgrade}
      footer={<>
        <Button variant="secondary" onClick={actions.cancelUpgrade} data-testid="upgrade-cancel">{t('upgrade.keep')}</Button>
        <Button onClick={() => actions.confirmUpgrade(preview)} data-testid="upgrade-apply" disabled={blocked} style={applyStyle(blocked, harmless)}>
          {preview.offer.kind === 'repin' ? t('fix.repin.apply') : t('upgrade.apply')}
        </Button>
      </>}>
      <div data-harmless={harmless ? '1' : '0'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Consequences preview={preview} />
        {blocked && <BlockedCallout blocked={preview.blocked} />}
        {s.upgrade.error && (
          <Callout tone="warn" role="alert" data-testid="upgrade-confirm-error" style={{ overflowWrap: 'anywhere' }}>{s.upgrade.error}</Callout>
        )}
      </div>
    </Modal>
  );
}
