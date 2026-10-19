// #796 slice 1 — the Align bank and every Align write use the export's word list.
//
// The bank came from `wordTokens` over the display text. The export checks another
// list: word-aligner `merge` tokenizes the stored-form slot. The two agree on plain
// verses and differ on a nested marker and on NFD-typed text. A record built on the
// bank then fails `merge`, and the export drops the verse with no message.
//
// The ways this can fail, written before the code:
// (a) a nested marker (`\add` over `\+nd`): the bank lacks "Señor" and "dijo";
// (b) NFD text: the counts differ, so one word has the wrong occurrence;
// (c) a footnote glued to a word: the bank must not join the footnote text to its
//     neighbours, and an edit must still weave;
// (d) a drafted verse that is bootstrapped, edited and reopened: the record is the
//     one stored, with no banner and no write;
// (e) a word that is both banked and placed, or placed on two cards, is written once.
import { describe, expect, it, vi } from 'vitest';
import { decompose } from '../journal/skeleton.mjs';
import { finalizeEdit, linkWord } from '../src/data/align/edit';
import { weaveBook } from '../src/data/export/weave.mjs';
import { indexBook } from '../src/data/usfm/indexer';
import { AlignmentHelpers } from '../src/data/vendor';
import { __buildAlignmentSessionForTests as buildAlignmentSession } from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
const FILE: AlignmentFile = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'checking/alignments/TIT.json'), 'utf8'));
const SOURCE = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };

/** The aligner's original-language objects, from the Greek words a record holds. */
const ORIG = FILE.chapters['1']['1'].alignments
  .flatMap((a) => a.topWords)
  .map((t) => ({
    tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph,
    occurrence: t.occurrence, occurrences: t.occurrences,
  }));

const makeStore = (file: AlignmentFile | null) => ({
  writeAlignments: vi.fn(),
  readAlignmentsWithMd5: async () => ({ value: file, md5: 'm1' }),
});
const bookOf = (verse1: string) => `\\id TIT test\n\\c 1\n\\p\n\\v 1 ${verse1}\n`;
const open = (raw: string, file: AlignmentFile | null = null, ref = '1:1', orig: unknown[] = ORIG) =>
  buildAlignmentSession(makeStore(file), null, { book: 'TIT', bookRaw: raw, project: { scriptDirection: 'ltr' } }, ref, SOURCE, orig);
const fileOf = (ref: string, record: AlignmentVerseRecord): AlignmentFile => {
  const [chapter, verse] = ref.split(':');
  return { schemaVersion: 1, book: 'TIT', chapters: { [chapter]: { [verse]: record } } };
};
const bankOf = (s: { record?: { wordBank: AlignedWord[] } }) =>
  (s.record?.wordBank ?? []).map((w) => `${w.word} ${Number(w.occurrence)}/${Number(w.occurrences)}`);

describe('#796 B3 the bank is the export word list', () => {
  it('(a) a nested marker: "Señor" and "dijo" are in the bank', async () => {
    const s = await open(bookOf('Y \\add el \\+nd Señor\\+nd* dijo\\add* así.'));
    expect(s.unavailable).toBeUndefined();
    expect(bankOf(s)).toEqual(['Y 1/1', 'el 1/1', 'Señor 1/1', 'dijo 1/1', 'así 1/1']);
  });

  it('(b) NFD text: café is counted as the export counts it', async () => {
    const s = await open(bookOf('cafe\u0301 y caf\u00e9'));
    expect(s.unavailable).toBeUndefined();
    expect(bankOf(s)).toEqual(['café 1/2', 'y 1/1', 'café 2/2']);
  });

  it('(c) a footnote glued to a word: siervo and de, and a full edit weaves and keeps the footnote', async () => {
    const raw = bookOf('siervo\\f + \\fr 1:1 \\ft o esclavo\\f* de');
    const s = await open(raw, null, '1:1', ORIG.slice(0, 2));
    expect(bankOf(s)).toEqual(['siervo 1/1', 'de 1/1']);
    const [siervo, de] = s.record.wordBank as AlignedWord[];
    const record = finalizeEdit(linkWord(linkWord(s.record, 0, siervo), 1, de), s.words, s.targetMd5);
    expect(record.wordBank).toEqual([]);
    expect(record.done).toBe(true);
    const woven = (decompose(weaveBook(raw, fileOf('1:1', record), AlignmentHelpers)).verses as Record<string, string>)['1:1'];
    expect(woven).toContain('\\zaln-s');
    expect(woven).toContain('\\f + \\fr 1:1 \\ft o esclavo\\f*');
  });
});

