// @vitest-environment jsdom
// #678 (owner ruling 2026-10-14): a sync does not swap the project, so after a
// sync the live project's history differs from Door43 `main`, and a share push
// from it would not be a fast-forward. The guard is at the action, not only the
// Home button: a project that syncs (projectSyncs) never runs the share push
// after its first share; Share or Upload changes on it runs the sync. A shared
// OBS project keeps Upload changes, and a first share still pushes.
// The real AppProvider runs; only the platform calls are spies on the `api` and
// `door43` singletons, and the sync operation is a stub.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

vi.mock('../src/data/share/syncOperation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/share/syncOperation')>()),
  sync: vi.fn(async () => ({ op: 'sync', ok: false, code: 'sync.offline', facts: { error: 'stub' } })),
}));

import { AppProvider, useApp, api, door43, internet } from '../src/state.jsx';
import { resumeSession, signOut } from '../src/data/share/session';
import { sync } from '../src/data/share/syncOperation';
import { JournalingStore } from '../src/data/journal/journalingStore';

const BIBLE = { id: '_local_/_local_/equipo', name: 'Equipo', languageTag: 'es', flavor: 'textTranslation', bookCodes: ['TIT'] };
const OBS = { id: '_local_/_local_/historias', name: 'Historias', languageTag: 'es', flavor: 'textStories', bookCodes: [] };
const ORIGIN = (repo: string) => [{ name: 'origin', url: `${door43.server}/facilitator/${repo}.git` }];

type App = {
  s: {
    remoteByProject: Record<string, unknown>;
    syncResult: { repoPath: string } | null;
    modal: string | null;
    sh: { mode?: string; step?: string; choices?: unknown } | null;
  };
  actions: Record<string, (...args: unknown[]) => Promise<unknown>>;
};
let app: App;
function Probe() {
  app = useApp() as unknown as App;
  return null;
}

let push: ReturnType<typeof vi.fn>;
let listRemotes: ReturnType<typeof vi.fn>;
let createRepository: ReturnType<typeof vi.fn>;

const mount = async () => {
  render(<AppProvider><Probe /></AppProvider>);
  await act(async () => {});
};
/** Start an action the way a click does. Its steps render as they land:
 * waitFor (not one act() around the whole action) lets each render happen. */
const press = (start: () => unknown) => {
  let done: unknown;
  act(() => { done = start(); });
  return done as Promise<unknown>;
};

beforeEach(() => {
  cleanup();
  // Nothing reaches a network: any call not stubbed below is refused.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test'); }));
  internet.on = true;
  resumeSession({ username: 'facilitator', token: 'test-token' });
  push = vi.fn(async () => undefined);
  listRemotes = vi.fn(async (repoPath: string) => (repoPath === OBS.id ? ORIGIN('historias') : ORIGIN('equipo')));
  createRepository = vi.fn(async () => ({ fullName: 'facilitator/equipo', cloneUrl: `${door43.server}/facilitator/equipo.git`, htmlUrl: `${door43.server}/facilitator/equipo` }));
  vi.spyOn(api, 'push').mockImplementation(push as never);
  vi.spyOn(api, 'listRemotes').mockImplementation(listRemotes as never);
  vi.spyOn(api, 'addRemote').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'getNetEnabled').mockResolvedValue(true);
  vi.spyOn(api, 'getClientSettings').mockResolvedValue({} as never);
  vi.spyOn(api, 'setClientSettings').mockResolvedValue(undefined as never);
  vi.spyOn(door43, 'createRepository').mockImplementation(createRepository as never);
  // Door43 answers after a render, as a real request does.
  vi.spyOn(door43, 'listOrganizations').mockImplementation(() => new Promise((r) => setTimeout(() => r([]), 5)) as never);
  vi.spyOn(JournalingStore.prototype, 'open').mockResolvedValue(undefined as never);
  vi.spyOn(JournalingStore.prototype, 'commitPending').mockResolvedValue(null);
  vi.mocked(sync).mockClear();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  internet.on = false;
  await signOut();
});

describe('#678 — a project that syncs never runs the share push', () => {
  it('a shared Bible project whose remote is not read yet: Share runs the sync, never api.push', async () => {
    await mount();
    expect(app.s.remoteByProject[BIBLE.id]).toBeUndefined();
    const done = press(() => app.actions.shareProject(BIBLE));
    await waitFor(() => expect(app.s.syncResult ?? app.s.sh).toBeTruthy());
    await done;
    // Upload changes, as the dialog sends it: no dialog is open, so nothing is sent
    await act(async () => { await app.actions.uploadChanges(BIBLE); });
    expect(push).not.toHaveBeenCalled();
    expect(createRepository).not.toHaveBeenCalled();
    expect(app.s.modal).not.toBe('share');
    // it ran the sync of this project instead
    expect(app.s.syncResult?.repoPath).toBe(BIBLE.id);
    expect(vi.mocked(sync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sync).mock.calls[0][1]).toMatchObject({ repoPath: BIBLE.id });
  });

  it('a shared Bible project whose remote is read: Share runs the sync, never api.push', async () => {
    await mount();
    await press(() => app.actions.loadShared(BIBLE));
    await waitFor(() => expect(app.s.remoteByProject[BIBLE.id]).toBeTruthy());
    const done = press(() => app.actions.shareProject(BIBLE));
    await waitFor(() => expect(app.s.syncResult ?? app.s.sh).toBeTruthy());
    await done;
    await act(async () => { await app.actions.uploadChanges(BIBLE); });
    expect(push).not.toHaveBeenCalled();
    expect(app.s.modal).not.toBe('share');
    expect(app.s.syncResult?.repoPath).toBe(BIBLE.id);
    expect(vi.mocked(sync)).toHaveBeenCalledTimes(1);
  });

  it('a shared OBS project keeps Upload changes: the upload pushes', async () => {
    await mount();
    await press(() => app.actions.shareProject(OBS));
    await waitFor(() => expect(app.s.sh?.mode).toBe('upload'));
    expect(app.s.modal).toBe('share');
    const done = press(() => app.actions.uploadChanges(OBS));
    await waitFor(() => expect(app.s.sh?.step).toBe('done'));
    await done;
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe(OBS.id);
    expect(vi.mocked(sync)).not.toHaveBeenCalled();
  });

  it('the first share of a Bible project still creates and pushes', async () => {
    listRemotes.mockResolvedValue([]);
    await mount();
    const opened = press(() => app.actions.shareProject(BIBLE));
    await waitFor(() => expect(app.s.sh?.choices).toEqual([]));
    await opened;
    expect(app.s.modal).toBe('share');
    expect(app.s.sh?.step).toBe('target');
    const done = press(() => app.actions.shareRun(BIBLE));
    await waitFor(() => expect(app.s.sh?.step).toBe('done'));
    await done;
    expect(createRepository).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe(BIBLE.id);
    expect(vi.mocked(sync)).not.toHaveBeenCalled();
  });
});
