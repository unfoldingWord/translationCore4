// #213 — keep the alignments an edit did not disturb.
//
// A verse edit used to send the whole record to invalid-and-retain (D36, J6):
// every link dropped from use, the translator re-linked the verse by hand.
// reflowAlignment keeps a link on its word, drops the link of a word the edit
// removed, rebuilds the bank from the new text, recomputes occurrence totals as
// integers (I-2) and restamps the I-3 hash. It never touches the source side and
// never creates a link. #789 (D106): the link follows its word by position, using
// the verse as it read before the save, and the verse is flagged `invalid` when an
// insert or delete of a copy of a linked word sits before it, or the text cannot
// say which copy changed (a tie). No reflow declines: an `invalid` record and an
// emptied verse are written too.
// The second suite drives the production helper over the real align
// scheduler: only the changed verse is staged; an untouched verse's record is
// byte-identical; a record already flagged is reflowed and stays flagged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, matchWords, reflowAlignment, alignmentIsStale, settleDone, stampTargetVerse } from '../src/data/align/edit';
import type { VerseText } from '../src/data/align/edit';
import { verseWords } from '../src/data/align/verseWords.mjs';
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
/** A verse as the reflow compares it: a plain one-line text is its own slot, and its hash is md5Hex of the text, as the export hashes it. */
const verse = (text: string): VerseText => ({ slot: text, words: verseWords(text), md5: md5Hex(text) });
/** reflowAlignment from the text before the save (`undefined`: the old book held no slot) to the text after it. */
const reflowTo = (record: AlignmentVerseRecord | undefined, before: string | undefined, after: string) =>
  reflowAlignment(record, before === undefined ? undefined : verse(before), verse(after));

const bank = (r: AlignmentVerseRecord) => r.wordBank.map((w) => `${w.word}/${w.occurrence}/${w.occurrences}`);
const placed = (r: AlignmentVerseRecord) => r.alignments.map((a) => a.bottomWords.map((w) => `${w.word}/${w.occurrence}/${w.occurrences}`));
const wordIn = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;

/** A record with Pablo→Παῦλος, siervo→δοῦλος and Dios(2)→θεοῦ linked. */
const linkedRecord = () => {
  let r = bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, md5Hex(TEXT));
  r = linkWord(r, 0, wordIn(r, 'Pablo'));
  r = linkWord(r, 1, wordIn(r, 'siervo'));
  r = linkWord(r, 2, wordIn(r, 'Dios', 2));
  return stampTargetVerse(r, md5Hex(TEXT));
};

