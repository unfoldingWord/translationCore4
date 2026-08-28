// Source-texts modal — owner design rebuilt on the design system (epic #104 /
// #109). Two steps: choose a gateway language, then choose a book and see the
// package contents.
//
// Everything the user sees about a package is fetched LIVE from the platform's
// catalog (`GET /gitea/remote-repos/<server>/<org>`) — versions, coverage and
// flavors are never read from app config. `data/gateways.ts` supplies only the
// org to ask, because 0.18.5 has no catalog-wide search route.
//
// Net is the user's choice (D30.4/D30.5): when the platform is offline this
// modal says so and offers to go online; it never enables net by itself.
import React from 'react';
import { useApp } from '../../state.jsx';
import { BOOK_NAMES, bookName } from '../../data/bookNames';
import { gatewayKey } from '../../data/gateways';
import { t } from '../../i18n';
import { Modal, Select, OptionCard, Overline, Button, Badge, Callout } from '../../ds/index.js';

function LanguageStep({ gateways, installedCount, onPick }) {
  return (
    <div style={{ paddingBottom: 18 }}>
      <Overline as="span" style={{ display: 'block', marginBottom: 8 }}>{t('sources.chooseGateway')}</Overline>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {gateways.map((g) => {
          const n = installedCount(g);
          return (
            <OptionCard key={g.key} onClick={() => onPick(g)}
              title={<span dir={g.dir}>{g.autonym}</span>} meta={g.name}
              description={<span style={{ fontFamily: 'var(--font-mono)' }}>{g.org} · {t('sources.suiteSeen', { tn: g.seen.tn, tw: g.seen.tw, ta: g.seen.ta })}</span>}
              trailing={n > 0 ? (
                <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', fontWeight: 'var(--fw-heavy)', color: 'var(--tc-valid-strong)', whiteSpace: 'nowrap' }}>
                  {t('sources.nInstalled', { n })}
                </span>
              ) : null} />
          );
        })}
      </div>
    </div>
  );
}

function PackageRow({ row, onToggle }) {
  const on = row.fixed || row.on;
  return (
    <OptionCard selected={on} onClick={row.fixed ? undefined : () => onToggle(row.k)}
      title={row.name} meta={row.repo} description={row.desc}
      trailing={row.fixed ? <Badge tone="neutral" title={t('sources.alwaysIncluded')}>{t('sources.alwaysIncluded')}</Badge> : null}
      style={row.fixed ? { cursor: 'default' } : (on ? null : { opacity: 0.72 })} />
  );
}

function GatewayStep({ s, g, src, isCheckable, isCurrent, actions }) {
  return (
        <>
          <Callout tone="info" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)' }}>{g.name} · {g.org}</span>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" onClick={actions.changeGateway}
              style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
              {t('sources.changeLanguage')}
            </Button>
          </Callout>

          {/* D30.2 — checking in this language is an explicit, whole-project
            * action, and this is where the user asks for it. Offered only
            * when the COMPLETE suite is installed (§5.3 coherence) and it is
            * not already the project's checking language. Confirmation, with
            * the consequences, happens in the GatewayChange dialogue. */}
          {s.gatewayError && !s.gatewayPreview && (
            // Review of the D30 sweep: a failed gateway-change PREVIEW never
            // opens the dialogue, so its error must render HERE, where the
            // gesture happened — a dispatched-but-unrenderable error is a
            // swallow with extra steps.
            <Callout tone="warn" role="alert" data-testid="gateway-preview-error" style={{ overflowWrap: 'anywhere' }}>
              {t('sources.gatewayPreviewError')} {s.gatewayError}
            </Callout>
          )}
          {isCheckable && !isCurrent && s.project && (
            <Callout tone="info" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-accent-soft)', borderColor: 'rgba(49,173,227,.35)', color: 'var(--uw-ocean)' }}>
              <span style={{ flex: 1 }}>{t('sources.checkInPrompt', { lang: g.name })}</span>
              <Button size="sm" onClick={() => actions.askGatewayChange(g)} data-testid="use-for-checking"
                style={{ flex: 'none' }}>{t('sources.checkIn')}</Button>
            </Callout>
          )}
          {isCurrent && (
            <p data-testid="already-checking-in" style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', color: 'var(--tc-valid-strong)', fontWeight: 'var(--fw-bold)', margin: 0 }}>
              {t('sources.alreadyCheckingIn', { lang: g.name })}
            </p>
          )}

          <Select id="src-book" label={t('sources.book')} value={src.book}
            onChange={(e) => actions.setSourceBook(e.target.value)}
            options={Object.keys(BOOK_NAMES).map((code) => ({ value: code, label: bookName(code) }))} />

          <div style={{ paddingBottom: 14 }}>
            <Overline as="span" style={{ display: 'block', marginBottom: 8 }}>{t('sources.packageContents')}</Overline>
            {src.loading && (
              <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', margin: 0 }}>{t('sources.loadingCatalog')}</p>
            )}
            {src.error && (
              <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-invalid)', margin: 0, lineHeight: 'var(--lh-body)' }} data-testid="sources-error">{src.error}</p>
            )}
            {s.checkableError && (
              // Catch-to-absence sweep (D30): an identity-read outage is
              // stated — never "this machine can check in no language".
              <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--tc-invalid)', margin: 0, lineHeight: 'var(--lh-body)' }} data-testid="checkable-error">{t('sources.checkableError')} {s.checkableError}</p>
            )}
            {!src.loading && !src.error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {src.rows.length === 0 && (
                  <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', margin: 0, lineHeight: 'var(--lh-body)' }}>
                    {t('sources.noneForBook', { book: bookName(src.book), lang: g.name })}
                  </p>
                )}
                {src.rows.map((row) => (
                  <PackageRow key={row.k} row={row} onToggle={actions.toggleSourceRow} />
                ))}
              </div>
            )}
          </div>
        </>
  );
}

