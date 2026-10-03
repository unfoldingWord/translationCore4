// D88 (#514): the Door43 account menu at the right of the top bar, on Home and
// in a project, and the "Use the internet?" dialog every internet task opens
// first while "Ask before using the internet" is on. Opening the menu sends
// nothing: its account row shows only what this computer already knows (the
// signed-in login, or that the keychain holds a token, D85).
import React, { useEffect, useRef, useState } from 'react';
import { useApp, door43 } from '../state.jsx';
import { APP_VERSION, LICENSE_TEXT } from '../data/about';
import { t } from '../i18n';
import { Layer } from '../ds/components/primitives/Layer.jsx';
import { Surface } from '../ds/components/primitives/Surface.jsx';
import { Action } from '../ds/components/primitives/Action.jsx';
import { Rule } from '../ds/components/primitives/Rule.jsx';
import { Modal, Button, Checkbox } from '../ds/index.js';

const TRIGGER = {
  width: 34, height: 34, padding: 0, borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer', color: '#fff', font: 'inherit',
};
const SUB = { fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'normal' };
const BODY = { margin: 0, fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' };

const Person = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

/** A two-line menu row: the action, and one line that says what it does. */
function Row({ title, sub, onClick, testId, role = 'menuitem', checked, end }) {
  return (
    <Action weight="row" role={role} aria-checked={checked} data-testid={testId} onClick={onClick}
      style={{ padding: '8px 10px', borderRadius: 8, width: '100%' }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 230 }}>
        <span>{title}</span>
        {sub && <span style={SUB}>{sub}</span>}
      </span>
      {end}
    </Action>
  );
}

