// C2.1 — pinned resource fetch + SHA verification + local install.
// Pure-logic checks here (unwrapping, SHA refusal, URL shape). The live
// end-to-end against the rig + DCS is the integration test below, skipped when
// the rig is down.
import { describe, expect, it } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import {
  sbZipUrl,
  localRepoPathFor,
  unwrapExport,
  rezip,
  identifyExistingInstall,
  fetchAndInstallPin,
} from '../src/data/resourceFetch';
import type { ResourcePin } from '../src/data/burritoStore';

const PIN: ResourcePin & { version: string } = {
  repoPath: 'git.door43.org/unfoldingWord/en_twl',
  version: 'v86',
  flavor: 'parascriptural/x-bcvarticles',
  sha: '570e76d0024c847689e48a20e2ac1a1d2c6eb6e3',
};

const metaFor = (revision: string | null) =>
  JSON.stringify({
    format: 'scripture burrito',
    identification: revision
      ? { primary: { dcs: { 'unfoldingWord/en_twl': { revision } } } }
      : { primary: {} },
  });

/** A DCS-shaped export: everything under ONE top directory. */
const wrappedZip = (revision: string | null, extra: Record<string, string> = {}) =>
  zipSync({
    'en_twl/metadata.json': strToU8(metaFor(revision)),
    'en_twl/ingredients/TIT.tsv': strToU8('Reference\tID\n1:1\tabcd\n'),
    'en_twl/.git/config': strToU8('[core]\n'),
    'en_twl/.DS_Store': strToU8('junk'),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });

describe('sb-zip URL + local target (D23b pin path)', () => {
  it('builds the /sb/<tag>.zip export URL from the pin', () => {
    expect(sbZipUrl(PIN)).toBe('https://git.door43.org/unfoldingWord/en_twl/sb/v86.zip');
  });

  it('installs into _local_/_sideloaded_/<repo>', () => {
    expect(localRepoPathFor(PIN)).toBe('_local_/_sideloaded_/unfoldingword--en_twl');
  });
});

describe('unwrapExport — the DCS export is wrapped, the importer needs it flat', () => {
  it('strips the single top directory', () => {
    const { files } = unwrapExport(wrappedZip('abc'));
    expect(Object.keys(files).sort()).toEqual(['ingredients/TIT.tsv', 'metadata.json']);
  });

  it('drops .git and .DS_Store, which the export ships but an install must not', () => {
    const { files } = unwrapExport(wrappedZip('abc'));
    expect(Object.keys(files).some((n) => n.startsWith('.git'))).toBe(false);
    expect(Object.keys(files).some((n) => n.endsWith('.DS_Store'))).toBe(false);
  });

  it('reads the revision the export declares', () => {
    expect(unwrapExport(wrappedZip('deadbeef')).revision).toBe('deadbeef');
    expect(unwrapExport(wrappedZip(null)).revision).toBeNull();
  });

  it('accepts an already-flat archive unchanged', () => {
    const flat = zipSync({
      'metadata.json': strToU8(metaFor('abc')),
      'ingredients/TIT.tsv': strToU8('x'),
    });
    expect(Object.keys(unwrapExport(flat).files).sort()).toEqual([
      'ingredients/TIT.tsv', 'metadata.json',
    ]);
  });

  it('refuses an archive that is not a burrito', () => {
    const noMeta = zipSync({ 'en_twl/ingredients/TIT.tsv': strToU8('x') });
    expect(() => unwrapExport(noMeta)).toThrow(/no root metadata.json/);
    const noIngredients = zipSync({ 'en_twl/metadata.json': strToU8(metaFor('a')) });
    expect(() => unwrapExport(noIngredients)).toThrow(/no ingredients/);
  });
});

