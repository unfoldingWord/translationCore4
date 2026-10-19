// #796 — the two places the provider takes the verse's words, driven for real.
//
// The Align write path takes its word list from the stored verse slot
// (`verseWords`, verseWords.mjs), not from the display text. For a verse with
// a nested marker (`\add el \+nd Señor\+nd* dijo\add*`) the two lists differ: the
// display text drops "Señor" and "dijo", the slot has them, and word-aligner
// `merge` (the export) checks the slot. These tests keep the provider on the slot:
//
// W1 `reflowAlignedVerses` (a draft save or blur) stages a record built on the
//    SLOT's words, so the bank holds "Señor" and "dijo". Fed the display text, a
//    record with a current hash and the old words reflowed to nothing and stayed
//    as it was.
// W2 `alignSessionAfterEdit` (the pipeline `applyAlignEdit` runs after the
//    mutation) makes the edited record match the session's words: no doubled
//    word, cards in verse order, the bank complete. Without that step the file
//    held the record as the mutation left it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord } from '../src/data/align/edit';
import { verseWords, sameWords } from '../src/data/align/verseWords.mjs';
import { SaveScheduler } from '../src/data/saveScheduler';
import { decompose } from '../journal/skeleton.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import { toNfc } from '../journal/grammar.mjs';
import {
  __alignSaveForTests, __alignSessionAfterEditForTests as alignSessionAfterEdit,
  __buildAlignmentSessionForTests as buildAlignmentSession, __reflowAlignedVersesForTests as reflowAlignedVerses, alignFileJson,
} from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const ORIG = ['Καὶ', 'ὁ', 'Κύριος'].map((text) => ({
  tag: 'w', type: 'word', text, strong: 'G00000', lemma: text, morph: 'Gr,N', occurrence: 1, occurrences: 1,
}));
const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const SOURCE = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
const BOOK = 'TIT';
const RAW = '\\id TIT\n\\c 1\n\\p\n\\v 1 Y \\add el \\+nd Señor\\+nd* dijo\\add* así.\n\\v 2 Otro verso.\n';
/** The stored slot of 1:1, cut as the export cuts it, and its hash. */
const SLOT = (decompose(toNfc(RAW) as string).verses as Record<string, string>)['1:1'];
const MD5 = verseTextMd5(SLOT) as string;
const WORDS = verseWords(SLOT);

const key = (w: AlignedWord) => `${w.word}/${w.occurrence}/${w.occurrences}`;
const bank = (r: AlignmentVerseRecord) => r.wordBank.map(key);
const placed = (r: AlignmentVerseRecord) => r.alignments.map((a) => a.bottomWords.map(key));
const everyWord = (r: AlignmentVerseRecord): AlignedWord[] => [...r.wordBank, ...r.alignments.flatMap((a) => a.bottomWords)];
const wordIn = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;

describe('the slot is not the display text (the premise of W1 and W2)', () => {
  it('the slot has "Señor" and "dijo"; the words of the old text do not', () => {
    expect(WORDS.map((w) => w.word)).toEqual(['Y', 'el', 'Señor', 'dijo', 'así']);
    expect(verseWords('Y el así.').map((w) => w.word)).toEqual(['Y', 'el', 'así']);
  });
});

/** The align scheduler's store: compare-and-swap over one §5.1 file. */
const makeStore = (file: AlignmentFile | null = null) => {
  let md5: string | null = file ? 'seed' : null;
  let writes = 0;
  return {
    get file() {
      return file;
    },
    readAlignmentsWithMd5: async () => ({ value: file, md5 }),
    writeAlignments: async (_book: string, data: AlignmentFile, expectMd5?: string | null) => {
      if ((expectMd5 ?? null) !== md5) throw new Error(`stale write: expected ${expectMd5}, disk ${md5}`);
      file = data;
      md5 = `md5-${++writes}`;
    },
    reconcileStaged: async () => {},
  };
};
const fileOf = (record: AlignmentVerseRecord): AlignmentFile =>
  JSON.parse(__alignSaveForTests.spliceAlignRecord(alignFileJson(null, BOOK), '1', '1', JSON.stringify(record)));

