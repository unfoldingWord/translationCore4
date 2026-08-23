// Machine-scoped install record vs project-scoped pins (C2.1/C2.2 seam).
// An install is shared by every project; a pin belongs to one project (D30.3).
import { describe, expect, it } from 'vitest';
import {
  coverageFromLocal,
  isPinLocal,
  languageSetFromInstalled,
  localRepoPathFromRepoPath,
  readInstalled,
  recordInstalled,
  preferInstalledVersion,
  pinsPreferringInstalled,
  discoverOnDisk,
  INSTALLED_KEY,
} from '../src/data/installed';
import { orgForRepoName } from '../src/data/gateways';
import { resolveToolBook } from '../src/data/resolve';
import type { InstalledMap } from '../src/data/installed';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';

// Recorded installs carry the burrito's real flavor (D57): a pin with an
// empty flavor cannot journal, so the record paths fill it from metadata.
// Deterministic fake sha per (repo, version) — D58: identity is the sha, so
// the fixtures derive one from the same (repo, version) distinctions the
// tests were written with.
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};

const pin = (repo: string, version: string, sha?: string): ResourcePin => ({
  repoPath: `git.door43.org/${repo}`,
  version,
  flavor: repo.endsWith('_ta')
    ? 'peripheral/x-peripheralArticles'
    : repo.endsWith('_tn')
      ? 'parascriptural/x-bcvnotes'
      : 'parascriptural/x-bcvarticles',
  sha: sha ?? sha40(`${repo.toLowerCase()}@${version}`),
});

// Owner-qualified, lowercased local identity (B9): `<owner>--<repo>`.
const INSTALLED: InstalledMap = {
  '_local_/_sideloaded_/unfoldingword--en_tn': pin('unfoldingWord/en_tn', 'v89'),
  '_local_/_sideloaded_/unfoldingword--en_tw': pin('unfoldingWord/en_tw', 'v89'),
  '_local_/_sideloaded_/unfoldingword--en_ta': pin('unfoldingWord/en_ta', 'v89'),
  '_local_/_sideloaded_/es-419_gl--es-419_tn': pin('es-419_gl/es-419_tn', 'v66'),
};

// The platform's own summaries — uppercase book_codes [VERIFIED live].
const SUMMARIES = {
  '_local_/_sideloaded_/unfoldingword--en_tn': { book_codes: ['TIT', 'JON', 'HEB'] },
  '_local_/_sideloaded_/unfoldingword--en_tw': { book_codes: ['BIBLE'] },
  '_local_/_sideloaded_/unfoldingword--en_ta': { book_codes: ['TRANSLATE'] },
  '_local_/_sideloaded_/es-419_gl--es-419_tn': { book_codes: ['TIT', 'JON'] },
  '_local_/_sideloaded_/orphan': { book_codes: ['TIT'] },
} as never;

describe('coverage comes from the platform summaries, keyed by pin identity', () => {
  it('keys coverage by repoPath AS DCS REPORTS IT, not by local path', () => {
    // The stored form is the catalogue's own form — nothing is converted on the
    // way in (owner ruling, 2026-08-04).
    const cov = coverageFromLocal(SUMMARIES, INSTALLED);
    expect(cov['git.door43.org/unfoldingWord/en_tn']).toEqual(['TIT', 'JON', 'HEB']);
    expect(cov['git.door43.org/es-419_gl/es-419_tn']).toEqual(['TIT', 'JON']);
  });

  it('a pin written ELSEWHERE with a different org case still resolves — same address', () => {
    // Comparison-time tolerance, not a stored conversion. A DCS path is a
    // case-insensitive address, so a burrito written by another tool (or by an
    // earlier version of this one) must not read as "needs downloading" for a
    // resource that is on disk.
    const cov = coverageFromLocal(SUMMARIES, INSTALLED);
    const resources = {
      schemaVersion: 2,
      languageSets: {
        primary: {
          gatewayLanguage: { languageId: 'es-419', owner: 'Es-419_gl' },
          translationNotes: pin('Es-419_gl/es-419_tn', 'v66'),
          translationWordsLinks: pin('Es-419_gl/es-419_tw', 'v37'),
          translationWords: pin('Es-419_gl/es-419_tw', 'v37'),
          translationAcademy: pin('Es-419_gl/es-419_ta', 'v4'),
        },
        fallback: {
          gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
          translationNotes: pin('unfoldingWord/en_tn', 'v89'),
          translationWordsLinks: pin('unfoldingWord/en_tw', 'v89'),
          translationWords: pin('unfoldingWord/en_tw', 'v89'),
          translationAcademy: pin('unfoldingWord/en_ta', 'v89'),
        },
      },
      resources: {},
    } as unknown as ResourcesFile;
    const r = resolveToolBook(resources, 'translationNotes', 'TIT', cov);
    expect(r.rung).toBe('primary');
    // …and the pin reads as INSTALLED, in either casing.
    expect(isPinLocal(INSTALLED, pin('es-419_gl/es-419_tn', 'v66'))).toBe(true);
    expect(isPinLocal(INSTALLED, pin('Es-419_gl/es-419_tn', 'v66'))).toBe(true);
  });

  it('a repo on disk with no install record contributes NO coverage (safe direction)', () => {
    const cov = coverageFromLocal(SUMMARIES, INSTALLED);
    expect(Object.values(cov).flat()).not.toContain('ORPHAN');
    expect(Object.keys(cov)).toHaveLength(4);
  });
});

