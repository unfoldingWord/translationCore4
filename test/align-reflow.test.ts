// #213 — keep the alignments an edit did not disturb.
//
// A verse edit used to send the whole record to invalid-and-retain (D36, J6):
// every link dropped from use, the translator re-linked the verse by hand.
// reflowAlignment keeps a link whose target word (text + occurrence, the #255
// tokenizer) is still in the new text, drops the rest, rebuilds the bank from
// the new text, recomputes occurrence totals as integers (I-2) and restamps
// the I-3 hash. It never touches the source side and never creates a link.
// The second suite drives the production helper over the real align
// scheduler: only the changed verse is staged; an untouched verse's record is
// byte-identical; a record the reflow cannot account for is left alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, reflowAlignment, alignmentIsStale, stampTargetVerse } from '../src/data/align/edit';
import { md5Hex } from '../src/data/httpStore';
import { SaveScheduler } from '../src/data/saveScheduler';
import { __alignSaveForTests, __reflowAlignedVersesForTests, alignFileJson } from '../src/state.jsx';
import type { AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

const ORIG = [
  { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'θεοῦ', strong: 'G23160', lemma: 'θεός', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const TEXT = 'Pablo, siervo de Dios y de Dios';

const bank = (r: AlignmentVerseRecord) => r.wordBank.map((w) => `${w.word}/${w.occurrence}/${w.occurrences}`);
const placed = (r: AlignmentVerseRecord) => r.alignments.map((a) => a.bottomWords.map((w) => `${w.word}/${w.occurrence}/${w.occurrences}`));
const wordIn = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;

/** A record with Pablo→Παῦλος, siervo→δοῦλος and Dios(2)→θεοῦ linked. */
const linkedRecord = () => {
  let r = bootstrapVerse(TEXT, ORIG, SOURCE);
  r = linkWord(r, 0, wordIn(r, 'Pablo'));
  r = linkWord(r, 1, wordIn(r, 'siervo'));
  r = linkWord(r, 2, wordIn(r, 'Dios', 2));
  return stampTargetVerse(r, TEXT);
};

describe('#213 reflowAlignment — keep what still fits, drop what changed', () => {
  it('a link whose target word is still present is kept; a new word lands in the bank', () => {
    const next = reflowAlignment(linkedRecord(), 'Pablo, siervo de Dios y apóstol de Dios');
    expect(next).not.toBeNull();
    expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
    expect(bank(next!)).toEqual(['de/1/2', 'Dios/1/2', 'y/1/1', 'apóstol/1/1', 'de/2/2']);
    // The source side is untouched, and the record now vouches for the new text.
    expect(next!.alignments.map((a) => a.topWords)).toEqual(linkedRecord().alignments.map((a) => a.topWords));
    expect(next!.invalid).toBe(false);
    expect(alignmentIsStale(next!, 'Pablo, siervo de Dios y apóstol de Dios')).toBe(false);
  });

  it('a target word the edit changed loses its link and is not in the bank; its replacement is', () => {
    const next = reflowAlignment(linkedRecord(), 'Pablo, esclavo de Dios y de Dios');
    expect(placed(next!)).toEqual([['Pablo/1/1'], [], ['Dios/2/2']]);
    expect(bank(next!)).toContain('esclavo/1/1');
    expect(bank(next!)).not.toContain('siervo/1/1');
  });

  it('occurrence numbers are recomputed for the new text, as integers', () => {
    // Removing the first "Dios" makes the old Dios(2) vanish: its link drops
    // (identity is text + occurrence) and the surviving "Dios" is Dios(1),
    // total 1, in the bank.
    const next = reflowAlignment(linkedRecord(), 'Pablo, siervo de y de Dios');
    expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], []]);
    expect(bank(next!)).toContain('Dios/1/1');
    for (const w of [...next!.wordBank, ...next!.alignments.flatMap((a) => a.bottomWords)]) {
      expect(typeof w.occurrence).toBe('number');
      expect(typeof w.occurrences).toBe('number');
    }
    // A kept word whose total changed carries the new total.
    const more = reflowAlignment(linkedRecord(), 'Pablo, siervo de Dios y de Dios de Dios');
    expect(placed(more!)[2]).toEqual(['Dios/2/3']);
  });

  it('a verse whose links all survive is no longer stale; unlinked words still report work', () => {
    const next = reflowAlignment(linkedRecord(), `${TEXT}.`);
    expect(alignmentIsStale(next!, `${TEXT}.`)).toBe(false);
    expect(next!.wordBank.length).toBeGreaterThan(0); // "de", "Dios"(1), "y" still to place
  });

  it('nothing to reflow → null, so the caller leaves the record exactly as it is (D36)', () => {
    const r = linkedRecord();
    expect(reflowAlignment(undefined, TEXT)).toBeNull();
    expect(reflowAlignment(r, TEXT)).toBeNull(); // unchanged text
    expect(reflowAlignment({ ...r, invalid: true }, 'Pablo, siervo')).toBeNull(); // a span create/break's flag
    expect(reflowAlignment(bootstrapVerse(TEXT, ORIG, SOURCE), 'Pablo, siervo')).toBeNull(); // nothing placed
    expect(reflowAlignment(r, '___')).toBeNull(); // no words in the new text
    expect(reflowAlignment(r, '')).toBeNull();
  });

  it('never creates a link the translator did not make', () => {
    const before = linkedRecord();
    const next = reflowAlignment(before, 'Pablo, siervo de Dios y de Dios y Pablo');
    const linksBefore = before.alignments.reduce((n, a) => n + a.bottomWords.length, 0);
    const linksAfter = next!.alignments.reduce((n, a) => n + a.bottomWords.length, 0);
    expect(linksAfter).toBeLessThanOrEqual(linksBefore);
    expect(bank(next!)).toContain('Pablo/2/2');
  });
});

