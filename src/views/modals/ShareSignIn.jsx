// The sign-in step of the first share (issue #203; D79 point 13, D84 point 6,
// D85; the Interface section of epic #372). One dialog: the Door43 username or
// email, the password, "Stay signed in on this computer", the server the app
// signs in to, and the author notice: the platform signs each shared change
// with the computer's account name, and Door43 shows it (PLATFORM-NOTES #47).
// Nothing is asked twice by design and nothing but the kept token is stored
// (D85): no name, no email, no login. The form lives in the state layer's
// `si`; the token never enters React state (session.ts). This file names no
// Door43 host (test/noBypass.test.ts): the host shown is the adapter's own
// server.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, TextField, Checkbox, Button, Callout } from '../../ds/index.js';

const NOTE = { fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0 };

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
        <TextField id="si-login" label={t('signIn.login')} value={si.login} autoComplete="username"
          onChange={(e) => actions.patchSi({ login: e.target.value })} />
        <TextField id="si-password" label={t('signIn.password')} value={si.password} type="password"
          autoComplete="current-password" onChange={(e) => actions.patchSi({ password: e.target.value })} />
        <Checkbox label={t('signIn.stay')} checked={si.stay} data-testid="signin-stay"
          onChange={(e) => actions.patchSi({ stay: !!e.target.checked })} />
        {/* The one line that says why a password is asked: without Stay signed in, one app session. */}
        <p style={NOTE} data-testid="signin-reason">{t('signIn.sessionNote')}</p>
        {/* D85: the author notice, in place of the D7 name-and-email notice. */}
        <p style={NOTE} data-testid="signin-notice">{t('signIn.notice')}</p>
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
