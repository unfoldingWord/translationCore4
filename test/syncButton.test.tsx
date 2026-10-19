// @vitest-environment jsdom
// #678 (layer 4 of epic #24): the "Sync with Door43" button and its result.
// The result reads only `report.facts`; the fixtures are real Reports made by
// journal/report.mjs (okReport, failedReport, Refusal), so a fixture that the
// Report contract refuses fails here first. Assertions read codes, roles and
// test ids, never message text, except the one sentence the issue fixes for
// `sync.no-write-access`.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import SyncResult, { SYNC_REFUSALS, syncCounts, syncTeam } from '../src/views/SyncResult.jsx';
import { InternetDialog } from '../src/views/AccountMenu.jsx';
import ShareDialog from '../src/views/modals/ShareDialog.jsx';
import { actorLabel } from '../src/views/actorLabel.js';
import { missingPinCount } from '../src/data/installed';

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

/** Every refusal code a sync can return: the sync core, the sync shell, the ops log, and
 * the open gate (#677, `guardOpenCopy`); and the store's project-path guard (#676), which
 * the result maps too. */
const SYNC_CODES = Object.keys(REFUSAL_CODES).filter((code) =>
  /^(sync|opslog)\./.test(code) || ['open-door43.removed', 'open-door43.pending', 'open.not-a-project'].includes(code));

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
    expect(catalogs).toHaveLength(10);
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

  it('D88 point 6: missingPinCount counts each pin that names a version this computer does not have', () => {
    const ult = { repoPath: 'git.door43.org/unfoldingWord/en_ult', sha: 'a'.repeat(40), version: 'v91', flavor: 'textTranslation' };
    const uhb = { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', sha: 'b'.repeat(40), version: 'v3.0.0', flavor: 'textTranslation' };
    const resources = { languageSets: { primary: { literalText: ult } }, resources: { originalLanguage: { ot: uhb } } } as never;
    const installed = { 'unfoldingWord/en_ult': { ...ult } };
    // control: every version installed counts 0
    expect(missingPinCount(resources, { ...installed, 'unfoldingWord/hbo_uhb': { ...uhb } })).toBe(0);
    // the original-language pin names a version this computer lacks: 1, and the result offers Download
    const n = missingPinCount(resources, installed);
    expect(n).toBe(1);
    // the same repository at another commit is not the pinned version (D58)
    expect(missingPinCount(resources, { ...installed, 'unfoldingWord/hbo_uhb': { ...uhb, sha: 'c'.repeat(40) } })).toBe(1);
    // a pin with no sha names no version to download (D59); no pin file counts 0
    expect(missingPinCount({ languageSets: { primary: { literalText: { repoPath: ult.repoPath } } } } as never, {})).toBe(0);
    expect(missingPinCount(null, {})).toBe(0);
    render(<SyncResult result={result(okSync(), n)} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('sync-missing-pins').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('sync-download')).toBeTruthy();
  });

  it('D88 point 6: a sync whose only missing version is a source Bible pane (extraScripture, #412) offers Download (bench round 5)', () => {
    // the pin file of the conformance sample, with every pin that names a version installed
    const resources = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'conformance/sample-burrito/ingredients/checking/resources.json'), 'utf8'));
    const pins = [
      ...Object.values(resources.languageSets).flatMap((set) => Object.values(set as Record<string, unknown>)),
      ...Object.values(resources.resources.originalLanguage),
      ...resources.extraScripture,
    ] as Array<{ repoPath: string; sha?: string; id?: string }>;
    const installed = Object.fromEntries(pins.filter((pin) => pin.sha).map((pin) => [pin.repoPath, { ...pin }]));
    expect(missingPinCount(resources, installed as never)).toBe(0); // control
    const ult = resources.extraScripture.find((pin: { id: string }) => pin.id === 'ult');
    const withoutUlt = Object.fromEntries(Object.entries(installed).filter(([key]) => key !== ult.repoPath));
    const n = missingPinCount(resources, withoutUlt as never);
    expect(n).toBe(1);
    render(<SyncResult result={result(okSync(), n)} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('sync-download')).toBeTruthy();
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
  const done = (project: Record<string, unknown>, mode?: string) => ({
    modal: 'share',
    sh: { project, mode, step: 'done', steps: ['create', 'push'], report: { ok: true, facts: { url: SHARED.url } }, error: null, copied: false, busy: false, target: { kind: 'user' }, name: 'equipo' },
  });

  it('first-share result names write access', () => {
    Object.assign(state, done(BIBLE));
    render(<ShareDialog />);
    expect(screen.getByTestId('share-done')).toBeTruthy();
    expect(screen.getByTestId('share-team-access').textContent).toBe(t('shareDialog.teamAccess'));
  });

  it('first-share result names write access: not for an OBS project, which cannot sync in round 1', () => {
    Object.assign(state, done(OBS));
    render(<ShareDialog />);
    expect(screen.getByTestId('share-done')).toBeTruthy();
    expect(screen.queryByTestId('share-team-access')).toBeNull();
  });

  it('first-share result names write access: an upload of an OBS project does not repeat it', () => {
    Object.assign(state, done(OBS, 'upload'));
    render(<ShareDialog />);
    expect(screen.getByTestId('share-done')).toBeTruthy();
    expect(screen.queryByTestId('share-team-access')).toBeNull();
  });
});

