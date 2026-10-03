// The first-share dialog (issue #362; D84 points 3, 4 and 5; the Interface
// section of epic #372), reached from Share beside Settings on a Home card once
// a token is held (the sign-in step, ShareSignIn.jsx, runs first when none is).
// Three steps in one dialog: where it goes (the user's own account, or an
// organization the user can create repositories in; one marked Recommended) →
// check what will be shared (the repository name, editable, and the books or
// stories) → one progress line ("Creating the repository…", "Pushing…") → the
// end: the URL, Copy link, Open on Door43, "Others can read it on Door43."
// A refusal returns to the check step with the Report's message and code.
// #530: Upload changes on a shared card opens this dialog too (`sh.mode`
// 'upload'): one review step (the repository, the account, the books or
// stories; nothing to choose) → the same progress line → the end. A refusal
// returns to the review step with Try again. Opening it sends nothing.
// Bound to the state layer's `sh` (startShare / openUpload / shareStep /
// shareRun / uploadChanges / shareCopyLink). No Door43 call and no fetch
// happens here (test/noBypass.test.ts):
// the operation is src/data/share/shareOperation.ts, the adapter door43Api.ts.
import React from 'react';
import { useApp } from '../../state.jsx';
import { bookName } from '../../data/bookNames';
import { locationOf } from '../../data/dcsServer';
import { t } from '../../i18n';
import { Modal, Button, OptionCard, TextField, Spinner, Callout, Text } from '../../ds/index.js';

/** The plain-words sentence for a share refusal: one per code (`share.name-exists`
 * → `shareDialog.error.name-exists`, with the Report's own message as `{reason}`);
 * the Report's message when the code has none. */
export const shareErrorText = (error) =>
  (error.code ? t(`shareDialog.error.${error.code.replace(/^share\./, '')}`, { reason: error.message }, error.message) : error.message);

const CHANGE = { border: 0, background: 'transparent', padding: 0, font: 'inherit', letterSpacing: 'inherit', color: 'var(--link)', cursor: 'pointer' };

/** D86 point 7: who shares, then Change (sign out, then the sign-in step).
 * The dialog shows "Sharing as @username", or "Signed in" for a kept sign-in
 * that is not resumed yet (the upload review, #530). */
export function Door43Account({ label, onChange, testId, style }) {
  return (
    <span data-testid={testId} style={style}>
      {label} · <button type="button" data-testid={`${testId}-change`} onClick={onChange} style={CHANGE}>{t('signIn.change')}</button>
    </span>
  );
}

/** The name Door43 accepts as a repository name (the adapter's rule). */
export const nameOk = (name) => /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name.trim());

const STEP_TITLES = {
  target: ['shareDialog.whereTitle', 'shareDialog.whereSubtitle'],
  check: ['shareDialog.checkTitle', 'shareDialog.checkSubtitle'],
  progress: ['shareDialog.progressTitle', 'shareDialog.progressSubtitle'],
  done: ['shareDialog.doneTitle', 'shareDialog.doneSubtitle'],
};
const UPLOAD_TITLES = {
  upload: ['uploadDialog.title', 'uploadDialog.subtitle'],
  progress: ['uploadDialog.progressTitle', 'shareDialog.progressSubtitle'],
  done: ['uploadDialog.doneTitle', 'shareDialog.doneSubtitle'],
};
/** A refusal that a second try cannot change: another device pushed. */
const NO_RETRY = ['share.non-fast-forward'];

/** Where the repository will be created, in words. */
const targetLabel = (sh, user) => (sh.target.kind === 'user' ? t('shareDialog.account', { user }) : sh.target.organization);

