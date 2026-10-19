// #796 slice 1 — `verseWords` is the export's word list.
//
// `verseWords(slot)` (src/data/align/verseWords.mjs) is a mirror of what word-aligner
// `merge` does to a stored verse slot: it makes the slot plain, parses it with usfm-js
// and tokenizes each text node. The export refuses a record whose words are not that
// list, so the mirror must equal the library on every slot it will meet. This file is
// the proof, against the library's own list (`getOrderedVerseObjectsFromString(...)
// .wordMap`, which `merge` reads), with occurrences as numbers:
//   B1  every slot of the fixtures, as stored and in plain form, and the marker shapes
//       that drove #796 (a footnote, a nested `\+nd`, `\x`, `\qs`, `\li1`, `\qa`, a
//       number, NFD text, `\w`);
//   B2  every slot of en_ult and en_ust v91 in the rig cache, in both forms. Opt-in:
//       TC4_V91_PARITY=1 TC4_RIG_PORT=19777 npx vitest run test/align-verse-words.test.ts --testTimeout=1800000
// The oracle is O(n^2) per verse, which is why B2 is not part of every run.
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { UsfmFileConversionHelpers } from 'word-aligner-lib';
import { decompose } from '../journal/skeleton.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { sameWords, verseWords } from '../src/data/align/verseWords.mjs';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const nodeRequire = process.getBuiltinModule('node:module').createRequire(path.resolve(process.cwd(), 'package.json'));

type MapEntry = { array: Array<{ text: string; occurrence: number | string; occurrences: number | string }>; pos: number };
const VOU = nodeRequire('word-aligner/lib/js/utils/verseObjects') as {
  getOrderedVerseObjectsFromString: (verse: string) => { wordMap: MapEntry[] };
};

/** word-aligner-lib's own plain form of a slot: what `merge` is given. */
const plain = (slot: string): string => UsfmFileConversionHelpers.cleanAlignmentMarkersFromString(slot);

/** The export's list: the library's `wordMap` over the plain slot, with numeric occurrences. */
const exportWords = (slot: string) =>
  VOU.getOrderedVerseObjectsFromString(plain(slot)).wordMap.map((m) => {
    const o = m.array[m.pos];
    return { word: o.text, occurrence: Number(o.occurrence), occurrences: Number(o.occurrences) };
  });

/** Every stored slot of a book: `decompose(toNfc(book)).verses`, the journal seal's own cut. */
const slotsOf = (book: string): Array<[string, string]> => Object.entries(decompose(toNfc(book) as string).verses as Record<string, string>);

/** The refs of a list of slots where `verseWords` differs from the export's list, in order. */
const misses = (slots: Array<[string, string]>): string[] =>
  slots.flatMap(([ref, slot]) => {
    const mine = verseWords(slot);
    const theirs = exportWords(slot);
    return JSON.stringify(mine) === JSON.stringify(theirs) ? [] : [`${ref}: ${JSON.stringify(mine)} != ${JSON.stringify(theirs)}`];
  });

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8') as string;
const FIXTURES = [
  'conformance/sample-burrito/ingredients/TIT.usfm',
  'conformance/sample-burrito/ingredients/JON.usfm',
  ...(fs.readdirSync(path.resolve(process.cwd(), 'test/fixtures/usfm-corpus')) as string[])
    .filter((f) => f.endsWith('.usfm')).sort().map((f) => `test/fixtures/usfm-corpus/${f}`),
  ...(fs.readdirSync(path.resolve(process.cwd(), 'test/fixtures/en_ult')) as string[])
    .filter((f) => f.endsWith('.usfm')).sort().map((f) => `test/fixtures/en_ult/${f}`),
  'test/fixtures/en_ust/TIT.usfm',
];

