// "Open a project from Door43" (#677; layer 4 of epic #24; owner mockup
// 2026-10-13, artboards e and g). The fourth card of "Add a project" opens it.
// The repository is `owner/repository` or a link; the project name is the
// repository name until the user types one. A name in use shows under the name
// field (`open-door43.name-exists`); any other refusal shows in a warn Callout with its
// code: no project was added. The operation is openFromDoor43 (syncOperation.ts).
import React from 'react';
import { useApp, door43 } from '../../state.jsx';
import { t } from '../../i18n';
import { openDefaultName, openRepoPathOf, openSourceOf, repoPathInUse } from '../../data/share/syncOperation';
import { Modal, Field, Input, Button, Callout, Text } from '../../ds/index.js';

const NAME_IN_USE = 'open-door43.name-exists';
/** The body sentence of a refusal: one per code the open throws; `refused.other` for the clone failure and any error without a code. */
const REFUSAL_TEXT = {
  'sync.incoming-invalid': 'openDoor43.refused.invalid',
  'sync.obs-unsupported': 'openDoor43.refused.obs',
  'open-door43.no-journal': 'openDoor43.refused.noJournal',
  'sync.clone-path-exists': 'openDoor43.refused.clonePathExists',
  'opslog.not-loaded': 'openDoor43.refused.opsNotLoaded',
  'sync.offline': 'openDoor43.refused.offline',
  'sync.move-failed': 'openDoor43.refused.moveFailed',
};

/** The error under the project name: not a folder name, or a name in use. */
function nameErrorOf(od, projects) {
  const name = od.name.trim();
  if (!name) return undefined;
  const repoPath = openRepoPathOf(name);
  if (!repoPath) return t('openDoor43.nameBad');
  const inUse = od.error?.code === NAME_IN_USE || repoPathInUse((projects || []).map((p) => p.id), repoPath);
  return inUse ? t('openDoor43.nameInUse', { name }) : undefined;
}

/** Artboard g: the refusal, its code, "No project was added", and Ask for help. */
function Refused({ refusal, onHelp }) {
  const text = t(REFUSAL_TEXT[refusal.code] ?? 'openDoor43.refused.other');
  return (
    <Callout tone="warn" data-testid="open-door43-refused" data-code={refusal.code ?? ''} role="alert">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text role="strong">{t('openDoor43.refusedTitle')}</Text>
        <span>{text}</span>
        <span>{refusal.code && <><code>{refusal.code}</code>{' · '}</>}{t('openDoor43.nothingWritten')}</span>
        <div>
          <Button size="sm" variant="outline" data-testid="open-door43-help"
            onClick={() => onHelp({ code: refusal.code ?? '', text: `${text}\n\n${refusal.reason ?? ''}`.trim(), report: null })}>
            {t('feedback.ask')}
          </Button>
        </div>
      </div>
    </Callout>
  );
}

export default function OpenFromDoor43() {
  const { s, actions } = useApp();
  if (s.modal !== 'openDoor43' || !s.od) return null;
  const od = s.od;
  const dev = import.meta.env.DEV === true;
  const host = new URL(door43.server).host;
  const source = openSourceOf(od.repo, door43.server, dev);
  const nameError = nameErrorOf(od, s.projects);
  const refusal = od.error && od.error.code !== NAME_IN_USE ? od.error : null;
  const cantOpen = !source || !od.name.trim() || !!nameError || od.busy;
  const onRepo = (repo) => {
    const from = openSourceOf(repo, door43.server, dev)?.repo;
    const named = from === undefined ? undefined : openDefaultName(from);
    actions.patchOd(od.named ? { repo, error: null } : { repo, name: named ?? '', error: null });
  };
  return (
    <Modal title={t('openDoor43.title')} subtitle={t('openDoor43.subtitle')} data-testid="open-door43-modal" width={520}
      closeLabel={t('common.close')} onClose={od.busy ? undefined : actions.closeModal}
      footer={<>
        <Button variant="secondary" disabled={od.busy} onClick={actions.closeModal} data-testid="open-door43-cancel">{t('openDoor43.cancel')}</Button>
        <Button disabled={cantOpen} aria-busy={od.busy || undefined} onClick={actions.openDoor43Run} data-testid="open-door43-submit">
          {t(od.busy ? 'openDoor43.opening' : 'openDoor43.open')}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 6 }}>
        <Callout tone="info">{t('openDoor43.where', { host })}</Callout>
        <Field label={t('openDoor43.repo')} hint={t('openDoor43.repoHint')}
          error={od.repo.trim() && !source ? t('openDoor43.repoBad', { host }) : undefined}>
          <Input value={od.repo} data-testid="open-door43-repo" disabled={od.busy} onChange={(e) => onRepo(e.target.value)} />
        </Field>
        <Field label={t('openDoor43.name')} hint={t('openDoor43.nameHint')} error={nameError} data-testid="open-door43-name-field">
          <Input value={od.name} data-testid="open-door43-name" disabled={od.busy}
            onChange={(e) => actions.patchOd({ name: e.target.value, named: true, error: null })} />
        </Field>
        {refusal
          ? <Refused refusal={refusal} onHelp={actions.askForHelp} />
          : <Text role="caption" tone="muted">{t('openDoor43.checks', { sync: t('home.sync') })}</Text>}
      </div>
    </Modal>
  );
}
