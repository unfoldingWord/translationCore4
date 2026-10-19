// #794 — tC4 writes no alignment for a verse that holds imported alignment markup.
//
// A book added from an aligned USFM file keeps its `\zaln-s … \zaln-e\*` markup
// inline in the stored verse (an I-1 violation that #553 will clean up by
// extracting it to the sidecar). Until then the verse keeps its stored bytes:
// the aligned export does not weave a record over it, a verse edit does not
// reflow a record for it, and Align does not open it.
//
// The ways this can fail, written before the code:
// 1. the aligned export weaves the translator's partial record over the
//    imported markup (en_ult Titus 1:1: 19 `\zaln-s` become 1);
// 2. the guard also stops a plain draft verse from being woven;
// 3. a draft save stages a reflowed record for a verse that holds markup;
// 4. the predicate misses the markup (or matches a different `\zaln-` marker).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { md5Hex } from '../src/data/httpStore';
import { SaveScheduler } from '../src/data/saveScheduler';
import { parseChapters, verseText } from '../src/data/bookModel';
import { verseBody } from '../src/data/usfm/splice';
import { AlignmentHelpers } from '../src/data/vendor';
import { holdsInlineAlignment, weaveBook as weave } from '../src/data/export/weave.mjs';
import { __alignSaveForTests, __reflowAlignedVersesForTests, __verseHoldsImportedAlignmentForTests as verseHoldsImportedAlignment, alignFileJson } from '../src/state.jsx';
import { decompose } from '../journal/skeleton.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import type { AlignmentFile, AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const EN_ULT = fs.readFileSync(path.resolve(__dirname, 'fixtures/en_ult/TIT.usfm'), 'utf8');
const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const SAMPLE_USFM = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const SAMPLE_ALIGNMENTS = (): AlignmentFile => JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));

const weaveBook = (usfm: string, alignments: AlignmentFile | null) => weave(usfm, alignments, AlignmentHelpers);

describe('#794 holdsInlineAlignment', () => {
  const imported = verseBody(EN_ULT, '1', '1');
  const plain = verseBody(SAMPLE_USFM, '1', '1');

  it('is true for the imported en_ult Titus 1:1 and false for the plain sample draft', () => {
    expect(imported).toMatch(/\\zaln-s/);
    expect(holdsInlineAlignment(imported)).toBe(true);
    expect(plain).not.toBeNull();
    expect(holdsInlineAlignment(plain)).toBe(false);
  });

  it('is false for no content, and for a different `\\zaln-` marker', () => {
    expect(holdsInlineAlignment(null)).toBe(false);
    expect(holdsInlineAlignment(undefined)).toBe(false);
    expect(holdsInlineAlignment('')).toBe(false);
    expect(holdsInlineAlignment('Paul, a servant \\zaln-start of God')).toBe(false);
    expect(holdsInlineAlignment('Paul, \\zaln-s |x-strong="G39720"\\*\\w Paul\\w*\\zaln-e\\*')).toBe(true);
  });
});

// The open decision: `openAlign` settles `{ unavailable: 'inline-alignment' }` on this answer.
describe('#794 verseHoldsImportedAlignment — the decision openAlign and the reflow make', () => {
  it('is true for en_ult Titus 1:1, which holds imported markup', () => {
    expect(verseHoldsImportedAlignment(EN_ULT, '1:1')).toBe(true);
  });

  it('is false for the plain conformance sample draft, Titus 1:1', () => {
    expect(verseHoldsImportedAlignment(SAMPLE_USFM, '1:1')).toBe(false);
  });

  it('is false for a verse the book does not have, and for no book', () => {
    expect(verseHoldsImportedAlignment(EN_ULT, '1:999')).toBe(false);
    expect(verseHoldsImportedAlignment(EN_ULT, '99:1')).toBe(false);
    expect(verseHoldsImportedAlignment(null, '1:1')).toBe(false);
    expect(verseHoldsImportedAlignment(undefined, '1:1')).toBe(false);
  });
});

