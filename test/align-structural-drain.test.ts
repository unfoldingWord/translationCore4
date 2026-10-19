// #792 — a span save drains the align save queue first.
//
// The align scheduler holds the whole alignment file of a book in a buffer, and
// its compare-and-swap token is the disk md5 read right before the write, so it
// always passes. Window: an alignment write fails and is kept for Retry; the
// translator then saves a section that creates a verse span (writeBookOrStructure
// -> applyStructuralEdit rewrites the alignment file outside the scheduler);
// then Retry publishes the old buffer again, with no base, on the key the span
// removed. The fold reports that record as orphaned (R-8.6.6).
//
// The fix: on a span save, writeBookOrStructure drains the align scheduler
// BEFORE it takes the structural flag. A failed drain throws, leaves the flag
// set and writes nothing, so the draft scheduler keeps the book write as a
// failure with Retry. A plain write never drains.
//
// Real JournalingStore over the in-memory rig (the store suites' fake
// pankosmia-web), the production align writer and splice, and a real
// SaveScheduler with a manual clock (flushOnBlur stands in for the debounce).
// Book text + record: the #63 fixtures of test/journalingStore.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { md5Hex } from '../src/data/httpStore';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import type { ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';
import { SaveScheduler } from '../src/data/saveScheduler';
import { t } from '../src/i18n';
import { __alignSaveForTests, __writeBookOrStructureForTests as writeBookOrStructure } from '../src/state.jsx';

const { makeAlignWriter, spliceAlignRecord, alignFileFor } = __alignSaveForTests;
const REPO = '_local_/_local_/prueba';
const TIT_USFM = ['\\id TIT prueba', '\\usfm 3.0', '\\h Tito', '\\mt Tito', '\\c 1', '\\p',
  '\\v 1 Pablo, siervo de Dios.', '\\v 2 ___', '\\c 2', '\\q1', '\\v 1 Pero tú enseña.', ''].join('\n');
const SPAN = (usfm: string) => usfm.replace(/\\v 1 (.*)\n\\v 2 ___/, '\\v 1-2 $1');

const sha40 = (s: string): string => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, '0').repeat(5); };
const PIN = (repo: string, version: string, flavor: string) => ({ sha: sha40(`${repo}@${version}`), repoPath: `git.door43.org/unfoldingWord/${repo}`, version, flavor });
const RUNG = { gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' }, translationNotes: PIN('en_tn', 'v86', 'parascriptural/x-bcvnotes'),
  translationWordsLinks: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'), translationWords: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationAcademy: PIN('en_ta', 'v86', 'peripheral/x-peripheralArticles') };
const PINS = { schemaVersion: 2, languageSets: { primary: { ...RUNG }, fallback: { ...RUNG } },
  resources: { originalLanguage: { nt: PIN('el-x-koine_ugnt', 'v0.34', 'scripture/textTranslation') } } } as unknown as ResourcesFile;

const ALIGNED = {
  alignments: [{ topWords: [{ word: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N,,,,,NMS,', occurrence: 1, occurrences: 1 }],
    bottomWords: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }] }],
  wordBank: [{ word: 'siervo', occurrence: 1, occurrences: 1 }, { word: 'de', occurrence: 1, occurrences: 1 }, { word: 'Dios', occurrence: 1, occurrences: 1 }],
  targetVerseMd5: md5Hex('Pablo, siervo de Dios.'),
  sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
};
const REC21 = { ...ALIGNED, alignments: [], wordBank: [{ word: 'Pero', occurrence: 1, occurrences: 1 }], targetVerseMd5: md5Hex('Pero tú enseña.') };

const manual = { setTimeout: () => 0, clearTimeout: () => {} }; // the debounce never fires; flushOnBlur() stands in for it
const diskFile = (rig: JournalingRig) => JSON.parse(rig.repos.get(REPO)?.files.get('checking/alignments/TIT.json') ?? 'null');
const diskBook = (rig: JournalingRig) => [...rig.repos.get(REPO)!.files.entries()].find(([p]) => /TIT\.usfm$/.test(p))?.[1] ?? '';
/** The fold's orphan list for the book: alignments on a key with no slot (R-8.6.6). */
const orphans = (store: JournalingStore) =>
  (store as unknown as { foldNow(): { invalid: Array<{ book: string; verse: string; orphaned?: boolean }> } })
    .foldNow().invalid.filter((x) => x.book === 'TIT' && x.orphaned).map((x) => x.verse);

/** A project with TIT, an aligned 1:1, and an align scheduler on the store whose
 * alignment writes fail while `ctl.failing` is set — a network error on the write. */
const setup = async (opts: { failing: boolean }) => {
  forgetSharedClocks(); forgetProjectQueues();
  const rig = journalingRig(); const kv = memKv(); const clock = tickingNow('2026-08-19T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const real = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await real.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await real.writeResources(PINS, null);
  await real.writeSettings({ schemaVersion: 1, textDirection: 'ltr', textFont: 'Noto Sans (default)' });
  await real.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  await real.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': ALIGNED as never } } });
  const ctl = { failing: opts.failing };
  const store = new Proxy(real, { get(target, key) {
    if (key === 'writeAlignments') return async (...args: Parameters<JournalingStore['writeAlignments']>) => { if (ctl.failing) throw new Error('network'); return target.writeAlignments(...args); };
    const v = Reflect.get(target, key, target); return typeof v === 'function' ? v.bind(target) : v;
  } });
  const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord, reconcile: () => real.reconcileStaged(), clock: manual });
  await alignFileFor(store, sched, 'TIT'); // the open book's buffer
  return { rig, real, store, sched, ctl };
};
/** The app's refs for writeBookOrStructure: TIT flagged as a span save. */
const refsFor = (store: JournalingStore, sched: SaveScheduler | null, flagged: boolean) => ({
  store,
  structuralRef: { current: new Set(flagged ? ['TIT'] : []) },
  alignSchedulerRef: { current: sched },
});
/** An Align edit on 2:1 whose write fails: the save indicator shows Retry. */
const failAnAlignWrite = async (sched: SaveScheduler) => {
  sched.markDirty('TIT', '2', '1', JSON.stringify(REC21));
  await sched.flushOnBlur();
  expect(sched.getState()).toBe('error');
};

