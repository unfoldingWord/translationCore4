// #94 — the fold runs off the main thread.
//
// Three proofs: (1) the store itself never calls `fold` — every fold goes
// through its FoldRunner, so in the browser (a Web Worker) no fold executes on
// the main thread during a save; (2) the worker protocol: the mirror grows by
// the appended tail when the store's array grew in place, is replaced whole
// otherwise, and the fold's refusal or a dead worker surface as rejections;
// (3) save ordering is unchanged across the asynchronous boundary — overlapping
// saves through a jittery runner fold to the same state as sequential ones.
import { describe, expect, it } from 'vitest';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { fold } from '../src/data/journal/runtime';
import { inlineFoldRunner, workerFoldRunner } from '../src/data/journal/foldRunner';
import type { FoldReply, FoldRequest, FoldRunner, WorkerLike } from '../src/data/journal/foldRunner';
import type { JournalEvent } from '../src/data/journal/seal';
import type { ResourcesFile } from '../src/data/burritoStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

describe('#94 — the store folds only through its runner', () => {
  it('journalingStore.ts imports no `fold` and calls none: the runner is the one fold site', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/data/journal/journalingStore.ts'), 'utf8');
    expect(src).not.toMatch(/[^.\w]fold\(/);
    expect(src).not.toMatch(/^\s+fold,\s*$/m); // the runtime import list
    expect(src).toMatch(/from '\.\/foldRunner'/);
  });
});

/** An in-process stand-in for the worker: the same mirror + fold logic as
 * foldWorker.ts, answering on a microtask, with every request recorded. */
const fakeWorker = (opts: { failOnRequest?: number } = {}) => {
  const requests: FoldRequest[] = [];
  let events: JournalEvent[] = [];
  let terminated = 0;
  const w: WorkerLike & { requests: FoldRequest[]; terminated: () => number } = {
    onmessage: null,
    onerror: null,
    requests,
    terminated: () => terminated,
    terminate: () => { terminated += 1; },
    postMessage(request) {
      requests.push(request);
      queueMicrotask(() => {
        if (requests.length === opts.failOnRequest) {
          w.onerror?.({ message: 'boom' });
          return;
        }
        if ('events' in request) events = request.events;
        else events.push(...request.append);
        let reply: FoldReply;
        try {
          reply = { id: request.id, result: fold(events) };
        } catch (error) {
          reply = { id: request.id, error: String((error as Error).message) };
        }
        w.onmessage?.({ data: reply });
      });
    },
  };
  return w;
};

const ts = (n: number) => `2026-08-19T09:00:${String(n).padStart(2, '0')}.000Z|0000|actor-a`;
const settingsEvent = (n: number, value: string): JournalEvent =>
  ({ v: 1, op: 'settings.set', actor: 'actor-a', ts: ts(n), base: null, path: 'textFont', value }) as unknown as JournalEvent;

describe('#94 — the worker protocol (mirror, append, refusal, death)', () => {
  it('posts the whole set first, then only the tail while the same array grows; a replaced array travels whole', async () => {
    let made: ReturnType<typeof fakeWorker> | null = null;
    const runner = workerFoldRunner(() => (made = fakeWorker()));
    const events: JournalEvent[] = [settingsEvent(1, 'A')];
    const first = await runner.fold(events);
    expect(first.settings.textFont).toBe('A');
    expect(made!.requests[0]).toMatchObject({ events });

    events.push(settingsEvent(2, 'B')); // grown in place, as publishAndRegenerate does
    const second = await runner.fold(events);
    expect(second.settings.textFont).toBe('B');
    expect(made!.requests[1]).toEqual({ id: 2, append: [events[1]] });

    const replaced = [settingsEvent(1, 'A'), settingsEvent(3, 'C')]; // a new array, as open/replay do
    const third = await runner.fold(replaced);
    expect(third.settings.textFont).toBe('C');
    expect(made!.requests[2]).toMatchObject({ events: replaced });
    expect(third).toEqual(fold(replaced)); // the worker's answer IS the inline fold
    runner.dispose();
    expect(made!.terminated()).toBe(1);
  });

  it("the fold's own refusal comes back as a rejection with its reason, and the worker lives on", async () => {
    let made: ReturnType<typeof fakeWorker> | null = null;
    const runner = workerFoldRunner(() => (made = fakeWorker()));
    const corrupt = [{ v: 1, op: 'settings.set', actor: 'actor-a', ts: 'not-a-ts', base: null, path: 'x', value: 1 }] as unknown as JournalEvent[];
    await expect(runner.fold(corrupt)).rejects.toThrow(/refuse to fold/);
    await expect(runner.fold([settingsEvent(1, 'A')])).resolves.toMatchObject({ settings: { textFont: 'A' } });
    expect(made!.terminated()).toBe(0);
  });

  it('a dead worker rejects what was pending and the next fold gets a fresh worker with a fresh mirror', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const runner = workerFoldRunner(() => {
      const w = fakeWorker({ failOnRequest: workers.length === 0 ? 1 : undefined });
      workers.push(w);
      return w;
    });
    const events = [settingsEvent(1, 'A')];
    await expect(runner.fold(events)).rejects.toThrow(/fold worker failed: boom/);
    expect(workers[0].terminated()).toBe(1);
    events.push(settingsEvent(2, 'B'));
    const out = await runner.fold(events);
    expect(out.settings.textFont).toBe('B');
    expect(workers).toHaveLength(2);
    expect(workers[1].requests[0]).toMatchObject({ events }); // whole set, not an append onto a dead mirror
  });
});

