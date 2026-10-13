// @vitest-environment jsdom
// #678 (layer 4 of epic #24): the "Sync with Door43" button and its result.
// The result reads only `report.facts`; the fixtures are real Reports made by
// journal/report.mjs (okReport, failedReport, Refusal), so a fixture that the
// Report contract refuses fails here first. Assertions read codes, roles and
// test ids, never message text, except the one sentence the issue fixes for
// `sync.no-write-access`.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { REFUSAL_CODES, Refusal, failedReport, okReport, reportError, type Report, type RefusalCode } from '../src/data/journal/runtime';
import { t } from '../src/i18n/index.js';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const actions = {
  loadShared: vi.fn(), loadProgress: vi.fn(), loadConflicts: vi.fn(), openProjectAt: vi.fn(), openSettings: vi.fn(),
  openAddBook: vi.fn(), openProjectConflicts: vi.fn(), syncProject: vi.fn(), shareProject: vi.fn(),
  turnOnInternet: vi.fn(), cancelInternet: vi.fn(), closeNetFailed: vi.fn(),
  closeModal: vi.fn(), shareCopyLink: vi.fn(), openDoor43Page: vi.fn(), changeSignIn: vi.fn(),
};
const BIBLE = { id: '_local_/_local_/equipo', name: 'Equipo', languageTag: 'es', flavor: 'textTranslation', scriptDirection: 'ltr', bookCodes: ['TIT'] };
const OBS = { id: '_local_/_local_/historias', name: 'Historias', languageTag: 'es', flavor: 'textStories', scriptDirection: 'ltr' };
const SHARED = { repository: 'facilitator/equipo', url: 'https://qa.door43.org/facilitator/equipo' };
let state: Record<string, unknown> = {};
const freshState = () => ({
  progressByProject: { [BIBLE.id]: { TIT: 10 } },
  conflictsByProject: { [BIBLE.id]: {} },
  remoteByProject: { [BIBLE.id]: SHARED, [OBS.id]: SHARED },
  obsRecentByProject: {},
  syncing: null,
  syncResult: null,
  netAsk: null,
  netFailed: false,
  modal: null,
  sh: null,
  door43User: 'facilitator',
});
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }), door43: { server: 'https://qa.door43.org' } }));

import { ProjectCard, ObsProjectCard } from '../src/views/Home.jsx';
import SyncResult, { SYNC_REFUSALS, syncCounts } from '../src/views/SyncResult.jsx';
import { InternetDialog } from '../src/views/AccountMenu.jsx';
import ShareDialog from '../src/views/modals/ShareDialog.jsx';

const AT = '2026-10-13T12:00:00.000Z';
/** An ok sync Report: 3 + 2 teammate files, one non-text conflict, two verse conflicts, one restored file. */
const okSync = (facts: Record<string, unknown> = {}) =>
  okReport('sync', AT, AT, {
    carried: 1,
    restored: 1,
    received: { b0000000000000aa: 3, c0000000000000bb: 2 },
    textConflicts: [
      { key: 'text|TIT 1:1', heads: [{ actor: 'a', ts: '1', text: 'x' }, { actor: 'b', ts: '2', text: 'y' }], provisional: '2' },
      { key: 'text|TIT 1:2', heads: [{ actor: 'a', ts: '3', text: 'x' }, { actor: 'c', ts: '4', text: 'z' }], provisional: '4' },
    ],
    newestWins: [{ key: 'check|translationWords|TIT|1', kind: 'check', winner: '5' }],
    names: {},
    tries: 1,
    repoPath: BIBLE.id,
    ...facts,
  });
const refused = (code: string) => failedReport('sync', AT, AT, new Refusal(code as RefusalCode, 'diagnosis for the log'), { repoPath: BIBLE.id });
const result = (report: Report, missingPins = 0) => ({ repoPath: BIBLE.id, name: BIBLE.name, report, missingPins });

