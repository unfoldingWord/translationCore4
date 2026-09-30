// D86 (#486): the Internet / Local status beside "Saved", and its two dialogs.
// The words say what tC4 may do, not whether the computer is connected. The
// label is the gate the server reports (state `netEnabled`), never the value
// the user asked for. A click only opens a dialog; the change is its button.
import React from 'react';
import { useApp } from '../state.jsx';
import { internetBusy } from '../data/internet';
import { t } from '../i18n';
import { Modal, Button } from '../ds/index.js';

const LABEL = { fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-heavy)', display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,.66)' };
const RESET = { border: 0, background: 'transparent', padding: 0, font: 'inherit', letterSpacing: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6 };
const BODY = { margin: 0, fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' };

export default function NetStatus() {
  const { s, actions } = useApp();
  const allowed = !!s.netEnabled;
  const busy = !allowed ? false : internetBusy(s);
  const disabled = !!s.netChanging || busy;
  const hint = busy ? t('net.busyHint') : t(allowed ? 'net.internetHint' : 'net.localHint');
  const state = s.netChanging ? 'turning' : allowed ? 'internet' : 'local';
  return (
    <div style={LABEL}>
      <button type="button" data-testid="net-status" data-state={state} title={hint} aria-label={hint}
        disabled={disabled} onClick={() => actions.askInternet(!allowed)}
        style={{ ...RESET, cursor: disabled ? 'default' : 'pointer' }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, flex: 'none', borderRadius: 'var(--radius-pill)',
          background: allowed ? 'var(--uw-inspire)' : 'rgba(255,255,255,.35)' }} />
        {s.netChanging ? t('net.turning') : t(allowed ? 'net.internet' : 'net.local')}
      </button>
      {s.netError && <span role="alert" data-testid="net-error">· {t(s.netError)}</span>}
    </div>
  );
}

/** Mounted with the other dialogs in App.jsx, outside the top bar, so it does
 * not take the bar's text color. */
export function NetDialog() {
  const { s, actions } = useApp();
  if (!s.netAsk) return null;
  const toLocal = s.netAsk === 'local';
  const text = toLocal
    ? { title: t('net.toLocal.title'), body: t('net.toLocal.body'), confirm: t('net.toLocal.confirm') }
    : { title: t('net.allow.title'), body: t('net.allow.body'), confirm: t('net.allow.confirm') };
  return (
    <Modal data-testid={toLocal ? 'net-to-local' : 'net-allow'} width={440} title={text.title}
      closeLabel={t('common.close')} onClose={actions.cancelInternet}
      footer={<>
        <Button variant="secondary" onClick={actions.cancelInternet} data-testid="net-cancel">{t('net.cancel')}</Button>
        <Button onClick={() => actions.setInternet(!toLocal)} data-testid="net-confirm">{text.confirm}</Button>
      </>}>
      <p style={BODY}>{text.body}</p>
    </Modal>
  );
}
