// C1a.4/C1a.5 (FR-32) — SaveScheduler with fake timers: debounce flush, blur
// flush, error retention + retry, and an indicator bound to the ACTUAL write
// promise (never optimistic). Composed with the real splice engine, its only
// mutation path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveScheduler, type SaveState } from '../src/data/saveScheduler';
import { spliceVerse, VerseNotFoundError } from '../src/data/usfm/splice';

const BOOK = 'TST';
const initial = ['\\id TST scheduler fixture', '\\c 1', '\\p', '\\v 1 uno', '\\v 2 dos', ''].join(
  '\n',
);

interface WriteCall {
  book: string;
  usfm: string;
}

const makeWrite = () => {
  const calls: WriteCall[] = [];
  let behavior: () => Promise<void> = () => Promise.resolve();
  return {
    calls,
    write: (book: string, usfm: string): Promise<void> => {
      calls.push({ book, usfm });
      return behavior();
    },
    setBehavior: (b: () => Promise<void>): void => {
      behavior = b;
    },
  };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeScheduler = (
  write: (book: string, usfm: string) => Promise<void>,
  debounceMs?: number,
) => {
  const scheduler = new SaveScheduler({ writeBook: write, splice: spliceVerse, debounceMs });
  scheduler.loadBook(BOOK, initial);
  return scheduler;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('idle debounce flush', () => {
  it('typing resets the debounce; one write carries the latest text', async () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'draft one');
    await vi.advanceTimersByTimeAsync(1500);
    scheduler.markDirty(BOOK, 1, '1', 'draft two');
    await vi.advanceTimersByTimeAsync(1500);
    expect(w.calls).toHaveLength(0); // the second edit re-armed the timer
    await vi.advanceTimersByTimeAsync(500);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].usfm).toBe(spliceVerse(initial, 1, '1', 'draft two'));
  });
});

describe('save indicator binds to the ACTUAL write promise', () => {
  it("a slow write keeps 'saving' until the promise resolves — never optimistic", async () => {
    const w = makeWrite();
    const gate = deferred();
    w.setBehavior(() => gate.promise);
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'slow');
    const flushed = scheduler.flushOnBlur();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.getState()).toBe('saving');
    // Time passing does not fake a completion; only resolution does.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduler.getState()).toBe('saving');
    gate.resolve();
    await flushed;
    expect(scheduler.getState()).toBe('saved');
  });

  it('notifies the full transition sequence saved → dirty → saving → saved', async () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write);
    const states: SaveState[] = [];
    scheduler.subscribe((s) => states.push(s));
    scheduler.markDirty(BOOK, 1, '1', 'sequenced');
    await scheduler.flushOnBlur();
    expect(states).toEqual(['saved', 'dirty', 'saving', 'saved']);
  });
});

describe('write failure (FR-32)', () => {
  it("keeps the dirty buffer, surfaces 'error', and retains the failed payload", async () => {
    const w = makeWrite();
    const boom = new Error('disk on fire');
    w.setBehavior(() => Promise.reject(boom));
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'edit that fails');
    await scheduler.flushOnBlur();
    expect(scheduler.getState()).toBe('error');
    const failure = scheduler.getFailure();
    expect(failure?.book).toBe(BOOK);
    expect(failure?.error).toBe(boom);
    expect(failure?.usfm).toBe(spliceVerse(initial, 1, '1', 'edit that fails'));
    // The buffer still holds the edit — nothing was dropped.
    expect(scheduler.bookText(BOOK)).toBe(failure?.usfm);
  });

  it('does not hammer a failing store: autosave stays parked until retry()', async () => {
    const w = makeWrite();
    w.setBehavior(() => Promise.reject(new Error('nope')));
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'first');
    await scheduler.flushOnBlur();
    expect(w.calls).toHaveLength(1);
    // More edits while in error: buffered, but no new write attempts.
    scheduler.markDirty(BOOK, 1, '2', 'second');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.calls).toHaveLength(1);
    expect(scheduler.getState()).toBe('error');
  });

  it('retry() re-attempts with everything buffered since the failure', async () => {
    const w = makeWrite();
    w.setBehavior(() => Promise.reject(new Error('nope')));
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'first');
    await scheduler.flushOnBlur();
    scheduler.markDirty(BOOK, 1, '2', 'second');
    w.setBehavior(() => Promise.resolve());
    await scheduler.retry();
    expect(scheduler.getState()).toBe('saved');
    expect(scheduler.getFailure()).toBeNull();
    expect(w.calls).toHaveLength(2);
    const expected = spliceVerse(spliceVerse(initial, 1, '1', 'first'), 1, '2', 'second');
    expect(w.calls[1].usfm).toBe(expected);
  });
});

