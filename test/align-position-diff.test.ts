// #789 — a link follows its word, and an edit before a linked repeated word flags the verse (D106).
//
// After a Translate save, the reflow used to keep a link when the same word with the same
// occurrence number was still in the verse. An edit that added or removed an EARLIER copy of a
// word renumbered the later copies, so the link moved to another physical word and nothing flagged
// the verse. It also declined (returned null) for an `invalid` record and for an emptied verse, and
// a declined record kept its old words, so a later save could attach an old link to a new word.
//
// The reflow now gets the text from before the save (`beforeRaw`), compares the verse's words
// before and after by position (an LCS diff), and moves each link with its word. It flags the verse
// (`invalid: true`) when the save adds, removes or moves a copy of a linked word before that word,
// or when the text cannot say which copy changed.
//
// The sample is Titus 1:1 of the conformance burrito: "Pablo, siervo de Dios y apóstol de
// Jesucristo, según la fe de los escogidos de Dios y el conocimiento de la verdad que va con la
// piedad," with six links, among them Θεοῦ/1 -> Dios/1 and Θεοῦ/2 -> Dios/2.
//
// The ways this can fail, written before the code:
// B1 deleting "de Dios" after "siervo" leaves the Θεοῦ/1 card holding the deleted word's link, or
//    moves it to the other Dios, or does not flag the verse;
// B2 inserting "Dios llamó a" before "Pablo" keeps the links on Dios/1 and Dios/2 by number, so both
//    links move to other words with no flag;
// B3 an edit that touches no copy of a linked word flags the verse, or moves a link;
// B4 a later save puts an old link on a re-added word (the reflow declined for an `invalid` record,
//    so the record kept its old words), or the file does not change at a save;
// B5 a save over a record that no longer fits the text before the save restamps it and clears the
//    reason to review, so a verse that needed review reads valid;
// B6 a section save, which reflows several verses with one text from before, treats a verse that
//    holds a link and an edit of unlinked words as flagged, or does not flag the first verse.
// B7 (#820) a replace of one copy of a repeated word keeps a link on the copy that is left with no
//    flag, though the text cannot say which copy was replaced; or a replace that leaves no doubt flags.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, reflowAlignment, stampTargetVerse } from '../src/data/align/edit';
import type { VerseText } from '../src/data/align/edit';
import { md5Hex } from '../src/data/httpStore';
import { recordWords } from '../src/data/align/review.mjs';
import { sameWords, verseWords } from '../src/data/align/verseWords.mjs';
import { SaveScheduler } from '../src/data/saveScheduler';
import { decompose } from '../journal/skeleton.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import {
  __alignIndexItemsForTests as alignIndexItems,
  __alignSaveForTests,
  __buildAlignmentSessionForTests as buildAlignmentSession,
  __reflowAlignedVersesForTests as reflowAlignedVerses,
  alignFileJson,
} from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const RAW: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const FILE: AlignmentFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const STORED = FILE.chapters['1']['1'];
const SOURCE = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
const SV = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const BOOK = 'TIT';

const ORIG = STORED.alignments.flatMap((a) => a.topWords).map((t) => ({
  tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph,
  occurrence: t.occurrence, occurrences: t.occurrences,
}));

/** The book text with one exact piece of it replaced. A piece that is not in the text is a test error. */
const edit = (raw: string, from: string, to: string): string => {
  expect(raw.split(from).length - 1, `"${from}" occurs once`).toBe(1);
  return raw.replace(from, to);
};
const slotOf = (raw: string, ref = '1:1'): string => (decompose(toNfc(raw) as string).verses as Record<string, string>)[ref];
const md5Of = (raw: string, ref = '1:1'): string => verseTextMd5(slotOf(raw, ref)) as string;

const RAW1 = edit(RAW, 'siervo de Dios y apóstol', 'siervo y apóstol'); // "de Dios" after "siervo" deleted
const RAW2 = edit(RAW, 'Pablo, siervo', 'Dios llamó a Pablo, siervo'); // "Dios llamó a" before "Pablo"

