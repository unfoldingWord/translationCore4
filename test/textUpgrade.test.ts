// #258 — upgrade an original-language text or a gateway Bible (D72): one offer
// per text repo; an original-language upgrade marks every alignment of the
// books it covers invalid and keeps each record, in the SAME journal action as
// the pin move, so a refused or failed write changes nothing.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { validateSegment } from '../src/data/journal/seal';
import { describeVerifierReport, verifyProjectAgainstJournal } from '../src/data/journal/verify';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';
import type { AlignmentFile } from '../src/data/align/zaln';
import { md5Hex } from '../src/data/httpStore';
import {
  applyTextUpgrade,
  invalidateAlignments,
  invalidatedTestaments,
  textOfferIsStale,
  textOffers,
  textReposOf,
  type ReleaseInfo,
} from '../src/data/upgrade';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', ''].join('\n');

const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};
const PIN = (repo: string, version: string, flavor = 'scripture/textTranslation'): ResourcePin => ({
  sha: sha40(`${repo}@${version}`),
  repoPath: `git.door43.org/unfoldingWord/${repo}`,
  version,
  flavor,
});
const RUNG = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: PIN('en_tn', 'v86', 'parascriptural/x-bcvnotes'),
  translationWordsLinks: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationWords: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationAcademy: PIN('en_ta', 'v86', 'peripheral/x-peripheralArticles'),
};
const PINS: ResourcesFile = {
  schemaVersion: 2,
  languageSets: { primary: { ...RUNG }, fallback: { ...RUNG, simplifiedText: PIN('en_ust', 'v89') } },
  resources: { originalLanguage: { nt: PIN('el-x-koine_ugnt', 'v0.34'), ot: PIN('hbo_uhb', 'v2.1.30') } },
  extraScripture: [
    { id: 'ult', ...PIN('en_ult', 'v89') },
    { id: 'ust', ...PIN('en_ust', 'v89') },
  ],
} as unknown as ResourcesFile;

const BOTH = ['nt', 'ot'] as const;
const release = (repo: string, tag: string): ReleaseInfo => ({ tag, sha: sha40(`${repo}@${tag}`), publishedAt: '2026-09-26T15:45:57Z' });
/** DCS: UGNT and UST have a newer release; UHB and ULT are at their pins. */
const NEWER: Record<string, ReleaseInfo> = {
  'el-x-koine_ugnt': release('el-x-koine_ugnt', 'v0.35'),
  en_ust: release('en_ust', 'v91'),
};
const lookup = async (repoPath: string): Promise<ReleaseInfo> => {
  const repo = repoPath.split('/').pop() as string;
  if (NEWER[repo]) return NEWER[repo];
  const pinned = textReposOf(PINS).find((r) => r.repoPath === repoPath)?.pin;
  if (!pinned) throw new Error(`${repoPath}: no published release`);
  return { tag: pinned.version as string, sha: pinned.sha, publishedAt: null };
};

const record = (patch: Record<string, unknown> = {}) => ({
  alignments: [
    {
      topWords: [{ word: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N,,,,,NMS,', occurrence: 1, occurrences: 1 }],
      bottomWords: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }],
    },
  ],
  wordBank: [{ word: 'siervo', occurrence: 1, occurrences: 1 }],
  targetVerseMd5: md5Hex('Pablo, siervo de Dios.'),
  sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
  ...patch,
});