describe('W1 reflowAlignedVerses takes the verse words from the stored slot', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
  /** Reflow 1:1 over the real scheduler and return what the file holds after. */
  const reflow = async (record: AlignmentVerseRecord) => {
    const store = makeStore(fileOf(record));
    const before = JSON.stringify(store.file);
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: RAW }, ['1:1']);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    return { before, after: store.file!, record: store.file!.chapters['1']['1'] as AlignmentVerseRecord };
  };
  /** Y, el and así placed on the three cards, on a bank that was made from `old`. */
  const recordOn = (old: string): AlignmentVerseRecord => {
    let r = bootstrapVerse(verseWords(old), ORIG, SV, MD5);
    for (const [i, w] of ['Y', 'el', 'así'].entries()) r = linkWord(r, i, wordIn(r, w));
    return r;
  };

  it('a record with links, a current hash and the OLD words is staged with the slot words', async () => {
    const old = recordOn('Y el así.');
    expect(old.targetVerseMd5).toBe(MD5); // the hash is current: only the words say it is stale
    expect(old.wordBank).toEqual([]);
    const { record } = await reflow(old);
    expect(placed(record)).toEqual([['Y/1/1'], ['el/1/1'], ['así/1/1']]);
    expect(bank(record)).toEqual(['Señor/1/1', 'dijo/1/1']);
    expect(sameWords(everyWord(record), WORDS)).toBe(true);
    expect(record.targetVerseMd5).toBe(MD5);
  });

  it('control: a record that already holds the slot words is not staged, its bytes stay', async () => {
    const current = recordOn('Y \\add el \\+nd Señor\\+nd* dijo\\add* así.');
    expect(sameWords(everyWord(current), WORDS)).toBe(true);
    const { before, after } = await reflow(current);
    expect(JSON.stringify(after)).toBe(before);
  });
});

describe('W2 alignSessionAfterEdit makes the edited record match the session words', () => {
  const open = () =>
    buildAlignmentSession(makeStore(), null, { book: BOOK, bookRaw: RAW, project: { scriptDirection: 'ltr' } }, '1:1', SOURCE, ORIG);
  const w = (word: string): AlignedWord => {
    const { occurrence, occurrences } = WORDS.find((x) => x.word === word)!;
    return { word, occurrence, occurrences };
  };

  it('a doubled word, cards out of verse order and a short bank come out reconciled', async () => {
    const a2 = await open();
    expect(a2.words).toEqual(WORDS);
    const unreconciled: AlignmentVerseRecord = {
      ...a2.record,
      alignments: [
        { ...a2.record.alignments[0], bottomWords: [w('así'), w('Y')] }, // out of verse order
        { ...a2.record.alignments[1], bottomWords: [w('el'), w('Y')] }, // Y is placed twice
        { ...a2.record.alignments[2], bottomWords: [] },
      ],
      wordBank: [], // "Señor" and "dijo" are in no list
    };
    const edited = alignSessionAfterEdit({ ...a2, armed: [w('dijo')] }, unreconciled, true);
    const record: AlignmentVerseRecord = edited.record;
    expect(placed(record)).toEqual([['Y/1/1', 'así/1/1'], ['el/1/1'], []]); // the first card keeps the doubled word
    expect(bank(record)).toEqual(['Señor/1/1', 'dijo/1/1']);
    expect(sameWords(everyWord(record), WORDS)).toBe(true);
    expect(record.targetVerseMd5).toBe(a2.targetMd5);
    expect(record.targetVerseMd5).toBe(MD5);
    expect(edited.armed).toBeNull(); // disarm
    expect(edited.stale).toBe(false);
    expect(edited.refusal).toBeNull();
  });

  it('an edit that does not disarm keeps the armed words', async () => {
    const a2 = await open();
    const edited = alignSessionAfterEdit({ ...a2, armed: [w('dijo')] }, linkWord(a2.record, 0, w('Y')), false);
    expect(edited.armed).toEqual([w('dijo')]);
    expect(placed(edited.record)[0]).toEqual(['Y/1/1']);
  });
});
