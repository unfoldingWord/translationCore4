// Gateway-language change confirmation (§5 default #2 / D23a, D30.2) — rebuilt
// on the design system (epic #104 / #109).
//
// This dialogue is WHERE THE WARNING LIVES. Changing which gateway language a
// project checks against is the only thing that moves a checked book to a
// different resource, so the consequences are counted and shown here, before
// anything is written, with a way to decline. A user who never changes their
// gateway language never sees this — partial coverage is handled per book by
// the two-rung ladder, silently and correctly.
import React from 'react';
import { useApp } from '../../state.jsx';
import { describeConsequences } from '../../data/gatewayChange';
import { bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Button, Callout } from '../../ds/index.js';

export default function GatewayChange() {
  const { s, actions } = useApp();
  const preview = s.gatewayPreview;
  if (!preview) return null;

  const { headline, detail } = describeConsequences(preview.consequences, bookName);
  const harmless = preview.consequences.harmless;
  const blocked = (preview.blocked?.length ?? 0) > 0;

  return (
    <Modal zIndex={90} data-testid="gateway-change" title={t('gateway.title', { lang: preview.gateway.name })}
      closeLabel={t('common.close')} onClose={actions.cancelGatewayChange}
      footer={<>
        <Button variant="secondary" onClick={actions.cancelGatewayChange} data-testid="gateway-cancel">
          {t('gateway.keep', { lang: preview.currentName ?? t('gateway.current') })}
        </Button>
        <Button onClick={() => actions.confirmGatewayChange(preview)} data-testid="gateway-confirm"
          disabled={blocked}
          style={blocked ? { background: 'var(--uw-haze)', boxShadow: 'none' }
            : harmless ? null : { background: 'var(--uw-kindle)' }}>
          {t('gateway.change', { lang: preview.gateway.name })}
        </Button>
      </>}>
      <div data-harmless={harmless ? '1' : '0'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p data-testid="gateway-headline"
          style={{ fontSize: 'var(--fs-ui)', letterSpacing: 'var(--track-13-5)', color: harmless ? 'var(--tc-valid-strong)' : 'var(--tc-warn-text)', fontWeight: 'var(--fw-bold)', lineHeight: 'var(--lh-body)', margin: 0 }}>
          {headline}
        </p>
        {detail && (
          <p style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0 }}>
            {detail}
          </p>
        )}

        {/* The exact outcome per book, not an estimate: the new resource's
          * check list has already been derived, so these numbers are what the
          * user will actually see afterwards. */}
        {!harmless && (
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }} data-testid="gateway-plan">
            {preview.consequences.affected.map((a) => {
              const p = (preview.plan ?? []).find(
                (x) => x.tool === a.tool && x.book === a.book,
              );
              return (
                <li key={`${a.tool}:${a.book}`}
                  style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {p
                    ? t('gateway.carryOver', {
                      book: bookName(a.book),
                      tool: t(`check.tool.${a.tool}`),
                      carried: p.carried,
                      invalidated: p.invalidated,
                    })
                    : t('gateway.affectedRow', {
                      book: bookName(a.book),
                      tool: t(`check.tool.${a.tool}`),
                      n: a.decisions,
                      resource: a.checkedAgainst.repoPath.split('/').pop(),
                    })}
                </li>
              );
            })}
          </ul>
        )}

        {/* Round 7: a book NEITHER rung covers after the change has stored
          * decisions and nothing to carry them to — the change is blocked,
          * with the books named, until the new suite covers them (or a
          * conforming unresolved state exists). */}
        {blocked && (
          <Callout tone="warn" role="alert" data-testid="gateway-blocked">
            {/* The remedy depends on WHY the books are blocked. A versification
              * block (frame unavailable/unknown) affects every entry at once
              * and cannot be fixed by installing a suite — say the real fix. */}
            {t(
              preview.blocked.find((b) => b.reason)
                ? `gateway.blocked-${preview.blocked.find((b) => b.reason).reason}`
                : 'gateway.blocked',
              {
                books: preview.blocked.map((b) => `${bookName(b.book)} (${t(`check.tool.${b.tool}`)})`).join(', '),
              },
            )}
          </Callout>
        )}

        {s.gatewayError && (
          <Callout tone="warn" role="alert" data-testid="gateway-error" style={{ overflowWrap: 'anywhere' }}>
            <strong>{t('gateway.failed')}</strong> {s.gatewayError}
          </Callout>
        )}
      </div>
    </Modal>
  );
}
