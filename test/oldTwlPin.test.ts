// #646 slice 3 (D97 ruling 6): a project whose `translationWordsLinks` pin does
// not name a `_twl` repository comes from a pre-release build. The app reads no
// TWL from that pin and tells the user to create the project again.
//
// Ways this can fail, written before the code (AGENTS.md "How to test" 3):
//   1. the open does not notice the old form                   → TWL is read from the `<lang>_tw` pin
//   2. the old form on the FALLBACK rung only passes            → same, through the English fallback
//   3. an OBS project's fallback old form passes                → no message on an OBS project
//   4. the two-repo form, or the ruling 7 form, is flagged      → a good project is told to recreate
//   5. the Check preflight still reports tW 'ready'             → the picker derives the list (a TSV read)
//   6. Understand's Words tab reads the TSV, or says 'none'     → a read, or a false absence claim (D30)
//   7. a locale lacks the message                               → English, or the raw key, on screen
import { describe, expect, it, vi } from 'vitest';
import {
  __loadProjectPinsForTests as loadPins,
  __performLoadUnderstandForTests as loadUnderstand,
  __performRunPreflightForTests as performRunPreflight,
  __reducerForTests as reducer,
  __setInstalledCacheForTests as setInstalledCache,
} from '../src/state.jsx';
import { localRepoPathFromRepoPath } from '../src/data/installed';
import { oldTwlPin, pinKey } from '../src/data/resolve';
import type { LanguageSet, ResourcePin, ResourcesFile } from '../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// The fixtures come from the reference samples (the two-repo form since
// BURRITO-SPEC 1.22). The old form is the same derivation the harness uses
// (conformance/validate.mjs, D97 ruling 6): the twl slot copies the tw pin.
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), p), 'utf8'));
const SAMPLE: ResourcesFile = readJson('conformance/sample-burrito/ingredients/checking/resources.json');
const OBS_SAMPLE: ResourcesFile = readJson('conformance/sample-burrito-obs/ingredients/checking/resources.json');
const oneRepo = (set: LanguageSet): LanguageSet => ({ ...set, translationWordsLinks: { ...set.translationWords } });
const withSets = (file: ResourcesFile, sets: Partial<ResourcesFile['languageSets']>): ResourcesFile => ({
  ...file,
  languageSets: { ...file.languageSets, ...sets },
});
const OLD_BOTH = withSets(SAMPLE, { primary: oneRepo(SAMPLE.languageSets.primary), fallback: oneRepo(SAMPLE.languageSets.fallback) });
const OLD_FALLBACK = withSets(SAMPLE, { fallback: oneRepo(SAMPLE.languageSets.fallback) });
const OLD_OBS = withSets(OBS_SAMPLE, { fallback: oneRepo(OBS_SAMPLE.languageSets.fallback) });
// Ruling 7: `en_twl` on both rungs with `ar_gt/ar_tw` (the harness fixture's shape).
const RULING7 = withSets(SAMPLE, {
  primary: {
    ...SAMPLE.languageSets.primary,
    gatewayLanguage: { languageId: 'ar', owner: 'ar_gt' },
    translationWordsLinks: { ...SAMPLE.languageSets.fallback.translationWordsLinks },
    translationWords: { ...SAMPLE.languageSets.primary.translationWords, repoPath: 'git.door43.org/ar_gt/ar_tw' },
  },
});

describe('D97 ruling 6 — the old-form twl pin is detected on either rung', () => {
  it('names the first pin whose repository does not end in _twl; null for the legal forms', () => {
    expect(oldTwlPin(OLD_BOTH)?.repoPath).toBe('git.door43.org/es-419_gl/es-419_tw');
    expect(oldTwlPin(OLD_FALLBACK)?.repoPath).toBe('git.door43.org/unfoldingWord/en_tw');
    expect(oldTwlPin(OLD_OBS)?.repoPath).toBe('git.door43.org/unfoldingWord/en_tw');
    expect(oldTwlPin(SAMPLE)).toBeNull();
    expect(oldTwlPin(OBS_SAMPLE)).toBeNull();
    expect(oldTwlPin(RULING7)).toBeNull();
    expect(oldTwlPin({ schemaVersion: 2, languageSets: {} } as ResourcesFile)).toBeNull(); // no slot is 'unpinned', not old-form
  });
});

describe('D97 ruling 6 — loadProjectPins lands the old-form document as read (the readers refuse, not the load)', () => {
  it('an old-form project: the pins load, with no read error', async () => {
    const store = { readResources: async () => OLD_BOTH };
    const patch = await new Promise<Record<string, unknown>>((resolve) => {
      loadPins({
        store,
        repoPath: 'repo/p',
        storeRef: { current: store },
        stateRef: { current: { project: { repoPath: 'repo/p' } } },
        actions: { resolutionContext: async () => ({ installed: {}, coverage: {} }) },
        dispatch: (a: { patch: Record<string, unknown> }) => resolve(a.patch),
      });
    });
    expect(patch).toMatchObject({ projectPins: OLD_BOTH, projectPinsLoaded: true, projectPinsError: null });
  });
});

