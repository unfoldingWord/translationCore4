// The USFM export (issue #19): the book as aligned USFM (the §5.1 records woven
// in as `\zaln` and `\w`) and as plain USFM (the stored file). The journey
// (e2e/j07-publish.spec.ts, "USFM") proves the menu and the download; this file
// proves the weave on the conformance sample, where CI runs it.
//
// The ways the export can fail, written before the tests (D81 rule 3):
// 1. the weave loses, reorders or changes an alignment, so unweaving does not
//    give the stored record;
// 2. a verse with no record gains markup, or its text changes;
// 3. a record that no longer matches its verse (I-3) or carries `invalid` is
//    woven onto text it does not describe;
// 4. the plain export is not the stored file byte for byte;
// 5. a file name leaves the `<BOOK>-aligned-<YYYY-MM-DD>.usfm` /
//    `<BOOK>-<YYYY-MM-DD>.usfm` forms;
// 6. a footnote or another marker inside a woven verse is lost, or a byte
//    outside the verses (headers, chapter and paragraph markers) changes;
// 7. the Windows server names zip entries with `\` (#425, PLATFORM-NOTES note
//    41), the `/` lookup misses, and the plain export throws instead of
//    downloading;
// 8. (#796) a verse whose record needs review (the text or the words changed, or
//    `invalid`) is left out with no name: the translator never learns that it is
//    not in the file;
// 9. (#796) a record with no placed word is woven: every word of the verse gets
//    `\w`, where a verse with no record exports its stored bytes;
// 10. (#796) a record that `merge` refuses, with words that look right, leaves the
//    verse out with no name;
// 11. (#796) a record that the app wrote (`finalizeEdit`) does not unweave to its
//    own words, or a word bank in another order changes the bytes.
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { weaveBook as weave } from '../../src/data/export/weave.mjs';
import { AlignmentHelpers } from '../../src/data/vendor';
import { USFM_ALIGNED, USFM_PLAIN } from '../../src/data/export/usfm';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../../src/data/align/zaln';
import { bootstrapVerse, finalizeEdit, linkWord } from '../../src/data/align/edit';
import { verseWords } from '../../src/data/align/verseWords.mjs';

const weaveBook = (usfm: string, alignments: AlignmentFile | null) => weave(usfm, alignments, AlignmentHelpers);
import type { ExportInput } from '../../src/data/export/kernel';
import { extractVerseFromZalnUsfm, origWordsFromAlignments } from '../helpers/zaln';
import { decompose } from '../../journal/skeleton.mjs';
import { verseTextMd5 } from '../../journal/fold.mjs';

type Skip = { ref: string; reason: string };
/** The weave with its report: the aligned book and every verse it named, in order. */
const weaveReported = (usfm: string, alignments: AlignmentFile | null): { out: string; skips: Skip[] } => {
  const skips: Skip[] = [];
  const out = weave(usfm, alignments, AlignmentHelpers, (skip: Skip) => skips.push(skip));
  return { out, skips };
};

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito/ingredients');
const USFM = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const ALIGNMENTS = (): AlignmentFile => JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const MARKUP = /\\zaln-|\\w /;

/** One target word as a comparable key: a numeric string counts as its number (I-2). */
const keyOf = (w: AlignedWord): string => `${w.word}|${Number(w.occurrence)}|${Number(w.occurrences)}`;
const sortedKeys = (words: AlignedWord[]): string[] => words.map(keyOf).sort();

/** `aligned` against the stored book `usfm`: every byte outside the verses is the same; a verse in `woven` unweaves to its stored record (each card's top words, and its target words and the bank as sets: a record that the app wrote keeps them in verse order, the unweave gives another order); every other verse is the stored content, unmarked. */
const expectRoundTrip = (aligned: string, alignments: AlignmentFile, woven: string[], usfm: string = USFM) => {
  expect(decompose(aligned).skeleton).toBe(decompose(usfm).skeleton);
  const stored = decompose(usfm).verses as Record<string, string>;
  const out = decompose(aligned).verses as Record<string, string>;
  expect(Object.keys(out)).toEqual(Object.keys(stored));
  for (const key of Object.keys(stored)) {
    if (!woven.includes(key)) {
      expect(out[key], key).toBe(stored[key]);
      continue;
    }
    const [chapter, verse] = key.split(':');
    const record = alignments.chapters[chapter][verse];
    expect(out[key], key).toMatch(MARKUP);
    const back = extractVerseFromZalnUsfm(out[key], origWordsFromAlignments(record.alignments));
    expect(back.alignments.length, key).toBe(record.alignments.length);
    record.alignments.forEach((card, i) => {
      expect(back.alignments[i].topWords, `${key} card ${i}`).toEqual(card.topWords);
      expect(sortedKeys(back.alignments[i].bottomWords), `${key} card ${i}`).toEqual(sortedKeys(card.bottomWords));
    });
    expect(sortedKeys(back.wordBank), `${key} bank`).toEqual(sortedKeys(record.wordBank));
  }
};

