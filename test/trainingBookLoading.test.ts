// #722 class: the suggestion trainer reads the open book's text. While a new
// book loads (since #679 the load waits in the store queue), s.bookRaw is null,
// and rawRef still holds the PREVIOUS book. The trainer must then read the open
// book from the store, as it reads every other book of the testament, and never
// pair the open book's alignments with the previous book's text.
import { describe, expect, it } from 'vitest';
import { decompose } from '../journal/skeleton.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { md5Hex } from '../src/data/httpStore';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';
import { __trainingTextForTests } from '../src/state.jsx';

const { collectTrainingVerses, trainingCollector } = __trainingTextForTests;

const G = (text: string, strong: string, lemma: string, morph: string) => ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence: 1, occurrences: 1 });
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const TEXT = 'Pablo, siervo de Dios';
const ORIG = [G('Παῦλος', 'G39720', 'Παῦλος', 'Gr,N,,,,,NMS,'), G('δοῦλος', 'G14010', 'δοῦλος', 'Gr,N,,,,,NMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,')];
const bankWord = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;
const aligned11 = () => {
  let r = bootstrapVerse(verseWords(TEXT), ORIG, SOURCE, md5Hex(TEXT));
  r = linkWord(r, 0, bankWord(r, 'Pablo'));
  r = linkWord(r, 1, bankWord(r, 'siervo'));
  r = linkWord(r, 2, bankWord(r, 'Dios'));
  return stampTargetVerse(r, md5Hex(TEXT));
};
const TIT_FILE: AlignmentFile = { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': aligned11() } } };
const TIT_USFM = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${TEXT}\n`;
const PHM_USFM = '\\id PHM\n\\c 1\n\\p\n\\v 1 Pablo, prisionero de Cristo Jesús\n';

const store = {
  readBook: async (code: string) => ({ usfm: code === 'TIT' ? TIT_USFM : PHM_USFM }),
  readAlignmentsWithMd5: async (code: string) => ({ value: code === 'TIT' ? TIT_FILE : null, md5: `md5-${code}` }),
};
const collect = (bookRaw: string | null) =>
  collectTrainingVerses({ store, sched: null, project: { bookCodes: ['PHM', 'TIT'] }, book: 'TIT', bookRaw, testament: 'nt' });

describe('suggestion training while the open book loads', () => {
  it('reads the open book from the store when its text has not arrived', async () => {
    const verses = await collect(null);
    expect(verses.map((v) => v.ref)).toEqual(['TIT 1:1']);
    expect(verses[0].target.map((t) => t.text)).toEqual(['Pablo', 'siervo', 'de', 'Dios']);
  });

  // The trainer's own wiring: the state says Titus and no text yet, while
  // rawRef still holds the previous book (Philemon).
  const collector = (bookRaw: string | null, raw: string) =>
    trainingCollector({
      storeRef: { current: store },
      alignSchedulerRef: { current: null },
      stateRef: { current: { project: { bookCodes: ['PHM', 'TIT'] }, book: 'TIT', bookRaw } },
      rawRef: { current: raw },
    });

  it('never pairs the open book with the previous book\'s text while it loads', async () => {
    const verses = await collector(null, PHM_USFM)('nt');
    expect(verses.map((v) => v.ref)).toEqual(['TIT 1:1']);
    expect(verses[0].target.map((t) => t.text)).toEqual(['Pablo', 'siervo', 'de', 'Dios']);
  });

  it('with the text there, reads the latest edits from rawRef', async () => {
    const edited = TIT_USFM.replace('Dios', 'Dios nuestro');
    const verses = await collector(TIT_USFM, edited)('nt');
    expect(verses[0].target.map((t) => t.text)).toEqual(['Pablo', 'siervo', 'de', 'Dios', 'nuestro']);
  });
});

// #796 S2: the training verse takes its target words from the stored slot, the list
// the bank is made of, not from the display text.
describe('suggestion training reads the stored verse words (#796)', () => {
  const fs = process.getBuiltinModule('node:fs');
  const SAMPLE = 'conformance/sample-burrito/ingredients';
  const SAMPLE_USFM: string = fs.readFileSync(`${process.cwd()}/${SAMPLE}/TIT.usfm`, 'utf8');
  const SAMPLE_FILE: AlignmentFile = JSON.parse(fs.readFileSync(`${process.cwd()}/${SAMPLE}/checking/alignments/TIT.json`, 'utf8'));
  const collectFrom = (usfm: string, file: AlignmentFile) =>
    collectTrainingVerses({
      store: { readBook: async () => ({ usfm }), readAlignmentsWithMd5: async () => ({ value: file, md5: 'm' }) },
      sched: null,
      project: { bookCodes: ['TIT'] },
      book: 'TIT',
      bookRaw: usfm,
      testament: 'nt',
    });

  it('the sample TIT: verse 1:1 gives a training verse whose targets are the words of its slot', async () => {
    const verses = await collectFrom(SAMPLE_USFM, SAMPLE_FILE);
    expect(verses.map((v) => v.ref)).toEqual(['TIT 1:1']);
    const slot = (decompose(toNfc(SAMPLE_USFM) as string).verses as Record<string, string>)['1:1'];
    expect(verses[0].target.map((t) => t.text)).toEqual(verseWords(slot).map((w) => w.word));
    expect(verses[0].target.map((t) => t.position)).toEqual(verseWords(slot).map((_, i) => i));
    expect(verses[0].links.length).toBe(SAMPLE_FILE.chapters['1']['1'].alignments.filter((a) => a.bottomWords.length).length);
  });

  it('a nested marker: the training verse holds the nested word, and its link', async () => {
    const nested = 'Y \\add el \\+nd Señor\\+nd* dijo\\add* así.';
    let r = bootstrapVerse(verseWords(nested), ORIG.slice(0, 1), SOURCE, md5Hex(nested));
    r = linkWord(r, 0, bankWord(r, 'Señor'));
    const file: AlignmentFile = { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': stampTargetVerse(r, md5Hex(nested)) } } };
    const verses = await collectFrom(`\\id TIT\n\\c 1\n\\p\n\\v 1 ${nested}\n`, file);
    expect(verses.map((v) => v.ref)).toEqual(['TIT 1:1']);
    expect(verses[0].target.map((t) => t.text)).toEqual(['Y', 'el', 'Señor', 'dijo', 'así']);
    expect(verses[0].links).toEqual([{ source: [0], target: [2] }]);
  });
});
