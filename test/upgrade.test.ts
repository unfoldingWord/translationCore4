// J12 (#256) — the offer computation from a release listing, the per-set
// separation, and the all-or-nothing install of a set's release.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyUpgrade, latestRelease, latestReleasesForSet, offerForSet, offerIsStale, reposOfSet, upgradedSet } from '../src/data/upgrade';
import type { ReleaseInfo } from '../src/data/upgrade';
import type { LanguageSet, ResourcePin, ResourcesFile } from '../src/data/burritoStore';
import { EN_OBS_IMAGES } from '../src/data/installedSuite';

const fetchAndInstallPin = vi.fn();
vi.mock('../src/data/resourceFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/resourceFetch')>()),
  fetchAndInstallPin: (...args: unknown[]) => fetchAndInstallPin(...args),
}));

import { __installReleaseSetForTests as installReleaseSet } from '../src/state.jsx';

const sha = (c: string) => c.repeat(40);
const pin = (repo: string, version: string, s: string, flavor = 'parascriptural/x-bcvnotes'): ResourcePin => ({
  repoPath: `git.door43.org/unfoldingWord/${repo}`,
  version,
  sha: sha(s),
  flavor,
});

const EN: LanguageSet = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: pin('en_tn', 'v89', 'a'),
  translationWordsLinks: pin('en_tw', 'v89', 'b', 'parascriptural/x-bcvarticles'),
  translationWords: pin('en_tw', 'v89', 'b', 'parascriptural/x-bcvarticles'),
  translationAcademy: pin('en_ta', 'v89', 'c', 'peripheral/x-peripheralArticles'),
  translationQuestions: pin('en_tq', 'v89', 'd', 'parascriptural/x-bcvquestions'),
};

const release = (tag: string, s: string): ReleaseInfo => ({ tag, sha: sha(s), publishedAt: '2026-08-17T19:15:10Z' });

describe('reposOfSet — one entry per repo, tW folded (D34), help slots only (D72)', () => {
  it('the simplified Bible (simplifiedText) is a gateway Bible, never offered here — that upgrade is #258', () => {
    const withUst: LanguageSet = { ...EN, simplifiedText: pin('en_ust', 'v89', 'u', 'scripture/textTranslation') };
    expect(reposOfSet(withUst).map((r) => r.repoPath.split('/').pop())).not.toContain('en_ust');
    const offer = offerForSet('primary', withUst, { 'git.door43.org/unfoldingWord/en_ust': release('v90', 'v') });
    expect(offer.upgrades).toEqual([]);
    expect(offer.current).toEqual([]);
    expect(upgradedSet(withUst, offer).simplifiedText).toBe(withUst.simplifiedText);
  });
});

