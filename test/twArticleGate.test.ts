// #643 — a tW check item exists only when the resolving set's tw pin carries
// its article. The owner ruling [decided 2026-10-12, issue #643]: a TWL row
// whose article the tw pin does not carry derives no item (not shown, not
// counted), and fallback is per book only (§5.2/§5.3), never per article.
//
// Ways this can fail, written before the code (AGENTS.md "How to test" 3):
//   1. the gate is not applied: the 2SA `arcofthecovenant` row derives;
//   2. the gate hides everything: an article set that is present and non-empty
//      still drops rows whose article IS carried (TIT v91 must lose nothing);
//   3. the key form is misread: the `ingredients/` prefix, the `.md` suffix or
//      the category folder is mishandled, so the wrong rows go (2SA keeps 3315
//      of 3316 rows, TIT keeps 182 of 182);
//   4. the gate reaches the wrong tool: a tN derivation given the article set
//      must not change;
//   5. the progress total still counts the hidden row;
//   6. the article opens from the fallback set when the primary set lacks it;
//   7. the carry-over deletes the decision on the hidden row, or keeps it
//      counted, instead of invalidating and retaining it (D36);
//   8. a failed metadata read becomes an empty set and hides every item, or
//      becomes "no gate" and lets the hidden row through: the session must
//      fail with a stated error instead.
// Every input is the system's own: the en_tw v91 export (the pin shipped in
// installedSuite.js, sha ff5b385…), vendored whole in test/fixtures/resources.
import { describe, expect, it } from 'vitest';
import {
  deriveForProject,
  deriveTwlItems,
  progressOf,
  twArticlesOf,
} from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';
import { carryOverDecisions } from '../src/data/carryOver';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import { localRepoPathFromRepoPath } from '../src/data/installed';
import { __helpReadsForTests, __obsCheckForTests } from '../src/state.jsx';
import type { DecisionFile } from '../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const FIX = path.resolve(process.cwd(), 'test/fixtures/resources');
const read = (p: string): string => fs.readFileSync(path.join(FIX, p), 'utf8');

const TW_META = JSON.parse(read('en_tw@v91/metadata.json'));
const TWL_2SA = read('en_tw@v91/2SA.tsv');
const TWL_TIT = read('en_tw@v91/TIT.tsv');
const TN_TIT = read('en_tn@v91/TIT.tsv');
const TW_PIN = INSTALLED_SUITE.languageSets.primary.translationWords;
const HIDDEN = { checkId: 'vwrw', article: 'kt/arcofthecovenant' };

const articles = twArticlesOf(TW_META);
const derive = (tsv: string, bookId: string, twArticles?: ReadonlySet<string>) =>
  deriveForProject({ tsv, tool: 'translationWords', bookId, from: 'eng', to: 'eng', schemes: {}, twArticles });

describe('twArticlesOf — the articles a tw pin carries, from its metadata ingredient list', () => {
  it('reads `payload/<category>/<slug>.md` entries only, with or without the ingredients/ prefix', () => {
    expect(articles.size).toBe(953);
    expect(articles.has('kt/arkofthecovenant')).toBe(true);
    expect(articles.has(HIDDEN.article)).toBe(false);
    expect(twArticlesOf({ ingredients: { 'payload/kt/god.md': {}, 'ingredients/payload/config.yaml': {}, 'ingredients/TIT.tsv': {} } })).toEqual(new Set(['kt/god']));
    expect(twArticlesOf({ ingredients: {} }).size).toBe(0);
  });
});

describe('derive gate (§4.2, #643)', () => {
  it('2SA: the row whose article the pin does not carry derives no item; the rest are unchanged', async () => {
    const ungated = deriveTwlItems(TWL_2SA, '2sa');
    expect(ungated.length).toBe(3316);
    expect(ungated.filter((i) => i.contextId.checkId === HIDDEN.checkId).map((i) => `${i.category}/${i.contextId.groupId}`)).toEqual([HIDDEN.article]);
    const { items } = await derive(TWL_2SA, '2sa', articles);
    expect(items.length).toBe(3315);
    expect(items.some((i) => i.contextId.checkId === HIDDEN.checkId)).toBe(false);
    expect(progressOf(items)).toEqual({ decided: 0, total: 3315 });
    // nothing else moved
    const kept = new Set(items.map((i) => i.contextId.checkId));
    expect(ungated.filter((i) => !kept.has(i.contextId.checkId)).map((i) => i.contextId.checkId)).toEqual([HIDDEN.checkId]);
  });

  it('TIT with the English v91 pins: every article exists, so the list equals the ungated one', async () => {
    const ungated = await derive(TWL_TIT, 'tit');
    const gated = await derive(TWL_TIT, 'tit', articles);
    expect(ungated.items.length).toBe(182);
    expect(gated.items).toEqual(ungated.items);
  });

  it('without an article set the derivation is unchanged (no gate), and an empty set hides every row', async () => {
    expect((await derive(TWL_2SA, '2sa')).items.length).toBe(3316);
    expect((await derive(TWL_2SA, '2sa', new Set())).items.length).toBe(0);
  });

  it('a tN derivation ignores the article set', async () => {
    const plain = await deriveForProject({ tsv: TN_TIT, tool: 'translationNotes', bookId: 'tit', from: 'eng', to: 'eng', schemes: {} });
    const given = await deriveForProject({ tsv: TN_TIT, tool: 'translationNotes', bookId: 'tit', from: 'eng', to: 'eng', schemes: {}, twArticles: new Set() });
    expect(plain.items.length).toBeGreaterThan(0);
    expect(given.items).toEqual(plain.items);
  });
});

