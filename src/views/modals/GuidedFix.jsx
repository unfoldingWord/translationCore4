// The guided fix screen (#9, D72 point 6): a tool's preflight found the pinned
// resource missing on this machine, and this is the way forward — fetch the
// pinned version, re-pin to a version that is installed, or sideload it from a
// file. Design-native on the app's own components (D29: no pankosmia-rcl
// visuals); the fetch, re-pin and sideload paths are the repository's existing
// download, carry-over and install code behind the screen.
import React from 'react';
import { useApp } from '../../state.jsx';
import { bookName } from '../../data/bookNames';
import { t } from '../../i18n';
import { Modal, Button, Callout, Overline, OptionCard, DropZone } from '../../ds/index.js';

const repoName = (repoPath) => repoPath.split('/').pop();
const label = (pin) => `${repoName(pin.repoPath)} · ${pin.version ?? pin.sha.slice(0, 12)}`;
const mono = { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-tertiary)' };

/** Option 1 — download the pinned identity itself. Offline it says why and offers the switch. */
function FetchOption({ fix, online, actions }) {
  return (
    <section data-testid="fix-fetch" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Overline as="span">{t('fix.fetch.title')}</Overline>
      <p style={{ margin: 0, fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' }}>
        {online ? t('fix.fetch.body', { pin: label(fix.pin) }) : t('fix.offline')}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" data-testid="fix-fetch-go" disabled={!online || !!fix.busy} onClick={actions.fixFetch}>
          {fix.busy === 'fetch' ? t('upgrade.installing') : t('check.fix.download')}
        </Button>
        {!online && (
          <Button size="sm" variant="secondary" data-testid="fix-go-online" onClick={actions.goOnline} style={{ background: 'var(--uw-kindle)', color: 'var(--text-inverse)' }}>
            {t('sources.goOnline')}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Option 2 — move the pin to a version of the same repo this machine holds.
 * Confirmation, with the D36 carry-over counts, follows in the UpgradeSet dialogue. */
function RepinOption({ fix, actions }) {
  return (
    <section data-testid="fix-repin" data-candidates={fix.candidates.length} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Overline as="span">{t('fix.repin.title')}</Overline>
      <p style={{ margin: 0, fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' }}>
        {fix.candidates.length ? t('fix.repin.body') : t('fix.repin.none', { repo: repoName(fix.pin.repoPath) })}
      </p>
      {fix.candidates.map((c) => (
        <OptionCard key={c.sha} onClick={fix.busy ? undefined : () => actions.fixRepin(c)} data-testid={`fix-repin-${c.sha.slice(0, 12)}`}
          title={label(c)} meta={t('fix.repin.installed')} description={<span style={mono}>{c.sha}</span>} />
      ))}
    </section>
  );
}

/** Option 3 — a Scripture Burrito zip from a file, verified against the pin before install. */
function SideloadOption({ fix, actions }) {
  const inputRef = React.useRef(null);
  const onFile = (file) => { if (file) actions.fixSideload(file); };
  return (
    <section data-testid="fix-sideload" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Overline as="span">{t('fix.sideload.title')}</Overline>
      <p style={{ margin: 0, fontSize: 'var(--fs-ui-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)' }}>
        {t('fix.sideload.body', { pin: label(fix.pin), sha: fix.pin.sha.slice(0, 12) })}
      </p>
      <input ref={inputRef} type="file" accept=".zip,application/zip" data-testid="fix-sideload-file" hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <DropZone title={fix.busy === 'sideload' ? t('fix.sideload.reading', { name: '' }) : t('fix.sideload.drop')} hint={t('fix.sideload.hint')}
        data-testid="fix-sideload-drop" disabled={!!fix.busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); }} />
    </section>
  );
}

export default function GuidedFix() {
  const { s, actions } = useApp();
  const fix = s.fix;
  if (s.modal !== 'fix' || !fix) return null;
  return (
    <Modal width={620} data-testid="guided-fix" title={t('fix.title', { tool: t(`check.tool.${fix.tool}`) })}
      subtitle={t('fix.subtitle', { pin: label(fix.pin), book: bookName(s.book ?? '') })}
      closeLabel={t('common.close')} onClose={actions.closeModal}
      footer={<Button variant="secondary" onClick={actions.closeModal} data-testid="fix-close">{t('common.close')}</Button>}>
      <p data-testid="fix-pin" style={{ ...mono, margin: 0 }}>{fix.pin.repoPath} · {fix.pin.sha}</p>
      {fix.progress && <p data-testid="fix-progress" style={{ margin: 0, fontSize: 'var(--fs-caption-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }}>{fix.progress}</p>}
      {fix.error && <Callout tone="warn" role="alert" data-testid="fix-error" style={{ overflowWrap: 'anywhere' }}>{fix.error}</Callout>}
      <FetchOption fix={fix} online={s.netEnabled} actions={actions} />
      <RepinOption fix={fix} actions={actions} />
      <SideloadOption fix={fix} actions={actions} />
    </Modal>
  );
}