describe('#19 weaveBook', () => {
  it('unweaving every verse gives the stored §5.1 records exactly; a verse with no record is its stored text', () => {
    const alignments = ALIGNMENTS();
    expectRoundTrip(weaveBook(USFM, alignments), alignments, ['1:1']);
  });

  it('weaves no record that fails I-3 or carries invalid (negative controls)', () => {
    const stale = ALIGNMENTS();
    stale.chapters['1']['1'].targetVerseMd5 = '0'.repeat(32);
    const staleRun = weaveReported(USFM, stale);
    expectRoundTrip(staleRun.out, stale, []);
    expect(staleRun.skips).toEqual([{ ref: '1:1', reason: 'needs-review' }]);
    const flagged = ALIGNMENTS();
    flagged.chapters['1']['1'].invalid = true;
    const flaggedRun = weaveReported(USFM, flagged);
    expectRoundTrip(flaggedRun.out, flagged, []);
    expect(flaggedRun.skips).toEqual([{ ref: '1:1', reason: 'needs-review' }]);
  });

  it('keeps a footnote and a paragraph break inside a woven verse', () => {
    const marked = USFM.replace('de Dios y apóstol', 'de Dios y\n\\p\napóstol').replace('con la piedad,', 'con la piedad,\\f + \\ft Nota de prueba.\\f*');
    const alignments = ALIGNMENTS();
    // The store stamps the record against the verse as it is stored (I-3).
    alignments.chapters['1']['1'].targetVerseMd5 = verseTextMd5((decompose(marked).verses as Record<string, string>)['1:1']);
    const aligned = weaveBook(marked, alignments);
    expectRoundTrip(aligned, alignments, ['1:1'], marked);
    const verse = (decompose(aligned).verses as Record<string, string>)['1:1'];
    expect(verse).toContain('\\f + \\ft Nota de prueba.\\f*');
    expect(verse).toMatch(/\\w y\|[^\n]*\n\\p\n\\zaln-s [^\n]*\\w apóstol\|/);
  });

  it('a book with no sidecar exports its text with no markup', () => {
    expectRoundTrip(weaveBook(USFM, null), ALIGNMENTS(), []);
  });
});

// #796 slice 5: the weave leaves out a verse that needs review and names it; a record with no
// placed word is the stored bytes, as a verse with no record is (F6, F20).
describe('#796 weaveBook — skip and name a verse that needs review; keep a verse with nothing placed as stored', () => {
  const STORED = ALIGNMENTS().chapters['1']['1'];
  const SLOT = (decompose(USFM).verses as Record<string, string>)['1:1'];
  const MD5 = verseTextMd5(SLOT) as string;
  const SV = STORED.sourceVersion;
  const WORDS = verseWords(SLOT);
  const fileOf = (record: AlignmentVerseRecord, ref = '1:1'): AlignmentFile => {
    const [chapter, verse] = ref.split(':');
    return { schemaVersion: 1, book: 'TIT', chapters: { [chapter]: { [verse]: record } } };
  };
  const bootstrap = (): AlignmentVerseRecord => bootstrapVerse(WORDS, origWordsFromAlignments(STORED.alignments), SV, MD5);
  const bankWord = (r: AlignmentVerseRecord, word: string): AlignedWord => r.wordBank.find((w) => w.word === word) as AlignedWord;
  const NEEDS_REVIEW: Skip[] = [{ ref: '1:1', reason: 'needs-review' }];

  const noLink: Array<[string, () => AlignmentVerseRecord]> = [
    ['the removal form (no card, no bank: R-8.5.11)', () => ({ alignments: [], wordBank: [], targetVerseMd5: MD5 }) as unknown as AlignmentVerseRecord],
    ['empty cards, every word in the bank', bootstrap],
    ['Mark valid with nothing placed (done)', () => ({ ...bootstrap(), done: true })],
  ];
  it.each(noLink)('%s: the stored bytes, no report (F20)', (_name, make) => {
    const { out, skips } = weaveReported(USFM, fileOf(make()));
    expect(out).toBe(USFM);
    expect(skips).toEqual([]);
  });

  it('control: one placed word is woven, with no report', () => {
    const b = bootstrap();
    const file = fileOf(finalizeEdit(linkWord(b, 0, bankWord(b, 'Pablo')), WORDS, MD5));
    const { out, skips } = weaveReported(USFM, file);
    expect(out).not.toBe(USFM);
    expectRoundTrip(out, file, ['1:1']);
    expect(skips).toEqual([]);
  });

  it('a record the app wrote with finalizeEdit (every third word placed) unweaves to its words, in verse order or not', () => {
    let r = bootstrap();
    r.wordBank.forEach((w, i) => {
      if (i % 3 === 0) r = linkWord(r, i % r.alignments.length, w);
    });
    const record = finalizeEdit(r, WORDS, MD5);
    expect(record.alignments.some((a) => a.bottomWords.length > 0)).toBe(true);
    const file = fileOf(record);
    const { out, skips } = weaveReported(USFM, file);
    expectRoundTrip(out, file, ['1:1']);
    expect(skips).toEqual([]);
  });

  const reviewCases: Array<[string, () => AlignmentVerseRecord]> = [
    ['a word on no card and not in the bank', () => ({ ...STORED, wordBank: STORED.wordBank.filter((w) => w.word !== 'escogidos') })],
    [
      'a word in the bank and on a card',
      () => ({ ...STORED, wordBank: [...STORED.wordBank, { ...(STORED.alignments.flatMap((a) => a.bottomWords).find((w) => w.word === 'Pablo') as AlignedWord) }] }),
    ],
    ['invalid, with no link', () => ({ ...bootstrap(), invalid: true })],
  ];
  it.each(reviewCases)('%s: the stored bytes and a needs-review report (F6)', (_name, make) => {
    const { out, skips } = weaveReported(USFM, fileOf(make()));
    expect(out).toBe(USFM);
    expect(skips).toEqual(NEEDS_REVIEW);
  });

  it('a bank in the reverse order is the same record: the bytes are the sample\'s', () => {
    const { out, skips } = weaveReported(USFM, fileOf({ ...STORED, wordBank: [...STORED.wordBank].reverse() }));
    expect(out).toBe(weaveBook(USFM, ALIGNMENTS()));
    expect(skips).toEqual([]);
  });

  it('occurrences as strings: the words are the verse\'s but merge refuses, and a merge-refused report names the verse', () => {
    const asStrings = (w: AlignedWord): AlignedWord => ({ ...w, occurrence: String(w.occurrence), occurrences: String(w.occurrences) });
    const record: AlignmentVerseRecord = {
      ...STORED,
      alignments: STORED.alignments.map((a) => ({ ...a, bottomWords: a.bottomWords.map(asStrings) })),
      wordBank: STORED.wordBank.map(asStrings),
    };
    const { out, skips } = weaveReported(USFM, fileOf(record));
    expect(out).toBe(USFM);
    expect(skips).toEqual([{ ref: '1:1', reason: 'merge-refused' }]);
  });

  it('a record for a verse the book does not have is left out with no report', () => {
    const { out, skips } = weaveReported(USFM, fileOf(STORED, '9:9'));
    expect(out).toBe(USFM);
    expect(skips).toEqual([]);
  });

  it('the report is optional: a call with no report weaves as before', () => {
    expect(weaveBook(USFM, fileOf({ ...STORED, targetVerseMd5: '0'.repeat(32) }))).toBe(USFM);
  });
});

