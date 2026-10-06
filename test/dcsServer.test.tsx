// @vitest-environment jsdom
// #120 — the Door43 server for account and write calls, isolated to the
// production value. #506: the card's location line names the server in a
// development build only. The journeys run on the Vite dev server, so they only ever
// see QA; no journey reaches the value a packaged build ships. Each case below
// is one way the issue says the production value can fail (D81 point 3).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const state = { remoteByProject: {} as Record<string, unknown>, progressByProject: {}, obsRecentByProject: {}, netEnabled: true };
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions: { loadProgress: vi.fn(), loadShared: vi.fn() } }) }));

const PRODUCTION = 'https://git.door43.org';
const QA = 'https://qa.door43.org';

/** The module as a build with this `import.meta.env.DEV` would evaluate it. */
async function serverWithDev(dev: boolean): Promise<string> {
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return (await import('../src/data/dcsServer')).DCS_SERVER;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('#120 — the production Door43 server', () => {
  it('a production build (DEV false) does not get the QA address', async () => {
    expect(await serverWithDev(false)).not.toBe(QA);
  });

  it('a build where DEV is absent gets production, never QA', async () => {
    // vi.stubEnv cannot remove DEV (Vitest coerces it to a boolean), so the
    // rule is given an env without it.
    const { dcsServerFor } = await import('../src/data/dcsServer');
    expect(dcsServerFor({})).toBe(PRODUCTION);
  });

  it('the production value is exactly https://git.door43.org — scheme, host, no trailing slash', async () => {
    expect(await serverWithDev(false)).toBe(PRODUCTION);
  });
});

describe('#506 — the Door43 location on a project card', () => {
  const PROJECT = { id: '_local_/_local_/kau_bible', name: 'Kanuri', languageTag: 'kau', flavor: 'textStories', scriptDirection: 'ltr' };
  const metaWith = async (dev: boolean, url: string, repository: string): Promise<string> => {
    await serverWithDev(dev);
    state.remoteByProject = { [PROJECT.id]: { repository, url } };
    const { ObsProjectCard } = await import('../src/views/Home.jsx');
    render(<ObsProjectCard p={PROJECT} />);
    return screen.getByTestId(`share-state-${PROJECT.id}`).textContent ?? '';
  };

  it('a development build names qa.door43.org in front of the repository', async () => {
    expect(await metaWith(true, `${QA}/kanuri-team/kau_bible`, 'kanuri-team/kau_bible')).toBe('Shared at qa.door43.org/kanuri-team/kau_bible');
  }, 30_000); // Home.jsx loads its views after the module reset

  it('a packaged build (no server label) shows the repository alone', async () => {
    const text = await metaWith(false, `${PRODUCTION}/kanuri-team/kau_bible`, 'kanuri-team/kau_bible');
    expect(text).toBe('Shared at kanuri-team/kau_bible');
  }, 30_000);

  it('a development build names no server for a remote that is not on it', async () => {
    expect(await metaWith(true, `${PRODUCTION}/kanuri-team/kau_bible`, 'kanuri-team/kau_bible')).toBe('Shared at kanuri-team/kau_bible');
    cleanup();
    expect(await metaWith(true, 'file:///tmp/remotes/kau_bible', 'tmp/remotes/kau_bible')).toBe('Shared at tmp/remotes/kau_bible');
  }, 30_000);
});
