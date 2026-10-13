// #646 slice 2 (D97, amends D34 and D17): a gateway set pins `<lang>_twl` for
// the TWL check lists, never `<lang>_tw` in that slot. A gateway organization
// with no `_twl` repository (ruling 7, `hasTwl: false`) pins the bundled
// English `en_twl` with its own `<lang>_tw`. The tW tool is ready only when
// BOTH pins of the resolving set are on this machine (the slice 2 criterion
// the owner added on #646).
//
// Ways this can fail, written before the fix:
//   - the selector still copies the tw pin into the twl slot (the one-repo
//     form) when `<lang>_twl` is not installed;
//   - a `hasTwl: true` gateway with no `_twl` installed borrows `en_twl`;
//   - a `hasTwl: false` gateway is reported incomplete, or its twl slot names
//     `ar_tw`, or its tw slot names `en_tw`;
//   - the ruling 7 set derives the check list from the tw pin, or opens the
//     article from the twl pin;
//   - a record whose pin equals both rungs resolves to the fallback;
//   - a missing tw pin leaves the tW tool "ready" (the preflight reads only
//     the twl slot), or names the twl pin as what is missing.
// Inputs are the system's own: the gateway entries of src/data/gateways.ts,
// the real DCS export slices under test/fixtures/resources (en_twl v86 TIT),
// and the bundled pin identities.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { languageSetFromInstalled, localRepoPathFromRepoPath } from '../src/data/installed';
import type { InstalledMap } from '../src/data/installed';
import { EN_HELPS } from '../src/data/installedSuite';
import { findGateway } from '../src/data/gateways';
import { pinKey, preflightToolBook, resolveToolBook } from '../src/data/resolve';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';
import { journalingRig } from './helpers/journalingRig';
import {
  __obsCheckForTests as check,
  __helpReadsForTests as reads,
  __rungPinningForTests as rungPinning,
} from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const fixture = (rel: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/resources', rel), 'utf8');
const TWL_TSV = fixture('en_twl@v86/TIT.tsv');
const twlMeta = JSON.parse(fixture('en_twl@v86/metadata.json')) as { identification: { primary: { dcs: Record<string, { revision: string }> } } };
const TWL_V86: ResourcePin = {
  repoPath: 'git.door43.org/unfoldingWord/en_twl',
  version: 'v86',
  sha: Object.values(twlMeta.identification.primary.dcs)[0].revision,
  flavor: 'parascriptural/x-bcvarticles',
};

// The gateway entries, from the catalogue config itself (ruling 7 is decided
// per organization: `ar_gt` publishes no `_twl`, `BSOJ` and `es-419_gl` do).
const AR_GT = findGateway('ar::ar_gt')!;
const BSOJ = findGateway('ar::BSOJ')!;
const ES = findGateway('es-419::es-419_gl')!;

const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};
const pin = (repo: string, version: string): ResourcePin => ({
  repoPath: `git.door43.org/${repo}`,
  version,
  sha: sha40(`${repo}@${version}`),
  flavor: repo.endsWith('_ta') ? 'peripheral/x-peripheralArticles' : repo.endsWith('_tn') ? 'parascriptural/x-bcvnotes' : 'parascriptural/x-bcvarticles',
});
const key = (repo: string) => `_local_/_sideloaded_/${repo.toLowerCase().replace('/', '--')}`;
const installedOf = (pins: ResourcePin[]): InstalledMap =>
  Object.fromEntries(pins.map((p) => [key(p.repoPath.replace('git.door43.org/', '')), p]));

// The bundled English suite (the identities src/data/installedSuite.js ships).
const ENGLISH = [EN_HELPS.translationNotes, EN_HELPS.translationWordsLinks, EN_HELPS.translationWords, EN_HELPS.translationAcademy];
const AR = [pin('ar_gt/ar_tn', 'v3.2'), pin('ar_gt/ar_tw', 'v3'), pin('ar_gt/ar_ta', 'v3.3')];
const AR_TW = AR[1];