describe('#680 — the result names each teammate through actorLabel', () => {
  // received: b0… and c0…; a0… is this translator; d0… sent nothing this sync and has no name
  const team = { names: { a0000000000000aa: 'facilitator', c0000000000000bb: 'maria' }, actors: ['a0000000000000aa', 'b0000000000000aa', 'c0000000000000bb', 'd0000000000000dd'] };

  it('a named teammate shows the Door43 name; an unnamed one the "Teammate n" the review gives', () => {
    render(<SyncResult result={result(okSync())} team={team} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    const review = (actor: string) => actorLabel(actor, team.names, 'a0000000000000aa', team.actors);
    expect(review('b0000000000000aa')).toBe(t('conflicts.teammate', { n: 1 }));
    expect(screen.getByTestId('sync-received-from').textContent)
      .toBe(t('syncResult.from', { names: [review('b0000000000000aa'), 'maria'].join(' · ') }));
  });

  it('no names line with no teammate change, with no team (the read after the sync failed), or for a refused sync', () => {
    render(<SyncResult result={result(okSync({ received: {} }))} team={team} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-received-from')).toBeNull();
    cleanup();
    render(<SyncResult result={result(okSync())} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-received-from')).toBeNull();
    expect(screen.getByTestId('sync-count-received').getAttribute('data-count')).toBe('5');
    cleanup();
    render(<SyncResult result={result(refused('sync.offline'))} team={team} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-received-from')).toBeNull();
  });

  it('syncTeam: the open store\'s team when the synced project is open, else Home\'s read-only one', () => {
    const open = { me: 'a0000000000000aa', ...team };
    const other = { names: {}, actors: ['x'] };
    expect(syncTeam({ project: { id: BIBLE.id }, team: open, teamByProject: { [BIBLE.id]: other } }, BIBLE.id)).toBe(open);
    expect(syncTeam({ project: null, team: null, teamByProject: { [BIBLE.id]: other } }, BIBLE.id)).toBe(other);
    expect(syncTeam({ project: { id: 'another' }, team: open, teamByProject: {} }, BIBLE.id)).toBeNull();
  });

  it('Home hands the toast the team of the synced project', async () => {
    Object.assign(state, { projects: [], lastEdit: null, bookError: null, commitError: null, importToast: null, project: null, team: null });
    state.syncResult = result(okSync());
    state.teamByProject = { [BIBLE.id]: team };
    Object.assign(actions, { dismissSyncResult: vi.fn(), syncDownload: vi.fn(), openAddProject: vi.fn(), refreshProjects: vi.fn() });
    const { default: Home } = await import('../src/views/Home.jsx');
    render(<Home />);
    expect(screen.getByTestId('sync-received-from').textContent).toContain('maria');
  });
});

describe('D108 (#791) — the result names each alignment that a teammate\'s newer record replaced', () => {
  const team = { me: 'a0000000000000aa', names: { c0000000000000bb: 'maria' }, actors: ['a0000000000000aa', 'b0000000000000aa', 'c0000000000000bb'] };
  const replaced = [
    { book: 'TIT', ref: '1:1', actor: 'c0000000000000bb' },
    { book: 'JON', ref: '2:3', actor: 'b0000000000000aa' },
  ];
  const draw = (facts: Record<string, unknown>, withTeam: typeof team | null = team) =>
    render(<SyncResult result={result(okSync(facts))} team={withTeam} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);

  it('one notice row per verse: the book, the verse and the teammate; the newest-version count stays', () => {
    draw({ alignReplaced: replaced });
    const rows = within(screen.getByTestId('sync-align-replaced')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      t('syncResult.alignReplaced', { book: 'Titus', ref: '1:1', name: 'maria' }),
      t('syncResult.alignReplaced', { book: 'Jonah', ref: '2:3', name: t('conflicts.teammate', { n: 1 }) }), // the review's label for the unnamed teammate
    ]);
    expect(screen.getByTestId('sync-count-newest').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('sync-count-conflicts').getAttribute('data-count')).toBe('2');
  });

  it('a notice only: no button, no link, and the review link follows the verse conflicts alone', () => {
    draw({ alignReplaced: replaced, textConflicts: [] });
    const list = screen.getByTestId('sync-align-replaced');
    expect(within(list).queryAllByRole('button')).toEqual([]);
    expect(within(list).queryAllByRole('link')).toEqual([]);
    expect(screen.queryByTestId('sync-review')).toBeNull();
  });

  it('with no team, a teammate shows by the folded name of the Report', () => {
    draw({ alignReplaced: replaced, names: { c0000000000000bb: 'maria' } }, null);
    expect(within(screen.getByTestId('sync-align-replaced')).getAllByRole('listitem')[0].textContent)
      .toBe(t('syncResult.alignReplaced', { book: 'Titus', ref: '1:1', name: 'maria' }));
  });

  it('no list when nothing was replaced, for an older Report without the fact, and for a refused sync', () => {
    draw({ alignReplaced: [] });
    expect(screen.queryByTestId('sync-align-replaced')).toBeNull();
    expect(screen.getByTestId('sync-count-newest')).toBeTruthy();
    cleanup();
    draw({});
    expect(screen.queryByTestId('sync-align-replaced')).toBeNull();
    cleanup();
    render(<SyncResult result={result(refused('sync.offline'))} team={team} onReview={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('sync-align-replaced')).toBeNull();
  });
});