function TargetStep({ sh, user, actions }) {
  const pick = (target) => actions.patchSh({ target });
  return (
    <div data-testid="share-target" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <OptionCard data-testid="share-target-user" control="radio" selected={sh.target.kind === 'user'}
        title={t('shareDialog.account', { user })} description={t('shareDialog.accountDesc')} onClick={() => pick({ kind: 'user' })} />
      {sh.choices === null && !sh.choicesError && (
        <div style={{ padding: '10px 0' }} data-testid="share-orgs-loading"><Spinner label={t('shareDialog.orgsLoading')} /></div>
      )}
      {sh.choicesError && (
        <Callout tone="warn" role="alert" data-testid="share-orgs-error" style={{ overflowWrap: 'anywhere' }}>{t('shareDialog.orgsError')} {sh.choicesError}</Callout>
      )}
      {(sh.choices || []).map((org) => (
        // D84 point 3: an organization the user cannot create in is shown, cannot be chosen, and says why.
        <OptionCard key={org.organization} data-testid={`share-org-${org.organization}`} control="radio"
          selected={sh.target.kind === 'organization' && sh.target.organization === org.organization}
          disabled={!org.canCreateRepository} data-recommended={org.recommended ? '1' : '0'}
          title={org.fullName || org.organization} recommended={org.recommended} recommendedLabel={t('shareDialog.recommended')}
          description={org.canCreateRepository ? org.organization : t('shareDialog.orgCannot')}
          onClick={org.canCreateRepository ? () => pick({ kind: 'organization', organization: org.organization }) : undefined} />
      ))}
    </div>
  );
}

// D84 point 4: the books or the stories, no counts, no license, no private option; the whole project, always.
function SharedItems({ project, upload = false }) {
  const obs = project.flavor === 'textStories';
  const items = obs ? t('shareDialog.stories') : project.bookCodes.map((code) => bookName(code)).join(', ');
  const label = `${upload ? 'uploadDialog' : 'shareDialog'}.${obs ? 'storiesLabel' : 'booksLabel'}`;
  return (
    <div>
      <Text role="caption" tone="muted">{t(label)}</Text>
      <Text role="body" data-testid="share-items">{items}</Text>
    </div>
  );
}

function CheckStep({ sh, user, actions }) {
  return (
    <div data-testid="share-check" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Text role="body" data-testid="share-where">{t('shareDialog.where', { target: targetLabel(sh, user) })}</Text>
      <TextField id="sh-name" label={t('shareDialog.name')} value={sh.name} data-testid="share-name"
        hint={t('shareDialog.nameRule')} invalid={!!sh.name.trim() && !nameOk(sh.name)}
        onChange={(e) => actions.patchSh({ name: e.target.value, error: null })} />
      <SharedItems project={sh.project} />
    </div>
  );
}

/** #530: the review of an upload. The repository is the project's own `origin`
 * (the card's "Shared at" location), shown and not editable; the books or the
 * stories are a review, not a choice. */
function UploadStep({ sh, shared }) {
  return (
    <div data-testid="share-upload" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <Text role="caption" tone="muted">{t('uploadDialog.whereLabel')}</Text>
        <Text role="body" data-testid="share-where" style={{ overflowWrap: 'anywhere' }}>{shared ? locationOf(shared) : ''}</Text>
      </div>
      <SharedItems project={sh.project} upload />
    </div>
  );
}

function DoneStep({ sh, actions }) {
  const url = sh.report.facts.url;
  return (
    // `data-steps`: the progress lines that were shown, in order (the journey reads them here, after the run).
    <div data-testid="share-done" data-steps={sh.steps.join(',')} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* D84 point 5: "Others can read it on Door43." — receive stays Phase 2, so nothing about opening it in the app. */}
      <Text role="body" data-testid="share-done-text"><span role="status">{t(sh.mode === 'upload' ? 'uploadDialog.doneText' : 'shareDialog.doneText')}</span></Text>
      <Text role="strong" data-testid="share-url" style={{ overflowWrap: 'anywhere' }}>{url}</Text>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button variant="secondary" size="sm" onClick={actions.shareCopyLink} data-testid="share-copy">
          {sh.copied ? t('shareDialog.copied') : t('shareDialog.copyLink')}
        </Button>
        <Button size="sm" onClick={() => actions.openDoor43Page('repoLink', url)} data-testid="share-open">{t('shareDialog.openOnDoor43')}</Button>
      </div>
    </div>
  );
}

/** "Sharing as @username · Change" on the where-it-goes, check and upload
 * review steps (D86 point 7). A kept sign-in that is not resumed yet has no
 * username to show: "Signed in · Change" (D88 point 1: no identity is fetched). */
function SharingAs({ sh, user, notKept, actions }) {
  if (!['target', 'check', 'upload'].includes(sh.step)) return null;
  return (
    <div style={{ margin: '0 0 14px' }}>
      <Door43Account testId="share-account" label={user ? t('signIn.sharingAs', { user }) : t('signIn.kept')} onChange={() => actions.changeSignIn(sh.project)}
        style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-secondary)' }} />
      {/* #366: "Stay signed in" asked, and this computer has no keychain the app can use. */}
      {notKept && <Text role="caption" tone="muted" data-testid="signin-not-kept">{t('signIn.notKept')}</Text>}
    </div>
  );
}

