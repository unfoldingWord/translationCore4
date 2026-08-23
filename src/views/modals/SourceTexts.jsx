// Source-texts modal — owner design (translationCore.dc.html, "MODAL · SOURCE
// TEXTS (book packages from Door43)"). Two steps: choose a gateway language,
// then choose a book and see the package contents.
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

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(1,38,56,.55)', zIndex: 80,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
};
const card = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640,
  maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(1,38,56,.4)',
};
const label = {
  display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '.1em',
  textTransform: 'uppercase', color: '#8A99A4', margin: '0 0 8px',
};
const closeBtn = {
  border: '1px solid rgba(35,31,32,.16)', background: '#fff', cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, padding: '10px 20px',
  borderRadius: 999, color: '#4F5E6A',
};
const primaryBtn = {
  border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800,
  fontSize: 13.5, padding: '10px 20px', borderRadius: 999,
  background: '#31ADE3', color: '#fff',
};

function LanguageStep({ gateways, installedCount, onPick }) {
  return (
    <div style={{ padding: '16px 24px 22px' }}>
      <span style={label}>{t('sources.chooseGateway')}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {gateways.map((g) => {
          const n = installedCount(g);
          return (
            <button key={g.key} type="button" onClick={() => onPick(g)} className="hovInspireBorder"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'start',
                border: '1.5px solid rgba(35,31,32,.12)', background: '#fff',
                cursor: 'pointer', borderRadius: 12, padding: '12px 14px',
                fontFamily: 'inherit', width: '100%',
              }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span dir={g.dir} style={{ fontSize: 14.5, fontWeight: 800, color: '#014263' }}>{g.autonym}</span>
                  <span style={{ fontSize: 12, color: '#8A99A4', fontWeight: 600 }}>{g.name}</span>
                </span>
                <span style={{ fontSize: 11.5, color: '#4F5E6A', fontFamily: 'ui-monospace,Menlo,monospace' }}>
                  {g.org} · {t('sources.suiteSeen', { tn: g.seen.tn, tw: g.seen.tw, ta: g.seen.ta })}
                </span>
              </span>
              {n > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#3C8F5C', whiteSpace: 'nowrap' }}>
                  {t('sources.nInstalled', { n })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PackageRow({ row, onToggle }) {
  const on = row.fixed || row.on;
  return (
    <button type="button" onClick={row.fixed ? undefined : () => onToggle(row.k)}
      title={row.fixed ? t('sources.alwaysIncluded') : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'start',
        border: '1.5px solid', cursor: row.fixed ? 'default' : 'pointer',
        borderRadius: 10, padding: '10px 12px', fontFamily: 'inherit', width: '100%',
        borderColor: on ? '#31ADE3' : 'rgba(35,31,32,.14)',
        background: on ? '#eaf6fc' : '#fff', opacity: on ? 1 : 0.72,
      }}>
      <span style={{ width: 20, height: 20, borderRadius: 99, background: on ? '#31ADE3' : '#C6D0D7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flex: 'none' }}>
        {on ? '✓' : '+'}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#014263' }}>{row.name}</span>
          <span style={{ fontSize: 10.5, color: '#8A99A4', fontFamily: 'ui-monospace,Menlo,monospace' }}>{row.repo}</span>
          {row.fixed && (
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', background: '#ECF2F5', color: '#8A99A4', borderRadius: 999, padding: '2px 7px' }}>
              {t('sources.alwaysIncluded')}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11.5, color: '#4F5E6A', lineHeight: 1.45 }}>{row.desc}</span>
      </span>
    </button>
  );
}

export default function SourceTexts() {
  const { s, actions } = useApp();
  if (s.modal !== 'sources') return null;
  const src = s.src;
  const g = src.gateway;
  const current = s.projectPins?.languageSets?.primary?.gatewayLanguage;
  // Org names compare case-insensitively — see samePath (D37): the stored form
  // is what DCS reports, but a project pinned by another tool may carry another
  // casing of the same address, and it is the same org.
  const isCurrent =
    !!g && current?.languageId === g.id &&
    (current?.owner ?? '').toLowerCase() === g.org.toLowerCase();
  const isCheckable = !!g && (s.checkable ?? []).includes(gatewayKey(g));

  return (
    <div style={overlay} onClick={actions.closeModal} data-testid="sources-modal">
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#014263', margin: '0 0 4px' }}>{t('sources.title')}</h3>
            <p style={{ fontSize: 13, color: '#4F5E6A', margin: 0, lineHeight: 1.5 }}>{t('sources.subtitle')}</p>
          </div>
          <button type="button" onClick={actions.closeModal} aria-label={t('common.close')}
            style={{ border: 0, background: '#ECF2F5', cursor: 'pointer', width: 28, height: 28, borderRadius: 99, fontSize: 13, color: '#4F5E6A', flex: 'none' }}>✕</button>
        </div>

        {/* The platform is the net gate; going online is the user's choice. */}
        {!s.netEnabled && (
          <div style={{ margin: '16px 24px 0', display: 'flex', alignItems: 'center', gap: 10, background: '#F6EEDC', border: '1px solid rgba(229,157,51,.35)', borderRadius: 10, padding: '10px 12px' }}>
            <span style={{ fontSize: 12.5, color: '#8A6A22', flex: 1, lineHeight: 1.45 }}>{t('sources.offline')}</span>
            <button type="button" onClick={actions.goOnline}
              style={{ border: 0, background: '#E59D33', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, padding: '7px 14px', borderRadius: 999, flex: 'none' }}>
              {t('sources.goOnline')}
            </button>
          </div>
        )}

        {!g && (
          <LanguageStep gateways={actions.sourceGateways()} installedCount={actions.installedCountFor} onPick={actions.pickGateway} />
        )}

        {g && (
          <>
            <div style={{ padding: '16px 24px 4px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F7FAFC', border: '1px solid rgba(35,31,32,.08)', borderRadius: 10, padding: '9px 12px' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#014263' }}>{g.name} · {g.org}</span>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={actions.changeGateway}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, color: '#31ADE3', padding: 0 }}>
                  {t('sources.changeLanguage')}
                </button>
              </div>

              {/* D30.2 — checking in this language is an explicit, whole-project
                * action, and this is where the user asks for it. Offered only
                * when the COMPLETE suite is installed (§5.3 coherence) and it is
                * not already the project's checking language. Confirmation, with
                * the consequences, happens in the GatewayChange dialogue. */}
              {isCheckable && !isCurrent && s.project && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#eaf6fc', border: '1px solid rgba(49,173,227,.35)', borderRadius: 10, padding: '10px 12px' }}>
                  <span style={{ fontSize: 12.5, color: '#014263', flex: 1, lineHeight: 1.45 }}>
                    {t('sources.checkInPrompt', { lang: g.name })}
                  </span>
                  <button type="button" onClick={() => actions.askGatewayChange(g)}
                    data-testid="use-for-checking"
                    style={{ border: 0, background: '#31ADE3', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12, padding: '7px 14px', borderRadius: 999, flex: 'none' }}>
                    {t('sources.checkIn')}
                  </button>
                </div>
              )}
              {isCurrent && (
                <p data-testid="already-checking-in" style={{ fontSize: 12, color: '#3C8F5C', fontWeight: 700, margin: 0 }}>
                  {t('sources.alreadyCheckingIn', { lang: g.name })}
                </p>
              )}
              {/* D57 — the suite is complete on disk but carries no recorded
                * version, so it cannot be pinned; say so instead of a silently
                * absent offer. */}
              {!isCheckable && !isCurrent && s.project &&
                (s.checkableUnversioned ?? []).includes(gatewayKey(g)) && (
                <p data-testid="unversioned-suite" style={{ fontSize: 12, color: '#8A6A22', fontWeight: 700, margin: 0, lineHeight: 1.5 }}>
                  {t('sources.noVersionRecord', { lang: g.name })}
                </p>
              )}

              <div>
                <label htmlFor="src-book" style={label}>{t('sources.book')}</label>
                <select id="src-book" value={src.book} onChange={(e) => actions.setSourceBook(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(35,31,32,.16)', borderRadius: 9, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, color: '#1E2C36', background: '#fff', outline: 'none' }}>
                  {Object.keys(BOOK_NAMES).map((code) => (
                    <option key={code} value={code}>{bookName(code)}</option>
                  ))}
                </select>
              </div>

              <div>
                <span style={label}>{t('sources.packageContents')}</span>
                {src.loading && (
                  <p style={{ fontSize: 12.5, color: '#8A99A4', margin: 0 }}>{t('sources.loadingCatalog')}</p>
                )}
                {src.error && (
                  <p style={{ fontSize: 12.5, color: '#A21309', margin: 0, lineHeight: 1.5 }} data-testid="sources-error">{src.error}</p>
                )}
                {!src.loading && !src.error && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {src.rows.length === 0 && (
                      <p style={{ fontSize: 12.5, color: '#8A99A4', margin: 0, lineHeight: 1.5 }}>
                        {t('sources.noneForBook', { book: bookName(src.book), lang: g.name })}
                      </p>
                    )}
                    {src.rows.map((row) => (
                      <PackageRow key={row.k} row={row} onToggle={actions.toggleSourceRow} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: '16px 24px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
              {src.dl === 'done' && (
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#3C8F5C' }} data-testid="sources-done">
                  {t('sources.ready', { book: bookName(src.book), lang: g.name })}
                </span>
              )}
              {src.dl === 'run' && (
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4F5E6A' }} data-testid="sources-progress">
                  {src.progress || t('sources.downloading')}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button type="button" onClick={actions.closeModal} style={closeBtn}>{t('common.close')}</button>
              {src.dl == null && src.rows.length > 0 && (
                <button type="button" onClick={actions.downloadPackage} style={primaryBtn} data-testid="sources-download">
                  {t('sources.download')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