describe('pin identity is (repoPath, sha) — a different commit is not this pin (D58)', () => {
  it('recognises the installed version', () => {
    expect(isPinLocal(INSTALLED, pin('unfoldingWord/en_tn', 'v89'))).toBe(true);
  });

  it('rejects a different version of the same repo', () => {
    expect(isPinLocal(INSTALLED, pin('unfoldingWord/en_tn', 'v86'))).toBe(false);
  });

  it('rejects a repo that is not installed at all', () => {
    expect(isPinLocal(INSTALLED, pin('unfoldingWord/en_tq', 'v89'))).toBe(false);
  });

  it('maps a DCS repoPath to its OWNER-QUALIFIED sideloaded local path (B9)', () => {
    expect(localRepoPathFromRepoPath('git.door43.org/unfoldingWord/en_tn'))
      .toBe('_local_/_sideloaded_/unfoldingword--en_tn');
    // Same repo, different org CASE → same install dir (mirrors samePath).
    expect(localRepoPathFromRepoPath('git.door43.org/UnfoldingWord/EN_TN'))
      .toBe('_local_/_sideloaded_/unfoldingword--en_tn');
    // Two owners, same repo name → DISTINCT dirs (the collision B9 fixes).
    expect(localRepoPathFromRepoPath('git.door43.org/Xenizo/fr_tn'))
      .not.toBe(localRepoPathFromRepoPath('git.door43.org/MVHS/fr_tn'));
  });
});

describe('a language set is written only when the suite is COMPLETE (§5.3)', () => {
  it('builds primary from the installed pins, with both tW slots on <lang>_tw (D34)', () => {
    const set = languageSetFromInstalled(INSTALLED, { id: 'en', org: 'unfoldingWord' });
    expect(set).not.toBeNull();
    expect(set?.gatewayLanguage).toEqual({ languageId: 'en', owner: 'unfoldingWord' });
    expect(set?.translationWordsLinks).toEqual(set?.translationWords);
    expect(set?.translationWords.repoPath).toMatch(/_tw$/);
    expect(set?.translationNotes.version).toBe('v89');
  });

  it('REFUSES a partial suite — es-419 has notes installed but no words/academy', () => {
    expect(languageSetFromInstalled(INSTALLED, { id: 'es-419', org: 'Es-419_gl' })).toBeNull();
  });
});

