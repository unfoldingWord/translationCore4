// #644 (D96, amends D34): the English suite pins `en_twl` for the TWL check
// lists and `en_tw` for the articles — two pins, each at its own commit. Every
// TWL read goes through the `translationWordsLinks` slot and every article read
// through `translationWords`; the TSVs a `_tw` export carries and the articles a
// `_twl` export carries are ignored, never stripped (ruling 5).
//
// Ways this can fail, written before the fix:
//   - the bundled suite still names `en_tw` in the twl slot (one-repo form);
//   - a TWL read resolves through the tw pin's path, so the tw export's TSVs
//     (built from `en_twl` master, not a release) drive the check list;
//   - an article read resolves through the twl pin's path;
//   - tW coverage is keyed to the tw pin (`BIBLE`, whole collection), so a book
//     no `en_twl` release contains still resolves;
//   - the twl pin's commit is not the commit the export declares.
// Inputs are the system's own: the real DCS export slices under
// test/fixtures/resources (their TIT TSVs differ: 188 vs 182 derivable rows),
// the export's own metadata for coverage, and the bundled pin identities.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { localRepoPathFromRepoPath, coverageFromLocal } from '../src/data/installed';
import { EN_HELPS, INSTALLED_SUITE } from '../src/data/installedSuite';
import { pinKey, resolveToolBook, covers } from '../src/data/resolve';
import { consequencesOfGatewayChange } from '../src/data/gatewayChange';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';
import { journalingRig } from './helpers/journalingRig';
import { __obsCheckForTests as check, __helpReadsForTests as reads } from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const fixture = (rel: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/resources', rel), 'utf8');
const metadataOf = (dir: string): { identification: { primary: { dcs: Record<string, { revision: string }> } }; ingredients: Record<string, unknown> } =>
  JSON.parse(fixture(`${dir}/metadata.json`));
const pinOf = (dir: string): ResourcePin => {
  const meta = metadataOf(dir);
  const [identity, { revision }] = Object.entries(meta.identification.primary.dcs)[0];
  return { repoPath: `git.door43.org/${identity}`, version: dir.split('@')[1], sha: revision, flavor: 'parascriptural/x-bcvarticles' };
};

const TWL_V86 = pinOf('en_twl@v86'); // 570e76…
const TW_V87 = pinOf('en_tw@v87'); // eaeb7bf…
const TWL_TSV = fixture('en_twl@v86/TIT.tsv');
const TW_TSV = fixture('en_tw@v87/TIT.tsv');
const TW_ARTICLE = fixture('en_tw@v87/payload-kt-god.md');
const TWL_ARTICLE = '# God\n\nThe article the twl export carries — never read.\n';

const localPath = (pin: ResourcePin) => localRepoPathFromRepoPath(pin.repoPath);

const englishOnly = (twl: ResourcePin, tw: ResourcePin): ResourcesFile => {
  const set = {
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    translationNotes: EN_HELPS.translationNotes,
    translationWordsLinks: twl,
    translationWords: tw,
    translationAcademy: EN_HELPS.translationAcademy,
  };
  return { schemaVersion: 2, languageSets: { primary: set, fallback: set } } as unknown as ResourcesFile;
};

/** The fake rig with both exports installed where the app reads them, and a
 * spy that keeps every ingredient read (repo + ipath). */
const rigWithBoth = () => {
  const rig = journalingRig();
  rig.createRepo(localPath(TWL_V86), { 'TIT.tsv': TWL_TSV, 'payload/kt/god.md': TWL_ARTICLE });
  // #643 keeps a row only when the tw pin lists its article. The fake tw repo
  // lists every article either TIT list links, so no row is hidden and the
  // count (188 vs 182) still shows which TSV was read.
  const twArticles = Object.fromEntries([...`${TWL_TSV}\n${TW_TSV}`.matchAll(/payload\/\w+\/[\w-]+\.md/g)]
    .map(([key]) => [key, '# stub\n']));
  rig.createRepo(localPath(TW_V87), { ...twArticles, 'TIT.tsv': TW_TSV, 'payload/kt/god.md': TW_ARTICLE });
  const readsSeen: Array<{ repo: string; ipath: string }> = [];
  const fetchFn: typeof rig.fetchFn = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/burrito/ingredient/raw/')) {
      readsSeen.push({
        repo: decodeURIComponent(url.pathname.split('/burrito/ingredient/raw/')[1]),
        ipath: decodeURIComponent(url.searchParams.get('ipath') ?? ''),
      });
    }
    return rig.fetchFn(input, init);
  };
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn });
  return { api, readsSeen };
};