describe('#646 ruling 7 — a gateway with no `_twl` repository pins the bundled en_twl with its own tw', () => {
  it('ar_gt: the set is complete; twl = en_twl (the bundled identity), tw = ar_tw', () => {
    const set = languageSetFromInstalled(installedOf([...ENGLISH, ...AR]), AR_GT);
    expect(set).not.toBeNull();
    expect(set?.gatewayLanguage).toEqual({ languageId: 'ar', owner: 'ar_gt' });
    expect(set?.translationWordsLinks).toEqual(EN_HELPS.translationWordsLinks);
    expect(set?.translationWords).toEqual(AR_TW);
    expect(set?.translationNotes).toEqual(AR[0]);
    expect(set?.translationAcademy).toEqual(AR[2]);
  });

  it('ar_gt without the bundled en_twl installed is incomplete (the twl slot never names ar_tw)', () => {
    const noTwl = ENGLISH.filter((p) => !p.repoPath.endsWith('/en_twl'));
    expect(languageSetFromInstalled(installedOf([...noTwl, ...AR]), AR_GT)).toBeNull();
  });
});

describe('#646 — `hasTwl` decides, not "not installed"', () => {
  const ES_NO_TWL = [pin('es-419_gl/es-419_tn', 'v66'), pin('es-419_gl/es-419_tw', 'v37'), pin('es-419_gl/es-419_ta', 'v4')];

  it('a hasTwl: true gateway whose `_twl` is not installed has an incomplete set, with en_twl on the machine', () => {
    expect(languageSetFromInstalled(installedOf([...ENGLISH, ...ES_NO_TWL]), ES)).toBeNull();
  });

  it('control: with es-419_twl installed the same gateway is complete, and the twl slot names es-419_twl', () => {
    const esTwl = pin('es-419_gl/es-419_twl', 'v18');
    const set = languageSetFromInstalled(installedOf([...ENGLISH, ...ES_NO_TWL, esTwl]), ES);
    expect(set?.translationWordsLinks).toEqual(esTwl);
    expect(set?.translationWords.repoPath).toBe('git.door43.org/es-419_gl/es-419_tw');
  });

  it('the check is per organization: BSOJ (hasTwl: true) with no ar_twl installed is incomplete, while ar_gt is complete', () => {
    const bsoj = [pin('BSOJ/ar_tn', 'v6.1'), pin('BSOJ/ar_tw', 'v5'), pin('BSOJ/ar_ta', 'v3')];
    const installed = installedOf([...ENGLISH, ...AR, ...bsoj]);
    expect(languageSetFromInstalled(installed, BSOJ)).toBeNull();
    expect(languageSetFromInstalled(installed, AR_GT)?.translationWords).toEqual(AR_TW);
  });

  it('a gateway passed without hasTwl is strict: no `_twl` installed → no set', () => {
    expect(languageSetFromInstalled(installedOf([...ENGLISH, ...ES_NO_TWL]), { id: 'es-419', org: 'es-419_gl' })).toBeNull();
  });
});

/** An ar_gt project: the ruling 7 primary set over the English fallback, so
 * `translationWordsLinks` is the same en_twl identity on both rungs. */
const arabicProject = (): ResourcesFile => {
  const primary = {
    gatewayLanguage: { languageId: 'ar', owner: 'ar_gt' },
    translationNotes: AR[0],
    translationWordsLinks: TWL_V86,
    translationWords: AR_TW,
    translationAcademy: AR[2],
  };
  const fallback = {
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    translationNotes: EN_HELPS.translationNotes,
    translationWordsLinks: TWL_V86,
    translationWords: EN_HELPS.translationWords,
    translationAcademy: EN_HELPS.translationAcademy,
  };
  return { schemaVersion: 2, languageSets: { primary, fallback } } as unknown as ResourcesFile;
};
const coverage = { [pinKey(TWL_V86)]: ['TIT'], [pinKey(AR_TW)]: ['BIBLE'], [pinKey(EN_HELPS.translationWords)]: ['BIBLE'] };
const localPath = (p: ResourcePin) => localRepoPathFromRepoPath(p.repoPath);
const AR_ARTICLE = '# الله\n\nThe Arabic article, read from ar_tw.\n';
const EN_ARTICLE = '# God\n\nThe English article — never read in an ar_gt project.\n';