// The installed map and coverage say every pin of the file is on this machine
// and covers TIT, so a read is refused ONLY by the ruling, never by absence.
const installedFor = (file: ResourcesFile) => {
  const pins = Object.values(file.languageSets).flatMap((s) =>
    Object.values(s).filter((v): v is ResourcePin => !!(v as ResourcePin)?.repoPath));
  return {
    installed: Object.fromEntries(pins.map((p) => [localRepoPathFromRepoPath(p.repoPath), p])),
    coverage: Object.fromEntries(pins.map((p) => [pinKey(p), ['TIT']])),
  };
};

describe('D97 ruling 6 — the Check preflight never offers tW from an old-form pin', () => {
  const preflightFor = async (file: ResourcesFile) => {
    const { installed, coverage } = installedFor(file);
    let state: Record<string, unknown> = {};
    const dispatch = (action: unknown) => { state = reducer(state, action as never); };
    await performRunPreflight({
      stateRef: { current: { project: { repoPath: '_local_/_local_/p', flavor: 'textTranslation' }, book: 'TIT', projectPins: file } },
      dispatch,
      actions: { resolutionContext: async () => ({ installed, coverage, resolutionError: null }) },
    });
    return state.preflight as Record<string, { state: string; resolution: { pin: ResourcePin | null } | null }>;
  };

  it("an old-form project: tW is 'old-twl' with no resolution; tN is still ready", async () => {
    const pre = await preflightFor(OLD_BOTH);
    expect(pre.translationWords.state).toBe('old-twl');
    expect(pre.translationWords.resolution).toBeNull();
    expect(pre.translationNotes.state).toBe('ready');
  });
  it('control: the two-repo form is ready', async () => {
    const pre = await preflightFor(SAMPLE);
    expect(pre.translationWords.state).toBe('ready');
    expect(pre.translationWords.resolution?.pin?.repoPath).toBe('git.door43.org/es-419_gl/es-419_twl');
  });
});

describe('D97 ruling 6 — Understand reads no TWL TSV from an old-form pin', () => {
  const load = async (file: ResourcesFile) => {
    const { installed, coverage } = installedFor(file);
    setInstalledCache(installed);
    // Each repo answers the header row of its own TSV (test/fixtures/resources/en_twl@v86/TIT.tsv,
    // en_tn@v91/TIT.tsv): a read that parses and derives to nothing.
    const TWL_HEADER = 'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n';
    const TN_HEADER = 'Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n';
    const readIngredient = vi.fn(async (repo: string, ipath: string) =>
      (ipath.endsWith('.tsv') ? (repo.endsWith('_tn') ? TN_HEADER : TWL_HEADER) : '{}'));
    const dispatched: Array<Record<string, unknown>> = [];
    const store = { readNotes: () => [], readSourceBook: async () => { throw Object.assign(new Error('404'), { isNotFound: true }); } };
    await loadUnderstand({
      stateRef: { current: { project: { repoPath: 'p', flavor: 'textTranslation' }, book: 'TIT', projectPins: file, projectPinsLoaded: true, projectScope: {}, netEnabled: false, understand: null } },
      storeRef: { current: store },
      understandSeqRef: { current: 0 },
      dispatch: (a: Record<string, unknown>) => dispatched.push(a),
      actions: {
        resolutionContext: async () => ({ installed, coverage }),
        projectFrame: async () => ({ state: 'ready', name: 'eng', schemes: {} }),
      },
      // The tw article gate (#643) needs the tw pin to list an article: the fixture's own (en_twl@v86/TIT.tsv row 1).
      apiClient: { readIngredient, getMetadataRaw: async () => ({ ingredients: { 'payload/names/paul.md': {} } }) },
    });
    setInstalledCache(null);
    const final = dispatched.map((d) => (d.patch as Record<string, unknown>)?.understand as Record<string, { state: string }> | undefined)
      .filter((u) => u && (u as unknown as { loading: boolean }).loading === false).pop()!;
    const tsvReads = readIngredient.mock.calls.filter(([, ipath]) => ipath.endsWith('.tsv')).map(([repo]) => repo);
    return { final, tsvReads };
  };
  const twlLocal = (file: ResourcesFile) => localRepoPathFromRepoPath(file.languageSets.primary.translationWordsLinks.repoPath);

  it("an old-form project: the Words slot is 'old-twl' and the twl pin's TSV is never read", async () => {
    const { final, tsvReads } = await load(OLD_BOTH);
    expect(final.words.state).toBe('old-twl');
    expect(tsvReads).not.toContain(twlLocal(OLD_BOTH));
    expect(tsvReads).not.toContain(localRepoPathFromRepoPath(OLD_BOTH.languageSets.fallback.translationWordsLinks.repoPath));
    expect(final.notes.state).toBe('ready'); // the other helps still load
  });
  it('control: the two-repo form reads the twl TSV and the slot is ready', async () => {
    const { final, tsvReads } = await load(SAMPLE);
    expect(final.words.state).toBe('ready');
    expect(tsvReads).toContain(twlLocal(SAMPLE));
  });
});

describe('D97 ruling 6 — the message is in every catalog on disk', () => {
  const dir = path.resolve(process.cwd(), 'src', 'i18n');
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
  it.each(files)('%s carries the three keys', (file: string) => {
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const key of ['check.oldTwl', 'check.state.old-twl', 'check.explain.old-twl']) {
      expect(typeof catalog[key], `${file} ${key}`).toBe('string');
      expect(catalog[key].trim(), `${file} ${key}`).not.toBe('');
    }
  });
});