describe('textOffers — one offer per text repo, by sha (D58)', () => {
  it('offers the original-language text and the gateway Bible that have newer releases, each on its own', async () => {
    const offers = await textOffers(PINS, BOTH, lookup);
    expect(offers.map((o) => [o.repoPath.split('/').pop(), o.kind, o.to.version])).toEqual([
      ['el-x-koine_ugnt', 'original', 'v0.35'],
      ['en_ust', 'gateway', 'v91'],
    ]);
    // en_ust is both a source pane and the fallback set's simplified Bible: one offer moves both.
    expect(offers[1].slots).toEqual([
      { group: 'extraScripture', id: 'ust' },
      { group: 'simplifiedText', rung: 'fallback' },
    ]);
    expect(invalidatedTestaments(offers[0])).toEqual(['nt']);
    expect(invalidatedTestaments(offers[1])).toEqual([]);
  });

  it('applyTextUpgrade moves only the offer\'s slots; every other pin is the same object', async () => {
    const [ugnt, ust] = await textOffers(PINS, BOTH, lookup);
    const afterOl = applyTextUpgrade(PINS, ugnt);
    const ol = (afterOl.resources as { originalLanguage: Record<string, ResourcePin> }).originalLanguage;
    expect(ol.nt.sha).toBe(NEWER['el-x-koine_ugnt'].sha);
    expect(ol.ot).toBe((PINS.resources as { originalLanguage: Record<string, ResourcePin> }).originalLanguage.ot);
    expect(afterOl.extraScripture).toBe(PINS.extraScripture);
    expect(afterOl.languageSets).toBe(PINS.languageSets);

    const afterUst = applyTextUpgrade(PINS, ust);
    expect(afterUst.extraScripture?.[1]).toEqual({ id: 'ust', ...ust.to });
    expect(afterUst.extraScripture?.[0]).toBe(PINS.extraScripture?.[0]);
    expect(afterUst.languageSets.fallback.simplifiedText).toEqual(ust.to);
    expect(afterUst.languageSets.primary).toBe(PINS.languageSets.primary);
    expect(afterUst.resources).toBe(PINS.resources);
    expect(textOfferIsStale(ust, PINS)).toBe(false);
    expect(textOfferIsStale(ust, afterUst)).toBe(true);
  });

  // Bench round 1 (Frank): slots of one repo at different commits.
  const MIXED = {
    ...PINS,
    languageSets: { ...PINS.languageSets, fallback: { ...PINS.languageSets.fallback, simplifiedText: PIN('en_ust', 'v88') } },
  } as ResourcesFile;
  /** DCS: en_ust's newest release is `tag`; every other text is at its pin. */
  const ustAt = (tag: string) => async (repoPath: string): Promise<ReleaseInfo> => {
    if (repoPath.endsWith('/en_ust')) return release('en_ust', tag);
    const pin = textReposOf(MIXED).find((r) => r.repoPath === repoPath)?.pin as ResourcePin;
    return { tag: pin.version as string, sha: pin.sha, publishedAt: null };
  };

  it('offers a repo whose FIRST slot is current when another slot is behind', async () => {
    const offers = await textOffers(MIXED, BOTH, ustAt('v89'));
    expect(offers.map((o) => o.repoPath.split('/').pop())).toEqual(['en_ust']);
    expect(offers[0].from.version).toBe('v88');
    expect(offers[0].fromPins.map((p) => p.version)).toEqual(['v89', 'v88']);
  });

  it('checks each slot against its own snapshot: an unchanged mixed-pin project is not stale', async () => {
    const [ust] = await textOffers(MIXED, BOTH, ustAt('v91'));
    expect(ust.slots).toHaveLength(2);
    expect(textOfferIsStale(ust, MIXED)).toBe(false);
    const after = applyTextUpgrade(MIXED, ust);
    expect(after.extraScripture?.[1].sha).toBe(ust.to.sha);
    expect(after.languageSets.fallback.simplifiedText?.sha).toBe(ust.to.sha);
    expect(textOfferIsStale(ust, after)).toBe(true);
  });
});

// #438: a project pins both originals, but only the testaments of its books
// are offered. The ways this can fail: an NT-only project offers the Hebrew
// Bible; an OT-only project offers the Greek New Testament; a project with
// books in both testaments loses one original; the filter drops a gateway
// Bible, which is not an original.
describe('textOffers — only the originals of the project\'s testaments (#438)', () => {
  /** DCS: both originals and en_ust have a newer release. */
  const allNewer = async (repoPath: string): Promise<ReleaseInfo> =>
    repoPath.endsWith('/hbo_uhb') ? release('hbo_uhb', 'v3.0.0') : lookup(repoPath);
  const offered = async (testaments: ReadonlyArray<'nt' | 'ot'>) =>
    (await textOffers(PINS, testaments, allNewer)).map((o) => o.repoPath.split('/').pop());

  it('an NT-only project with both originals pinned lists no hbo_uhb row', async () => {
    expect(await offered(['nt'])).toEqual(['el-x-koine_ugnt', 'en_ust']);
  });

  it('an OT-only project lists no el-x-koine_ugnt row', async () => {
    expect(await offered(['ot'])).toEqual(['hbo_uhb', 'en_ust']);
  });

  it('a project with books in both testaments lists both originals', async () => {
    expect(await offered(['nt', 'ot'])).toEqual(['el-x-koine_ugnt', 'hbo_uhb', 'en_ust']);
  });
});