/** The fake rig: en_twl (the TSV), ar_tw (every article the TSV links, so the
 * §4.2 gate of #643 hides no row) and en_tw, with a spy on every ingredient read. */
const rigWithArabic = () => {
  const rig = journalingRig();
  const linked = Object.fromEntries([...TWL_TSV.matchAll(/payload\/\w+\/[\w-]+\.md/g)].map(([k]) => [k, '# stub\n']));
  rig.createRepo(localPath(TWL_V86), { 'TIT.tsv': TWL_TSV, 'payload/kt/god.md': EN_ARTICLE });
  rig.createRepo(localPath(AR_TW), { ...linked, 'payload/kt/god.md': AR_ARTICLE });
  rig.createRepo(localPath(EN_HELPS.translationWords), { ...linked, 'payload/kt/god.md': EN_ARTICLE });
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
  return { api: new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn }), readsSeen };
};

describe('#646 ruling 7 — in an ar_gt project the items come from en_twl and the articles from ar_tw', () => {
  it('derives the TIT check list from the en_twl pin of the primary rung and reads no TSV elsewhere', async () => {
    const { api, readsSeen } = rigWithArabic();
    const resources = arabicProject();
    const resolution = resolveToolBook(resources, 'translationWords', 'TIT', coverage);
    expect(resolution.rung).toBe('primary');
    expect(resolution.pin && pinKey(resolution.pin)).toBe(pinKey(TWL_V86));
    const st = { project: { flavor: 'textTranslation', repoPath: '_local_/_local_/p' }, projectPins: resources, projectScope: {} };
    const actions = { projectFrame: async () => ({ state: 'ready', name: 'eng', schemes: {} }) };
    const result = await check.deriveCheckItems({ apiClient: api, actions, st, tool: 'translationWords', book: 'TIT', pre: { resolution } });
    expect((result.derived ?? []).length).toBe(188); // en_twl v86 TIT (fixtures README)
    expect(readsSeen.filter((r) => r.ipath === 'TIT.tsv').map((r) => r.repo)).toEqual([localPath(TWL_V86)]);
    expect(readsSeen.some((r) => r.repo === localPath(AR_TW))).toBe(false);
  });

  it('opens the article from ar_tw and reads nothing under en_twl or en_tw', async () => {
    const { api, readsSeen } = rigWithArabic();
    const article = await reads.readHelpArticle(api, 'tw', arabicProject().languageSets.primary, 'kt', 'god');
    expect(article?.body).toBe(AR_ARTICLE);
    expect(readsSeen.map((r) => r.repo)).toEqual([localPath(AR_TW)]);
  });
});

describe('#646 — equal pins on two rungs resolve to primary (the app half; the harness half is in conformance/validate.mjs)', () => {
  it('rungPinning: the en_twl pin that both rungs carry is pinned by `primary`', () => {
    expect(rungPinning(arabicProject(), 'translationWordsLinks', TWL_V86)).toBe('primary');
  });

  it('control: a pin only the fallback carries is pinned by `fallback`, and a foreign pin by no rung', () => {
    const resources = arabicProject();
    expect(rungPinning(resources, 'translationWords', EN_HELPS.translationWords)).toBe('fallback');
    expect(rungPinning(resources, 'translationWords', pin('BSOJ/ar_tw', 'v5'))).toBeNull();
  });

  it('a tW resolution for a covered book lands on primary, never on the fallback that pins the same identity', () => {
    const r = resolveToolBook(arabicProject(), 'translationWords', 'TIT', coverage);
    expect(r.rung).toBe('primary');
    expect(r.usedFallback).toBe(false);
  });
});

