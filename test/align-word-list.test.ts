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
import { decompose, recompose } from '../journal/skeleton.mjs';
import { finalizeEdit, linkWord } from '../src/data/align/edit';
import { holdsInlineAlignment, weaveBook } from '../src/data/export/weave.mjs';
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

// #796 review fix: "missing" is decided on the body the rail tests, not on the slot.
// A slot runs to the next \v or \c, so it keeps a trailing \p, \s5, \q2 or \s line;
// `indexBook` leaves a break or a heading after the verse's last words outside the
// body (since #812 a poem line or a break with verse text after it belongs to it).
// Books that keep paragraph or chunk markers between verses (imported books) have
// this shape.
describe('#796 a stub or empty verse is "missing" when a paragraph marker follows it', () => {
  const followed = (marker: string) => `\\id TIT\n\\c 1\n\\p\n\\v 1 ___\n${marker}\n\\v 2 Hola\n`;
  it.each(['\\p', '\\s5', '\\q2', '\\s Encabezado'])('a "___" stub followed by %s', async (marker) => {
    const s = await open(followed(marker));
    expect(s.unavailable).toBe('missing');
    expect(s.record).toBeUndefined();
  });

  it('an empty verse (blanks only) followed by \\p', async () => {
    const s = await open('\\id TIT\n\\c 1\n\\p\n\\v 1  \n\\p\n\\v 2 Hola\n');
    expect(s.unavailable).toBe('missing');
  });

  // A marker line that HOLDS words keeps the slot's word list non-empty, so the words
  // check cannot decide these: only the drafted body (nothing, or a stub) does. A
  // heading after the verse's last words is outside the body (#812): the verse is a stub.
  it('a "___" stub followed by a \\qa line that holds a word', async () => {
    const s = await open('\\id TIT\n\\c 1\n\\p\n\\v 1 ___\n\\qa Alef\n\\v 2 Hola\n');
    expect(s.unavailable).toBe('missing');
    expect(s.record).toBeUndefined();
  });

  // #786/#812: a \q2 line with a word, before the next \v, is the verse's own poem
  // line. The body holds it, as the export's word list does: the verse opens with
  // that word, and the "___" stub is no word of it.
  it.each([
    ['a "___" stub followed by a \\q2 line that holds a word', '\\v 1 ___\n\\q2 palabras\n\\v 2 Hola'],
    ['a blank verse followed by a \\q2 line that holds a word', '\\v 1 \n\\q2 palabras\n\\v 2 Hola'],
  ])('%s opens with that word', async (_name, verses) => {
    const s = await open(`\\id TIT\n\\c 1\n\\p\n${verses}\n`);
    expect(s.unavailable).toBeUndefined();
    expect(bankOf(s)).toEqual(['palabras 1/1']);
  });

  it('a verse that holds only a footnote has no word to align', async () => {
    const s = await open('\\id TIT\n\\c 1\n\\p\n\\v 1 \\f + \\fr 1:1 \\ft solo nota\\f*\n\\v 2 Hola\n');
    expect(s.unavailable).toBe('missing');
  });

  it('the verse after the stub still opens', async () => {
    const s = await open(followed('\\p'), null, '1:2', ORIG.slice(0, 1));
    expect(s.unavailable).toBeUndefined();
    expect(bankOf(s)).toEqual(['Hola 1/1']);
  });

  it('a stub with no trailing marker is still "missing" (unchanged)', async () => {
    const s = await open('\\id TIT\n\\c 1\n\\p\n\\v 1 ___\n\\v 2 Hola\n');
    expect(s.unavailable).toBe('missing');
  });
});

// #796 slice 5 (acceptance criterion 4, the export half): the weave now asks `needsReview` and
// `hasLinks` before it merges. A record that matches its verse must still weave as the library
// merges it, with nothing reported. The records are the ones of the sweep above (B3 (d)).
describe('#796 slice 5 B4 the export sweep: a record that matches its verse weaves as the library merges it', () => {
  const fixtures = [
    'conformance/sample-burrito/ingredients/TIT.usfm',
    'conformance/sample-burrito/ingredients/JON.usfm',
    'test/fixtures/usfm-corpus/sample-TIT-draft.usfm',
    'test/fixtures/usfm-corpus/sample-JON-span.usfm',
    'test/fixtures/usfm-corpus/exotic-partial-book.usfm',
    'test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm',
  ];

  // A verse that holds imported `\zaln-s` markup (one fixture verse does, #794) keeps its stored bytes, and the
  // report names it; every other verse is merge(slot, record) with an empty report.
  it('every drafted verse of the six fixtures: the woven verse is merge(slot, record), and the report is empty', async () => {
    let merged = 0;
    const inline: string[] = [];
    for (const rel of fixtures) {
      const raw: string = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      const slots = decompose(raw).verses as Record<string, string>;
      for (const e of indexBook(raw)) {
        const body = raw.slice(e.start, e.end).trim();
        if (body === '' || body === '___') continue;
        const ref = `${e.chapter}:${e.verseKey}`;
        const first = await open(raw, null, ref);
        let next: AlignmentVerseRecord = first.record;
        first.record.wordBank.forEach((w: AlignedWord, i: number) => {
          if (i % 3 === 0) next = linkWord(next, i % next.alignments.length, w);
        });
        const stored: AlignmentVerseRecord = JSON.parse(JSON.stringify(finalizeEdit(next, first.words, first.targetMd5)));
        const skips: Array<{ ref: string; reason: string }> = [];
        // The library changes the record it is given: the expected verse is made from its own copy.
        const expected = holdsInlineAlignment(slots[ref])
          ? slots[ref]
          : AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge(slots[ref], JSON.parse(JSON.stringify(stored)));
        expect(expected, `${rel} ${ref} merges`).not.toBeNull();
        const out = weaveBook(raw, fileOf(ref, stored), AlignmentHelpers, (skip: { ref: string; reason: string }) => skips.push(skip));
        expect((decompose(out).verses as Record<string, string>)[ref], `${rel} ${ref}`).toBe(expected);
        if (holdsInlineAlignment(slots[ref])) {
          expect(skips, `${rel} ${ref}`).toEqual([{ ref: `${e.chapter}:${e.verseKey}`, reason: 'inline-alignment' }]);
          inline.push(`${rel} ${ref}`);
        } else {
          expect(skips, `${rel} ${ref}`).toEqual([]);
          expect(expected, `${rel} ${ref} is woven`).not.toBe(slots[ref]);
          merged++;
        }
      }
    }
    expect(inline).toEqual(['test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm 1:3']);
    expect(merged + inline.length).toBe(23);
  });

  it('the whole sample Titus: the output is the stored book with 1:1 merged by the library, byte for byte', () => {
    const raw: string = fs.readFileSync(path.join(SAMPLE, 'TIT.usfm'), 'utf8');
    const { skeleton, verses } = decompose(raw) as { skeleton: string; verses: Record<string, string> };
    const merged = AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge(verses['1:1'], JSON.parse(JSON.stringify(FILE.chapters['1']['1'])));
    expect(merged).not.toBeNull();
    const skips: Array<{ ref: string; reason: string }> = [];
    const out = weaveBook(raw, FILE, AlignmentHelpers, (skip: { ref: string; reason: string }) => skips.push(skip));
    expect(out).toBe(recompose(skeleton, { ...verses, '1:1': merged }));
    expect(skips).toEqual([]);
  });
});
