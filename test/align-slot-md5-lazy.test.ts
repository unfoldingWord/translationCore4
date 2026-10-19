// #795 review — the slot hash is lazy and stays off the save path.
//
// `verseTextMd5` is a usfm-js parse of one verse slot. A Translate blur calls the
// reflow in the same task as the draft write, and the Align rail runs on every
// verse switch. Hashing every verse of the book there cost 150 ms on an aligned
// en_ult Genesis and 20 ms on a plain Psalms, before the draft write started.
//
// The ways this can fail, written before the fix:
// 1. the reflow hashes the whole book though no verse has a record
// 2. the reflow hashes more than the verses it was asked about
// 3. the rail hashes verses that have no record, or whose record is flagged invalid
//    (the status never reads the hash for them)
// 4. the same book text is hashed again on every call (the memo does not hold)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verseTextMd5 } from '../src/data/journal/runtime';
import { __alignIndexItemsForTests as alignIndexItems, __reflowAlignedVersesForTests as reflowAlignedVerses } from '../src/state.jsx';

vi.mock('../src/data/journal/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/journal/runtime')>();
  return { ...actual, verseTextMd5: vi.fn(actual.verseTextMd5) };
});

const hashes = vi.mocked(verseTextMd5);

/** A book of 40 drafted verses; `tag` makes each test's book text its own (the memo is by text). */
const book = (tag: string): string =>
  `\\id TIT ${tag}\n\\c 1\n\\p\n${Array.from({ length: 40 }, (_, i) => `\\v ${i + 1} Pablo, siervo de Dios ${i + 1}\n`).join('')}`;

/** A stored record with nothing placed: the reflow leaves it, and the rail reads its hash. */
const record = (extra: Record<string, unknown> = {}) => ({
  alignments: [{ topWords: [], bottomWords: [] }],
  wordBank: [],
  invalid: false,
  targetVerseMd5: 'x',
  ...extra,
});
const fileWith = (verses: Record<string, unknown>) => ({ schemaVersion: 2, book: 'TIT', chapters: { '1': verses } });
const storeOf = (file: unknown) => ({ readAlignmentsWithMd5: async () => ({ value: file, md5: null }) });

describe('#795 the reflow hashes only a verse that has a record', () => {
  beforeEach(() => {
    hashes.mockClear();
  });

  it('a book with no stored records is hashed not at all', async () => {
    await reflowAlignedVerses({ store: storeOf(null), sched: null, book: 'TIT', bookRaw: book('reflow-none') }, ['1:5']);
    expect(hashes).not.toHaveBeenCalled();
  });

  it('one record in the book: only the verse asked about is hashed, and once', async () => {
    const bookRaw = book('reflow-one');
    const file = fileWith({ '3': record(), '9': record() });
    await reflowAlignedVerses({ store: storeOf(file), sched: null, book: 'TIT', bookRaw }, ['1:3', '1:4']);
    expect(hashes).toHaveBeenCalledTimes(1);
    await reflowAlignedVerses({ store: storeOf(file), sched: null, book: 'TIT', bookRaw }, ['1:3']);
    expect(hashes).toHaveBeenCalledTimes(1);
  });

  it('nothing is hashed before the sidecar read settles', () => {
    const pending = reflowAlignedVerses({ store: { readAlignmentsWithMd5: () => new Promise(() => {}) }, sched: null, book: 'TIT', bookRaw: book('reflow-sync') }, ['1:1']);
    expect(pending).toBeInstanceOf(Promise);
    expect(hashes).not.toHaveBeenCalled();
  });
});

describe('#795 the rail hashes only a verse whose status reads the hash', () => {
  beforeEach(() => {
    hashes.mockClear();
  });

  it('no sidecar file: nothing is hashed', () => {
    expect(alignIndexItems(book('rail-none'), null)).toHaveLength(40);
    expect(hashes).not.toHaveBeenCalled();
  });

  it('a valid record is hashed once; an invalid-flagged record and a verse with none are not', () => {
    const bookRaw = book('rail-some');
    const file = fileWith({ '2': record(), '3': record({ invalid: true }) });
    const items = alignIndexItems(bookRaw, file) as Array<{ ref: string; status: string }>;
    expect(hashes).toHaveBeenCalledTimes(1);
    const status = (ref: string) => items.find((i) => i.ref === ref)?.status;
    expect(status('1:2')).toBe('invalid'); // the stored hash is "x", not the slot hash
    expect(status('1:3')).toBe('invalid'); // flagged
    expect(status('1:4')).toBe('todo');
    // The same book text again: the memo answers.
    alignIndexItems(bookRaw, file);
    expect(hashes).toHaveBeenCalledTimes(1);
  });
});
