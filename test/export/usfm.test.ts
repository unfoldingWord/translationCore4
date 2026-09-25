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
//    `<BOOK>-<YYYY-MM-DD>.usfm` forms.
import { describe, expect, it } from 'vitest';
import { weaveBook } from '../../src/data/export/weave.mjs';
import { USFM_ALIGNED, USFM_PLAIN } from '../../src/data/export/usfm';
import type { AlignmentFile } from '../../src/data/align/zaln';
import type { ExportInput } from '../../src/data/export/kernel';
import { extractVerseFromZalnUsfm, origWordsFromAlignments } from '../helpers/zaln';
import { decompose } from '../../journal/skeleton.mjs';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito/ingredients');
const USFM = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
const ALIGNMENTS = (): AlignmentFile => JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const MARKUP = /\\zaln-|\\w /;

/** Every verse of `aligned` against the stored book: a verse in `woven` unweaves to its stored record; every other verse is the stored content, unmarked. */
const expectRoundTrip = (aligned: string, alignments: AlignmentFile, woven: string[]) => {
  const stored = decompose(USFM).verses as Record<string, string>;
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
    expect(extractVerseFromZalnUsfm(out[key], origWordsFromAlignments(record.alignments)), key).toEqual({
      alignments: record.alignments,
      wordBank: record.wordBank,
    });
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
    expectRoundTrip(weaveBook(USFM, stale), stale, []);
    const flagged = ALIGNMENTS();
    flagged.chapters['1']['1'].invalid = true;
    expectRoundTrip(weaveBook(USFM, flagged), flagged, []);
  });

  it('a book with no sidecar exports its text with no markup', () => {
    expectRoundTrip(weaveBook(USFM, null), ALIGNMENTS(), []);
  });
});

describe('#19 USFM producers', () => {
  const input = { store: { readBook: async () => ({ usfm: USFM }), readAlignments: async () => ALIGNMENTS() }, project: { flavor: 'textTranslation' }, book: 'TIT' } as unknown as ExportInput;

  it('plain: the stored book file byte for byte, as <BOOK>-<YYYY-MM-DD>.usfm', async () => {
    const file = await USFM_PLAIN.produce(input);
    expect(Buffer.from(file.bytes).equals(Buffer.from(USFM, 'utf8'))).toBe(true);
    expect(file.filename).toMatch(/^TIT-\d{4}-\d{2}-\d{2}\.usfm$/);
  });

  it('aligned: the woven book, as <BOOK>-aligned-<YYYY-MM-DD>.usfm', async () => {
    const file = await USFM_ALIGNED.produce(input);
    expect(new TextDecoder().decode(file.bytes)).toBe(weaveBook(USFM, ALIGNMENTS()));
    expect(file.filename).toMatch(/^TIT-aligned-\d{4}-\d{2}-\d{2}\.usfm$/);
  });

  it('applies to a Bible project only', () => {
    for (const producer of [USFM_ALIGNED, USFM_PLAIN]) {
      expect(producer.appliesTo({ flavor: 'textTranslation' } as never)).toBe(true);
      expect(producer.appliesTo({ flavor: 'textStories' } as never)).toBe(false);
    }
  });
});
