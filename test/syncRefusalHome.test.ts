// #801 — Home after a sync.project-replaced refusal (U1), and the text of that refusal (U2).
//
// A store that opened before a sync's apply is old: it refuses each later queued action
// with sync.project-replaced, before the action runs (journalingStore.ts `queue`). A save
// buffer that holds this refusal can never reach rest on that store, so Home's drain must
// not wait for it. Every other failure still holds Home (FR-32).
//
// The ways Home's drain can fail (written before the code, AGENTS.md "How to test"):
//   a. A buffer holds the refusal and has a reconcile hook: a drain runs the reconcile,
//      the old store refuses it again, and Home stays held for good.
//   b. The refusal first comes during Home's own drain: Home stays once, then leaves.
//   c. Another buffer holds unsaved work and no failure: Home drops it instead of writing it.
//   d. A failure with another cause (no code): Home leaves over it.
//   e. A story buffer holds two dirty frames: one refused frame leaves the other to hold Home.
//   f. A buffer whose Retry is in flight: Home drops it while the retry still runs.
import { describe, expect, it } from 'vitest';
import { SaveScheduler } from '../src/data/saveScheduler';
import { StoryScheduler } from '../src/data/storyScheduler';
import { Refusal } from '../src/data/journal/runtime';
import { __drainForHomeForTests, __drainSchedulersForTests, __failureTextForTests } from '../src/state.jsx';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const EN: Record<string, string> = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/i18n/en.json'), 'utf8'));
const SENTENCE = EN['refusal.sync.project-replaced'];
const REPO = '_local_/x';
const replaced = () => new Refusal('sync.project-replaced', `${REPO} was synced after this store opened it; open it again`, { repoPath: REPO });

type Sched = SaveScheduler | StoryScheduler;
const ref = (current: Sched) => ({ current });

/** A buffer with one dirty key whose writer and reconcile are given; `markDirty` only arms
 * the debounce, so nothing is written until a flush or a drain. */
function buffer({ write, reconcile }: { write: () => Promise<unknown>; reconcile?: () => Promise<void> }) {
  const writes: string[] = [];
  const sched = new SaveScheduler({
    writeBook: async (book: string) => {
      writes.push(book);
      await write();
    },
    splice: (_raw: string, _c: string | number, _v: string, body: string) => body,
    ...(reconcile ? { reconcile } : {}),
  });
  sched.seedIfAbsent('K1', 'persisted');
  sched.markDirty('K1', '', '', 'edited');
  return { sched, writes };
}

/** A buffer that already holds a failure of `error` (its first write failed). */
async function failed(error: () => Error, reconcile?: () => Promise<void>) {
  const b = buffer({ write: () => Promise.reject(error()), reconcile });
  await b.sched.flushOnBlur();
  expect(b.sched.getState()).toBe('error');
  return b;
}

describe('#801 U1 — Home drops a buffer that holds a sync.project-replaced failure, and only that one', () => {
  it('a. a refused buffer with a reconcile hook: Home passes and never runs the reconcile; the drain of every other navigation holds', async () => {
    let reconciles = 0;
    const { sched } = await failed(replaced, async () => {
      reconciles += 1;
      throw replaced();
    });
    expect(await __drainForHomeForTests([ref(sched)])).toBe(true);
    expect(reconciles).toBe(0);
    // Control: the drain of a mode switch, a book switch or an export still holds.
    expect(await __drainSchedulersForTests([ref(sched)])).toBe(false);
    expect(reconciles).toBe(1);
  });

  it('b. the refusal first comes during Home\'s drain: Home stays once, and the next Home passes', async () => {
    const { sched, writes } = buffer({ write: () => Promise.reject(replaced()) });
    expect(sched.getState()).toBe('dirty');
    expect(await __drainForHomeForTests([ref(sched)])).toBe(false);
    expect(sched.getState()).toBe('error');
    expect(await __drainForHomeForTests([ref(sched)])).toBe(true);
    expect(writes).toEqual(['K1']);
  });

  it('c. a refused buffer next to a dirty buffer with no failure: Home writes the dirty one', async () => {
    const a = await failed(replaced);
    const b = buffer({ write: () => Promise.resolve() });
    expect(await __drainForHomeForTests([ref(a.sched), ref(b.sched)])).toBe(true);
    expect(b.writes).toEqual(['K1']);
    expect(b.sched.getState()).toBe('saved');
    expect(a.writes).toEqual(['K1']); // the refused one is not written again
  });

  it('d. control: a failure with no code (an I/O error) holds Home over two drains', async () => {
    const { sched } = await failed(() => new Error('HTTP 500'));
    expect(await __drainForHomeForTests([ref(sched)])).toBe(false);
    expect(await __drainForHomeForTests([ref(sched)])).toBe(false);
    expect(sched.getState()).toBe('error');
  });

  it('e. a story buffer with two dirty frames and a refused write: Home passes', async () => {
    const written: number[] = [];
    const story = new StoryScheduler({
      write: async (unit) => {
        if (unit.kind === 'frame') written.push(unit.frame);
        throw replaced();
      },
    });
    for (const frame of [1, 2]) {
      story.seed({ kind: 'frame', story: 1, frame }, `stored ${frame}`);
      story.markDirty({ kind: 'frame', story: 1, frame }, `edited ${frame}`);
    }
    await story.flushOnBlur();
    expect(story.getState()).toBe('error');
    expect(await __drainForHomeForTests([ref(story)])).toBe(true);
    expect(written).toEqual([1]); // the second frame was never tried
  });

  it('f. a refused buffer whose Retry is in flight: Home joins the retry and does not drop the buffer', async () => {
    let rejectReconcile!: (e: Error) => void;
    const pending = new Promise<void>((_, reject) => (rejectReconcile = reject));
    const { sched } = await failed(replaced, () => pending);
    const retry = sched.retry();
    expect(sched.getState()).toBe('saving');
    const home = __drainForHomeForTests([ref(sched)]);
    rejectReconcile(replaced());
    await retry;
    expect(await home).toBe(false);
    // The retry ended with the failure standing: the next Home drops the buffer.
    expect(sched.getState()).toBe('error');
    expect(await __drainForHomeForTests([ref(sched)])).toBe(true);
  });
});

describe('#801 U2 — the banner text of a failed store operation', () => {
  it('gives only the sentence for sync.project-replaced, with no diagnosis and no project path', () => {
    expect(SENTENCE).toBeTruthy();
    expect(__failureTextForTests(replaced())).toBe(SENTENCE);
  });

  it('gives the diagnosis, then the sentence, for another live code (#156)', () => {
    const other = new Refusal('checkpoint.divergence', 'ingredients/TIT.usfm differs from its projection', { ipath: 'ingredients/TIT.usfm' });
    const sentence = EN['refusal.checkpoint.divergence'];
    expect(sentence).toBeTruthy();
    expect(__failureTextForTests(other)).toBe(`ingredients/TIT.usfm differs from its projection ${sentence}`);
  });

  it('gives the message for an error with no code', () => {
    expect(__failureTextForTests(new Error('boom'))).toBe('boom');
  });
});