const derive = async (api: ServerApi, resources: ResourcesFile, coverage: Record<string, string[]>) => {
  const resolution = resolveToolBook(resources, 'translationWords', 'TIT', coverage);
  const st = { project: { flavor: 'textTranslation', repoPath: '_local_/_local_/p' }, projectPins: resources, projectScope: {} };
  const actions = { projectFrame: async () => ({ state: 'ready', name: 'eng', schemes: {} }) };
  const result = await check.deriveCheckItems({ apiClient: api, actions, st, tool: 'translationWords', book: 'TIT', pre: { resolution } });
  return { resolution, items: result.derived ?? [] };
};

describe('#644 — the default English pins', () => {
  it('pin translationWordsLinks to en_twl v91 (7cbb3419…) and translationWords to en_tw v91 (ff5b3852…)', () => {
    for (const set of [EN_HELPS, INSTALLED_SUITE.languageSets.primary, INSTALLED_SUITE.languageSets.fallback]) {
      expect(set.translationWordsLinks).toEqual({
        repoPath: 'git.door43.org/unfoldingWord/en_twl',
        version: 'v91',
        sha: '7cbb3419f79780ce84b92ad7d42bd476cc5d8a64',
        flavor: 'parascriptural/x-bcvarticles',
      });
      expect(set.translationWords).toEqual({
        repoPath: 'git.door43.org/unfoldingWord/en_tw',
        version: 'v91',
        sha: 'ff5b3852c27c3a0d01b109e482eb26047dcd20e2',
        flavor: 'parascriptural/x-bcvarticles',
      });
    }
  });

  it('the twl pin names the commit the en_twl v91 export declares (its own metadata)', () => {
    const meta = metadataOf('en_twl@v91');
    expect(meta.identification.primary.dcs['unfoldingWord/en_twl'].revision).toBe(EN_HELPS.translationWordsLinks.sha);
  });
});

describe('#644 — TWL from the twl pin only (ruling 5: the tw export\'s TSVs are ignored)', () => {
  const coverage = { [pinKey(TWL_V86)]: ['TIT'], [pinKey(TW_V87)]: ['BIBLE'] };

  it('derives the check list from the twl pin and reads no TSV under the tw pin\'s path', async () => {
    const { api, readsSeen } = rigWithBoth();
    const { resolution, items } = await derive(api, englishOnly(TWL_V86, TW_V87), coverage);
    expect(resolution.pin && pinKey(resolution.pin)).toBe(pinKey(TWL_V86));
    expect(items.length).toBe(188); // en_twl v86 TIT (fixtures README); en_tw v87 TIT has 182
    expect(readsSeen.filter((r) => r.ipath === 'TIT.tsv').map((r) => r.repo)).toEqual([localPath(TWL_V86)]);
    expect(readsSeen.some((r) => r.repo === localPath(TW_V87))).toBe(false);
  });

  it('negative control: with the tw pin in the twl slot (the one-repo form) the spy DOES see the tw path', async () => {
    const { api, readsSeen } = rigWithBoth();
    const { items } = await derive(api, englishOnly(TW_V87, TW_V87), coverage);
    expect(items.length).toBe(182);
    expect(readsSeen.filter((r) => r.ipath === 'TIT.tsv').map((r) => r.repo)).toEqual([localPath(TW_V87)]);
  });

  it('tW book coverage is keyed to the twl pin, not to the tw pin\'s whole-collection marker', () => {
    const resources = englishOnly(TWL_V86, TW_V87);
    const set = resources.languageSets.fallback;
    expect(covers(coverage, set.translationWordsLinks, 'TIT')).toBe(true);
    expect(covers(coverage, set.translationWordsLinks, 'JON')).toBe(false); // the tw pin's BIBLE marker would say true
    expect(resolveToolBook(resources, 'translationWords', 'JON', coverage).rung).toBeNull();
  });

  it('the gateway-change check resolves tW by the twl pin', () => {
    // A TIT decision file checked against the twl pin is unaffected by a change
    // whose next sets keep that pin; one checked against the tw pin is affected.
    const next = englishOnly(TWL_V86, TW_V87).languageSets;
    const stored = (pin: ResourcePin) => [{ tool: 'translationWords' as const, book: 'TIT', file: { decisions: [{}], resource: pin } }];
    expect(consequencesOfGatewayChange(stored(TWL_V86) as never, next, coverage).harmless).toBe(true);
    expect(consequencesOfGatewayChange(stored(TW_V87) as never, next, coverage).harmless).toBe(false);
  });
});

