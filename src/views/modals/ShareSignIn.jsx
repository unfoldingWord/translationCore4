// The sign-in step of the first share (issue #203; D79 point 13, D84 points 6
// and 7; the Interface section of epic #372). One dialog: the Door43 username
// or email, the password, "Stay signed in on this computer", and the server
// the app signs in to. On the first share of the installation it also asks the
// name and the email that git records (D7), with the exposure notice; later it
// shows them with a Change link, the only place they change. The form lives in
// the state layer's `si`; the token never enters React state (session.ts).
// This file names no Door43 host (test/noBypass.test.ts): the host shown is
// the adapter's own server.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, TextField, Checkbox, Button, Callout, Overline } from '../../ds/index.js';

const NOTE = { fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0 };

function Identity({ si, actions }) {
  const asks = !si.identity || si.changing;
  if (!asks) {
    return (
      <p style={NOTE} data-testid="signin-identity">
        {t('signIn.identityShown', { name: si.identity.name, email: si.identity.email })}{' '}
        <Button variant="ghost" size="sm" onClick={actions.changeIdentity} data-testid="signin-change"
          style={{ padding: '0 4px', fontSize: 'var(--fs-caption-lg)' }}>
          {t('signIn.change')}
        </Button>
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="signin-identity-form">
      <Overline as="span">{t('signIn.identityTitle')}</Overline>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <TextField id="si-name" label={t('signIn.name')} value={si.name} autoComplete="name"
          onChange={(e) => actions.patchSi({ name: e.target.value })} />
        <TextField id="si-email" label={t('signIn.email')} value={si.email} type="email" autoComplete="email"
          onChange={(e) => actions.patchSi({ email: e.target.value })} />
      </div>
      {/* D7: the identity exposure notice, shown where the identity is given. */}
      <p style={NOTE} data-testid="signin-notice">{t('signIn.notice')}</p>
    </div>
  );
}

export default function ShareSignIn() {
  const { s, actions } = useApp();
  const si = s.si;
  if (s.modal !== 'signIn' || !si) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    actions.submitSignIn();
  };

  return (
    <Modal data-testid="share-signin" title={t('signIn.title')} subtitle={t('signIn.subtitle')}
      closeLabel={t('common.close')} onClose={actions.closeModal}
      footer={<>
        <Button variant="secondary" onClick={actions.closeModal} data-testid="signin-cancel">{t('signIn.cancel')}</Button>
        <Button onClick={submit} disabled={si.busy} data-testid="signin-submit">
          {si.busy ? t('signIn.busy') : t('signIn.submit')}
        </Button>
      </>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* The server comes from the adapter (dcsServer, #120): QA in a development build. */}
        <p style={NOTE} data-testid="signin-server">{t('signIn.server', { host: si.server })}</p>
        {si.reason && (
          <p style={NOTE} data-testid="signin-reason">{t(`signIn.reason.${si.reason}`)}</p>
        )}
        <TextField id="si-login" label={t('signIn.login')} value={si.login} autoComplete="username"
          onChange={(e) => actions.patchSi({ login: e.target.value })} />
        <TextField id="si-password" label={t('signIn.password')} value={si.password} type="password"
          autoComplete="current-password" onChange={(e) => actions.patchSi({ password: e.target.value })} />
        <Checkbox label={t('signIn.stay')} checked={si.stay} data-testid="signin-stay"
          onChange={(e) => actions.patchSi({ stay: !!e.target.checked })} />
        <Identity si={si} actions={actions} />
        {si.error && (
          <Callout tone="warn" role="alert" data-testid="signin-error" data-code={si.error.code || ''}
            style={{ overflowWrap: 'anywhere' }}>
            <strong>{t('signIn.failed')}</strong>{' '}
            {/* The plain-words sentence per code (`share.auth-failed` → `signIn.error.auth-failed`); the Report's own message otherwise. */}
            {si.error.code ? t(`signIn.error.${si.error.code.replace(/^share\./, '')}`, undefined, si.error.message) : si.error.message}
          </Callout>
        )}
        {/* Enter submits the form; the visible action is the footer button. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