describe('#213 reflowAlignment — keep what still fits, drop what changed', () => {
  it('a link whose target word is still present is kept; a new word lands in the bank', () => {
    const next = reflowTo(linkedRecord(), TEXT, 'Pablo, siervo de Dios y apóstol de Dios');
    expect(next).not.toBeNull();
    expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
    expect(bank(next!)).toEqual(['de/1/2', 'Dios/1/2', 'y/1/1', 'apóstol/1/1', 'de/2/2']);
    // The source side is untouched, and the record now vouches for the new text.
    expect(next!.alignments.map((a) => a.topWords)).toEqual(linkedRecord().alignments.map((a) => a.topWords));
    expect(next!.invalid).toBe(false);
    expect(alignmentIsStale(next!, md5Hex('Pablo, siervo de Dios y apóstol de Dios'))).toBe(false);
  });

  it('a target word the edit changed loses its link and is not in the bank; its replacement is', () => {
    const next = reflowTo(linkedRecord(), TEXT, 'Pablo, esclavo de Dios y de Dios');
    expect(next!.invalid).toBe(false); // a word replaced in place is not before a copy of itself
    expect(placed(next!)).toEqual([['Pablo/1/1'], [], ['Dios/2/2']]);
    expect(bank(next!)).toContain('esclavo/1/1');
    expect(bank(next!)).not.toContain('siervo/1/1');
  });

  it('occurrence numbers are recomputed for the new text, as integers', () => {
    // Removing the first "Dios" (#789): the link of the old Dios(2) follows its word, which is now
    // Dios(1), total 1, and the verse is flagged: a copy of a linked word was removed before it.
    const next = reflowTo(linkedRecord(), TEXT, 'Pablo, siervo de y de Dios');
    expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/1/1']]);
    expect(bank(next!)).not.toContain('Dios/1/1');
    expect(next!.invalid).toBe(true);
    for (const w of [...next!.wordBank, ...next!.alignments.flatMap((a) => a.bottomWords)]) {
      expect(typeof w.occurrence).toBe('number');
      expect(typeof w.occurrences).toBe('number');
    }
    // A kept word whose total changed carries the new total. The new "de Dios" is at the end: the
    // text cannot say whether it is the first or the second pair that is new, so it flags (a tie).
    const more = reflowTo(linkedRecord(), TEXT, 'Pablo, siervo de Dios y de Dios de Dios');
    expect(placed(more!)[2]).toEqual(['Dios/2/3']);
    expect(more!.invalid).toBe(true);
  });

  it('nothing to reflow → null, so the caller leaves the record exactly as it is', () => {
    const r = linkedRecord();
    expect(reflowTo(undefined, TEXT, TEXT)).toBeNull();
    expect(reflowTo(r, TEXT, TEXT)).toBeNull(); // unchanged text
    expect(reflowTo(bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, md5Hex(TEXT)), TEXT, 'Pablo, siervo')).toBeNull(); // nothing placed
  });

  // #789 (D106 point 4): no reflow declines. These used to return null, and the record kept its old words.
  it('an invalid record is reflowed and stays invalid; an emptied verse is written with no link', () => {
    const flagged = reflowTo({ ...linkedRecord(), invalid: true }, TEXT, 'Pablo, siervo');
    expect(flagged).not.toBeNull();
    expect(flagged!.invalid).toBe(true);
    expect(placed(flagged!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], []]);
    for (const text of ['___', '']) {
      const emptied = reflowTo(linkedRecord(), TEXT, text);
      expect(emptied).not.toBeNull();
      expect(placed(emptied!)).toEqual([[], [], []]);
      expect(emptied!.wordBank).toEqual([]);
      expect(emptied!.targetVerseMd5).toBe(md5Hex(text));
      expect('done' in emptied!).toBe(false);
    }
  });

  // #789 (D106 point 1 and 2): the rows of the plan's table, on the verse of this file.
  describe('a link follows its word; an insert or delete before a linked copy flags', () => {
    const DIOS = (r: AlignmentVerseRecord) => placed(r)[2];
    it('a tie flags: "de Dios" at the very end could be either pair; the link stays on Dios 2 of 3', () => {
      const next = reflowTo(linkedRecord(), TEXT, `${TEXT} de Dios`);
      expect(DIOS(next!)).toEqual(['Dios/2/3']);
      expect(next!.invalid).toBe(true);
    });
    it('a tie flags: "Pablo dijo: Pablo, siervo" could be either Pablo; the link goes to Pablo 1 of 2', () => {
      const next = reflowTo(linkedRecord(), TEXT, 'Pablo dijo: Pablo, siervo de Dios y de Dios');
      expect(placed(next!)[0]).toEqual(['Pablo/1/2']);
      expect(next!.invalid).toBe(true);
    });
    it('two linked copies, one deleted: the first copy keeps its link, the other goes, and a tie flags', () => {
      let r = bootstrapVerse(verseWords('Dios Dios'), ORIG, SOURCE, md5Hex('Dios Dios'));
      r = linkWord(r, 0, wordIn(r, 'Dios', 1));
      r = linkWord(r, 1, wordIn(r, 'Dios', 2));
      const next = reflowTo(stampTargetVerse(r, md5Hex('Dios Dios')), 'Dios Dios', 'Dios');
      expect(placed(next!)).toEqual([['Dios/1/1'], [], []]);
      expect(next!.invalid).toBe(true);
    });
    it('a tie with no insert or delete before a linked copy: one of two copies is deleted, the first is linked, and the text cannot say which went', () => {
      let r = bootstrapVerse(verseWords('Dios Dios'), ORIG, SOURCE, md5Hex('Dios Dios'));
      r = linkWord(r, 0, wordIn(r, 'Dios', 1));
      const next = reflowTo(stampTargetVerse(r, md5Hex('Dios Dios')), 'Dios Dios', 'Dios');
      // Either copy could be the deleted one. In the pass where the linked copy stays, no lost copy sits
      // before it, so only the two passes disagreeing flags the verse.
      expect(placed(next!)).toEqual([['Dios/1/1'], [], []]);
      expect(next!.invalid).toBe(true);
    });
    it('a copy moves from before the linked word to after another word, and the linked word keeps its number: it still flags', () => {
      // Before: Dios(1 of 2), a, b, Dios(2 of 2, linked). After: a, Dios(1 of 2), b, Dios(2 of 2). The first Dios
      // moved past "a". The linked word is Dios 2 of 2 before and after, and the early pass, which keeps the
      // second Dios in place, sees nothing. Only the late pass sees a copy of its own string lost before it and
      // another gained before it, so an unchanged number does not clear the flag.
      let r = bootstrapVerse(verseWords('Dios a b Dios'), ORIG, SOURCE, md5Hex('Dios a b Dios'));
      r = linkWord(r, 2, wordIn(r, 'Dios', 2));
      const next = reflowTo(stampTargetVerse(r, md5Hex('Dios a b Dios')), 'Dios a b Dios', 'a Dios b Dios');
      expect(placed(next!)).toEqual([[], [], ['Dios/2/2']]);
      expect(next!.invalid).toBe(true);
    });
    it('a linked word that lands on a copy with another number flags, though no copy of its string is lost before it or gained before its new place', () => {
      // Before: Dios(1 of 2, linked), a, Dios(2 of 2), b. After: a, Dios(1 of 2), b, Dios(2 of 2). Both passes send
      // the first Dios to the last Dios. The lost copy is the linked word itself, at index 0, and the new copy is
      // the one it lands on, so neither the lost-before nor the new-before test fires. Only its number, 1 to 2, flags.
      let r = bootstrapVerse(verseWords('Dios a Dios b'), ORIG, SOURCE, md5Hex('Dios a Dios b'));
      r = linkWord(r, 0, wordIn(r, 'Dios', 1));
      const next = reflowTo(stampTargetVerse(r, md5Hex('Dios a Dios b')), 'Dios a Dios b', 'a Dios b Dios');
      expect(placed(next!)).toEqual([['Dios/2/2'], [], []]);
      expect(next!.invalid).toBe(true);
    });
    it('a recased word is a new word: its link goes, and a linked word after it that is renumbered flags', () => {
      let r = bootstrapVerse(verseWords('dios y Dios'), ORIG, SOURCE, md5Hex('dios y Dios'));
      r = linkWord(r, 0, wordIn(r, 'Dios'));
      const next = reflowTo(stampTargetVerse(r, md5Hex('dios y Dios')), 'dios y Dios', 'Dios y Dios');
      // Before: dios, y, Dios(1 of 1, linked). After: Dios(1 of 2), y, Dios(2 of 2). The new first Dios sits before the linked one.
      expect(placed(next!)).toEqual([['Dios/2/2'], [], []]);
      expect(next!.invalid).toBe(true);
    });
    it('a unique word moved, a word replaced and a word inserted: every link is kept or goes, and nothing flags', () => {
      const next = reflowTo(linkedRecord(), TEXT, 'siervo apóstol de Dios y de Dios Pablo');
      expect(next!.invalid).toBe(false);
      expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
      const replaced = reflowTo(linkedRecord(), TEXT, 'Pablo, esclavo apóstol de Dios y de Dios');
      expect(replaced!.invalid).toBe(false);
      expect(placed(replaced!)).toEqual([['Pablo/1/1'], [], ['Dios/2/2']]);
    });
    it('no text before the save: the links stay by word and occurrence, and the verse is flagged', () => {
      const next = reflowTo(linkedRecord(), undefined, 'Pablo, siervo de Dios y apóstol de Dios');
      expect(placed(next!)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
      expect(next!.invalid).toBe(true);
    });
    it('a record that did not fit the text before the save carries the flag to the text after it', () => {
      // Stamped for TEXT, but the save goes from another text: the record never described its before.
      const next = reflowTo(linkedRecord(), 'Pablo, siervo de Dios', 'Pablo, siervo de Dios y apóstol');
      expect(next!.invalid).toBe(true);
    });
  });

  describe('matchWords — the LCS diff', () => {
    it('matches equal words, as early as it can: an insert or a delete goes as late as it can', () => {
      expect(Array.from(matchWords(['a', 'b', 'c'], ['a', 'b', 'c']))).toEqual([0, 1, 2]);
      expect(Array.from(matchWords(['a', 'b', 'a'], ['a', 'b', 'a', 'b', 'a']))).toEqual([0, 1, 2]); // the new pair is the last
      expect(Array.from(matchWords(['a', 'b', 'c'], ['a', 'c']))).toEqual([0, -1, 1]);
      expect(Array.from(matchWords([], ['a']))).toEqual([]);
      expect(Array.from(matchWords(['a'], []))).toEqual([-1]);
    });
    it('on a tie it drops the before word first, so the insert lands as late as it can', () => {
      // Two matches are as long as each other when the two words cross. At the first pair the walk takes the
      // before word out, so the before word is the one with no match and its copy in the after list is the later one.
      expect(Array.from(matchWords(['a', 'b'], ['b', 'a']))).toEqual([-1, 0]);
      // The verse of a linked repeated word: the first Dios has no match, the second Dios and "a" and "b" do.
      expect(Array.from(matchWords(['Dios', 'a', 'b', 'Dios'], ['a', 'Dios', 'b', 'Dios']))).toEqual([-1, 0, 2, 3]);
    });
  });

  // #796 — the write rule: a record whose hash is current but whose stored words are not the
  // verse's words is reflowed. At base the hash alone decided, so such a record stayed as it was
  // and `merge` (the export) refused it.
  describe('a current hash with different stored words (#796)', () => {
    const SLOT = 'Y \\add el \\+nd Señor\\+nd* dijo\\add* así.';
    /** A fully placed, done record for a slot, built on the OLD bank: no 'Señor', no 'dijo'. */
    const oldBankRecord = () => {
      let r = bootstrapVerse(verseWords('Y el así.'), ORIG, SOURCE, md5Hex(SLOT));
      r = linkWord(r, 0, wordIn(r, 'Y'));
      r = linkWord(r, 1, wordIn(r, 'el'));
      r = linkWord(r, 2, wordIn(r, 'así'));
      return settleDone(stampTargetVerse(r, md5Hex(SLOT)));
    };

    it('reflows to the verse words, keeps the links, and takes done back', () => {
      const before = oldBankRecord();
      expect(before.done).toBe(true);
      expect(alignmentIsStale(before, md5Hex(SLOT))).toBe(false); // the hash is current
      expect(verseWords(SLOT).map((w) => w.word)).toEqual(['Y', 'el', 'Señor', 'dijo', 'así']);
      const next = reflowAlignment(before, verse(SLOT), verse(SLOT));
      expect(next).not.toBeNull();
      expect(placed(next!)).toEqual([['Y/1/1'], ['el/1/1'], ['así/1/1']]);
      expect(bank(next!)).toEqual(['Señor/1/1', 'dijo/1/1']);
      expect('done' in next!).toBe(false);
      expect(next!.targetVerseMd5).toBe(md5Hex(SLOT));
      // #789 (D106 point 3): the record did not fit its verse before this save, so it needs review after it.
      expect(next!.invalid).toBe(true);
    });

    it('the same words in another order, or with string counts, are not a change → null', () => {
      let r = bootstrapVerse(verseWords('Y el así.'), ORIG, SOURCE, md5Hex(SLOT));
      r = stampTargetVerse(linkWord(r, 0, wordIn(r, 'Y')), md5Hex(SLOT));
      const shuffled = {
        ...r,
        wordBank: [...r.wordBank].reverse().map((w) => ({ ...w, occurrence: String(w.occurrence), occurrences: String(w.occurrences) })),
      } as unknown as AlignmentVerseRecord;
      expect(alignmentIsStale(shuffled, md5Hex(SLOT))).toBe(false);
      expect(reflowAlignment(shuffled, verse(SLOT), { slot: SLOT, words: verseWords('Y el así.'), md5: md5Hex(SLOT) })).toBeNull();
    });
  });

  it('never creates a link the translator did not make', () => {
    const before = linkedRecord();
    const next = reflowTo(before, TEXT, 'Pablo, siervo de Dios y de Dios y Pablo');
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
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: raw(newText, TEXT), beforeRaw: raw(TEXT, TEXT) }, ['1:1']);
    await settle();

    const after1 = store.file!.chapters['1']['1'] as AlignmentVerseRecord;
    expect(after1.targetVerseMd5).toBe(md5Hex(newText));
    expect(placed(after1)).toEqual([['Pablo/1/1'], ['siervo/1/1'], ['Dios/2/2']]);
    expect(bank(after1)).toContain('apóstol/1/1');
    expect(JSON.stringify(store.file!.chapters['1']['2'])).toBe(v2Bytes);
  });

  it('the project was left while the sidecar read was in flight — nothing is staged on the disposed scheduler', async () => {
    const store = makeStore();
    const { md5 } = await store.readAlignmentsWithMd5();
    await store.writeAlignments(BOOK, JSON.parse(spliceAlignRecord(alignFileJson(null, BOOK), '1', '1', JSON.stringify(linkedRecord()))), md5);
    const bytes = JSON.stringify(store.file);
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    const newText = 'Pablo, siervo de Dios y apóstol de Dios';
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: raw(newText, TEXT), beforeRaw: raw(TEXT, TEXT), stillCurrent: () => false }, ['1:1']);
    await settle();
    expect(sched.getState()).toBe('saved');
    expect(JSON.stringify(store.file)).toBe(bytes);
  });

  it('a record that is already flagged is reflowed, and it stays flagged', async () => {
    const store = makeStore();
    const v1 = { ...linkedRecord(), invalid: true };
    const { md5 } = await store.readAlignmentsWithMd5();
    await store.writeAlignments(BOOK, JSON.parse(spliceAlignRecord(alignFileJson(null, BOOK), '1', '1', JSON.stringify(v1))), md5);
    const bytes = JSON.stringify(store.file);
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    await reflowAlignedVerses({ store, sched, book: BOOK, bookRaw: raw('Pablo, siervo', TEXT), beforeRaw: raw(TEXT, TEXT) }, ['1:1']);
    await settle();
    const after1 = store.file!.chapters['1']['1'] as AlignmentVerseRecord;
    expect(JSON.stringify(store.file)).not.toBe(bytes);
    expect(after1.invalid).toBe(true);
    expect(after1.targetVerseMd5).toBe(md5Hex('Pablo, siervo'));
    expect(placed(after1)).toEqual([['Pablo/1/1'], ['siervo/1/1'], []]);
  });
});