describe('latestReleasesForSet — commit-only OBS image packs do not block text offers (#288)', () => {
  it('skips a missing obs-images release and keeps the other release results', async () => {
    const withImages = { ...EN, 'obs-images': EN_OBS_IMAGES };
    const lookup = vi.fn(async (repoPath: string) => {
      if (repoPath.endsWith('obs_images_360')) throw new Error('no published release');
      return release('v90', 'e');
    });
    const latest = await latestReleasesForSet(withImages, lookup);
    expect(Object.keys(latest)).not.toContain(withImages['obs-images'].repoPath);
    expect(Object.keys(latest)).toContain(EN.translationNotes.repoPath);
  });

  it('still reports a missing release for a text resource', async () => {
    await expect(latestReleasesForSet(EN, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });
});

describe('offerForSet — what differs from the pin is offered, by sha (D58)', () => {

  it('a differing LABEL with the same commit is not an upgrade — the sha is the identity', () => {
    const offer = offerForSet('primary', EN, { 'git.door43.org/unfoldingWord/en_tn': release('v89-rc', 'a') });
    expect(offer.upgrades).toEqual([]);
    expect(offer.current).toEqual([EN.translationNotes.repoPath]);
  });

  it('matches the repo path case-insensitively, like every other pin comparison', () => {
    const offer = offerForSet('primary', EN, { 'git.door43.org/unfoldingword/EN_TN': release('v90', 'e') });
    expect(offer.upgrades).toHaveLength(1);
  });

  it('upgradedSet moves every slot that names the repo and leaves the others byte-identical', () => {
    const offer = offerForSet('primary', EN, {
      'git.door43.org/unfoldingWord/en_tw': release('v90', 'g'),
    });
    const next = upgradedSet(EN, offer);
    expect(next.translationWordsLinks).toEqual({ repoPath: EN.translationWords.repoPath, version: 'v90', sha: sha('g'), flavor: 'parascriptural/x-bcvarticles' });
    expect(next.translationWords).toBe(next.translationWordsLinks);
    expect(next.translationNotes).toBe(EN.translationNotes);
    expect(next.translationAcademy).toBe(EN.translationAcademy);
    expect(next.translationQuestions).toBe(EN.translationQuestions);
    expect(next.gatewayLanguage).toBe(EN.gatewayLanguage);
  });
});

describe('applyUpgrade — per-set separation (D72: one offer, one step, per set)', () => {
  const resources = {
    schemaVersion: 2,
    languageSets: { primary: EN, fallback: EN },
    resources: { originalLanguage: { nt: pin('el-x-koine_ugnt', 'v0.34', '9', 'scripture/textTranslation') } },
    extraScripture: [{ id: 'ult', ...pin('en_ult', 'v89', '8', 'scripture/textTranslation') }],
  } as unknown as ResourcesFile;
  const latest = { 'git.door43.org/unfoldingWord/en_tn': release('v90', 'e') };

  it('upgrading the primary set leaves the fallback set, the groups and extraScripture the same objects', () => {
    const next = applyUpgrade(resources, offerForSet('primary', EN, latest));
    expect(next.languageSets.primary.translationNotes.sha).toBe(sha('e'));
    expect(next.languageSets.fallback).toBe(resources.languageSets.fallback);
    expect(next.resources).toBe(resources.resources);
    expect(next.extraScripture).toBe(resources.extraScripture);
    expect(JSON.stringify(next.languageSets.fallback)).toBe(JSON.stringify(EN));
  });

  it('the two sets carry separate offers even when they pin the same release', () => {
    const primary = offerForSet('primary', EN, latest);
    const fallback = offerForSet('fallback', EN, latest);
    expect(primary.rung).toBe('primary');
    expect(fallback.rung).toBe('fallback');
    const afterPrimary = applyUpgrade(resources, primary);
    expect(afterPrimary.languageSets.fallback.translationNotes.sha).toBe(sha('a'));
    const afterBoth = applyUpgrade(afterPrimary, fallback);
    expect(afterBoth.languageSets.fallback.translationNotes.sha).toBe(sha('e'));
    expect(afterBoth.languageSets.primary).toBe(afterPrimary.languageSets.primary);
  });
});

describe('offerIsStale — an offer applies only to the set it was computed from (Codex round 1)', () => {
  const latest = { 'git.door43.org/unfoldingWord/en_tn': release('v90', 'e') };
  const offer = offerForSet('primary', EN, latest);

  it('the set it was computed from is not stale', () => {
    expect(offerIsStale(offer, EN)).toBe(false);
  });

  it('another project\'s set — a different pinned commit, or another language — is stale', () => {
    expect(offerIsStale(offer, { ...EN, translationNotes: pin('en_tn', 'v88', 'z') })).toBe(true);
    const ES: LanguageSet = { ...EN, gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' }, translationNotes: { ...pin('es-419_tn', 'v66', 'x'), repoPath: 'git.door43.org/es-419_gl/es-419_tn' } };
    expect(offerIsStale(offer, ES)).toBe(true);
    expect(offerIsStale(offer, undefined)).toBe(true);
  });

  it('pins that moved to the OFFERED release already are stale too — nothing left to move', () => {
    expect(offerIsStale(offer, upgradedSet(EN, offer))).toBe(true);
  });
});

describe('latestRelease — the tag and date from releases/latest, the commit from the tags oracle', () => {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body }) as unknown as Response;

  it('joins the two DCS answers', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('/releases/latest')) return json({ tag_name: 'v90', published_at: '2026-08-17T19:15:10Z' });
      return json([{ name: 'v90', commit: { sha: sha('e') } }, { name: 'v89', commit: { sha: sha('a') } }]);
    }) as unknown as typeof fetch;
    const info = await latestRelease('git.door43.org/unfoldingWord/en_tn', fetchFn);
    expect(info).toEqual({ tag: 'v90', sha: sha('e'), publishedAt: '2026-08-17T19:15:10Z' });
    expect(calls[0]).toBe('https://git.door43.org/api/v1/repos/unfoldingWord/en_tn/releases/latest');
  });

  it('a repo with no release, or a tag DCS names no commit for, is an error — never a guessed offer', async () => {
    const none = (async () => json({}, false)) as unknown as typeof fetch;
    await expect(latestRelease('git.door43.org/unfoldingWord/en_tn', none)).rejects.toThrow(/no published release/);
    const noSha = (async (url: string) =>
      url.endsWith('/releases/latest') ? json({ tag_name: 'v90' }) : json([])) as unknown as typeof fetch;
    await expect(latestRelease('git.door43.org/unfoldingWord/en_tn', noSha)).rejects.toThrow(/names no commit/);
  });
});