describe('rezip — the importer needs explicit directory entries', () => {
  it('emits an `ingredients/` DIRECTORY entry, not just the file paths', () => {
    // The platform's check_burrito_zip looks for a file named metadata.json AND
    // a directory entry named ingredients/. Without the directory entry a
    // perfectly valid tree is rejected with "Zip does not look like a burrito"
    // (observed live before this was fixed).
    const { files } = unwrapExport(wrappedZip('abc'));
    const entries = Object.keys(unzipSync(rezip(files)));
    expect(entries).toContain('ingredients/');
    expect(entries).toContain('metadata.json');
    expect(entries).toContain('ingredients/TIT.tsv');
  });

  it('creates every intermediate directory, not only the top one', () => {
    const nested = unwrapExport(zipSync({
      'r/metadata.json': strToU8(metaFor('abc')),
      'r/ingredients/checking/alignments/TIT.json': strToU8('{}'),
    }));
    const entries = Object.keys(unzipSync(rezip(nested.files)));
    expect(entries).toContain('ingredients/');
    expect(entries).toContain('ingredients/checking/');
    expect(entries).toContain('ingredients/checking/alignments/');
  });
});

describe('identifyExistingInstall — name an already-present resource by evidence', () => {
  const tagsFetch = (tags: Array<{ name: string; sha: string }>, ok = true) =>
    (async () => ({
      ok,
      json: async () => tags.map((t) => ({ name: t.name, commit: { sha: t.sha } })),
    })) as unknown as typeof fetch;

  it('names the release whose commit matches the installed revision', async () => {
    const found = await identifyExistingInstall(
      'git.door43.org/unfoldingWord/en_ult',
      '84c73ba00fc8a95a9033f9efb14bb905a2a52ee4',
      tagsFetch([
        { name: 'v88', sha: '1'.repeat(40) },
        { name: 'v89', sha: '84c73ba00fc8a95a9033f9efb14bb905a2a52ee4' },
      ]),
    );
    expect(found?.version).toBe('v89');
    expect(found?.sha).toBe('84c73ba00fc8a95a9033f9efb14bb905a2a52ee4');
  });

  it('stays UNIDENTIFIED when no tag matches — never guesses a version', async () => {
    expect(await identifyExistingInstall(
      'git.door43.org/unfoldingWord/en_ult',
      'f'.repeat(40),
      tagsFetch([{ name: 'v89', sha: '1'.repeat(40) }]),
    )).toBeNull();
  });

  it('stays unidentified with no revision, or when DCS is unreachable', async () => {
    expect(await identifyExistingInstall('git.door43.org/a/b', '', tagsFetch([]))).toBeNull();
    expect(await identifyExistingInstall('git.door43.org/a/b', 'abc', tagsFetch([], false))).toBeNull();
  });
});