describe('#796 B3 (d) a drafted verse opens as the edit left it', () => {
  const fixtures = [
    'conformance/sample-burrito/ingredients/TIT.usfm',
    'conformance/sample-burrito/ingredients/JON.usfm',
    'test/fixtures/usfm-corpus/sample-TIT-draft.usfm',
    'test/fixtures/usfm-corpus/sample-JON-span.usfm',
    'test/fixtures/usfm-corpus/exotic-partial-book.usfm',
    'test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm',
  ];

  it('bootstrap, link every third word, finalize, reopen: the same record, no banner, no write', async () => {
    let opened = 0;
    let unavailable = 0;
    let linked = 0;
    for (const rel of fixtures) {
      const raw: string = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      for (const e of indexBook(raw)) {
        const body = raw.slice(e.start, e.end).trim();
        if (body === '' || body === '___') continue;
        const ref = `${e.chapter}:${e.verseKey}`;
        const first = await open(raw, null, ref);
        if (first.unavailable) {
          unavailable++;
          continue;
        }
        let next: AlignmentVerseRecord = first.record;
        first.record.wordBank.forEach((w: AlignedWord, i: number) => {
          if (i % 3 === 0) {
            next = linkWord(next, i % next.alignments.length, w);
            linked++;
          }
        });
        const stored: AlignmentVerseRecord = JSON.parse(JSON.stringify(finalizeEdit(next, first.words, first.targetMd5)));
        const store = makeStore(fileOf(ref, stored));
        const again = await buildAlignmentSession(store, null, { book: 'TIT', bookRaw: raw, project: {} }, ref, SOURCE, ORIG);
        expect(again.record, `${rel} ${ref}`).toEqual(stored);
        expect(again.stale, `${rel} ${ref}`).toBe(false);
        expect(store.writeAlignments, `${rel} ${ref}`).not.toHaveBeenCalled();
        opened++;
      }
    }
    expect(opened + unavailable).toBe(23); // every drafted verse of the six fixtures (align-one-hash pins the same 23)
    expect(unavailable).toBe(0);
    expect(linked).toBeGreaterThan(opened);
  });
});

describe('#796 B3 (e) a word is written once', () => {
  it('a word that is both banked and placed stays on its card and leaves the bank', async () => {
    const s = await open(bookOf('Pablo siervo de Dios'));
    const pablo = s.record.wordBank[0] as AlignedWord;
    const both: AlignmentVerseRecord = {
      ...s.record,
      alignments: s.record.alignments.map((a: { bottomWords: AlignedWord[] }, i: number) => (i === 0 ? { ...a, bottomWords: [pablo] } : a)),
    };
    expect(both.wordBank.map((w) => w.word)).toContain('Pablo'); // banked and placed
    const out = finalizeEdit(both, s.words, s.targetMd5);
    const everyWord = [...out.wordBank, ...out.alignments.flatMap((a) => a.bottomWords)].map((w) => `${w.word} ${w.occurrence}`);
    expect(everyWord.filter((w) => w === 'Pablo 1')).toHaveLength(1);
    expect(out.alignments[0].bottomWords.map((w) => w.word)).toEqual(['Pablo']);
    expect(out.wordBank.map((w) => w.word)).toEqual(['siervo', 'de', 'Dios']);
  });

  it('a word placed on two cards stays on the first card', async () => {
    const s = await open(bookOf('Pablo siervo de Dios'));
    const pablo = s.record.wordBank[0] as AlignedWord;
    const twice: AlignmentVerseRecord = {
      ...s.record,
      alignments: s.record.alignments.map((a: { bottomWords: AlignedWord[] }, i: number) => (i < 2 ? { ...a, bottomWords: [pablo] } : a)),
    };
    const out = finalizeEdit(twice, s.words, s.targetMd5);
    expect(out.alignments[0].bottomWords.map((w) => w.word)).toEqual(['Pablo']);
    expect(out.alignments[1].bottomWords).toEqual([]);
    expect([...out.wordBank, ...out.alignments.flatMap((a) => a.bottomWords)]).toHaveLength(4);
  });
});
