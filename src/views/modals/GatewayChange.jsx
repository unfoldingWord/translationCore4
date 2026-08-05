// Gateway-language change confirmation (§5 default #2 / D23a, D30.2).
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

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(1,38,56,.55)', zIndex: 90,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
};
const card = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
  boxShadow: '0 24px 64px rgba(1,38,56,.4)', padding: '24px 26px',
};

export default function GatewayChange() {
  const { s, actions } = useApp();
  const preview = s.gatewayPreview;
  if (!preview) return null;

  const { headline, detail } = describeConsequences(preview.consequences, bookName);
  const harmless = preview.consequences.harmless;

  return (
    <div style={overlay} onClick={actions.cancelGatewayChange} data-testid="gateway-change">
      <div style={card} onClick={(e) => e.stopPropagation()}
        data-harmless={harmless ? '1' : '0'}>
        <h3 style={{ fontSize: 19, fontWeight: 900, color: '#014263', margin: '0 0 12px' }}>
          {t('gateway.title', { lang: preview.gateway.name })}
        </h3>

        <p data-testid="gateway-headline"
          style={{ fontSize: 14, color: harmless ? '#3C8F5C' : '#8A6A22', fontWeight: 700, lineHeight: 1.55, margin: '0 0 8px' }}>
          {headline}
        </p>
        {detail && (
          <p style={{ fontSize: 13.5, color: '#4F5E6A', lineHeight: 1.6, margin: '0 0 14px' }}>
            {detail}
          </p>
        )}

        {/* The exact outcome per book, not an estimate: the new resource's
          * check list has already been derived, so these numbers are what the
          * user will actually see afterwards. */}
        {!harmless && (
          <ul style={{ margin: '0 0 16px', paddingInlineStart: 18 }} data-testid="gateway-plan">
            {preview.consequences.affected.map((a) => {
              const p = (preview.plan ?? []).find(
                (x) => x.tool === a.tool && x.book === a.book,
              );
              return (
                <li key={`${a.tool}:${a.book}`}
                  style={{ fontSize: 12.5, color: '#4F5E6A', lineHeight: 1.7 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={actions.cancelGatewayChange} data-testid="gateway-cancel"
            style={{ border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, color: '#4F5E6A' }}>
            {t('gateway.keep', { lang: preview.currentName ?? t('gateway.current') })}
          </button>
          <button type="button" onClick={() => actions.confirmGatewayChange(preview)}
            data-testid="gateway-confirm"
            style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px', borderRadius: 999, background: harmless ? '#31ADE3' : '#E59D33', color: '#fff' }}>
            {t('gateway.change', { lang: preview.gateway.name })}
          </button>
        </div>
      </div>
    </div>
  );
}