/** #530: the footer of the upload review: Cancel and Upload changes; after a
 * refusal, Close and Try again (Close alone when a second try cannot change
 * the refusal). */
function UploadFooter({ sh, actions }) {
  const failed = !!sh.error;
  const retry = failed && !NO_RETRY.includes(sh.error.code);
  return (
    <>
      <Button variant="secondary" onClick={actions.closeModal} data-testid={failed ? 'share-close' : 'share-cancel'}>
        {failed ? t('common.close') : t('shareDialog.cancel')}
      </Button>
      {(!failed || retry) && (
        <Button onClick={() => actions.uploadChanges(sh.project)} disabled={sh.busy} data-testid="share-submit">
          {failed ? t('uploadDialog.retry') : t('uploadDialog.submit')}
        </Button>
      )}
    </>
  );
}

function Footer({ sh, actions }) {
  if (sh.step === 'target') {
    return (
      <>
        <Button variant="secondary" onClick={actions.closeModal} data-testid="share-cancel">{t('shareDialog.cancel')}</Button>
        <Button onClick={() => actions.shareStep('check')} disabled={sh.choices === null && !sh.choicesError} data-testid="share-next">{t('shareDialog.next')}</Button>
      </>
    );
  }
  if (sh.step === 'check') {
    return (
      <>
        <Button variant="secondary" onClick={() => actions.shareStep('target')} data-testid="share-back">{t('shareDialog.back')}</Button>
        <Button onClick={() => actions.shareRun(sh.project)} disabled={!nameOk(sh.name) || sh.busy} data-testid="share-submit">{t('shareDialog.submit')}</Button>
      </>
    );
  }
  if (sh.step === 'upload') return <UploadFooter sh={sh} actions={actions} />;
  return <Button onClick={actions.closeModal} data-testid="share-close">{t('common.close')}</Button>;
}

/** One progress line (D84 point 5); `data-steps` keeps the lines shown so far for the journey. */
function ProgressStep({ sh }) {
  const current = sh.steps[sh.steps.length - 1];
  return (
    <div role="status" style={{ padding: '26px 0 30px', display: 'flex', justifyContent: 'center' }} data-testid="share-progress" data-steps={sh.steps.join(',')}>
      <Spinner label={current ? t(current === 'create' ? 'shareDialog.creating' : 'shareDialog.pushing') : t('shareDialog.preparing')} />
    </div>
  );
}

export default function ShareDialog() {
  const { s, actions } = useApp();
  const sh = s.sh;
  if (s.modal !== 'share' || !sh) return null;
  const user = s.door43User || '';
  const upload = sh.mode === 'upload';
  const [titleKey, subtitleKey] = (upload ? UPLOAD_TITLES : STEP_TITLES)[sh.step];
  // No footer and no close while the run is in progress.
  const running = sh.step === 'progress';
  return (
    <Modal data-testid="share-dialog" title={t(titleKey)} subtitle={t(subtitleKey, { name: sh.project.name })}
      closeLabel={t('common.close')} onClose={running ? undefined : actions.closeModal}
      footer={running ? null : <Footer sh={sh} actions={actions} />}>
      <SharingAs sh={sh} user={user} notKept={s.door43NotKept} actions={actions} />
      {sh.step === 'target' && <TargetStep sh={sh} user={user} actions={actions} />}
      {sh.step === 'check' && <CheckStep sh={sh} user={user} actions={actions} />}
      {sh.step === 'upload' && <UploadStep sh={sh} shared={s.remoteByProject[sh.project.id]} />}
      {running && <ProgressStep sh={sh} />}
      {sh.step === 'done' && <DoneStep sh={sh} actions={actions} />}
      {sh.error && (
        <Callout tone="warn" role="alert" data-testid="share-error" data-code={sh.error.code || ''} style={{ overflowWrap: 'anywhere' }}>
          <strong>{t(upload ? 'uploadDialog.failed' : 'shareDialog.failed')}</strong> {shareErrorText(sh.error)}
        </Callout>
      )}
    </Modal>
  );
}
