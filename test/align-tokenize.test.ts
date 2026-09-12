// #255 — one tokenizer for alignment editing and the suggestion engine.
//
// The editor's word split (src/data/align/tokenize.ts, used by edit.ts) and the
// suggestion engine's `wordmap-lexer` must split a verse into the SAME words
// with the SAME occurrence numbers, or a suggestion lands on the wrong word
// with no error (invariant I-2, word identity = text + occurrence). Every verse
// here is real fixture text — the aligned ULT/UST Titus, the sample drafts, the
// hand-made corpus files, and the Hebrew Jonah (right-to-left, with U+2060 word
// joiners inside words). No invented verse text.
import { describe, expect, it } from 'vitest';
import Lexer from 'wordmap-lexer';
import { usfmjs } from '../src/data/vendor';
import { tokenizeVerse, wordTokens } from '../src/data/align/tokenize';
import { tokenizeTargetVerse } from '../src/data/align/edit';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment (see usfm-identity-corpus.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

type VerseObject = { type?: string; text?: string; children?: VerseObject[] };

/** Plain verse text from usfm-js verseObjects, descending into `\zaln` milestones. */
const flatten = (objects: VerseObject[]): string =>
  objects
    .map((vo) => (vo.children ? flatten(vo.children) : vo.type === 'text' || vo.text ? (vo.text ?? '') : ''))
    .join('');

/** Every verse of a USFM file as [ref, plain text], stubs (`___`) and empties dropped. */
const versesOf = (rel: string): Array<[string, string]> => {
  const json = usfmjs.toJSON(read(rel)) as {
    chapters: { [c: string]: { [v: string]: { verseObjects?: VerseObject[] } } };
  };
  const out: Array<[string, string]> = [];
  for (const [c, verses] of Object.entries(json.chapters ?? {})) {
    for (const [v, data] of Object.entries(verses)) {
      if (!/^\d/.test(v)) continue; // front matter keys
      const text = flatten(data.verseObjects ?? []).replace(/\s+/g, ' ').trim();
      if (text && text !== '___') out.push([`${rel} ${c}:${v}`, text]);
    }
  }
  return out;
};

const CORPUS = [
  'usfm-corpus/en_ult-TIT-aligned.usfm',
  'usfm-corpus/en_ust-TIT-aligned.usfm',
  'usfm-corpus/sample-TIT-draft.usfm',
  'usfm-corpus/sample-JON-span.usfm',
  'usfm-corpus/exotic-poetry-footnotes.usfm',
  'usfm-corpus/exotic-partial-book.usfm',
  'hbo_uhb/JON.usfm',
];

const lexerWords = (text: string) =>
  Lexer.tokenize(text).map((t) => ({ text: t.toString(), occurrence: t.occurrence, occurrences: t.occurrences }));

const ourWords = (text: string) =>
  wordTokens(text).map((t) => ({ text: t.text, occurrence: t.occurrence, occurrences: t.occurrences }));

describe('#255 — the editor split and wordmap-lexer agree on every fixture verse', () => {
  const all = CORPUS.flatMap(versesOf);

  it('the corpus is real and covers the required shapes', () => {
    expect(all.length).toBeGreaterThan(100);
    // punctuation attached to a word
    expect(all.some(([, t]) => /\p{L}[,.;:]/u.test(t))).toBe(true);
    // a verse with a repeated word
    expect(all.some(([, t]) => ourWords(t).some((w) => w.occurrences > 1))).toBe(true);
    // right-to-left text (Hebrew block)
    expect(all.some(([, t]) => /[\u0590-\u05FF]/.test(t))).toBe(true);
  });

  it('token text and occurrence numbers match, verse by verse', () => {
    const mismatches = all
      .filter(([, t]) => JSON.stringify(ourWords(t)) !== JSON.stringify(lexerWords(t)))
      .map(([ref]) => ref);
    expect(mismatches).toEqual([]);
  });

  it('a Hebrew verse with word joiners splits into whole words on both sides', () => {
    const [ref, text] = versesOf('hbo_uhb/JON.usfm')[0];
    expect(ref).toBe('hbo_uhb/JON.usfm 1:1');
    expect(text).toContain('\u2060'); // the fixture writes וַֽ⁠יְהִי֙ with a word joiner
    const ours = ourWords(text);
    expect(ours).toEqual(lexerWords(text));
    // The joiner stays inside its word; the old regex cut the word in two here.
    expect(ours.some((w) => w.text.includes('\u2060'))).toBe(true);
  });
});

describe('#255 — tokenizeTargetVerse is built on the same split', () => {
  it('the \\w tokens it emits are exactly the shared tokenizer\u2019s words with their occurrence data', () => {
    for (const [, text] of CORPUS.flatMap(versesOf)) {
      const emitted = [...tokenizeTargetVerse(text).matchAll(/\\w ([^|]+)\|x-occurrence="(\d+)" x-occurrences="(\d+)"\\w\*/g)].map(
        (m) => ({ text: m[1], occurrence: Number(m[2]), occurrences: Number(m[3]) }),
      );
      expect(emitted).toEqual(ourWords(text));
    }
  });

  it('keeps punctuation and whitespace between the words', () => {
    const text = 'Pablo, siervo de Dios y de Dios';
    const separators = tokenizeVerse(text).filter((t) => !t.isWord).map((t) => t.text);
    expect(separators).toEqual([',', ' ', ' ', ' ', ' ', ' ', ' ']);
    expect(tokenizeTargetVerse(text)).toContain(', ');
  });
});
