// #807 — after a sync, a span save that waits on a refused alignment save must not block Home.
//
// A sync replaces the project; the store that opened before it is stale and refuses every
// queued action with `sync.project-replaced` (G1). Home (#801, drainForHome) drops only the
// save buffers whose failure carries that code. A span save drains the align queue first
// (#792, writeBookOrStructure). When that drain fails because the align buffer holds the
// refusal, the span save used to throw a plain Error: the draft buffer then held a failure
// Home does not drop, and Home could not be left until the app restarted.
//
// The fix: the span save throws the align buffer's own refusal. A drain that fails for any
// other reason (the network) still throws upgrade.alignUnsaved and still holds Home (#792).
//
// Real JournalingStore over the in-memory rig, the production align writer, real align and
// draft SaveSchedulers, and the genuine refusal from nextSyncGeneration.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { md5Hex } from '../src/data/httpStore';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { nextSyncGeneration } from '../src/data/journal/opsLog';
import { refusalCodeOf } from '../src/data/journal/runtime';
import type { ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow, type JournalingRig } from './helpers/journalingRig';
import { SaveScheduler } from '../src/data/saveScheduler';
import { t } from '../src/i18n';
import {
  __alignSaveForTests, __drainForHomeForTests as drainForHome,
  __writeBookOrStructureForTests as writeBookOrStructure,
} from '../src/state.jsx';

const { makeAlignWriter, spliceAlignRecord, alignFileFor } = __alignSaveForTests;
const REPO = '_local_/_local_/prueba';
const REPLACED = 'sync.project-replaced';
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
const diskBook = (rig: JournalingRig) => [...rig.repos.get(REPO)!.files.entries()].find(([p]) => /TIT\.usfm$/.test(p))?.[1] ?? '';
const failureCode = (s: SaveScheduler) => refusalCodeOf(s.getFailure()?.error) ?? null;

/** A project with TIT and an aligned 1:1, a production-wired align scheduler, and a draft scheduler
 * wired as production wires it (writeBook -> writeBookOrStructure). While `ctl.failing` is set, an align
 * write fails with a plain Error('network'); `nextSyncGeneration` makes the store stale (the refusal). */
const setup = async () => {
  forgetSharedClocks(); forgetProjectQueues();
  const rig = journalingRig(); const kv = memKv(); const clock = tickingNow('2026-08-19T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const real = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await real.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await real.writeResources(PINS, null);
  await real.writeSettings({ schemaVersion: 1, textDirection: 'ltr', textFont: 'Noto Sans (default)' });
  await real.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM });
  await real.writeAlignments('TIT', { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': ALIGNED as never } } });
  const ctl = { failing: false };
  const store = new Proxy(real, { get(target, key) {
    if (key === 'writeAlignments') return async (...args: Parameters<JournalingStore['writeAlignments']>) => {
      if (ctl.failing) throw new Error('network');
      return target.writeAlignments(...args);
    };
    const v = Reflect.get(target, key, target); return typeof v === 'function' ? v.bind(target) : v;
  } });
  const align = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord, reconcile: () => real.reconcileStaged(), clock: manual });
  await alignFileFor(store, align, 'TIT');
  const refs = { store, structuralRef: { current: new Set<string>() }, alignSchedulerRef: { current: align } };
  const draft = new SaveScheduler({ writeBook: (book: string, whole: string) => writeBookOrStructure(refs, book, whole), splice: (raw: string) => raw, clock: manual });
  draft.loadBook('TIT', TIT_USFM);
  return { rig, align, draft, refs, ctl, saveRefs: [{ current: draft }, { current: align }] };
};
type World = Awaited<ReturnType<typeof setup>>;

/** The user's span save: the section save flags TIT and replaces the draft buffer (stageStructuralSection). */
const stageSpanSave = (w: World) => { w.refs.structuralRef.current.add('TIT'); w.draft.replaceBook('TIT', SPAN(TIT_USFM)); };
/** An Align edit on 2:1, flushed at once (blur). */
const alignEdit = async (w: World) => { w.align.markDirty('TIT', '2', '1', JSON.stringify(REC21)); await w.align.flushOnBlur(); };

describe('#807 a span save behind a refused align save', () => {
  it('B1: the span save carries the refusal, and Home leaves on the first call', async () => {
    const w = await setup();
    nextSyncGeneration(REPO); // a sync replaced the project: the open store is stale
    await alignEdit(w);
    expect(w.align.getState()).toBe('error');
    expect(failureCode(w.align)).toBe(REPLACED);
    stageSpanSave(w);
    await w.draft.flushOnBlur();
    expect(w.draft.getState()).toBe('error');
    expect(failureCode(w.draft)).toBe(REPLACED);
    expect(w.refs.structuralRef.current.has('TIT')).toBe(true); // the flag is put back, as #792 requires
    expect(await drainForHome(w.saveRefs)).toBe(true);
    expect(diskBook(w.rig)).not.toContain('\\v 1-2'); // the stale store wrote nothing
  });

  it('B2: Home\'s own drain runs the span save; Home holds once, then leaves', async () => {
    const w = await setup();
    nextSyncGeneration(REPO);
    await alignEdit(w);
    stageSpanSave(w); // not flushed: Home's drain flushes it
    expect(await drainForHome(w.saveRefs)).toBe(false); // the refusal arrives during this drain (#801)
    expect(failureCode(w.draft)).toBe(REPLACED);
    expect(await drainForHome(w.saveRefs)).toBe(true);
    expect(diskBook(w.rig)).not.toContain('\\v 1-2');
  });

  it('B3: an align failure that is not a refusal still fails the span save with upgrade.alignUnsaved and holds Home', async () => {
    const w = await setup();
    w.ctl.failing = true; // plain Error('network'); the store is NOT stale
    await alignEdit(w);
    expect(failureCode(w.align)).toBeNull();
    stageSpanSave(w);
    await w.draft.flushOnBlur();
    expect(w.draft.getState()).toBe('error');
    expect(failureCode(w.draft)).toBeNull();
    expect((w.draft.getFailure()?.error as Error).message).toBe(t('upgrade.alignUnsaved'));
    expect(await drainForHome(w.saveRefs)).toBe(false);
    expect(await drainForHome(w.saveRefs)).toBe(false);
    // the network comes back: the #792 recovery path still saves the span
    w.ctl.failing = false;
    expect(await drainForHome(w.saveRefs)).toBe(true);
    expect(diskBook(w.rig)).toContain('\\v 1-2 Pablo, siervo de Dios.');
  });
});
