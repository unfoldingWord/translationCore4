// The first-share dialog (issue #362; D84 points 3, 4 and 5; the Interface
// section of epic #372), reached from Share beside Settings on a Home card once
// a token is held (the sign-in step, ShareSignIn.jsx, runs first when none is).
// Three steps in one dialog: where it goes (the user's own account, or an
// organization the user can create repositories in; one marked Recommended) →
// check what will be shared (the repository name, editable, and the books or
// stories) → one progress line ("Creating the repository…", "Pushing…") → the
// end: the URL, Copy link, Open on Door43, "Others can read it on Door43."
// A refusal returns to the check step with the Report's message and code.
// Bound to the state layer's `sh` (startShare / shareStep / shareRun /
// shareCopyLink). No Door43 call and no fetch happens here (test/noBypass.test.ts):
// the operation is src/data/share/shareOperation.ts, the adapter door43Api.ts.
import React from 'react';
import { useApp } from '../../state.jsx';
import { bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Button, OptionCard, TextField, Spinner, Callout, Text } from '../../ds/index.js';

/** The plain-words sentence for a share refusal: one per code (`share.name-exists`
 * → `shareDialog.error.name-exists`, with the Report's own message as `{reason}`);
 * the Report's message when the code has none. Home's card uses it too. */
export const shareErrorText = (error) =>
  (error.code ? t(`shareDialog.error.${error.code.replace(/^share\./, '')}`, { reason: error.message }, error.message) : error.message);

const CHANGE = { border: 0, background: 'transparent', padding: 0, font: 'inherit', letterSpacing: 'inherit', color: 'var(--link)', cursor: 'pointer' };

/** D86 point 7: who shares, then Change (sign out, then the sign-in step).
 * The share dialog shows "Sharing as @username"; a shared card "as @username",
 * or "Signed in" for a kept sign-in that is not resumed yet. */
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

function CheckStep({ sh, user, actions }) {
  const project = sh.project;
  const obs = project.flavor === 'textStories';
  // D84 point 4: the books or the stories, no counts, no license, no private option; the whole project, always.
  const items = obs ? t('shareDialog.stories') : project.bookCodes.map((code) => bookName(code)).join(', ');
  return (
    <div data-testid="share-check" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Text role="body" data-testid="share-where">{t('shareDialog.where', { target: targetLabel(sh, user) })}</Text>
      <TextField id="sh-name" label={t('shareDialog.name')} value={sh.name} data-testid="share-name"
        hint={t('shareDialog.nameRule')} invalid={!!sh.name.trim() && !nameOk(sh.name)}
        onChange={(e) => actions.patchSh({ name: e.target.value, error: null })} />
      <div>
        <Text role="caption" tone="muted">{obs ? t('shareDialog.storiesLabel') : t('shareDialog.booksLabel')}</Text>
        <Text role="body" data-testid="share-items">{items}</Text>
      </div>
    </div>
  );
}

function DoneStep({ sh, actions }) {
  const url = sh.report.facts.url;
  return (
    // `data-steps`: the progress lines that were shown, in order (the journey reads them here, after the run).
    <div data-testid="share-done" data-steps={sh.steps.join(',')} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* D84 point 5: "Others can read it on Door43." — receive stays Phase 2, so nothing about opening it in the app. */}
      <Text role="body" data-testid="share-done-text">{t('shareDialog.doneText')}</Text>
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

/** "Sharing as @username · Change" on the where-it-goes and check steps (D86 point 7). */
function SharingAs({ sh, user, notKept, actions }) {
  if (sh.step !== 'target' && sh.step !== 'check') return null;
  return (
    <div style={{ margin: '0 0 14px' }}>
      <Door43Account testId="share-account" label={t('signIn.sharingAs', { user })} onChange={() => actions.changeSignIn(sh.project)}
        style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-secondary)' }} />
      {/* #366: "Stay signed in" asked, and this computer has no keychain the app can use. */}
      {notKept && <Text role="caption" tone="muted" data-testid="signin-not-kept">{t('signIn.notKept')}</Text>}
    </div>
  );
}

export default function ShareDialog() {
  const { s, actions } = useApp();
  const sh = s.sh;
  if (s.modal !== 'share' || !sh) return null;
  const user = s.door43User || '';
  const [titleKey, subtitleKey] = STEP_TITLES[sh.step];
  const footer = {
    target: (
      <>
        <Button variant="secondary" onClick={actions.closeModal} data-testid="share-cancel">{t('shareDialog.cancel')}</Button>
        <Button onClick={() => actions.shareStep('check')} disabled={sh.choices === null && !sh.choicesError} data-testid="share-next">{t('shareDialog.next')}</Button>
      </>
    ),
    check: (
      <>
        <Button variant="secondary" onClick={() => actions.shareStep('target')} data-testid="share-back">{t('shareDialog.back')}</Button>
        <Button onClick={() => actions.shareRun(sh.project)} disabled={!nameOk(sh.name) || sh.busy} data-testid="share-submit">{t('shareDialog.submit')}</Button>
      </>
    ),
    progress: null,
    done: <Button onClick={actions.closeModal} data-testid="share-close">{t('common.close')}</Button>,
  }[sh.step];
  const current = sh.steps[sh.steps.length - 1];
  return (
    <Modal data-testid="share-dialog" title={t(titleKey)} subtitle={t(subtitleKey, { name: sh.project.name })}
      closeLabel={t('common.close')} onClose={sh.step === 'progress' ? undefined : actions.closeModal} footer={footer}>
      <SharingAs sh={sh} user={user} notKept={s.door43NotKept} actions={actions} />
      {sh.step === 'target' && <TargetStep sh={sh} user={user} actions={actions} />}
      {sh.step === 'check' && <CheckStep sh={sh} user={user} actions={actions} />}
      {sh.step === 'progress' && (
        // One progress line (D84 point 5); `data-steps` keeps the lines shown so far for the journey.
        <div style={{ padding: '26px 0 30px', display: 'flex', justifyContent: 'center' }} data-testid="share-progress" data-steps={sh.steps.join(',')}>
          <Spinner label={current ? t(current === 'create' ? 'shareDialog.creating' : 'shareDialog.pushing') : t('shareDialog.preparing')} />
        </div>
      )}
      {sh.step === 'done' && <DoneStep sh={sh} actions={actions} />}
      {sh.error && (
        <Callout tone="warn" role="alert" data-testid="share-error" data-code={sh.error.code || ''} style={{ overflowWrap: 'anywhere' }}>
          <strong>{t('shareDialog.failed')}</strong> {shareErrorText(sh.error)}
        </Callout>
      )}
    </Modal>
  );
}