describe('edits during an in-flight write', () => {
  it('keeps the book dirty and the next flush writes the newer text', async () => {
    const w = makeWrite();
    const gate = deferred();
    w.setBehavior(() => gate.promise);
    const scheduler = makeScheduler(w.write);
    scheduler.markDirty(BOOK, 1, '1', 'v1 first');
    const flushed = scheduler.flushOnBlur();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.getState()).toBe('saving');
    scheduler.markDirty(BOOK, 1, '2', 'v2 during flight');
    gate.resolve();
    w.setBehavior(() => Promise.resolve());
    await flushed;
    expect(scheduler.getState()).toBe('dirty'); // the in-flight snapshot missed the newer edit
    await scheduler.flushOnBlur();
    expect(w.calls).toHaveLength(2);
    const expected = spliceVerse(
      spliceVerse(initial, 1, '1', 'v1 first'),
      1,
      '2',
      'v2 during flight',
    );
    expect(w.calls[1].usfm).toBe(expected);
    expect(scheduler.getState()).toBe('saved');
  });
});

describe('composition and guards', () => {
  it('writes are per-book: two dirty books flush as two whole-file writes', async () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write);
    const other = ['\\id OTH second book', '\\c 1', '\\p', '\\v 1 eins', ''].join('\n');
    scheduler.loadBook('OTH', other);
    scheduler.markDirty(BOOK, 1, '1', 'a');
    scheduler.markDirty('OTH', 1, '1', 'b');
    await scheduler.flushOnBlur();
    expect(w.calls.map((c) => c.book)).toEqual([BOOK, 'OTH']);
    expect(w.calls[1].usfm).toBe(spliceVerse(other, 1, '1', 'b'));
    expect(scheduler.getState()).toBe('saved');
  });

  it('markDirty on a book that was never loaded throws', () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write);
    expect(() => scheduler.markDirty('NOPE', 1, '1', 'x')).toThrow(/not loaded/);
  });

  it('markDirty propagates the splice engine’s VerseNotFoundError', () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write);
    expect(() => scheduler.markDirty(BOOK, 3, '99', 'x')).toThrow(VerseNotFoundError);
    // A failed splice buffers nothing.
    expect(scheduler.getState()).toBe('saved');
    expect(scheduler.bookText(BOOK)).toBe(initial);
  });
});

describe('#63 — replaceBook: a whole-book replacement is one dirty write', () => {
  it('a later verse edit splices into the replaced text, not the loaded one', async () => {
    const w = makeWrite();
    const scheduler = makeScheduler(w.write, 500);
    const replaced = initial.replace('\\v 1 uno\n\\v 2 dos', '\\v 1-2 uno dos');
    scheduler.replaceBook(BOOK, replaced);
    scheduler.markDirty(BOOK, 1, '1-2', 'uno y dos');
    await vi.advanceTimersByTimeAsync(500);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].usfm).toContain('\\v 1-2 uno y dos');
  });

  it('refuses a book that was never loaded', () => {
    const w = makeWrite();
    const scheduler = new SaveScheduler({ writeBook: w.write, splice: spliceVerse });
    expect(() => scheduler.replaceBook('NOPE', 'x')).toThrow(/not loaded/);
  });
});