describe('invalidateAlignments — the invalidation count (D72)', () => {
  it('marks every record invalid and keeps it in full; an empty or already-invalid record is not counted', () => {
    const file = {
      schemaVersion: 1,
      book: 'TIT',
      chapters: {
        '1': { '1': record(), '2': record({ invalid: true }), '3': record({ alignments: [], wordBank: [] }) },
        '2': { '1': record({ done: true }) },
      },
    } as unknown as AlignmentFile;
    const { file: marked, verses } = invalidateAlignments(file);
    expect(verses).toBe(2);
    expect(marked?.chapters['1']['1']).toEqual({ ...file.chapters['1']['1'], invalid: true });
    expect(marked?.chapters['2']['1']).toEqual({ ...file.chapters['2']['1'], invalid: true });
    expect(marked?.chapters['1']['2']).toBe(file.chapters['1']['2']);
    expect(marked?.chapters['1']['3']).toBe(file.chapters['1']['3']);
    expect(invalidateAlignments(null)).toEqual({ file: null, verses: 0 });
  });
});

describe('the original-language upgrade is ONE journal action, all or nothing', () => {
  const setup = async () => {
    forgetSharedClocks();
    forgetProjectQueues();
    const rig: JournalingRig = journalingRig();
    const clock = tickingNow('2026-09-26T09:00:00.000Z');
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
    await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
    await store.writeResources(PINS, null);
    await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr' });
    await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
    await store.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': record() as never } } });
    const files = () => rig.repos.get(REPO)?.files as Map<string, string>;
    const segments = () => [...files().keys()].filter((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p)).sort();
    /** What the app's upgradeText plans: the moved pins and the marked files. */
    const plan = async () => {
      const [ugnt] = await textOffers(PINS, BOTH, lookup);
      const { value, md5 } = await store.readAlignmentsWithMd5('TIT');
      const { file, verses } = invalidateAlignments(value);
      return {
        verses,
        change: {
          resources: applyTextUpgrade(PINS, ugnt),
          resourcesMd5: (await store.readResourcesWithMd5()).md5,
          decisions: [],
          alignments: [{ book: 'TIT', file: file as AlignmentFile, expectMd5: md5 }],
        },
      };
    };
    return { rig, api, store, files, segments, plan };
  };

  it('moves the pin and marks the alignment invalid together; the record and the text stay byte-identical', async () => {
    const { api, store, files, segments, plan } = await setup();
    const usfmBefore = files().get('TIT.usfm');
    const before = segments().length;
    const { verses, change } = await plan();
    expect(verses).toBe(1);
    await store.applyGatewayChange(change);
    expect(segments()).toHaveLength(before + 1); // ONE action
    const verdict = await validateSegment(files().get(segments()[segments().length - 1]) ?? '');
    if (!verdict.ok) throw new Error(verdict.reason);
    expect(verdict.events.map((e) => e.op).sort()).toEqual(['align.verse.set', 'resource.pin.set']);
    const aligned = JSON.parse(files().get('checking/alignments/TIT.json') ?? '');
    expect(aligned.chapters['1']['1']).toEqual({ ...record(), invalid: true });
    const pins = JSON.parse(files().get('checking/resources.json') ?? '');
    expect(pins.resources.originalLanguage.nt.sha).toBe(NEWER['el-x-koine_ugnt'].sha);
    expect(files().get('TIT.usfm')).toBe(usfmBefore);
    const report = await verifyProjectAgainstJournal(api, REPO);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
  });

  it('an alignment saved after the preview refuses the WHOLE change: the pin and the marks do not move', async () => {
    const { store, files, segments, plan } = await setup();
    const { change } = await plan();
    await store.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': record({ wordBank: [] }) as never } } });
    const pinsBefore = files().get('checking/resources.json');
    const alignBefore = files().get('checking/alignments/TIT.json');
    const before = segments().length;
    await expect(store.applyGatewayChange(change)).rejects.toThrow(/stale write refused/);
    expect(segments()).toHaveLength(before);
    expect(files().get('checking/resources.json')).toBe(pinsBefore);
    expect(files().get('checking/alignments/TIT.json')).toBe(alignBefore);
  });

  it('a failed journal write publishes nothing: the pin and the marks do not move', async () => {
    const { rig, store, files, segments, plan } = await setup();
    const { change } = await plan();
    const pinsBefore = files().get('checking/resources.json');
    const alignBefore = files().get('checking/alignments/TIT.json');
    const before = segments().length;
    rig.failOn((ctx) => ctx.method === 'POST' && (ctx.ipath ?? '').includes('/segments/'));
    await expect(store.applyGatewayChange(change)).rejects.toThrow(/injected failure/);
    expect(segments()).toHaveLength(before);
    expect(files().get('checking/resources.json')).toBe(pinsBefore);
    expect(files().get('checking/alignments/TIT.json')).toBe(alignBefore);
  });
});
