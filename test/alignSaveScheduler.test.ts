// #100 — alignment saves ride the SaveScheduler. The bar: confirming an
// alignment returns control at once; consecutive saves serialize per book
// with correct md5 chaining (N rapid saves → the final file state); a failed
// write is retained with Retry; the registry drain refuses over a failure.
// The writer and splice are the production ones (state.jsx test hooks); the
// store is a fake with the platform's compare-and-swap (#17).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveScheduler } from '../src/data/saveScheduler';
import { __alignSaveForTests, __drainSchedulersForTests, alignFileJson } from '../src/state.jsx';

const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
const BOOK = 'TIT';

interface Write {
  book: string;
  data: { chapters: Record<string, Record<string, unknown>> };
  expectMd5: string | null;
}

/** A store whose alignment file changes md5 on every accepted write and
 * refuses a write whose expectMd5 is not the md5 it currently holds. */
const makeStore = () => {
  let file: Write['data'] | null = null;
  let md5: string | null = null;
  const writes: Write[] = [];
  let failNext: Error | null = null;
  return {
    writes,
    get file() {
      return file;
    },
    get md5() {
      return md5;
    },
    failNextWrite(error: Error) {
      failNext = error;
    },
    readAlignmentsWithMd5: async () => ({ value: file, md5 }),
    writeAlignments: async (book: string, data: Write['data'], expectMd5?: string | null) => {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      if ((expectMd5 ?? null) !== md5) throw new Error(`stale write: expected ${expectMd5}, disk ${md5}`);
      writes.push({ book, data, expectMd5: expectMd5 ?? null });
      file = data;
      md5 = `md5-${writes.length}`;
    },
    reconcileStaged: async () => {},
  };
};

const record = (n: number) => ({ alignments: [{ topWords: [`w${n}`], bottomWords: [`t${n}`] }], wordBank: [], targetVerseMd5: `t${n}` });

const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('#100 — N rapid alignment saves serialize per book with md5 chaining', () => {
  it('five edits in a burst return at once, coalesce into one write, and the file holds all five', async () => {
    const store = makeStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    sched.seedIfAbsent(BOOK, alignFileJson(null, BOOK));
    for (let v = 1; v <= 5; v++) sched.markDirty(BOOK, '1', String(v), JSON.stringify(record(v)));
    // Control came back: nothing has been written yet, the buffer is dirty.
    expect(store.writes).toHaveLength(0);
    expect(sched.getState()).toBe('dirty');
    await settle();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].expectMd5).toBeNull(); // the file did not exist: the CAS token is the read's md5
    expect(Object.keys(store.file!.chapters['1'])).toEqual(['1', '2', '3', '4', '5']);
    expect(store.file!.chapters['1']['3']).toEqual(record(3));
    expect(sched.getState()).toBe('saved');
  });

  it('a second burst chains on the md5 the first write produced, and keeps every earlier record', async () => {
    const store = makeStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    sched.seedIfAbsent(BOOK, alignFileJson(null, BOOK));
    sched.markDirty(BOOK, '1', '1', JSON.stringify(record(1)));
    await settle();
    expect(store.md5).toBe('md5-1');
    sched.markDirty(BOOK, '1', '2', JSON.stringify(record(2)));
    sched.markDirty(BOOK, '2', '7', JSON.stringify(record(7)));
    await settle();
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1].expectMd5).toBe('md5-1'); // chained: the second write edits the state the first left
    expect(store.file!.chapters['1']).toEqual({ '1': record(1), '2': record(2) });
    expect(store.file!.chapters['2']).toEqual({ '7': record(7) });
    expect(store.md5).toBe('md5-2');
  });

  it('a later edit of the same verse supersedes the earlier one in the same write', async () => {
    const store = makeStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    sched.seedIfAbsent(BOOK, alignFileJson(null, BOOK));
    sched.markDirty(BOOK, '1', '1', JSON.stringify(record(1)));
    sched.markDirty(BOOK, '1', '1', JSON.stringify(record(9)));
    await settle();
    expect(store.writes).toHaveLength(1);
    expect(store.file!.chapters['1']['1']).toEqual(record(9));
  });
});

describe('#100 — a failed alignment write is retained, shown, retried, and blocks the drain (FR-32)', () => {
  it('the failure holds the buffer, the buffered file still carries the edit, retry writes it', async () => {
    const store = makeStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    sched.seedIfAbsent(BOOK, alignFileJson(null, BOOK));
    store.failNextWrite(new Error('disk full'));
    sched.markDirty(BOOK, '1', '1', JSON.stringify(record(1)));
    await settle();
    expect(sched.getState()).toBe('error');
    expect(sched.getFailure()?.book).toBe(BOOK);
    expect(store.writes).toHaveLength(0);
    // The buffer is what openAlign reads back: the edit is not lost.
    expect(JSON.parse(sched.bookText(BOOK)!).chapters['1']['1']).toEqual(record(1));
    await sched.retry();
    expect(store.writes).toHaveLength(1);
    expect(sched.getState()).toBe('saved');
  });

  it('the registry drain refuses while the align scheduler holds a failure, and passes once it is retried', async () => {
    const store = makeStore();
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    sched.seedIfAbsent(BOOK, alignFileJson(null, BOOK));
    const refs = [{ current: null }, { current: sched }];
    store.failNextWrite(new Error('refused'));
    sched.markDirty(BOOK, '1', '1', JSON.stringify(record(1)));
    // drain() retries once (the failure is retained on this first attempt).
    expect(await __drainSchedulersForTests(refs)).toBe(false);
    expect(sched.getState()).toBe('error');
    // Now the store accepts: the drain's retry lands the write.
    expect(await __drainSchedulersForTests(refs)).toBe(true);
    expect(store.writes).toHaveLength(1);
  });
});
