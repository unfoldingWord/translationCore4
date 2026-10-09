// D88 (#514): the Door43 account menu at the right of the top bar, on Home and
// in a project. D95 (#559): the button shows while the internet is on, the
// menu's switch turns it off, and the "Turn on the internet?" dialog opens for
// a step that needs the internet while it is off. Opening the menu sends
// nothing: its account row shows only what this computer already knows (the
// signed-in login, or that the keychain holds a token, D85).
import React, { useEffect, useRef, useState } from 'react';
import { useApp, door43 } from '../state.jsx';
import { APP_COMMIT, APP_VERSION, COPYRIGHT_LINE, GPL_TEXT, LICENSE_TEXT } from '../data/about';
import { LOCALES, t } from '../i18n';
import { Layer } from '../ds/components/primitives/Layer.jsx';
import { Surface } from '../ds/components/primitives/Surface.jsx';
import { Action } from '../ds/components/primitives/Action.jsx';
import { Rule } from '../ds/components/primitives/Rule.jsx';
import { Modal, Button, Select, Callout } from '../ds/index.js';

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

/** The account button. D95: while the internet is on it carries a dot, and its
 * tooltip says so; the menu's switch turns the internet off. */
function Trigger({ state, user, label, online, open, onClick }) {
  const title = online ? t('net.on.tooltip') : label;
  return (
    <>
      <button type="button" data-testid="account-menu" data-state={state} data-internet={online ? 'on' : 'off'}
        aria-haspopup="menu" aria-expanded={open} aria-label={online ? `${label}. ${title}` : label} title={title} onClick={onClick}
        style={{ ...TRIGGER, ...(user
          ? { background: 'var(--uw-inspire)', border: '2px solid rgba(255,255,255,.9)', fontWeight: 900, fontSize: 12.5 }
          : { background: 'rgba(255,255,255,.12)', border: '1.5px solid rgba(255,255,255,.55)' }),
        boxShadow: open ? '0 0 0 3px rgba(49,173,227,.45)' : 'none' }}>
        {user ? user.slice(0, 2).toUpperCase() : <Person />}
      </button>
      {online && <span data-testid="internet-indicator" aria-hidden="true" style={{ position: 'absolute', right: -2, top: -2, width: 11, height: 11,
        borderRadius: 'var(--radius-pill)', background: 'var(--uw-inspire)', border: '2px solid #fff', boxSizing: 'border-box', pointerEvents: 'none' }} />}
    </>
  );
}

export default function AccountMenu() {
  const { s, actions } = useApp();
  const [open, setOpen] = useState(false);
  // #520: null, 'about', 'license', or 'back' (About again, after License closed).
  const [about, setAbout] = useState(null);
  // #522: the App language dialog is open.
  const [language, setLanguage] = useState(false);
  // #519: the Help and guides panel is open.
  const [help, setHelp] = useState(false);
  const ref = useRef(null);
  const user = s.door43User;
  const saved = !user && s.door43Kept;
  const state = user ? 'in' : saved ? 'saved' : 'out';
  const label = t(`account.label.${state}`, { user });
  const online = s.internetOn;
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
      <span ref={ref} style={{ display: 'inline-flex', position: 'relative' }}>
        <Trigger state={state} user={user} label={label} online={online} open={open} onClick={() => setOpen(!open)} />
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
          {/* A menu row that stays open: the switch changes the internet state only (D95). */}
          <Row testId="account-internet" role="menuitemcheckbox" checked={online} title={t('account.internet')}
            sub={t(online ? 'account.internetOn' : 'account.internetOff')} end={<Switch on={online} />}
            onClick={() => actions.setInternet(!online)} />
          {/* #519: the help pages of this build, below the internet switch. */}
          <Row testId="account-help" title={t('account.help')} onClick={choose(() => setHelp(true))} />
          {/* #522: the app language, below Help and guides and before About. */}
          <Row testId="account-language" title={t('account.language')} sub={LOCALES.find((l) => l.id === s.appLocale)?.label}
            onClick={choose(() => setLanguage(true))} />
          {/* #521: the Feedback dialog of #378; opening it sends nothing. */}
          <Row testId="account-report" title={t('account.report')} onClick={choose(actions.reportProblem)} />
          <Row testId="account-about" title={t('account.about')} onClick={choose(() => setAbout('about'))} />
          {state !== 'out' && <>
            <Rule style={{ margin: '5px 4px' }} />
            <Row testId="account-sign-out" title={t('account.signOut')} onClick={choose(actions.signOut)} />
          </>}
          </div>
        </Surface>
      </Layer>
      {/* The dialogs render inside the dark top bar: data-on gives them the light ground's colours (ds/tokens/context.css). */}
      {language && <span data-on="light" style={{ display: 'contents' }}>
        <AppLanguageDialog applied={s.appLocale} actions={actions} onClose={() => {
          setLanguage(false);
          ref.current?.querySelector('button')?.focus();
        }} />
      </span>}
      {help && <span data-on="light" style={{ display: 'contents' }}>
        <HelpPanel openLink={(url) => actions.openDoor43Page('helpLink', url)} onClose={() => {
          setHelp(false);
          ref.current?.querySelector('button')?.focus();
        }} />
      </span>}
      {about && <span data-on="light" style={{ display: 'contents' }}>
        {about === 'license'
          ? <LicenseDialog onClose={() => setAbout('back')} />
          : <AboutDialog focusRead={about === 'back'} onRead={() => setAbout('license')} onClose={() => {
            setAbout(null);
            ref.current?.querySelector('button')?.focus();
          }} />}
      </span>}
    </>
  );
}