const Switch = ({ on }) => (
  <span aria-hidden="true" style={{ width: 32, height: 18, padding: 2, borderRadius: 'var(--radius-pill)', flex: 'none', boxSizing: 'border-box',
    display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', background: on ? 'var(--uw-inspire)' : 'var(--border-strong)' }}>
    <span style={{ width: 14, height: 14, borderRadius: 'var(--radius-pill)', background: '#fff' }} />
  </span>
);

export default function AccountMenu() {
  const { s, actions } = useApp();
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const ref = useRef(null);
  const user = s.door43User;
  const saved = !user && s.door43Kept;
  const state = user ? 'in' : saved ? 'saved' : 'out';
  const label = t(`account.label.${state}`, { user });
  const choose = (run) => () => {
    setOpen(false);
    run();
  };
  // The menu keyboard contract (AC 1): the first row takes focus on open, the
  // arrows, Home and End move between rows, and Tab leaves the menu. Escape
  // and the focus return to the trigger are the Layer's.
  const panel = useRef(null);
  const rows = () => [...(panel.current?.querySelectorAll('[role^="menuitem"]') ?? [])];
  useEffect(() => {
    if (!open) return undefined;
    // The Layer settles over its first frames and can hand focus back to the
    // trigger; keep the first row focused until it has settled.
    let frame = 0;
    const focusFirst = (tries) => {
      if (!panel.current?.contains(document.activeElement)) rows()[0]?.focus();
      if (tries > 0) frame = requestAnimationFrame(() => focusFirst(tries - 1));
    };
    focusFirst(10);
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const onKeyDown = (e) => {
    const list = rows();
    const i = list.indexOf(document.activeElement);
    const target = { ArrowDown: (i + 1) % list.length, ArrowUp: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key];
    if (e.key === 'Tab') setOpen(false);
    if (target === undefined || !list.length) return;
    e.preventDefault();
    list[target].focus();
  };
  return (
    <>
      <span ref={ref} style={{ display: 'inline-flex' }}>
        <button type="button" data-testid="account-menu" data-state={state} aria-haspopup="menu" aria-expanded={open}
          aria-label={label} title={label} onClick={() => setOpen(!open)}
          style={{ ...TRIGGER, ...(user
            ? { background: 'var(--uw-inspire)', border: '2px solid rgba(255,255,255,.9)', fontWeight: 900, fontSize: 12.5 }
            : { background: 'rgba(255,255,255,.12)', border: '1.5px solid rgba(255,255,255,.55)' }),
          boxShadow: open ? '0 0 0 3px rgba(49,173,227,.45)' : 'none' }}>
          {user ? user.slice(0, 2).toUpperCase() : <Person />}
        </button>
      </span>
      <Layer open={open} level="popover" placement="anchor" anchorTo={ref} align="end"
        role="menu" label={label} dismiss="outside escape" onDismiss={() => setOpen(false)}>
        <Surface fill="card" border="line" radius="lg" elevation="hover" pad={6} data-testid="account-menu-panel">
          {/* The panel renders inside the dark top bar, so its rows would take the
            * bar's white --fg; the card's own colours are set here. */}
          <div ref={panel} onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', gap: 1, color: 'var(--text-body)',
            '--fg': 'var(--text-body)', '--fg-muted': 'var(--text-secondary)', '--line': 'var(--border)' }}>
          {user && <Row testId="account-page" title={`@${user}`} sub={t('account.openPage')}
            onClick={choose(() => actions.openDoor43Page('profile', `${door43.server}/${encodeURIComponent(user)}`))} />}
          {saved && <Row testId="account-check" title={t('account.saved')} sub={t('account.savedCheck')}
            onClick={choose(actions.checkSavedSignIn)} />}
          {state === 'out' && <Row testId="account-sign-in" title={t('account.signIn')} sub={t('account.signInHint')}
            onClick={choose(() => actions.openSignIn())} />}
          {s.accountError && <p role="alert" data-testid="account-error" style={{ ...SUB, margin: '2px 10px 6px', maxWidth: 260 }}>{t(s.accountError)}</p>}
          <Rule style={{ margin: '5px 4px' }} />
          {/* A menu row that stays open: the switch changes the preference only. */}
          <Row testId="account-ask" role="menuitemcheckbox" checked={s.askInternet} title={t('account.ask')}
            sub={t(s.askInternet ? 'account.askOn' : 'account.askOff')} end={<Switch on={s.askInternet} />}
            onClick={() => actions.setAskInternet(!s.askInternet)} />
          <Row testId="account-about" title={t('account.about')} onClick={choose(() => setAbout(true))} />
          {state !== 'out' && <>
            <Rule style={{ margin: '5px 4px' }} />
            <Row testId="account-sign-out" title={t('account.signOut')} onClick={choose(actions.signOut)} />
          </>}
          </div>
        </Surface>
      </Layer>
      {/* The dialog renders inside the dark top bar: data-on gives it the light ground's colours (ds/tokens/context.css). */}
      {about && <span data-on="light" style={{ display: 'contents' }}>
        <AboutDialog onClose={() => {
          setAbout(false);
          ref.current?.querySelector('button')?.focus();
        }} />
      </span>}
    </>
  );
}

/** #520: the version of the running build and the license. Both are part of
 * the bundle (src/data/about.ts), so opening it sends no request. */
function AboutDialog({ onClose }) {
  return (
    <Modal data-testid="about-dialog" width={560} title={t('account.about')} closeLabel={t('common.close')} onClose={onClose}
      footer={<Button onClick={onClose} data-testid="about-close">{t('common.close')}</Button>}>
      <p style={{ ...BODY, color: 'var(--text-body)' }}>
        {t('about.version')} <strong data-testid="about-version">{APP_VERSION}</strong>
      </p>
      <div>
        <p style={{ ...BODY, fontWeight: 700, color: 'var(--text-body)' }}>{t('about.license')}</p>
        <pre data-testid="about-license" style={{ ...BODY, marginTop: 6, font: 'inherit', fontSize: 'var(--fs-ui-sm)', whiteSpace: 'pre-wrap' }}>{LICENSE_TEXT}</pre>
      </div>
    </Modal>
  );
}

/** D88: "Use the internet?" — what the task does, whom it contacts and what
 * leaves the computer. Mounted over every other dialog, so a task that starts
 * in Source texts or Share asks on top of it. */
export function InternetDialog() {
  const { s, actions } = useApp();
  if (s.netFailed) {
    return (
      <Modal data-testid="net-failed" width={460} title={t('net.failed.title')} closeLabel={t('common.close')} onClose={actions.closeNetFailed}
        footer={<Button onClick={actions.closeNetFailed} data-testid="net-failed-close">{t('net.failed.close')}</Button>}>
        <p role="alert" style={BODY}>{t('net.failed.body')}</p>
      </Modal>
    );
  }
  if (!s.netAsk) return null;
  return <Ask key={s.netAsk.kind} kind={s.netAsk.kind} actions={actions} />;
}

const ACTION_LABEL = { signIn: 'net.ask.signInAction', fix: 'net.ask.fixAction' };

function Ask({ kind, actions }) {
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Modal data-testid="net-ask" data-kind={kind} width={520} title={t('net.ask.title')}
      closeLabel={t('common.close')} onClose={actions.cancelInternet}
      footer={<>
        <Button variant="secondary" onClick={actions.cancelInternet} data-testid="net-cancel">{t('net.ask.cancel')}</Button>
        <Button onClick={() => actions.confirmInternet(dontAsk)} data-testid="net-confirm">{t(ACTION_LABEL[kind] ?? 'net.ask.continue')}</Button>
      </>}>
      <p style={{ ...BODY, color: 'var(--text-body)' }} data-testid="net-ask-reason">{t(`net.ask.${kind}`)}</p>
      <Checkbox label={t('net.ask.dontAsk')} checked={dontAsk} data-testid="net-dont-ask"
        onChange={(e) => setDontAsk(!!e.target.checked)} style={{ marginTop: 14 }} />
      <p style={{ ...BODY, marginTop: 14 }}>{t('net.ask.note')}</p>
    </Modal>
  );
}
