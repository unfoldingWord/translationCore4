import { afterEach, describe, expect, it } from 'vitest';

// #396, decision D57: seed.zsh writes the install records of the tags it sideloads,
// through dev-env/scripts/write-install-records.mjs. The script runs as seed.zsh runs
// it: `node write-install-records.mjs <work dir>`.
const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { execFileSync } = process.getBuiltinModule('node:child_process');

const SCRIPT = path.resolve(process.cwd(), 'dev-env', 'scripts', 'write-install-records.mjs');
const EN_TW_SHA = '002f704aa693a0131dd6ea4efb83df7419148bfc';
const ES_TN_SHA = '22f3d0c61e2ab4701cb869547de9c3c43da07208';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A rig work dir holding the given sideloaded resources and an existing uw-tc4.json. */
function workDir(resources: Record<string, { sha: string; flavorType: string; flavor: string }>): string {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-install-records-'));
  dirs.push(work);
  for (const [name, r] of Object.entries(resources)) {
    const repo = path.join(work, 'repos', '_local_', '_sideloaded_', name);
    fs.mkdirSync(repo, { recursive: true });
    // The metadata shape of a DCS sb-zip export: the commit sha under
    // identification.primary.dcs, no release tag (D57).
    const meta = {
      identification: { primary: { dcs: { [`${name}-id`]: { revision: r.sha, timestamp: '2026-01-01T00:00:00Z' } } } },
      type: { flavorType: { name: r.flavorType, flavor: { name: r.flavor } } },
    };
    fs.writeFileSync(path.join(repo, 'metadata.json'), JSON.stringify(meta));
  }
  fs.mkdirSync(path.join(work, 'client_settings'));
  fs.writeFileSync(
    path.join(work, 'client_settings', 'uw-tc4.json'),
    JSON.stringify({ lastUsed: { repoPath: '_local_/_local_/sample_burrito' } }),
  );
  return work;
}

const run = (work: string): string => execFileSync(process.execPath, [SCRIPT, work], { encoding: 'utf8' });
const settings = (work: string) =>
  JSON.parse(fs.readFileSync(path.join(work, 'client_settings', 'uw-tc4.json'), 'utf8')) as Record<string, unknown>;

/** The assertions of this issue, on one work dir. */
function expectRecords(work: string): void {
  const doc = settings(work);
  expect(doc.installedResources).toEqual({
    '_local_/_sideloaded_/en_tw': {
      repoPath: 'git.door43.org/unfoldingWord/en_tw',
      version: 'v89',
      flavor: 'parascriptural/x-bcvarticles',
      sha: EN_TW_SHA,
    },
    '_local_/_sideloaded_/es-419_tn': {
      repoPath: 'git.door43.org/es-419_gl/es-419_tn',
      version: 'v66',
      flavor: 'parascriptural/x-bcvnotes',
      sha: ES_TN_SHA,
    },
  });
  // en_tn is on the list but not sideloaded: no record.
  expect(doc.installedResources).not.toHaveProperty(['_local_/_sideloaded_/en_tn']);
  expect(doc.lastUsed).toEqual({ repoPath: '_local_/_local_/sample_burrito' });
}

const TWO = {
  en_tw: { sha: EN_TW_SHA, flavorType: 'parascriptural', flavor: 'x-bcvarticles' },
  'es-419_tn': { sha: ES_TN_SHA, flavorType: 'parascriptural', flavor: 'x-bcvnotes' },
};

describe('#396 — write-install-records.mjs (D57)', () => {
  it('writes one record per sideloaded resource, with its version, flavor, sha and org', () => {
    const work = workDir(TWO);
    expect(run(work)).toContain('install records: 2 (en_tw, es-419_tn)');
    expectRecords(work);
  });

  it('negative control: with no records written, the same assertions fail', () => {
    const work = workDir(TWO);
    expect(() => expectRecords(work)).toThrow();
  });

  it('gives a resource with no revision a record without sha', () => {
    const work = workDir({ en_ult: { sha: '', flavorType: 'scripture', flavor: 'textTranslation' } });
    run(work);
    expect(settings(work).installedResources).toEqual({
      '_local_/_sideloaded_/en_ult': {
        repoPath: 'git.door43.org/unfoldingWord/en_ult',
        version: 'v89',
        flavor: 'scripture/textTranslation',
      },
    });
  });

  it('writes no record for an OBS resource', () => {
    const work = workDir({ en_obs: { sha: EN_TW_SHA, flavorType: 'gloss', flavor: 'textStories' } });
    run(work);
    expect(settings(work).installedResources).toEqual({});
  });
});