/** #519: the help pages of this build (`public/help/`, from the tc-website commit that
 * scripts/fetch-help.mjs pins), in a same-origin frame that fills the window. A new
 * window would open in the system browser and skip the internet switch, so the pages
 * stay here. A link to another origin does not open in the frame: it is the internet
 * task `helpLink`, which opens the browser. Escape in the frame closes the panel too. */
function HelpPanel({ openLink, onClose }) {
  const frame = useRef(null);
  // Each page is a new document in the frame. Watch each one before it is first
  // painted, so no click can reach an unwatched link: the frame's load event waits for
  // every image. A same-origin frame shares this window's event loop, so a check on
  // every animation frame runs before the new page's first paint.
  useEffect(() => {
    let seen = null;
    let tick = 0;
    const watch = () => {
      tick = requestAnimationFrame(watch);
      const doc = frame.current?.contentDocument;
      if (!doc || doc === seen) return;
      seen = doc;
      const onLink = (e) => {
        const a = e.target.closest?.('a[href]');
        if (!a) return;
        const url = new URL(a.href);
        if (url.origin === window.location.origin) return;
        // auxclick is the middle button here; the right button opens a context menu, not the link.
        if (e.type === 'auxclick' && e.button !== 1) return;
        e.preventDefault();
        if (/^https?:$/.test(url.protocol)) openLink(url.href);
      };
      doc.addEventListener('click', onLink, true);
      doc.addEventListener('auxclick', onLink, true);
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') onClose();
      });
    };
    watch();
    return () => cancelAnimationFrame(tick);
  }, []); // on mount only: openLink and onClose call a stable action and setters
  return (
    <Layer open level="overlay" placement="end" role="dialog" label={t('account.help')} dismiss="escape" trapFocus lockScroll
      onDismiss={onClose} style={{ width: '100vw' }} data-testid="help-panel">
      <Surface fill="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ flex: 1, fontSize: 'var(--fs-ui)', color: 'var(--text-body)' }}>{t('account.help')}</strong>
          <Action weight="soft" iconOnly shape="square" size="sm" tone="neutral" title={t('common.close')} aria-label={t('common.close')}
            onClick={onClose} data-testid="help-close" style={{ borderRadius: 'var(--radius-pill)' }}>✕</Action>
        </div>
        <iframe ref={frame} title={t('account.help')} src={`${import.meta.env.BASE_URL}help/index.html`} tabIndex={0}
          data-testid="help-frame" style={{ flex: 1, width: '100%', border: 0 }} />
      </Surface>
    </Layer>
  );
}

const LICENSE_PRE = { ...BODY, font: 'inherit', fontSize: 'var(--fs-ui-sm)', whiteSpace: 'pre-wrap' };

/** #520: the version and the commit of the running build, the copyright line and
 * the license name. The build reads every value (src/data/about.ts), so opening
 * it sends no request. */
function AboutDialog({ focusRead, onRead, onClose }) {
  const read = useRef(null);
  useEffect(() => {
    if (!focusRead) return undefined;
    // Back from License: the focus returns to "Read the license". The Layer puts
    // it on its first control over its first frames; hold it here until it settles.
    let frame = 0;
    const hold = (tries) => {
      read.current?.focus();
      if (tries > 0) frame = requestAnimationFrame(() => hold(tries - 1));
    };
    hold(10);
    return () => cancelAnimationFrame(frame);
  }, [focusRead]);
  return (
    <Modal data-testid="about-dialog" width={460} title={t('account.about')} closeLabel={t('common.close')} onClose={onClose}
      footer={<Button onClick={onClose} data-testid="about-close">{t('common.close')}</Button>}>
      <p style={{ ...BODY, color: 'var(--text-body)' }}>
        {t('about.version')} <strong data-testid="about-version">{APP_VERSION} ({APP_COMMIT})</strong>
      </p>
      <p style={BODY} data-testid="about-copyright">{COPYRIGHT_LINE}</p>
      <p style={BODY} data-testid="about-license-name">{t('about.licenseName')}</p>
      <div ref={(el) => { read.current = el?.querySelector('button') ?? null; }}>
        <Button variant="secondary" onClick={onRead} data-testid="about-read-license">{t('about.readLicense')}</Button>
      </div>
    </Modal>
  );
}

