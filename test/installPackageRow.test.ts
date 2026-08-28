// Round 20 (2026-08-28 adversarial review): the Source-texts download is the
// ONLY exposed recovery path for a project whose pinned resource is missing —
// it must fetch the project's pinned IDENTITY (repoPath + sha, D58), not the
// catalog's latest release, and an existing same-repo install at the wrong
// sha must not read as "done".
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchAndInstallPin = vi.fn();
const latestReleaseTag = vi.fn();

vi.mock('../src/data/resourceFetch', () => ({
  fetchAndInstallPin: (...args: unknown[]) => fetchAndInstallPin(...args),
  latestReleaseTag: (...args: unknown[]) => latestReleaseTag(...args),
  identifyExistingInstall: async () => null,
}));

import { __installPackageRowForTests as installPackageRow } from '../src/state.jsx';

const SHA_PINNED = 'a'.repeat(40);
const SHA_LATEST = 'b'.repeat(40);
const GATEWAY = { id: 'en', org: 'unfoldingWord' };
const ROW = { repo: 'en_tq' };
const TARGET = '_local_/_sideloaded_/unfoldingword--en_tq';
const WANTED = {
  repoPath: 'git.door43.org/unfoldingWord/en_tq',
  version: 'v88',
  sha: SHA_PINNED,
  flavor: 'parascriptural/x-bcvquestions',
};

// The api stub covers what installPackageRow touches: the client-settings
// install record and the metadata read that names a flavor.
const apiStub = () => {
  const settings: Record<string, unknown> = {};
  return {
    getClientSettings: async () => settings,
    setClientSettings: async (_: string, next: Record<string, unknown>) =>
      Object.assign(settings, next),
    getMetadataRaw: async () => ({}),
    __settings: settings,
  };
};

beforeEach(() => {
  fetchAndInstallPin.mockReset();
  latestReleaseTag.mockReset();
  latestReleaseTag.mockResolvedValue('v89');
});

describe('round 20 — installPackageRow fetches the PROJECT pin, never latest-instead', () => {
  it('VERSION SKEW: the pinned identity is requested, latestReleaseTag is never consulted', async () => {
    fetchAndInstallPin.mockResolvedValue({ repoPath: TARGET, revision: SHA_PINNED, bytes: 1 });
    const result = await installPackageRow(apiStub(), GATEWAY, ROW, new Set(), WANTED);
    expect(result.done).toBe('en_tq v88');
    expect(latestReleaseTag).not.toHaveBeenCalled();
    const [pinArg, optsArg] = fetchAndInstallPin.mock.calls[0];
    expect(pinArg).toMatchObject({ repoPath: WANTED.repoPath, version: 'v88', sha: SHA_PINNED });
    expect(optsArg.targetRepoPath).toBeUndefined(); // canonical path is free
  });

  it('an OCCUPIED canonical path does not read as done — the pin installs side by side', async () => {
    // The old path returned { done } for any existing install, so a wrong-sha
    // occupant made the project permanently unable to satisfy its pin.
    fetchAndInstallPin.mockResolvedValue({
      repoPath: `${TARGET}--aaaaaaaaaaaa`,
      revision: SHA_PINNED,
      bytes: 1,
    });
    const api = apiStub();
    const result = await installPackageRow(api, GATEWAY, ROW, new Set([TARGET]), WANTED);
    expect(result.done).toBe('en_tq v88');
    const [, optsArg] = fetchAndInstallPin.mock.calls[0];
    expect(optsArg.targetRepoPath).toBe(`${TARGET}--${SHA_PINNED.slice(0, 12)}`);
    // The record names the side path with the VERIFIED revision.
    const installed = (api.__settings.installedResources ?? {}) as Record<string, { sha: string }>;
    expect(installed[`${TARGET}--${SHA_PINNED.slice(0, 12)}`]?.sha).toBe(SHA_PINNED);
  });

  it('a SHA-mismatched export is a reported failure, never a recorded install (D23b)', async () => {
    fetchAndInstallPin.mockRejectedValue(new Error('pin SHA mismatch for en_tq v88'));
    const api = apiStub();
    const result = await installPackageRow(api, GATEWAY, ROW, new Set(), WANTED);
    expect(result.failed).toMatch(/SHA mismatch/);
    expect(api.__settings.installedResources).toBeUndefined();
  });

  it('with NO project pin, an absent repo still installs the latest release (unchanged path)', async () => {
    fetchAndInstallPin.mockResolvedValue({ repoPath: TARGET, revision: SHA_LATEST, bytes: 1 });
    const result = await installPackageRow(apiStub(), GATEWAY, ROW, new Set(), null);
    expect(result.done).toBe('en_tq v89');
    expect(latestReleaseTag).toHaveBeenCalledWith(`git.door43.org/${GATEWAY.org}/${ROW.repo}`);
  });
});