describe('the record round-trips through per-client settings', () => {
  const fakeApi = () => {
    let store: Record<string, unknown> = {};
    return {
      api: {
        getClientSettings: async () => store,
        setClientSettings: async (_id: string, s: Record<string, unknown>) => { store = s; },
      },
      peek: () => store,
    };
  };

  it('records an install and reads it back', async () => {
    const { api, peek } = fakeApi();
    await recordInstalled(api as never, 'uw-tc4', '_local_/_sideloaded_/en_tn', pin('unfoldingWord/en_tn', 'v89', 'a'.repeat(40)));
    expect(Object.keys(peek()[INSTALLED_KEY] as object)).toEqual(['_local_/_sideloaded_/en_tn']);
    const back = await readInstalled(api as never, 'uw-tc4');
    expect(back['_local_/_sideloaded_/en_tn'].sha).toBe('a'.repeat(40));
  });

  it('merges, so a second download never erases the first', async () => {
    const { api } = fakeApi();
    await recordInstalled(api as never, 'uw-tc4', '_local_/_sideloaded_/en_tn', pin('unfoldingWord/en_tn', 'v89'));
    await recordInstalled(api as never, 'uw-tc4', '_local_/_sideloaded_/en_tw', pin('unfoldingWord/en_tw', 'v89'));
    expect(Object.keys(await readInstalled(api as never, 'uw-tc4')).sort())
      .toEqual(['_local_/_sideloaded_/en_tn', '_local_/_sideloaded_/en_tw']);
  });

  it('preserves unrelated client settings (e.g. the last-used ordering)', async () => {
    const { api, peek } = fakeApi();
    await (api as never as { setClientSettings: (a: string, b: unknown) => Promise<void> })
      .setClientSettings('uw-tc4', { lastUsed: { a: 1 } });
    await recordInstalled(api as never, 'uw-tc4', '_local_/_sideloaded_/en_tn', pin('unfoldingWord/en_tn', 'v89'));
    expect((peek() as { lastUsed: unknown }).lastUsed).toEqual({ a: 1 });
  });
});

describe('the machine record feeds the resolver end to end', () => {
  it('a project pinned to installed versions resolves tN per book across the ladder', () => {
    const set = languageSetFromInstalled(INSTALLED, { id: 'en', org: 'unfoldingWord' });
    const resources = {
      schemaVersion: 2,
      languageSets: { primary: set, fallback: set },
      resources: {},
    } as unknown as ResourcesFile;
    const coverage = coverageFromLocal(SUMMARIES, INSTALLED);
    expect(resolveToolBook(resources, 'translationNotes', 'TIT', coverage).rung).toBe('primary');
    // A book the installed tN does not cover resolves nowhere — the tool is
    // simply not offered, rather than silently deriving from the wrong text.
    expect(resolveToolBook(resources, 'translationNotes', 'REV', coverage).rung).toBeNull();
  });
});

describe('D59: the sha is the ONLY local-install identity — no version-label rung', () => {
  it('a matching version label over a DIFFERENT sha is NOT this pin', () => {
    // The tag is unenforced (D58): same repo, same label, different commit.
    const wanted = pin('unfoldingWord/en_tn', 'v89', 'a'.repeat(40));
    expect(isPinLocal(INSTALLED, wanted)).toBe(false);
  });

  it('a sha-less install record satisfies NO pin — it forces the identifying fetch', () => {
    const legacy: InstalledMap = {
      '_local_/_sideloaded_/unfoldingword--en_tn': {
        ...pin('unfoldingWord/en_tn', 'v89'),
        sha: undefined,
      } as never,
    };
    expect(isPinLocal(legacy, pin('unfoldingWord/en_tn', 'v89'))).toBe(false);
  });

  it('among coexisting installs, the version label never selects — only the sha', () => {
    // Two installs of one repo (the B16 mid-migration shape): the pin's sha
    // matches the SECOND entry while the label matches the first. The tag
    // rung would pick the wrong install.
    const twin: InstalledMap = {
      '_local_/_sideloaded_/en_tn': pin('unfoldingWord/en_tn', 'v89', 'b'.repeat(40)),
      '_local_/_sideloaded_/unfoldingword--en_tn': pin('unfoldingWord/en_tn', 'v88'),
    };
    const wanted = { ...pin('unfoldingWord/en_tn', 'v89'), sha: sha40('unfoldingword/en_tn@v88') };
    expect(isPinLocal(twin, wanted)).toBe(true);
  });

  it('preferInstalledVersion never adopts a label from a sha-less install record', () => {
    // Adopting the label while keeping the default sha fabricates a pin whose
    // sha and version describe different releases (D59 deletes the state).
    const legacy: InstalledMap = {
      '_local_/_sideloaded_/unfoldingword--en_tn': {
        ...pin('unfoldingWord/en_tn', 'v89'),
        sha: undefined,
      } as never,
    };
    const shipped = pin('unfoldingWord/en_tn', 'v86', 'c'.repeat(40));
    expect(preferInstalledVersion(legacy, shipped)).toEqual(shipped);
  });
});

