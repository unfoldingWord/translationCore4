// #678: the result of one "Sync with Door43" (layer 4 of epic #24), on Home.
// It reads only the sync Report (`report.facts`, journal/sync.mjs): the
// changes teammates made (`received`), the conflicts where the newest version
// won (`newestWins`), and the verse conflicts (`textConflicts`), with a link to
// the review (#679) when there is one. A refused sync shows the one message of
// its code. #680: the teammates who sent changes, each by actorLabel. The owner's mockup (2026-10-13, "HomeConflicts"): a white toast at
// the bottom of Home, a dot, one line, an Ocean link, and a dismiss button.
import React from 'react';
import { t } from '../i18n';
import { actorLabel } from './actorLabel.js';

/** One message for each refusal code that a sync can return (journal/report.mjs). */
export const SYNC_REFUSALS = {
  'sync.own-file-differs': 'syncResult.error.ownFileDiffers',
  'sync.incoming-invalid': 'syncResult.error.incomingInvalid',
  'sync.metadata-overlay': 'syncResult.error.metadataOverlay',
  'sync.obs-unsupported': 'syncResult.error.obsUnsupported',
  'sync.auth-failed': 'syncResult.error.authFailed',
  'sync.offline': 'syncResult.error.offline',
  'sync.not-shared': 'syncResult.error.notShared',
  'sync.clone-path-exists': 'syncResult.error.clonePathExists',
  'sync.clone-failed': 'syncResult.error.cloneFailed',
  'sync.move-failed': 'syncResult.error.moveFailed',
  'sync.verify-failed': 'syncResult.error.verifyFailed',
  'sync.non-fast-forward': 'syncResult.error.nonFastForward',
  'sync.no-write-access': 'syncResult.error.noWriteAccess',
  'sync.push-failed': 'syncResult.error.pushFailed',
  'opslog.not-loaded': 'syncResult.error.opsLogNotLoaded',
  'sync.swap-pending': 'syncResult.error.swapPending',
};

/** The message of a failed sync Report: the text of its code, else the reason. */
export const syncErrorText = (report) => {
  const key = SYNC_REFUSALS[report.code];
  if (key) return t(key);
  return t('syncResult.error.other', { reason: String(report.facts?.error ?? '') });
};

/** The three counts of an ok sync Report, from `report.facts` only. */
export const syncCounts = (facts = {}) => ({
  received: Object.values(facts.received ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0),
  newestWins: Array.isArray(facts.newestWins) ? facts.newestWins.length : 0,
  textConflicts: Array.isArray(facts.textConflicts) ? facts.textConflicts.length : 0,
});

const counted = (n, one, many) => t(n === 1 ? one : many, { n });

const LINK = { border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-ocean)', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' };

const LINE = { fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--uw-ink)', overflowWrap: 'anywhere' };
const NOTE = { fontSize: 'var(--fs-meta)', color: 'var(--text-secondary)' };

/** The line of an ok sync: the three counts. */
function Counts({ counts }) {
  return (
    <span style={LINE}>
      {t('syncResult.done')}
      {' · '}<span data-testid="sync-count-received" data-count={counts.received}>{counted(counts.received, 'syncResult.receivedOne', 'syncResult.receivedMany')}</span>
      {' · '}<span data-testid="sync-count-newest" data-count={counts.newestWins}>{counted(counts.newestWins, 'syncResult.newestOne', 'syncResult.newestMany')}</span>
      {' · '}<span data-testid="sync-count-conflicts" data-count={counts.textConflicts}>{counted(counts.textConflicts, 'syncResult.conflictsOne', 'syncResult.conflictsMany')}</span>
    </span>
  );
}

/** #680: the teammates who sent changes (`received`), each by the label the
 * review gives them: the Door43 name of `facts.names`, else "Teammate n" over
 * `facts.actors`. `received` holds teammates only, so no "Mine" shows here;
 * `me` is null because the sync writes this translator's name first, and a
 * named actor takes no number. Nothing for no teammate. */
function From({ facts = {} }) {
  const senders = Object.keys(facts.received ?? {}).sort();
  if (!senders.length) return null;
  const labels = senders.map((a) => actorLabel(a, facts.names, null, facts.actors));
  return <span data-testid="sync-received-from" style={NOTE}>{t('syncResult.from', { names: labels.join(' · ') })}</span>;
}

/** A count sentence under the line, or nothing for 0. */
function Note({ testId, n, one, many }) {
  if (!n) return null;
  return <span data-testid={testId} data-count={n} style={NOTE}>{counted(n, one, many)}</span>;
}

function Link({ testId, onClick, label, show }) {
  if (!show) return null;
  return <button type="button" data-testid={testId} onClick={onClick} style={LINK}>{label}</button>;
}

/** `result`: { repoPath, name, report, missingPins } (state `syncResult`). */
export default function SyncResult({ result, onReview, onDownload, onDismiss }) {
  const { report } = result;
  const ok = report.ok === true;
  const counts = syncCounts(report.facts);
  const restored = ok ? Number(report.facts?.restored) || 0 : 0;
  const missingPins = ok ? result.missingPins || 0 : 0;
  const review = ok && counts.textConflicts > 0;
  const dot = !ok ? 'var(--tc-invalid)' : review || missingPins ? 'var(--uw-kindle)' : 'var(--tc-valid)';
  return (
    <div role={ok ? 'status' : 'alert'} data-testid="sync-result" data-ok={ok ? '1' : '0'} data-code={report.code ?? ''}
      style={{ boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px 12px 16px', background: 'var(--surface-card)', border: 'var(--stroke-hair) solid var(--border-hair)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-hover)', fontFamily: 'var(--font-ui)' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: dot, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {ok ? <Counts counts={counts} /> : (
          <span style={LINE}>
            <strong>{t('syncResult.failed')}</strong>{' '}
            <span data-testid="sync-message">{syncErrorText(report)}</span>
          </span>
        )}
        {ok && <From facts={report.facts} />}
        <Note testId="sync-restored" n={restored} one="syncResult.restoredOne" many="syncResult.restoredMany" />
        <Note testId="sync-missing-pins" n={missingPins} one="syncResult.missingPinsOne" many="syncResult.missingPinsMany" />
      </div>
      <Link testId="sync-review" onClick={onReview} label={t('syncResult.review')} show={review} />
      <Link testId="sync-download" onClick={onDownload} label={t('syncResult.download')} show={missingPins > 0} />
      <button type="button" data-testid="sync-dismiss" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={onDismiss}
        style={{ width: 26, height: 26, borderRadius: 'var(--radius-pill)', border: 0, background: 'var(--uw-frost)', color: 'var(--uw-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', flex: 'none' }}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
          <path d="M6 6l12 12" /><path d="M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