describe('#19 USFM producers', () => {
  const stored = new Uint8Array(fs.readFileSync(path.join(SAMPLE, 'TIT.usfm')));
  const store = { readBook: async () => ({ usfm: USFM }), readAlignments: async () => ALIGNMENTS(), readZipped: async () => zipSync({ 'ingredients/TIT.usfm': stored }) };
  const input = { store, project: { flavor: 'textTranslation' }, book: 'TIT' } as unknown as ExportInput;

  it('plain: the stored book file byte for byte, as <BOOK>-<YYYY-MM-DD>.usfm', async () => {
    const file = await USFM_PLAIN.produce(input);
    expect(Buffer.from(file.bytes).equals(Buffer.from(stored))).toBe(true);
    expect(file.filename).toMatch(/^TIT-\d{4}-\d{2}-\d{2}\.usfm$/);
  });

  it('plain: a Windows server zip (`\\` entry names, #425) downloads the same stored bytes', async () => {
    const windows = { ...store, readZipped: async () => zipSync({ 'ingredients\\TIT.usfm': stored }) };
    const file = await USFM_PLAIN.produce({ ...input, store: windows } as unknown as ExportInput);
    expect(Buffer.from(file.bytes).equals(Buffer.from(stored))).toBe(true);
  });

  it('aligned: the woven book, as <BOOK>-aligned-<YYYY-MM-DD>.usfm', async () => {
    const file = await USFM_ALIGNED.produce(input);
    expect(new TextDecoder().decode(file.bytes)).toBe(weaveBook(USFM, ALIGNMENTS()));
    expect(file.filename).toMatch(/^TIT-aligned-\d{4}-\d{2}-\d{2}\.usfm$/);
  });

  it('aligned: a verse whose record needs review is named in `skipped`; with nothing left out the file has no `skipped` key (#796)', async () => {
    const stale = ALIGNMENTS();
    stale.chapters['1']['1'].targetVerseMd5 = '0'.repeat(32);
    const file = await USFM_ALIGNED.produce({ ...input, store: { ...store, readAlignments: async () => stale } } as unknown as ExportInput);
    expect(file.skipped).toEqual(['1:1']);
    expect(new TextDecoder().decode(file.bytes)).toBe(USFM);
    // The sample as it is: 1:1 is woven, and nothing is left out.
    const whole = await USFM_ALIGNED.produce(input);
    expect('skipped' in whole).toBe(false);
  });

  it('applies to a Bible project only', () => {
    for (const producer of [USFM_ALIGNED, USFM_PLAIN]) {
      expect(producer.appliesTo({ flavor: 'textTranslation' } as never)).toBe(true);
      expect(producer.appliesTo({ flavor: 'textStories' } as never)).toBe(false);
    }
  });
});