describe('#796 B1 verseWords equals the export word list', () => {
  it('every slot of the fixtures, as stored and in plain form', () => {
    let slots = 0;
    for (const rel of FIXTURES) {
      const list = slotsOf(read(rel));
      slots += list.length;
      expect(misses(list), `${rel} as stored`).toEqual([]);
      expect(misses(list.map(([ref, slot]) => [ref, plain(slot)])), `${rel} in plain form`).toEqual([]);
    }
    expect(FIXTURES.length).toBe(14);
    expect(slots).toBe(421);
  });

  /** One verse slot per marker shape, with the words the export counts in it. */
  const SHAPES: Array<[string, string, string[]]> = [
    ['a footnote glued to a word', 'siervo\\f + \\fr 1:1 \\ft o esclavo\\f* de', ['siervo', 'de']],
    ['a footnote after a space', 'siervo \\f + \\fr 1:1 \\ft o esclavo\\f* de', ['siervo', 'de']],
    ['a cross reference', 'texto \\x - \\xo 1:1 \\xt Gn 1:1\\x* más', ['texto', 'más']],
    ['words of Jesus around a nested name of God', '\\wj Dijo \\+nd el Señor\\+nd* \\wj* así', ['Dijo', 'el', 'Señor', 'así']],
    ['an added word around a nested name of God', 'Y \\add el \\+nd Señor\\+nd* dijo\\add* así.', ['Y', 'el', 'Señor', 'dijo', 'así']],
    ['a Selah', 'Texto \\qs Selah\\qs*', ['Texto', 'Selah']],
    ['list lines', 'Texto\n\\li1 uno dos\n\\li1 tres', ['Texto']],
    ['an acrostic line', '\\qa Alef\n\\q1 texto aquí', ['Alef', 'texto', 'aquí']],
    ['numbers', 'Él tenía 12 años y 3 hijos, 12 veces', ['Él', 'tenía', '12', 'años', 'y', '3', 'hijos', '12', 'veces']],
    ['a word marker', '\\w Pablo|x-occurrence="1" x-occurrences="1"\\w* siervo', ['Pablo', 'siervo']],
    [
      'an aligned word',
      '\\zaln-s |x-strong="G39720" x-lemma="Παῦλος" x-morph="Gr,N" x-occurrence="1" x-occurrences="1" x-content="Παῦλος"\\*\\w Pablo|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* siervo',
      ['Pablo', 'siervo'],
    ],
    ['no words', '___', []],
    ['an empty slot', '', []],
  ];

  it.each(SHAPES)('%s', (_name, slot, words) => {
    expect(verseWords(slot).map((w) => w.word)).toEqual(words);
    expect(verseWords(slot)).toEqual(exportWords(slot));
    expect(misses([['1:1', plain(slot)]])).toEqual([]);
  });

  it('NFD text: the slot the seal stores (NFC) and the raw NFD slot both agree with the export', () => {
    const nfd = 'cafe\u0301 y caf\u00e9';
    expect(toNfc(nfd)).not.toBe(nfd);
    expect(verseWords(toNfc(nfd) as string)).toEqual(exportWords(toNfc(nfd) as string));
    expect(verseWords(toNfc(nfd) as string).map((w) => `${w.word} ${w.occurrence}/${w.occurrences}`)).toEqual(['café 1/2', 'y 1/1', 'café 2/2']);
    expect(verseWords(nfd)).toEqual(exportWords(nfd));
  });

  it('a missing slot has no words', () => {
    expect(verseWords(undefined)).toEqual([]);
  });

  it('occurrences count every word of the verse, in one pass', () => {
    expect(verseWords('de Dios y de Dios de nuevo').map((w) => `${w.word} ${w.occurrence}/${w.occurrences}`)).toEqual([
      'de 1/3', 'Dios 1/2', 'y 1/1', 'de 2/3', 'Dios 2/2', 'de 3/3', 'nuevo 1/1',
    ]);
  });

  it('sameWords: one multiset on word, occurrence and occurrences, in any order, numbers or numeric strings', () => {
    const a = verseWords('de Dios y de Dios');
    expect(sameWords(a, [...a].reverse())).toBe(true);
    expect(sameWords(a, a.map((w) => ({ ...w, occurrence: String(w.occurrence), occurrences: String(w.occurrences) })))).toBe(true);
    expect(sameWords(a, a.slice(1))).toBe(false);
    expect(sameWords(a, a.map((w) => (w.word === 'y' ? { ...w, word: 'z' } : w)))).toBe(false);
    expect(sameWords(a, a.map((w, i) => (i === 0 ? { ...w, occurrences: 9 } : w)))).toBe(false);
    expect(sameWords([], [])).toBe(true);
  });
});

describe.skipIf(process.env.TC4_V91_PARITY !== '1')('#796 B2 every slot of en_ult and en_ust v91', () => {
  for (const repo of ['en_ult', 'en_ust']) {
    it(`${repo}: stored and plain form, every book`, () => {
      const zip = unzipSync(new Uint8Array(fs.readFileSync(path.resolve(process.cwd(), `dev-env/resources-cache/${repo}-v91-unwrapped.zip`))));
      const books = Object.keys(zip).filter((name) => /^ingredients\/[^/]+\.usfm$/.test(name)).sort();
      expect(books.length).toBeGreaterThanOrEqual(59);
      let slots = 0;
      const differences: string[] = [];
      for (const name of books) {
        const list = slotsOf(strFromU8(zip[name]));
        slots += list.length;
        differences.push(...misses(list).map((m) => `${name} stored ${m}`));
        differences.push(...misses(list.map(([ref, slot]) => [ref, plain(slot)])).map((m) => `${name} plain ${m}`));
      }
      console.log(`[B2] ${repo} v91: ${books.length} books, ${slots} slots, each in two forms, ${differences.length} differences`);
      expect(differences).toEqual([]);
    });
  }
});