/** The align scheduler's store: compare-and-swap over one §5.1 file. */
const makeStore = () => {
  let file: { schemaVersion: number; book: string; chapters: Record<string, Record<string, unknown>> } | null = null;
  let md5: string | null = null;
  let writes = 0;
  return {
    get file() {
      return file;
    },
    readAlignmentsWithMd5: async () => ({ value: file, md5 }),
    writeAlignments: async (_book: string, data: typeof file, expectMd5?: string | null) => {
      if ((expectMd5 ?? null) !== md5) throw new Error(`stale write: expected ${expectMd5}, disk ${md5}`);
      file = data;
      md5 = `md5-${++writes}`;
    },
    reconcileStaged: async () => {},
  };
};

const BOOK = 'TIT';
const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
};

describe('#213 reflowAlignedVerses — the changed verse is staged, the untouched verse is byte-identical', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;
  const reflowAlignedVerses = __reflowAlignedVersesForTests;

  const raw = (v1: string, v2: string) => `\\id TIT\n\\c 1\n\\p\n\\v 1 ${v1}\n\\v 2 ${v2}\n`;

  it('one save changes 1:1 — 1:1 is reflowed through the scheduler, 1:2 keeps its bytes', async () => {
    const store = makeStore();
    const v1 = linkedRecord();
    const v2 = linkedRecord();
    const { md5 } = await store.readAlignmentsWithMd5();
    // Seed the file with both records under the production splice.
    let json = alignFileJson(null, BOOK);
    json = spliceAlignRecord(json, '1', '1', JSON.stringify(v1));
    json = spliceAlignRecord(json, '1', '2', JSON.stringify(v2));
    await store.writeAlignments(BOOK, JSON.parse(json), md5);
    const v2Bytes = JSON.stringify(store.file!.chapters['1']['2']);

    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    const newText = 'Pablo, siervo de Dios y apóstol de Dios';
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: raw(newText, TEXT) }, ['1:1']);
    await settle();

    const after1 = store.file!.chapters['1']['1'] as AlignmentVerseRecord;
    expect(after1.targetVerseMd5).toBe(md5Hex(newText));
    expect(placed(after1)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
    expect(bank(after1)).toContain('apóstol/1/1');
    expect(JSON.stringify(store.file!.chapters['1']['2'])).toBe(v2Bytes);
  });

  it('a verse the reflow cannot account for is not staged at all — invalidate-and-retain stays', async () => {
    const store = makeStore();
    const v1 = { ...linkedRecord(), invalid: true };
    const { md5 } = await store.readAlignmentsWithMd5();
    await store.writeAlignments(BOOK, JSON.parse(spliceAlignRecord(alignFileJson(null, BOOK), '1', '1', JSON.stringify(v1))), md5);
    const bytes = JSON.stringify(store.file);
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: raw('Pablo, siervo', TEXT) }, ['1:1']);
    await settle();
    expect(sched.getState()).toBe('saved');
    expect(JSON.stringify(store.file)).toBe(bytes);
  });
});