describe('no per-article fallback (owner ruling, §5.2/§5.3)', () => {
  const primary = { translationWords: { repoPath: 'git.door43.org/Es-419_gl/es-419_tw', version: 'v37', sha: 'a'.repeat(40) } };
  const fallback = { translationWords: TW_PIN };
  const fallbackRepo = localRepoPathFromRepoPath(TW_PIN.repoPath);

  it('an article present only in the fallback set does not open from the primary set', async () => {
    const asked: string[] = [];
    const api = {
      readIngredient: async (repoPath: string, ipath: string) => {
        asked.push(repoPath);
        if (repoPath === fallbackRepo && ipath === `payload/${HIDDEN.article}.md`) return '# Ark of the covenant\n\nbody';
        throw Object.assign(new Error('not found'), { isNotFound: true });
      },
    };
    expect(await __helpReadsForTests.readHelpArticle(api, 'tw', primary, 'kt', 'arcofthecovenant')).toBeNull();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((repo) => repo !== fallbackRepo)).toBe(true);
    // control: the fallback set itself finds it
    expect(await __helpReadsForTests.readHelpArticle(api, 'tw', fallback, 'kt', 'arcofthecovenant')).toMatchObject({ title: 'Ark of the covenant' });
  });

  it('the check session derives against the resolving rung’s tw pin only: the item stays hidden', async () => {
    const sessionItems = async (apiClient: Record<string, unknown>) => {
      const pre = { tool: 'translationWords', state: 'ready', resolution: { tool: 'translationWords', book: '2SA', pin: TW_PIN, rung: 'primary', usedFallback: false } };
      const st = { project: { flavor: 'textTranslation' }, projectPins: { languageSets: { primary: fallback, fallback } }, projectScope: {}, book: '2SA' };
      const actions = { projectFrame: async () => ({ state: 'ready', name: 'eng', schemes: {} }) };
      return __obsCheckForTests.deriveCheckItems({ apiClient, actions, st, tool: 'translationWords', book: '2SA', pre });
    };
    const api = {
      readIngredient: async (_repo: string, ipath: string) => {
        if (ipath === '2SA.tsv') return TWL_2SA;
        throw Object.assign(new Error('not found'), { isNotFound: true });
      },
      getMetadataRaw: async () => TW_META,
    };
    const result = await sessionItems(api);
    expect(result.session).toBeUndefined();
    const derived = result.derived ?? [];
    expect(derived.length).toBe(3315);
    expect(derived.some((i: CheckItem) => i.contextId.checkId === HIDDEN.checkId)).toBe(false);
    // failure is not "no": a metadata read that fails must not hide every item,
    // and must not let the hidden row through — the session fails, stated.
    const failing = { ...api, getMetadataRaw: async () => { throw new Error('rig down'); } };
    await expect(sessionItems(failing)).rejects.toThrow('rig down');
    // a metadata table that lists no article is a server-side rewrite hazard
    // (PLATFORM-NOTES #48), never a tw resource: refuse, do not hide everything.
    const empty = { ...api, getMetadataRaw: async () => ({ ingredients: {} }) };
    await expect(sessionItems(empty)).rejects.toThrow(/no article/);
  });
});

describe('carry-over (D36): a stored decision on a hidden item is invalidated and kept', () => {
  const resource = { repoPath: TW_PIN.repoPath, version: TW_PIN.version, sha: TW_PIN.sha };
  const decidedOn = (item: CheckItem): CheckItem => ({
    ...item,
    selections: [{ text: 'ark', occurrence: 1, occurrences: 1 }],
    comments: false,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
  });

  it('the decision stays in the file, invalidated, not carried, not counted', async () => {
    const ungated = deriveTwlItems(TWL_2SA, '2sa');
    const hidden = ungated.find((i) => i.contextId.checkId === HIDDEN.checkId)!;
    const other = ungated.find((i) => i.contextId.checkId !== HIDDEN.checkId)!;
    const file = { schemaVersion: 1, tool: 'translationWords', book: '2SA', resource, decisions: [decidedOn(hidden), decidedOn(other)] } as unknown as DecisionFile;
    const { items } = await derive(TWL_2SA, '2sa', articles);
    const r = carryOverDecisions(file, items, resource);
    expect(r.carried).toBe(1);
    expect(r.invalidated).toBe(1);
    const stored = r.file.decisions.find((d) => d.contextId.checkId === HIDDEN.checkId)!;
    expect(stored).toMatchObject({ invalidated: true, status: 'invalid' });
    expect(stored.selections).toEqual([{ text: 'ark', occurrence: 1, occurrences: 1 }]);
    expect(r.file.decisions.length).toBe(2);
    // control: with no gate the same decision carries
    expect(carryOverDecisions(file, ungated, resource)).toMatchObject({ carried: 2, invalidated: 0 });
  });
});