describe('#644 — articles from the tw pin only (ruling 5: the twl export\'s articles are ignored)', () => {
  it('opens the article from the tw pin and reads nothing under the twl pin\'s path', async () => {
    const { api, readsSeen } = rigWithBoth();
    const set = englishOnly(TWL_V86, TW_V87).languageSets.fallback;
    const article = await reads.readHelpArticle(api, 'tw', set, 'kt', 'god');
    expect(article?.body).toBe(TW_ARTICLE);
    expect(readsSeen.map((r) => r.repo)).toEqual([localPath(TW_V87)]);
  });

  it('negative control: with the twl pin in the tw slot the twl export\'s article is read', async () => {
    const { api, readsSeen } = rigWithBoth();
    const set = englishOnly(TWL_V86, TWL_V86).languageSets.fallback;
    const article = await reads.readHelpArticle(api, 'tw', set, 'kt', 'god');
    expect(article?.body).toBe(TWL_ARTICLE);
    expect(readsSeen.map((r) => r.repo)).toEqual([localPath(TWL_V86)]);
  });
});

describe('#644 — unreleased books: no rung covers a book that en_twl v91 does not contain', () => {
  // Coverage from the export's own metadata (the TSV ingredients it lists),
  // keyed to the bundled pin exactly as the platform summaries key it.
  const booksOf = (dir: string): string[] =>
    Object.keys(metadataOf(dir).ingredients)
      .map((k) => /^ingredients\/([A-Z0-9]{3})\.tsv$/.exec(k)?.[1])
      .filter((b): b is string => !!b);
  const installed = {
    [localPath(EN_HELPS.translationWordsLinks)]: EN_HELPS.translationWordsLinks,
    [localPath(EN_HELPS.translationWords)]: EN_HELPS.translationWords,
  };
  const summaries = {
    [localPath(EN_HELPS.translationWordsLinks)]: { book_codes: booksOf('en_twl@v91') },
    [localPath(EN_HELPS.translationWords)]: { book_codes: ['BIBLE'] }, // the articles: whole collection
  };
  const coverage = coverageFromLocal(summaries as never, installed);

  it('the v91 export lists 59 book TSVs', () => {
    expect(booksOf('en_twl@v91').length).toBe(59);
  });

  it.each(['1CH', '2CH', 'ECC', 'EZK', 'ISA', 'JER', 'NUM'])('%s resolves to no rung for tW', (book) => {
    const r = resolveToolBook(INSTALLED_SUITE as unknown as ResourcesFile, 'translationWords', book, coverage);
    expect(r.rung).toBeNull();
    expect(r.pin).toBeNull();
  });

  it('a released book (TIT) resolves to the twl pin', () => {
    const r = resolveToolBook(INSTALLED_SUITE as unknown as ResourcesFile, 'translationWords', 'TIT', coverage);
    expect(r.pin && pinKey(r.pin)).toBe(pinKey(EN_HELPS.translationWordsLinks));
  });
});