describe('#646 — the tw pin must be local: a tW tool whose resolving set lacks its `translationWords` pin is not ready', () => {
  const only = (...local: ResourcePin[]) => (p: ResourcePin) => local.some((l) => pinKey(l) === pinKey(p));

  it('twl installed, tw not installed, online → fetch, and the missing pin named is the tw pin', () => {
    const pre = preflightToolBook(arabicProject(), 'translationWords', 'TIT', { coverage, isLocal: only(TWL_V86), online: true });
    expect(pre.state).toBe('fetch');
    expect(pre.resolution?.rung).toBe('primary');
    expect(pre.needs && pinKey(pre.needs)).toBe(pinKey(AR_TW));
  });

  it('the same, offline → unavailable, as a missing twl pin is; the fix screen still names the tw pin', () => {
    const missingTw = preflightToolBook(arabicProject(), 'translationWords', 'TIT', { coverage, isLocal: only(TWL_V86), online: false });
    const missingTwl = preflightToolBook(arabicProject(), 'translationWords', 'TIT', { coverage, isLocal: only(AR_TW), online: false });
    expect(missingTw.state).toBe('unavailable');
    expect(missingTw.state).toBe(missingTwl.state);
    expect(missingTw.needs && pinKey(missingTw.needs)).toBe(pinKey(AR_TW));
    expect(missingTwl.needs && pinKey(missingTwl.needs)).toBe(pinKey(TWL_V86));
  });

  it('control: twl not installed, tw installed → fetch names the twl pin (unchanged); both installed → ready', () => {
    const missingTwl = preflightToolBook(arabicProject(), 'translationWords', 'TIT', { coverage, isLocal: only(AR_TW), online: true });
    expect(missingTwl.state).toBe('fetch');
    expect(missingTwl.needs && pinKey(missingTwl.needs)).toBe(pinKey(TWL_V86));
    const both = preflightToolBook(arabicProject(), 'translationWords', 'TIT', { coverage, isLocal: only(TWL_V86, AR_TW), online: true });
    expect(both.state).toBe('ready');
    expect(both.needs).toBeNull();
  });

  it('the rule reads the RESOLVING set: a book the fallback resolves needs the fallback tw, not the primary one', () => {
    // A Spanish primary that covers TIT only; MRK resolves to the English
    // fallback, whose en_tw is not on the machine while ar/es tw is.
    const es = pin('es-419_gl/es-419_twl', 'v18');
    const esTw = pin('es-419_gl/es-419_tw', 'v37');
    const resources = arabicProject();
    resources.languageSets.primary = { ...resources.languageSets.primary, gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' }, translationWordsLinks: es, translationWords: esTw };
    const cov = { ...coverage, [pinKey(es)]: ['TIT'], [pinKey(esTw)]: ['BIBLE'], [pinKey(TWL_V86)]: ['TIT', 'MRK'] };
    const pre = preflightToolBook(resources, 'translationWords', 'MRK', { coverage: cov, isLocal: only(es, esTw, TWL_V86), online: true });
    expect(pre.resolution?.rung).toBe('fallback');
    expect(pre.state).toBe('fetch');
    expect(pre.needs && pinKey(pre.needs)).toBe(pinKey(EN_HELPS.translationWords));
  });

  it('the tw rule is tW-only: a tN tool with no tw pin installed stays ready', () => {
    const pre = preflightToolBook(arabicProject(), 'translationNotes', 'TIT', {
      coverage: { ...coverage, [pinKey(AR[0])]: ['TIT'] }, isLocal: only(AR[0]), online: true,
    });
    expect(pre.state).toBe('ready');
  });
});