describe('installReleaseSet — all or nothing, and an installed identity is not fetched again', () => {
  const api = () => {
    const settings: Record<string, unknown> = {};
    return {
      getClientSettings: async () => settings,
      setClientSettings: async (_: string, next: Record<string, unknown>) => Object.assign(settings, next),
      getMetadataRaw: async () => ({}),
    };
  };
  const offer = offerForSet('primary', EN, {
    'git.door43.org/unfoldingWord/en_tn': release('v90', 'e'),
    'git.door43.org/unfoldingWord/en_tw': release('v90', 'g'),
    'git.door43.org/unfoldingWord/en_ta': release('v90', 'f'),
  });

  beforeEach(() => fetchAndInstallPin.mockReset());

  it('fetches every offered repo in order, and stops at the FIRST failure with the repo named', async () => {
    fetchAndInstallPin
      .mockResolvedValueOnce({ repoPath: 'x', revision: sha('e'), bytes: 1 })
      .mockRejectedValueOnce(new Error('pin SHA mismatch for en_tw v90'));
    await expect(installReleaseSet(api(), offer.upgrades, new Set(), {})).rejects.toThrow(/^en_tw v90: pin SHA mismatch/);
    // en_tn was fetched, en_tw failed, en_ta was never attempted — nothing
    // downstream (pins, decisions) runs, because the caller has not started.
    expect(fetchAndInstallPin).toHaveBeenCalledTimes(2);
    expect(fetchAndInstallPin.mock.calls[0][0]).toMatchObject({ repoPath: EN.translationNotes.repoPath, version: 'v90', sha: sha('e') });
  });

  it('skips a repo whose new identity this machine already holds (verified at its own install)', async () => {
    fetchAndInstallPin.mockResolvedValue({ repoPath: 'x', revision: sha('f'), bytes: 1 });
    const installed = { '_local_/_sideloaded_/en_tw': { ...EN.translationWords, version: 'v90', sha: sha('g') } };
    const progress: string[] = [];
    await installReleaseSet(api(), offer.upgrades, new Set(), installed, (repo: string) => progress.push(repo));
    expect(progress).toEqual(['en_tn', 'en_ta']);
    expect(fetchAndInstallPin).toHaveBeenCalledTimes(2);
  });

  it('an occupied canonical path installs the new identity side by side (round 20 rule)', async () => {
    fetchAndInstallPin.mockResolvedValue({ repoPath: 'x', revision: sha('e'), bytes: 1 });
    const local = new Set(['_local_/_sideloaded_/unfoldingword--en_tn']);
    await installReleaseSet(api(), offer.upgrades.slice(0, 1), local, {});
    const [, opts] = fetchAndInstallPin.mock.calls[0];
    expect(opts.targetRepoPath).toBe(`_local_/_sideloaded_/unfoldingword--en_tn--${sha('e').slice(0, 12)}`);
  });
});