const word = (w: AlignedWord): string => `${w.word}/${w.occurrence}/${w.occurrences}`;
/** The words on the card that starts with Θεοῦ/n: the n-th Θεοῦ of the source. */
const theta = (r: AlignmentVerseRecord, n: number): string[] =>
  r.alignments.find((a) => a.topWords.some((t) => t.word === 'Θεοῦ' && Number(t.occurrence) === n))!.bottomWords.map(word);
/** The words on the card that holds this source word. */
const cardOf = (r: AlignmentVerseRecord, top: string): string[] =>
  r.alignments.find((a) => a.topWords.some((t) => t.word === top))!.bottomWords.map(word);
const bank = (r: AlignmentVerseRecord): string[] => r.wordBank.map(word);
const fits = (r: AlignmentVerseRecord, raw: string, ref = '1:1'): boolean =>
  sameWords(recordWords(r), verseWords(slotOf(raw, ref))) && r.targetVerseMd5 === md5Of(raw, ref);

/** The align scheduler's store: compare-and-swap over one §5.1 file. */
const makeStore = () => {
  let file: AlignmentFile | null = null;
  let md5: string | null = null;
  let writes = 0;
  return {
    get file() {
      return file;
    },
    get writes() {
      return writes;
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
const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
};
const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;

/** A store that holds these records (verse key -> record) of chapter 1. */
const seeded = async (records: Record<string, AlignmentVerseRecord>) => {
  const store = makeStore();
  let json = alignFileJson(null, BOOK);
  for (const [verse, record] of Object.entries(records)) json = spliceAlignRecord(json, '1', verse, JSON.stringify(record));
  await store.writeAlignments(BOOK, JSON.parse(json), null);
  const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
  return { store, sched };
};
type Seeded = Awaited<ReturnType<typeof seeded>>;
const recordOf = (s: Seeded, verse = '1'): AlignmentVerseRecord => s.store.file!.chapters['1'][verse] as AlignmentVerseRecord;
/** One Translate save of 1:1: the text before it and the text after it. */
const save = async (s: Seeded, beforeRaw: string, bookRaw: string, refs = ['1:1']) => {
  await reflowAlignedVerses({ store: s.store, sched: s.sched, book: BOOK, bookRaw, beforeRaw }, refs);
  await settle();
};

const storeOf = (file: AlignmentFile) => ({ writeAlignments: () => {}, readAlignmentsWithMd5: async () => ({ value: file, md5: 'm1' }) });
const railStatus = (raw: string, file: AlignmentFile): string | undefined =>
  (alignIndexItems(raw, file) as Array<{ ref: string; status: string }>).find((i) => i.ref === '1:1')?.status;
const openSession = (raw: string, file: AlignmentFile) =>
  buildAlignmentSession(storeOf(file), null, { book: BOOK, bookRaw: raw, project: {} }, '1:1', SOURCE, ORIG);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('#789 preconditions: the sample is what the table says', () => {
  it('the stored 1:1 record fits RAW and has six links, Θεοῦ/1 on Dios/1 and Θεοῦ/2 on Dios/2', () => {
    expect(fits(STORED, RAW)).toBe(true);
    expect(STORED.invalid).toBe(false);
    expect(STORED.alignments.reduce((n, a) => n + a.bottomWords.length, 0)).toBe(6);
    expect(theta(STORED, 1)).toEqual(['Dios/1/2']);
    expect(theta(STORED, 2)).toEqual(['Dios/2/2']);
    expect(fits(STORED, RAW1)).toBe(false);
  });
});

describe('#789 B1 (AC1): a deleted word loses its link, and the link of the other copy follows its word', () => {
  it('deleting "de Dios" after "siervo": Θεοῦ/1 is empty, Θεοῦ/2 holds the one Dios, the verse is flagged', async () => {
    const s = await seeded({ '1': STORED });
    await save(s, RAW, RAW1);
    const r = recordOf(s);
    expect(theta(r, 1)).toEqual([]);
    expect(theta(r, 2)).toEqual(['Dios/1/1']);
    expect(bank(r).filter((w) => w.startsWith('Dios/'))).toEqual([]);
    // The cards of the words the edit did not touch are as they were.
    for (const top of ['Παῦλος', 'δοῦλος', 'ἀπόστολος', 'Ἰησοῦ']) expect(cardOf(r, top)).toEqual(cardOf(STORED, top));
    expect(r.invalid).toBe(true);
    expect(r.targetVerseMd5).toBe(md5Of(RAW1));
    expect(sameWords(recordWords(r), verseWords(slotOf(RAW1)))).toBe(true);
  });
});

describe('#789 B2 (AC2): an insert before a repeated linked word moves each link with its word and flags the verse', () => {
  it('"Dios llamó a" before "Pablo": Θεοῦ/1 is on Dios 2 of 3, Θεοῦ/2 on Dios 3 of 3, Dios 1 of 3 is in the bank', async () => {
    const s = await seeded({ '1': STORED });
    await save(s, RAW, RAW2);
    const r = recordOf(s);
    expect(theta(r, 1)).toEqual(['Dios/2/3']);
    expect(theta(r, 2)).toEqual(['Dios/3/3']);
    expect(bank(r)).toContain('Dios/1/3');
    expect(r.invalid).toBe(true);
    expect(r.targetVerseMd5).toBe(md5Of(RAW2));
  });
});

describe('#789 B3 (AC3): an edit that touches no copy of a linked word keeps every link and does not flag', () => {
  const cases: Array<[string, string, string, string[], string[]]> = [
    ['an unlinked word is added', 'de la verdad', 'de la verdad eterna', ['Dios/1/2'], ['Dios/2/2']],
    ['"de Dios" is added after both linked Dios', 'con la piedad,', 'con la piedad de Dios,', ['Dios/1/3'], ['Dios/2/3']],
    ['an unlinked word is added between two linked words', 'Dios y apóstol', 'Dios y también apóstol', ['Dios/1/2'], ['Dios/2/2']],
  ];
  it.each(cases)('%s', async (_name, from, to, t1, t2) => {
    const s = await seeded({ '1': STORED });
    const after = edit(RAW, from, to);
    await save(s, RAW, after);
    const r = recordOf(s);
    expect(theta(r, 1)).toEqual(t1);
    expect(theta(r, 2)).toEqual(t2);
    for (const top of ['Παῦλος', 'δοῦλος', 'ἀπόστολος', 'Ἰησοῦ']) expect(cardOf(r, top)).toEqual(cardOf(STORED, top));
    expect(r.invalid).toBe(false);
    expect(fits(r, after)).toBe(true);
  });
});

describe('#789 B4 (AC4): no reflow declines, so an old link never comes back on a new word', () => {
  it('save 1 deletes "de Dios", save 2 puts it back: the first link stays gone, the second follows its Dios', async () => {
    const s = await seeded({ '1': STORED });
    await save(s, RAW, RAW1);
    const afterSave1 = JSON.stringify(s.store.file);
    expect(recordOf(s).invalid).toBe(true);
    const writes = s.store.writes;

    await save(s, RAW1, RAW); // (a) the words come back
    expect(JSON.stringify(s.store.file)).not.toBe(afterSave1); // the file changed at save 2: nothing was declined
    expect(s.store.writes).toBeGreaterThan(writes);
    const a = recordOf(s);
    expect(theta(a, 1)).toEqual([]);
    expect(theta(a, 2)).toEqual(['Dios/2/2']);
    expect(a.invalid).toBe(true);
    expect(railStatus(RAW, s.store.file!)).toBe('invalid');
    expect((await openSession(RAW, s.store.file!)).stale).toBe(true);
  });

  it('save 2 adds "de Dios" at the end instead: the second link stays on the "escogidos" Dios', async () => {
    const s = await seeded({ '1': STORED });
    await save(s, RAW, RAW1);
    const RAW1B = edit(RAW1, 'con la piedad,', 'con la piedad de Dios,');
    await save(s, RAW1, RAW1B);
    const b = recordOf(s);
    expect(theta(b, 1)).toEqual([]);
    expect(theta(b, 2)).toEqual(['Dios/1/2']);
    expect(b.invalid).toBe(true);
    expect(railStatus(RAW1B, s.store.file!)).toBe('invalid');
    expect((await openSession(RAW1B, s.store.file!)).stale).toBe(true);
  });
});

describe('#789 B4b two fast blurs: the second reflow reads the record the first one staged', () => {
  it('both reflows start before either settles: the first link stays gone, and nothing is flagged by a stale read twice', async () => {
    const s = await seeded({ '1': STORED });
    // The two blurs of two edits in a row: RAW -> RAW1, then RAW1 -> RAW. The second is called at once, with no wait.
    const first = reflowAlignedVerses({ store: s.store, sched: s.sched, book: BOOK, bookRaw: RAW1, beforeRaw: RAW }, ['1:1']);
    const second = reflowAlignedVerses({ store: s.store, sched: s.sched, book: BOOK, bookRaw: RAW, beforeRaw: RAW1 }, ['1:1']);
    await Promise.all([first, second]);
    await settle();
    const r = recordOf(s);
    // Had the second reflow read the record of RAW (which fits RAW), it would stage nothing, and the
    // file would keep the record of RAW1: the hash and the second link below would not be those of RAW.
    expect(theta(r, 1)).toEqual([]);
    expect(theta(r, 2)).toEqual(['Dios/2/2']);
    expect(r.invalid).toBe(true);
    expect(r.targetVerseMd5).toBe(md5Of(RAW));
  });
});

describe('#789 B5 (AC5): a record that no longer fits the text before the save stays under review', () => {
  it('(a) RAW1 opened with the record made for RAW and no reflow: the banner and the red dot show', async () => {
    const file = JSON.parse(spliceAlignRecord(alignFileJson(null, BOOK), '1', '1', JSON.stringify(STORED))) as AlignmentFile;
    expect((await openSession(RAW1, file)).stale).toBe(true);
    expect(railStatus(RAW1, file)).toBe('invalid');
  });

  it('(b) then a save of RAW1 to RAW1 with "eterna" restamps the record and flags it', async () => {
    const s = await seeded({ '1': STORED });
    const RAW1E = edit(RAW1, 'de la verdad', 'de la verdad eterna');
    await save(s, RAW1, RAW1E);
    const r = recordOf(s);
    expect(r.invalid).toBe(true);
    expect(r.targetVerseMd5).toBe(md5Of(RAW1E));
    expect(railStatus(RAW1E, s.store.file!)).toBe('invalid');
  });
});

describe('#789 B6 (AC6): the section shape, several verses with one text from before', () => {
  const VERSE2 = 'con la esperanza de la vida eterna, la cual Dios, que no miente, prometió desde antes del principio de los siglos,';
  /** 1:2 with Dios linked to its one card; made on the slot of RAW, so it fits RAW. */
  const record2 = (): AlignmentVerseRecord => {
    const slot = slotOf(RAW, '1:2');
    const orig = [{ tag: 'w', type: 'word', text: 'Θεός', strong: 'G23160', lemma: 'θεός', morph: 'Gr,N', occurrence: 1, occurrences: 1 }];
    const r = bootstrapVerse(verseWords(slot), orig, SV, md5Of(RAW, '1:2'));
    return linkWord(r, 0, r.wordBank.find((w) => w.word === 'Dios') as AlignedWord);
  };

  it('1:1 deletes "de Dios" and is flagged; 1:2 edits unlinked words and keeps its link without a flag', async () => {
    expect(RAW).toContain(VERSE2);
    const s = await seeded({ '1': STORED, '2': record2() });
    const after = edit(RAW1, 'prometió desde', 'prometió ya desde');
    await save(s, RAW, after, ['1:1', '1:2']);
    // 1:1 as in B1.
    const r1 = recordOf(s);
    expect(theta(r1, 1)).toEqual([]);
    expect(theta(r1, 2)).toEqual(['Dios/1/1']);
    expect(r1.invalid).toBe(true);
    // 1:2: its link stays on Dios, the verse is restamped, and nothing flags it.
    const r2 = recordOf(s, '2');
    expect(r2.alignments[0].bottomWords.map(word)).toEqual(['Dios/1/1']);
    expect(r2.invalid).toBe(false);
    expect(r2.targetVerseMd5).toBe(md5Of(after, '1:2'));
    expect(fits(r2, after, '1:2')).toBe(true);
  });
});

describe('#820 B7: a replace of one copy of a repeated word flags the verse; a replace that leaves no doubt does not', () => {
  const ORIG3 = ORIG.slice(0, 3);
  const verse = (text: string): VerseText => ({ slot: text, words: verseWords(text), md5: md5Hex(text) });
  /** A record of `text` with the given copies linked, card n to the n-th entry, then the reflow to `after`. */
  const reflowOf = (text: string, links: Array<[string, number]>, after: string) => {
    let r = bootstrapVerse(verseWords(text), ORIG3, SV, md5Hex(text));
    links.forEach(([w, occ], card) => {
      r = linkWord(r, card, r.wordBank.find((b) => b.word === w && Number(b.occurrence) === occ) as AlignedWord);
    });
    return reflowAlignment(stampTargetVerse(r, md5Hex(text)), verse(text), verse(after))!;
  };
  const placed = (r: AlignmentVerseRecord) => r.alignments.map((a) => a.bottomWords.map(word));

  it('"Dios Dios" with the first Dios linked, saved as "Dios Pablo": either Dios can be the one left, so the verse is flagged', () => {
    const r = reflowOf('Dios Dios', [['Dios', 1]], 'Dios Pablo');
    expect(r.targetVerseMd5).toBe(md5Hex('Dios Pablo'));
    expect(r.invalid).toBe(true);
  });
  it('the mirror: the second Dios linked, saved as "Dios Pablo": the verse is flagged', () => {
    const r = reflowOf('Dios Dios', [['Dios', 2]], 'Dios Pablo');
    expect(r.targetVerseMd5).toBe(md5Hex('Dios Pablo'));
    expect(r.invalid).toBe(true);
  });
  it('the replace before the link: "Dios Dios" with the second Dios linked, saved as "Pablo Dios": the verse is flagged', () => {
    expect(reflowOf('Dios Dios', [['Dios', 2]], 'Pablo Dios').invalid).toBe(true);
  });
  it('a replace of a word that is not repeated, next to the link: the link stays and nothing flags', () => {
    const r = reflowOf('Dios Pablo', [['Dios', 1]], 'Dios Juan');
    expect(placed(r)).toEqual([['Dios/1/1'], [], []]);
    expect(r.invalid).toBe(false);
  });
  it('a replace of the linked word, which is not repeated: its link goes and nothing flags', () => {
    const r = reflowOf('Pablo Dios', [['Pablo', 1], ['Dios', 1]], 'Juan Dios');
    expect(placed(r)).toEqual([[], ['Dios/1/1'], []]);
    expect(r.invalid).toBe(false);
  });
  it('a word that is not repeated moves: its link follows it and nothing flags', () => {
    const r = reflowOf('Dios Pablo', [['Dios', 1]], 'Pablo Dios');
    expect(placed(r)).toEqual([['Dios/1/1'], [], []]);
    expect(r.invalid).toBe(false);
  });
  it('Titus 1:1 through the save path: "siervo" replaced by "esclavo" drops its link, keeps the other links and does not flag', async () => {
    const s = await seeded({ '1': STORED });
    const after = edit(RAW, 'Pablo, siervo de', 'Pablo, esclavo de');
    await save(s, RAW, after);
    const r = recordOf(s);
    expect(cardOf(r, 'δοῦλος')).toEqual([]);
    expect(theta(r, 1)).toEqual(['Dios/1/2']);
    expect(theta(r, 2)).toEqual(['Dios/2/2']);
    expect(r.invalid).toBe(false);
    expect(fits(r, after)).toBe(true);
  });
});