describe('fetchAndInstallPin — the SHA gate (D23b: verify at every import)', () => {
  const apiWith = (netEnabled: boolean, installed: string[] = []) => ({
    getNetEnabled: async () => netEnabled,
    postZippedBurrito: async (repoPath: string) => { installed.push(repoPath); },
  });
  const fetchReturning = (bytes: Uint8Array, ok = true, status = 200) =>
    (async () => ({ ok, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })) as unknown as typeof fetch;

  it('installs when the export SHA matches the pin', async () => {
    const installed: string[] = [];
    const r = await fetchAndInstallPin(PIN, {
      api: apiWith(true, installed) as never,
      fetchFn: fetchReturning(wrappedZip(PIN.sha as string)),
    });
    expect(r.repoPath).toBe('_local_/_sideloaded_/unfoldingword--en_twl');
    expect(r.revision).toBe(PIN.sha);
    expect(installed).toEqual(['_local_/_sideloaded_/unfoldingword--en_twl']);
  });

  it('REFUSES to install when the export SHA differs from the pin', async () => {
    const installed: string[] = [];
    await expect(fetchAndInstallPin(PIN, {
      api: apiWith(true, installed) as never,
      fetchFn: fetchReturning(wrappedZip('0'.repeat(40))),
    })).rejects.toThrow(/SHA mismatch/);
    expect(installed).toEqual([]); // nothing installed — the whole point
  });

  it('REFUSES when the pin carries a SHA but the export declares none', async () => {
    const installed: string[] = [];
    await expect(fetchAndInstallPin(PIN, {
      api: apiWith(true, installed) as never,
      fetchFn: fetchReturning(wrappedZip(null)),
    })).rejects.toThrow(/cannot be verified/);
    expect(installed).toEqual([]);
  });

  it('respects the platform offline switch even though the GET is client-side', async () => {
    let fetched = false;
    await expect(fetchAndInstallPin(PIN, {
      api: apiWith(false) as never,
      fetchFn: (async () => { fetched = true; return { ok: true }; }) as unknown as typeof fetch,
    })).rejects.toThrow(/offline/);
    expect(fetched).toBe(false); // never reached the network
  });

  it('surfaces a failed download instead of installing a partial', async () => {
    await expect(fetchAndInstallPin(PIN, {
      api: apiWith(true) as never,
      fetchFn: fetchReturning(new Uint8Array(0), false, 404),
    })).rejects.toThrow(/HTTP 404/);
  });

  it('reports each stage in order, so the UI can show honest progress', async () => {
    const stages: string[] = [];
    await fetchAndInstallPin(PIN, {
      api: apiWith(true) as never,
      fetchFn: fetchReturning(wrappedZip(PIN.sha as string)),
      onStage: (s) => stages.push(s),
    });
    expect(stages).toEqual(['download', 'verify', 'install']);
  });

  // F4 — a FIRST install carries no pin SHA. The expected SHA must come from
  // DCS's own tag→commit record (independent), NOT from the archive itself.
  // A FIRST install genuinely has no sha yet — the FetchPin request shape
  // (D58: §5.3 pins require the sha, fetch REQUESTS may not have one).
  const FIRST = {
    repoPath: 'git.door43.org/unfoldingWord/en_twl', version: 'v86', flavor: '',
  };
  const SHA = '570e76d0024c847689e48a20e2ac1a1d2c6eb6e3';
  // Dispatch by URL: the tags API answers the oracle call, the sb-zip the download.
  const dcsFetch = (
    zip: Uint8Array, tags: Array<{ name: string; sha: string }>, tagsOk = true,
  ) => (async (url: string) => (String(url).includes('/api/v1/repos/')
    ? { ok: tagsOk, status: 200, json: async () => tags.map((t) => ({ name: t.name, commit: { sha: t.sha } })) }
    : { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }
  )) as unknown as typeof fetch;

  it('installs a first pin (no SHA) when the export matches DCS’s tag commit', async () => {
    const installed: string[] = [];
    const r = await fetchAndInstallPin(FIRST, {
      api: apiWith(true, installed) as never,
      fetchFn: dcsFetch(wrappedZip(SHA), [{ name: 'v86', sha: SHA }]),
    });
    expect(r.revision).toBe(SHA);
    expect(installed).toEqual(['_local_/_sideloaded_/unfoldingword--en_twl']);
  });

  it('REFUSES a first pin whose export declares a revision DCS does not vouch for', async () => {
    const installed: string[] = [];
    await expect(fetchAndInstallPin(FIRST, {
      api: apiWith(true, installed) as never,
      // The archive claims SHA, but DCS records a DIFFERENT commit for v86 —
      // exactly the self-certifying archive F4 warned about.
      fetchFn: dcsFetch(wrappedZip(SHA), [{ name: 'v86', sha: '0'.repeat(40) }]),
    })).rejects.toThrow(/SHA mismatch/);
    expect(installed).toEqual([]);
  });

  it('REFUSES a first pin when DCS cannot vouch for the tag at all', async () => {
    const installed: string[] = [];
    await expect(fetchAndInstallPin(FIRST, {
      api: apiWith(true, installed) as never,
      fetchFn: dcsFetch(wrappedZip(SHA), [{ name: 'v99', sha: SHA }]), // v86 absent
    })).rejects.toThrow(/cannot authenticate/);
    expect(installed).toEqual([]);
  });
});