/** #520: the LICENSE notice, then the full GNU GPL version 2, in one region that
 * the keyboard can reach and scroll. Closing it returns to About. */
function LicenseDialog({ onClose }) {
  return (
    <Modal data-testid="license-dialog" width={640} title={t('about.license')} closeLabel={t('common.close')} onClose={onClose}
      footer={<Button onClick={onClose} data-testid="license-close">{t('common.close')}</Button>}>
      <div role="region" aria-label={t('about.licenseText')} tabIndex={0} data-testid="license-text"
        style={{ maxHeight: '52vh', overflow: 'auto', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
        <pre data-testid="license-notice" style={{ ...LICENSE_PRE, margin: 0 }}>{LICENSE_TEXT}</pre>
        <pre data-testid="license-gpl" style={{ ...LICENSE_PRE, margin: '18px 0 0' }}>{GPL_TEXT}</pre>
      </div>
    </Modal>
  );
}

/** #522: App language. One select of the four installed catalogs, Apply and
 * Cancel. A selection previews the language across the whole app, this dialog
 * included; Apply saves it on this computer and closes after the write has
 * succeeded; Cancel, Escape, the close button and the scrim restore the applied
 * language and save nothing. A failed save keeps the preview and the dialog,
 * with an error; retry and Cancel are then available again. While the save is
 * pending, the select, Apply and Cancel are disabled, and the close button,
 * Escape and the scrim are withdrawn (`onClose` undefined, as the import and
 * share dialogs do while busy) (Q9).
 * The applied locale is captured when Apply starts: a later rollback uses the
 * value that was applied then, not one a race could leave. */
function AppLanguageDialog({ applied, actions, onClose }) {
  const [preview, setPreview] = useState(applied);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const locked = saving;
  // Opening the dialog is the user's selection of `applied`: from here on a
  // startup read of the saved choice that lands late changes nothing.
  useEffect(() => {
    actions.previewAppLocale(applied);
  }, []); // on mount only: `applied` changes only through this dialog's own Apply
  const select = (id) => {
    if (locked || id === preview) return;
    setPreview(id);
    setError(false);
    actions.previewAppLocale(id);
  };
  const cancel = () => {
    if (locked) return;
    actions.previewAppLocale(applied);
    onClose();
  };
  const apply = async () => {
    if (locked || preview === applied) return;
    const chosen = preview;
    setSaving(true);
    setError(false);
    try {
      await actions.applyAppLocale(chosen);
      onClose();
    } catch {
      setSaving(false);
      setError(true);
    }
  };
  return (
    <Modal data-testid="language-dialog" data-saving={saving ? 'true' : 'false'} width={420} title={t('language.title')}
      closeLabel={t('common.close')} onClose={locked ? undefined : cancel}
      footer={<>
        <Button variant="secondary" onClick={cancel} disabled={locked} data-testid="language-cancel">{t('language.cancel')}</Button>
        <Button onClick={apply} disabled={locked || preview === applied} data-testid="language-apply">{t('language.apply')}</Button>
      </>}>
      <p style={{ ...BODY, color: 'var(--text-body)' }}>{t('language.hint')}</p>
      <Select id="app-language" label={t('language.field')} value={preview} disabled={locked} data-testid="language-select"
        onChange={(e) => select(e.target.value)} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
      {error && <Callout tone="warn" role="alert" data-testid="language-error">{t('language.saveFailed')}</Callout>}
    </Modal>
  );
}

/** D95: "Turn on the internet?" — what the step does, and that the internet
 * stays on until the user turns it off or closes tC4. Mounted over every
 * other dialog, so a step that starts in Source texts or Share asks on top of
 * it. "tC4 could not use the internet" shows here too (D88 point 4). */
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
  const kind = s.netAsk.kind;
  return (
    <Modal key={kind} data-testid="net-ask" data-kind={kind} width={520} title={t('net.ask.title')}
      closeLabel={t('common.close')} onClose={actions.cancelInternet}
      footer={<>
        <Button variant="secondary" onClick={actions.cancelInternet} data-testid="net-cancel">{t('net.ask.notNow')}</Button>
        <Button onClick={actions.turnOnInternet} data-testid="net-confirm">{t('net.ask.turnOn')}</Button>
      </>}>
      <p style={{ ...BODY, color: 'var(--text-body)' }} data-testid="net-ask-reason">{t('net.ask.step', { what: t(`net.ask.${kind}`) })}</p>
      <p style={{ ...BODY, marginTop: 14 }}>{t('net.ask.until')}</p>
    </Modal>
  );
}