describe('preferInstalledVersion — a fresh project pins what the machine has', () => {
  it('replaces the shipped default version with the installed one', () => {
    const shipped = pin('unfoldingWord/en_tn', 'v86', 'c'.repeat(40));
    const out = preferInstalledVersion(INSTALLED, shipped);
    expect(out.version).toBe('v89'); // INSTALLED holds v89
    expect(out.repoPath).toBe(shipped.repoPath);
  });

  it('leaves a pin alone when the machine has nothing for that repo', () => {
    const shipped = pin('unfoldingWord/en_tq', 'v86');
    expect(preferInstalledVersion(INSTALLED, shipped)).toEqual(shipped);
  });

  it('rewrites every slot of every rung, so a new project opens ready', () => {
    const shipped = {
      schemaVersion: 2,
      languageSets: {
        primary: {
          gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
          translationNotes: pin('unfoldingWord/en_tn', 'v86'),
          translationWordsLinks: pin('unfoldingWord/en_tw', 'v87'),
          translationWords: pin('unfoldingWord/en_tw', 'v87'),
          translationAcademy: pin('unfoldingWord/en_ta', 'v86'),
        },
        fallback: {
          gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
          translationNotes: pin('unfoldingWord/en_tn', 'v86'),
          translationWordsLinks: pin('unfoldingWord/en_tw', 'v87'),
          translationWords: pin('unfoldingWord/en_tw', 'v87'),
          translationAcademy: pin('unfoldingWord/en_ta', 'v86'),
        },
      },
    };
    const out = pinsPreferringInstalled(shipped, INSTALLED);
    for (const rung of ['primary', 'fallback'] as const) {
      expect(out.languageSets[rung].translationNotes).toMatchObject({ version: 'v89' });
      expect(out.languageSets[rung].translationWords).toMatchObject({ version: 'v89' });
      expect(out.languageSets[rung].translationAcademy).toMatchObject({ version: 'v89' });
    }
    // …and those pins are now local, so the preflight says ready.
    expect(isPinLocal(INSTALLED, out.languageSets.primary.translationNotes as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PLATFORM-NOTES #30 — a DCS export records the org name AS IT WAS AT EXPORT TIME.
// Measured live 2026-08-04: `Es-419_gl/es-419_tn` v66 (and es-419_tw v37,
// es-419_ta v4) declare `Idiomas-Puentes/...`; `GET /api/v1/orgs/
// Idiomas-Puentes` → 404, while `GET /api/v1/repos/Es-419_gl/es-419_tn`
// reports `full_name: es-419_gl/es-419_tn`. The org was renamed; the export
// was not regenerated. English never shows this — unfoldingWord was never
// renamed — so it is invisible until a SECOND gateway language is tested.
const metadataApi = (byPath: Record<string, string>) =>
  ({
    getMetadataRaw: async (localPath: string) => {
      const dcsKey = byPath[localPath];
      if (!dcsKey) throw new Error('no metadata');
      // A real export carries a 40-hex revision and its flavorType — both
      // identity halves discoverOnDisk records (D58).
      return {
        identification: { primary: { dcs: { [dcsKey]: { revision: sha40(dcsKey) } } } },
        type: { flavorType: { name: 'parascriptural', flavor: { name: 'x-bcvnotes' } } },
      };
    },
  }) as never;

describe('discovering resources that are on disk with no install record', () => {
  const summaries = {
    '_local_/_sideloaded_/es-419_tn': { book_codes: ['TIT'] },
  } as never;
  const api = metadataApi({ '_local_/_sideloaded_/es-419_tn': 'Idiomas-Puentes/es-419_tn' });

  it('uses the CONFIGURED org, not the stale one the export records', async () => {
    const found = await discoverOnDisk(api, summaries, {}, orgForRepoName);
    expect(found['_local_/_sideloaded_/es-419_tn'].repoPath)
      .toBe('git.door43.org/es-419_gl/es-419_tn');
  });

  it('without the resolver it would record the dead org — the defect this fixes', async () => {
    const found = await discoverOnDisk(api, summaries, {});
    expect(found['_local_/_sideloaded_/es-419_tn'].repoPath)
      .toBe('git.door43.org/Idiomas-Puentes/es-419_tn');
  });

  it('the revision always comes from the burrito itself, never from config', async () => {
    const found = await discoverOnDisk(api, summaries, {}, orgForRepoName);
    expect(found['_local_/_sideloaded_/es-419_tn'].sha).toBe(sha40('Idiomas-Puentes/es-419_tn'));
    // D58: no version label is invented — the burrito does not know its tag.
    expect(found['_local_/_sideloaded_/es-419_tn'].version).toBeUndefined();
  });

  it('a recorded install still wins — it additionally knows the release tag', async () => {
    const recorded = { '_local_/_sideloaded_/es-419_tn': pin('es-419_gl/es-419_tn', 'v66') };
    const found = await discoverOnDisk(api, summaries, recorded, orgForRepoName);
    expect(found['_local_/_sideloaded_/es-419_tn'].version).toBe('v66');
  });

  it('an AMBIGUOUS repo name falls back to the metadata: fr_tn has two publishers', async () => {
    // Xenizo and MVHS both publish French. Config cannot decide, so the
    // burrito's own record is the only evidence there is.
    const frSummaries = { '_local_/_sideloaded_/fr_tn': { book_codes: ['TIT'] } } as never;
    const frApi = metadataApi({ '_local_/_sideloaded_/fr_tn': 'Xenizo/fr_tn' });
    const found = await discoverOnDisk(frApi, frSummaries, {}, orgForRepoName);
    expect(orgForRepoName('fr_tn')).toBeNull();
    expect(found['_local_/_sideloaded_/fr_tn'].repoPath).toBe('git.door43.org/Xenizo/fr_tn');
  });

  it('a non-helps repo name resolves to no org (source texts are pinned elsewhere)', () => {
    expect(orgForRepoName('en_ult')).toBeNull();
    expect(orgForRepoName('el-x-koine_ugnt')).toBeNull();
    expect(orgForRepoName('en_tn')).toBe('unfoldingWord');
    expect(orgForRepoName('es-419_tw')).toBe('es-419_gl');
  });
});

describe('the whole point: a Spanish suite on disk resolves to a language set', () => {
  it('languageSetFromInstalled finds it ONLY because the org was corrected', async () => {
    const summaries = {
      '_local_/_sideloaded_/es-419_tn': { book_codes: ['TIT'] },
      '_local_/_sideloaded_/es-419_tw': { book_codes: ['TIT'] },
      '_local_/_sideloaded_/es-419_ta': { book_codes: ['TRANSLATE'] },
    } as never;
    const api = metadataApi({
      '_local_/_sideloaded_/es-419_tn': 'Idiomas-Puentes/es-419_tn',
      '_local_/_sideloaded_/es-419_tw': 'Idiomas-Puentes/es-419_tw',
      '_local_/_sideloaded_/es-419_ta': 'Idiomas-Puentes/es-419_ta',
    });
    const gateway = { id: 'es-419', org: 'es-419_gl' };

    const stale = await discoverOnDisk(api, summaries, {});
    expect(languageSetFromInstalled(stale, gateway)).toBeNull(); // suite "incomplete"

    // D58: with the org corrected the suite is complete AND pinnable — its
    // burrito metadata carries the identity (sha) and flavor; no version tag
    // is needed (the sha IS the identity, the tag a display label).
    const fixed = await discoverOnDisk(api, summaries, {}, orgForRepoName);
    const set = languageSetFromInstalled(fixed, gateway);
    expect(set).not.toBeNull();
    expect(set?.translationNotes.repoPath).toBe('git.door43.org/es-419_gl/es-419_tn');
    expect(set?.translationNotes.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(set?.translationNotes.version).toBeUndefined();
    expect(set?.translationWords.repoPath).toBe('git.door43.org/es-419_gl/es-419_tw');
    expect(set?.translationWordsLinks.repoPath).toBe('git.door43.org/es-419_gl/es-419_tw'); // D34
  });
});