function SourcesFooter({ src, g, actions }) {
  return (
    <>
        {src.dl === 'done' && (
          <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-heavy)', color: 'var(--tc-valid-strong)' }} data-testid="sources-done">
            {t('sources.ready', { book: bookName(src.book), lang: g.name })}
          </span>
        )}
        {src.dl === 'run' && (
          <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }} data-testid="sources-progress">
            {src.progress || t('sources.downloading')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={actions.closeModal}>{t('common.close')}</Button>
        {src.dl == null && src.rows.length > 0 && (
          <Button onClick={actions.downloadPackage} data-testid="sources-download">{t('sources.download')}</Button>
        )}
    </>
  );
}

/** Org names compare case-insensitively — see samePath (D37): the stored
 * form is what DCS reports, but a project pinned by another tool may carry
 * another casing of the same address, and it is the same org. */
const isCurrentGateway = (s, g) => {
  const current = s.projectPins?.languageSets?.primary?.gatewayLanguage;
  return (
    !!g && current?.languageId === g.id &&
    (current?.owner ?? '').toLowerCase() === g.org.toLowerCase()
  );
};
const isCheckableGateway = (s, g) => !!g && (s.checkable ?? []).includes(gatewayKey(g));

export default function SourceTexts() {
  const { s, actions } = useApp();
  if (s.modal !== 'sources') return null;
  const src = s.src;
  const g = src.gateway;
  // Org names compare case-insensitively — see samePath (D37): the stored form
  // is what DCS reports, but a project pinned by another tool may carry another
  // casing of the same address, and it is the same org.
  const isCurrent = isCurrentGateway(s, g);
  const isCheckable = isCheckableGateway(s, g);

  return (
    <Modal width={640} data-testid="sources-modal" title={t('sources.title')} subtitle={t('sources.subtitle')}
      closeLabel={t('common.close')} onClose={actions.closeModal}
      footer={g ? <SourcesFooter src={src} g={g} actions={actions} /> : null}>

      {/* The platform is the net gate; going online is the user's choice. */}
      {!s.netEnabled && (
        <Callout tone="kindle" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{t('sources.offline')}</span>
          <Button size="sm" onClick={actions.goOnline}
            style={{ background: 'var(--uw-kindle)', flex: 'none' }}>{t('sources.goOnline')}</Button>
        </Callout>
      )}

      {!g && (
        <LanguageStep gateways={actions.sourceGateways()} installedCount={actions.installedCountFor} onPick={actions.pickGateway} />
      )}

      {g && <GatewayStep s={s} g={g} src={src} isCheckable={isCheckable} isCurrent={isCurrent} actions={actions} />}
    </Modal>
  );
}