describe('#792 a span save drains the align queue first', () => {
  it('B1: an align write is kept for Retry, so the span save throws, keeps its flag and writes nothing', async () => {
    const { rig, store, sched } = await setup({ failing: true });
    await failAnAlignWrite(sched);
    const bookBefore = diskBook(rig);
    const alignBefore = diskFile(rig);
    const refs = refsFor(store, sched, true);

    await expect(writeBookOrStructure(refs, 'TIT', SPAN(TIT_USFM))).rejects.toThrow(t('upgrade.alignUnsaved'));

    expect(refs.structuralRef.current.has('TIT')).toBe(true); // the draft scheduler's retry still knows it is a span save
    expect(diskBook(rig)).toBe(bookBefore); // the book is unchanged
    expect(diskFile(rig)).toEqual(alignBefore); // so is the alignment file
    expect(sched.getState()).toBe('error'); // the align failure is still kept, with Retry
    expect(sched.getFailure()).not.toBeNull();
  });

  it('B1b: once the align write can succeed, the same span save goes through', async () => {
    const { rig, real, store, sched, ctl } = await setup({ failing: true });
    await failAnAlignWrite(sched);
    const refs = refsFor(store, sched, true);
    await expect(writeBookOrStructure(refs, 'TIT', SPAN(TIT_USFM))).rejects.toThrow(t('upgrade.alignUnsaved'));

    ctl.failing = false; // the draft scheduler's Retry carries the same buffer and the same flag
    await writeBookOrStructure(refs, 'TIT', SPAN(TIT_USFM));

    expect(refs.structuralRef.current.has('TIT')).toBe(false);
    expect(diskBook(rig)).toContain('\\v 1-2 Pablo, siervo de Dios.');
    expect(sched.getState()).toBe('saved');
    expect(Object.keys(diskFile(rig).chapters['1'])).toEqual(['1-2']);
    expect(diskFile(rig).chapters['2']['1']).toBeDefined(); // the Align edit that failed landed too
    expect(orphans(real)).toEqual([]);
  });

  it('B2: a failed align write, then a span save, then Retry: no orphan record is published', async () => {
    const { rig, real, store, sched, ctl } = await setup({ failing: true });
    await failAnAlignWrite(sched);
    ctl.failing = false; // the network is back: the drain's Retry succeeds
    const refs = refsFor(store, sched, true);

    await writeBookOrStructure(refs, 'TIT', SPAN(TIT_USFM));
    await sched.drain(); // a Retry click or a navigation drain, after the span save

    const file = diskFile(rig);
    expect(sched.getState()).toBe('saved');
    expect(orphans(real)).toEqual([]); // the fold reports no alignment on a key without a slot
    expect(Object.keys(file.chapters['1'])).toEqual(['1-2']); // nothing is republished on the key the span removed
    expect(file.chapters['1']['1-2'].invalid).toBe(true); // the span's empty invalid record is there
    expect(file.chapters['1']['1-2'].alignments).toEqual([]);
    expect(file.chapters['2']['1']).toBeDefined(); // the Align edit that failed landed
  });

  it('B3: with no pending align work a span save behaves as before, and a plain save never drains', async () => {
    const { rig, real, store, sched } = await setup({ failing: false });
    const drain = vi.spyOn(sched, 'drain');

    // A span save with the align queue at rest: the drain is a no-op, the save runs.
    const span = refsFor(store, sched, true);
    await writeBookOrStructure(span, 'TIT', SPAN(TIT_USFM));
    expect(span.structuralRef.current.has('TIT')).toBe(false);
    expect(diskBook(rig)).toContain('\\v 1-2 Pablo, siervo de Dios.');
    expect(Object.keys(diskFile(rig).chapters['1'])).toEqual(['1-2']);
    expect(diskFile(rig).chapters['1']['1-2'].invalid).toBe(true);
    expect(orphans(real)).toEqual([]);
    expect(drain).toHaveBeenCalledTimes(1);

    // A plain save: no drain, even while an align failure is kept.
    const { rig: rig2, store: store2, sched: sched2 } = await setup({ failing: true });
    await failAnAlignWrite(sched2);
    const drain2 = vi.spyOn(sched2, 'drain');
    const edited = TIT_USFM.replace('Pablo, siervo de Dios.', 'Pablo, siervo fiel de Dios.');
    await writeBookOrStructure(refsFor(store2, sched2, false), 'TIT', edited);
    expect(drain2).not.toHaveBeenCalled();
    expect(diskBook(rig2)).toContain('\\v 1 Pablo, siervo fiel de Dios.');
    expect(sched2.getState()).toBe('error'); // the plain save left the align failure alone
  });

  it('B3b: with no align scheduler in the ref a span save still runs', async () => {
    const { rig, real, store } = await setup({ failing: false });
    const refs = refsFor(store, null, true); // the align ref holds no scheduler
    await writeBookOrStructure(refs, 'TIT', SPAN(TIT_USFM));
    expect(diskBook(rig)).toContain('\\v 1-2 Pablo, siervo de Dios.');
    expect(orphans(real)).toEqual([]);
  });
});