/** Every refusal code a sync can return: the sync core, the sync shell, and the ops log. */
const SYNC_CODES = Object.keys(REFUSAL_CODES).filter((code) => /^(sync|opslog)\./.test(code));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state = freshState();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('#678 — the button', () => {
  it('sync label in every catalog', () => {
    const dir = path.resolve(process.cwd(), 'src', 'i18n');
    const catalogs = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
    expect(catalogs).toHaveLength(9);
    const keys = ['home.sync', 'home.syncing', 'net.ask.sync', 'shareDialog.teamAccess', ...Object.values(SYNC_REFUSALS)];
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
    for (const file of catalogs) {
      const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const key of keys) {
        expect(typeof catalog[key], `${file} ${key}`).toBe('string');
        expect(catalog[key].trim(), `${file} ${key}`).not.toBe('');
      }
      // a real translation: the label differs from the English one in every other language
      if (file !== 'en.json') expect(catalog['home.sync'], file).not.toBe(en['home.sync']);
    }
  });

  it('a shared Bible card says "Sync with Door43" and one press asks for one sync', () => {
    render(<ProjectCard p={BIBLE} />);
    const card = screen.getByTestId(`share-card-${BIBLE.id}`);
    expect(card.getAttribute('data-action')).toBe('sync');
    const button = screen.getByTestId(`share-${BIBLE.id}`);
    expect(button.textContent).toBe(t('home.sync'));
    fireEvent.click(button);
    expect(actions.syncProject).toHaveBeenCalledTimes(1);
    expect(actions.syncProject).toHaveBeenCalledWith(BIBLE);
    expect(actions.shareProject).not.toHaveBeenCalled();
  });

  it('before the first share the card offers Share; a shared OBS card keeps Upload changes (round 1 syncs Bible projects only)', () => {
    state.remoteByProject = { [BIBLE.id]: null, [OBS.id]: SHARED };
    render(<ProjectCard p={BIBLE} />);
    expect(screen.getByTestId(`share-card-${BIBLE.id}`).getAttribute('data-action')).toBe('share');
    fireEvent.click(screen.getByTestId(`share-${BIBLE.id}`));
    expect(actions.shareProject).toHaveBeenCalledWith(BIBLE);
    cleanup();
    state.progressByProject = { [OBS.id]: { OBS: 0, stories: [] } };
    render(<ObsProjectCard p={OBS} />);
    expect(screen.getByTestId(`share-card-${OBS.id}`).getAttribute('data-action')).toBe('upload');
    expect(actions.syncProject).not.toHaveBeenCalled();
  });

  it('the button is disabled while a sync runs, and says so', () => {
    state.syncing = BIBLE.id;
    render(<ProjectCard p={BIBLE} />);
    const button = screen.getByTestId(`share-${BIBLE.id}`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe(t('home.syncing'));
    fireEvent.click(button);
    expect(actions.syncProject).not.toHaveBeenCalled();
  });

  it('no Door43 request at start or idle', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    render(<ProjectCard p={BIBLE} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    // the card reads only its own `origin` (loadShared, a local read); it starts no sync and no share
    expect(actions.loadShared).toHaveBeenCalled();
    expect(actions.syncProject).not.toHaveBeenCalled();
    expect(actions.shareProject).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for the internet when it is off: the question names the sync, and only Turn on internet lets it go on', () => {
    state.netAsk = { kind: 'sync' };
    render(<InternetDialog />);
    const dialog = screen.getByTestId('net-ask');
    expect(dialog.getAttribute('data-kind')).toBe('sync');
    expect(screen.getByTestId('net-ask-reason').textContent).toContain(t('net.ask.sync'));
    fireEvent.click(screen.getByTestId('net-cancel'));
    expect(actions.cancelInternet).toHaveBeenCalledTimes(1);
    expect(actions.turnOnInternet).not.toHaveBeenCalled();
    expect(actions.syncProject).not.toHaveBeenCalled();
  });
});