const ORIG = [
  { tag: 'w', type: 'word', text: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'δοῦλος', strong: 'G14010', lemma: 'δοῦλος', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const TEXT = 'Pablo, siervo de Dios';
const NEW_TEXT = 'Pablo, esclavo de Dios';
const BOOK = 'TIT';

const wordIn = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;
/** A record with Pablo→Παῦλος and siervo→δοῦλος linked, stamped for TEXT. */
const linkedRecord = () => {
  let r = bootstrapVerse(TEXT, ORIG, SOURCE, md5Hex(TEXT));
  r = linkWord(r, 0, wordIn(r, 'Pablo'));
  r = linkWord(r, 1, wordIn(r, 'siervo'));
  return stampTargetVerse(r, md5Hex(TEXT));
};

describe('#794 weaveBook — a verse that holds imported alignment markup keeps its stored bytes', () => {
  it('a valid record for en_ult Titus 1:1 is not woven over the imported markup', () => {
    const stored = decompose(EN_ULT).verses as Record<string, string>;
    // The translator's partial record: two links, stamped so the I-3 check passes.
    const text = verseText((parseChapters(EN_ULT) as Record<string, Record<string, unknown>>)['1']['1']);
    let record = bootstrapVerse(text, ORIG, SOURCE, md5Hex(text));
    record = linkWord(record, 0, wordIn(record, 'Paul'));
    record = linkWord(record, 1, wordIn(record, 'servant'));
    record = { ...record, targetVerseMd5: verseTextMd5(stored['1:1']) };
    const alignments = { schemaVersion: 2, book: 'TIT', chapters: { '1': { '1': record } } } as unknown as AlignmentFile;
    const out = weaveBook(EN_ULT, alignments);
    expect((decompose(out).verses as Record<string, string>)['1:1']).toBe(stored['1:1']);
    expect(out).toBe(EN_ULT);
  });

  it('control: a plain draft verse with its real record is still woven', () => {
    const stored = decompose(SAMPLE_USFM).verses as Record<string, string>;
    const out = weaveBook(SAMPLE_USFM, SAMPLE_ALIGNMENTS());
    const woven = (decompose(out).verses as Record<string, string>)['1:1'];
    expect(woven).not.toBe(stored['1:1']);
    expect(woven).toMatch(/\\zaln-s/);
  });
});

// ---- reflow --------------------------------------------------------------

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

const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
};

describe('#794 reflowAlignedVerses — a changed verse that holds imported markup stages no record', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const { makeAlignWriter, spliceAlignRecord } = __alignSaveForTests;

  it('1:1 holds imported markup and 1:2 is plain: only 1:2 is reflowed', async () => {
    const store = makeStore();
    const { md5 } = await store.readAlignmentsWithMd5();
    let json = alignFileJson(null, BOOK);
    json = spliceAlignRecord(json, '1', '1', JSON.stringify(linkedRecord()));
    json = spliceAlignRecord(json, '1', '2', JSON.stringify(linkedRecord()));
    await store.writeAlignments(BOOK, JSON.parse(json), md5);
    const v1Bytes = JSON.stringify(store.file!.chapters['1']['1']);

    const imported = verseBody(EN_ULT, '1', '1')!;
    const raw = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${imported}\n\\v 2 ${NEW_TEXT}\n`;
    const sched = new SaveScheduler({ writeBook: makeAlignWriter({ store }), splice: spliceAlignRecord });
    await __reflowAlignedVersesForTests({ store, sched, book: BOOK, bookRaw: raw }, ['1:1', '1:2']);
    await settle();

    expect(JSON.stringify(store.file!.chapters['1']['1'])).toBe(v1Bytes);
    expect((store.file!.chapters['1']['2'] as AlignmentVerseRecord).targetVerseMd5).toBe(md5Hex(NEW_TEXT));
  });
});
