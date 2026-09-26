// @vitest-environment jsdom
// #120 — the Door43 server for account and write calls, isolated to the
// production value. The journeys run on the Vite dev server, so they only ever
// see QA; no journey reaches the value a packaged build ships. Each case below
// is one way the issue says the production value can fail (D81 point 3).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: {}, actions: {} }) }));

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

  it('with the production value, the server label is absent from the DOM', async () => {
    await serverWithDev(false);
    const { DcsServerLabel } = await import('../src/App.jsx');
    render(<DcsServerLabel />);
    expect(screen.queryByTestId('dcs-server-label')).toBeNull();
  }, 30_000); // App.jsx loads every view after the module reset
});