// ---- (3) ordering across the asynchronous boundary ---------------------------

const REPO = '_local_/_local_/prueba';
const TIT_USFM = (v1: string) => ['\\id TIT prueba', '\\usfm 3.0', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', `\\v 1 ${v1}`, '\\v 2 ___', ''].join('\n');
const sha40 = (s: string): string => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
};
const PIN = (repo: string, version: string, flavor: string) => ({ sha: sha40(`${repo}@${version}`), repoPath: `git.door43.org/unfoldingWord/${repo}`, version, flavor });
const RUNG = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: PIN('en_tn', 'v86', 'parascriptural/x-bcvnotes'),
  translationWordsLinks: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationWords: PIN('en_tw', 'v87', 'parascriptural/x-bcvarticles'),
  translationAcademy: PIN('en_ta', 'v86', 'peripheral/x-peripheralArticles'),
};
const PINS = { schemaVersion: 2, languageSets: { primary: { ...RUNG }, fallback: { ...RUNG } }, resources: { originalLanguage: { nt: PIN('el-x-koine_ugnt', 'v0.34', 'scripture/textTranslation') } } } as unknown as ResourcesFile;

/** The inline fold, answered after a random 0–4 ms delay: the worker's timing shape without a worker. */
const jitteryRunner = (): FoldRunner => {
  const inline = inlineFoldRunner();
  return {
    fold: (events) => new Promise((resolve, reject) => setTimeout(() => inline.fold(events).then(resolve, reject), Math.floor(Math.random() * 5))),
    dispose: () => {},
  };
};

const project = async (foldRunner: FoldRunner) => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-08-19T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13), foldRunner });
  await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.writeResources(PINS, null);
  await store.writeSettings({ schemaVersion: 1, textDirection: 'ltr', textFont: 'Noto Sans (default)' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: TIT_USFM('___') });
  return { rig, store };
};

const STEPS = (store: JournalingStore) => [
  () => store.writeBook('TIT', TIT_USFM('Pablo, siervo.')),
  () => store.writeSettings({ schemaVersion: 1, textDirection: 'rtl', textFont: 'Charis SIL' }),
  () => store.writeBook('TIT', TIT_USFM('Pablo, siervo de Dios.')),
  () => store.writeSettings({ schemaVersion: 1, textDirection: 'rtl', textFont: 'Noto Sans (default)' }),
  () => store.writeBook('TIT', TIT_USFM('Pablo, siervo de Dios y apóstol.')),
];

const derived = (rig: ReturnType<typeof journalingRig>) => {
  const files = rig.repos.get(REPO)!.files;
  return {
    usfm: files.get('TIT.usfm'),
    settings: files.get('checking/settings.json'),
    segments: [...files.keys()].filter((k) => /journal\/[a-z0-9-]+\/segments\//.test(k)).length,
  };
};

describe('#94 — save ordering per project is unchanged across the worker boundary', () => {
  it('overlapping saves through a jittery runner fold to the sequential result', async () => {
    const sequential = await project(inlineFoldRunner());
    for (const step of STEPS(sequential.store)) await step();
    const expected = derived(sequential.rig);
    expect(expected.usfm).toContain('Pablo, siervo de Dios y apóstol.');
    expect(JSON.parse(expected.settings!).textFont).toBe('Noto Sans (default)');

    for (let round = 0; round < 3; round += 1) {
      const overlapping = await project(jitteryRunner());
      await Promise.all(STEPS(overlapping.store).map((step) => step())); // fired together, no awaits between
      expect(derived(overlapping.rig)).toEqual(expected);
    }
  });
});