describe('#678 — the result, built only from report.facts', () => {
  it('the Report fixtures are valid Reports', () => {
    expect(reportError(okSync())).toBeNull();
    for (const code of SYNC_CODES) expect(reportError(refused(code)), code).toBeNull();
  });

  it('three counts', () => {
    const report = okSync();
    expect(syncCounts(report.facts)).toEqual({ received: 5, newestWins: 1, textConflicts: 2 });
    render(<SyncResult result={result(report)} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    const toast = screen.getByRole('status');
    expect(toast.getAttribute('data-testid')).toBe('sync-result');
    expect(toast.getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('sync-count-received').getAttribute('data-count')).toBe('5');
    expect(screen.getByTestId('sync-count-newest').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('sync-count-conflicts').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('sync-restored').getAttribute('data-count')).toBe('1');
    expect(screen.queryByTestId('sync-message')).toBeNull();
  });

  it('three counts: a sync with no teammate change still gives all three, as 0, and no restored line', () => {
    render(<SyncResult result={result(okSync({ received: {}, textConflicts: [], newestWins: [], restored: 0 }))} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    for (const id of ['sync-count-received', 'sync-count-newest', 'sync-count-conflicts'])
      expect(screen.getByTestId(id).getAttribute('data-count'), id).toBe('0');
    expect(screen.queryByTestId('sync-restored')).toBeNull();
    expect(screen.queryByTestId('sync-review')).toBeNull();
  });

  it('link to review', () => {
    const onReview = vi.fn();
    render(<SyncResult result={result(okSync())} onReview={onReview} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sync-review'));
    expect(onReview).toHaveBeenCalledTimes(1);
    cleanup();
    render(<SyncResult result={result(okSync({ textConflicts: [] }))} onReview={onReview} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-review')).toBeNull();
  });

  it('Home: Review on the result opens the conflict review of the synced project', () => {
    state.syncResult = result(okSync());
    // Home renders the toast; mock the rest of the page's state it reads
    Object.assign(state, { projects: [], lastEdit: null, bookError: null, commitError: null, importToast: null });
    return import('../src/views/Home.jsx').then(({ default: Home }) => {
      const dismissSyncResult = vi.fn();
      Object.assign(actions, { dismissSyncResult, syncDownload: vi.fn(), openAddProject: vi.fn(), refreshProjects: vi.fn() });
      render(<Home />);
      fireEvent.click(screen.getByTestId('sync-review'));
      expect(dismissSyncResult).toHaveBeenCalledTimes(1);
      expect(actions.openProjectConflicts).toHaveBeenCalledWith(BIBLE.id);
    });
  });

  it('D88 point 6: a version this computer lacks offers Download', () => {
    const onDownload = vi.fn();
    render(<SyncResult result={result(okSync(), 2)} onReview={vi.fn()} onDownload={onDownload} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('sync-missing-pins').getAttribute('data-count')).toBe('2');
    fireEvent.click(screen.getByTestId('sync-download'));
    expect(onDownload).toHaveBeenCalledTimes(1);
    cleanup();
    render(<SyncResult result={result(okSync(), 0)} onReview={vi.fn()} onDownload={onDownload} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-download')).toBeNull();
  });

  it('one message per code', () => {
    // every code a sync can return has its own entry, and no entry names another code
    expect(Object.keys(SYNC_REFUSALS).sort()).toEqual([...SYNC_CODES].sort());
    const messages = new Map<string, string>();
    for (const code of SYNC_CODES) {
      cleanup();
      render(<SyncResult result={result(refused(code))} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
      const toast = screen.getByRole('alert');
      expect(toast.getAttribute('data-code')).toBe(code);
      expect(toast.getAttribute('data-ok')).toBe('0');
      const message = screen.getByTestId('sync-message').textContent ?? '';
      expect(message, code).toBe(t(SYNC_REFUSALS[code as keyof typeof SYNC_REFUSALS]));
      // the catalog has the text: a missing key would show the key itself
      expect(message, code).not.toBe(SYNC_REFUSALS[code as keyof typeof SYNC_REFUSALS]);
      // the diagnosis for the log never reaches the person
      expect(message).not.toContain('diagnosis for the log');
      expect(screen.queryByTestId('sync-count-received')).toBeNull();
      messages.set(code, message);
    }
    expect(new Set(messages.values()).size).toBe(SYNC_CODES.length);
    expect(messages.get('sync.no-write-access')).toBe('Ask the project owner for write access on Door43.');
  });

  it('one message per code: a failure with no code shows its reason in the one other message', () => {
    render(<SyncResult result={result(failedReport('sync', AT, AT, new Error('disk full'), { repoPath: BIBLE.id }))} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert').getAttribute('data-code')).toBe('');
    expect(screen.getByTestId('sync-message').textContent).toBe(t('syncResult.error.other', { reason: 'disk full' }));
  });
});

describe('#678 — the first share', () => {
  const done = (mode?: string) => ({
    modal: 'share',
    sh: { project: BIBLE, mode, step: 'done', steps: ['create', 'push'], report: { ok: true, facts: { url: SHARED.url } }, error: null, copied: false, busy: false, target: { kind: 'user' }, name: 'equipo' },
  });

  it('first-share result names write access', () => {
    Object.assign(state, done());
    render(<ShareDialog />);
    expect(screen.getByTestId('share-done')).toBeTruthy();
    expect(screen.getByTestId('share-team-access').textContent).toBe(t('shareDialog.teamAccess'));
  });

  it('first-share result names write access: an upload of an OBS project does not repeat it', () => {
    Object.assign(state, done('upload'));
    render(<ShareDialog />);
    expect(screen.getByTestId('share-done')).toBeTruthy();
    expect(screen.queryByTestId('share-team-access')).toBeNull();
  });
});
