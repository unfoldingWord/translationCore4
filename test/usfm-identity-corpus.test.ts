// Issue #17 — parse-and-serialize identity over the USFM corpus. The editor's
// byte promise (D8/FR-7): an edit to one verse changes no other byte of the
// file. The test runs the app's real read→write path — indexBook + verseBody +
// spliceVerse (src/data/usfm/), the only mutation path for book text (AD-1/
// AD-4) — over every file in test/fixtures/usfm-corpus/ and every verse in
// each file. Corpus provenance: test/fixtures/usfm-corpus/README.md.
import { describe, expect, it } from 'vitest';
import { indexBook } from '../src/data/usfm/indexer';
import { spliceVerse, verseBody } from '../src/data/usfm/splice';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const CORPUS_DIR = path.resolve(process.cwd(), 'test/fixtures/usfm-corpus');

// Every .usfm file in the corpus directory — a new corpus file is tested
// without a test change (its provenance goes in the corpus README).
const corpusFiles: string[] = fs
  .readdirSync(CORPUS_DIR)
  .filter((name: string) => name.endsWith('.usfm'))
  .sort();

const corpus: Record<string, string> = Object.fromEntries(
  corpusFiles.map((name) => [name, fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8')]),
);

const MARKER = 'XX_CORPUS_EDIT_XX';

describe('corpus shape — the exotic classes are really present', () => {
  it('has the six documented files', () => {
    expect(corpusFiles).toEqual([
      'en_ult-TIT-aligned.usfm',
      'en_ust-TIT-aligned.usfm',
      'exotic-partial-book.usfm',
      'exotic-poetry-footnotes.usfm',
      'sample-JON-span.usfm',
      'sample-TIT-draft.usfm',
    ]);
  });

  it('covers alignment, poetry, footnotes, span verses and a partial book', () => {
    const all = Object.values(corpus);
    expect(all.some((raw) => raw.includes('\\zaln-s'))).toBe(true);
    expect(all.some((raw) => /^\\q/m.test(raw))).toBe(true);
    expect(all.some((raw) => raw.includes('\\f '))).toBe(true);
    expect(all.some((raw) => indexBook(raw).some((e) => e.verseKey.includes('-')))).toBe(true);
    // The partial book has no chapter 1 and no final line terminator.
    const partial = corpus['exotic-partial-book.usfm'];
    expect(indexBook(partial).every((e) => e.chapter === '3')).toBe(true);
    expect(partial.endsWith('\n')).toBe(false);
  });

  it('every corpus file indexes at least one verse', () => {
    for (const [name, raw] of Object.entries(corpus)) {
      expect(indexBook(raw).length, name).toBeGreaterThan(0);
    }
  });
});

describe('identity — splicing every verse body back in reproduces the file byte-exactly', () => {
  it.each(Object.entries(corpus))('%s', (_name, raw) => {
    const entries = indexBook(raw);
    for (const e of entries) {
      const body = verseBody(raw, e.chapter, e.verseKey);
      expect(body).not.toBeNull();
      const respliced = spliceVerse(raw, e.chapter, e.verseKey, body as string);
      // Whole-string equality — byte-strict (FR-7).
      expect(respliced === raw).toBe(true);
    }
  });
});

describe('locality — an edit to one verse changes only that verse', () => {
  it.each(Object.entries(corpus))('%s', (_name, raw) => {
    for (const e of indexBook(raw)) {
      const edited = spliceVerse(raw, e.chapter, e.verseKey, MARKER);
      // Every byte before the replaced range and after it is identical.
      expect(edited.slice(0, e.start) === raw.slice(0, e.start)).toBe(true);
      expect(edited.slice(e.start + MARKER.length) === raw.slice(e.end)).toBe(true);
      // The new body reads back at the same verse key.
      expect(verseBody(edited, e.chapter, e.verseKey)).toBe(MARKER);
      // Splicing the original body back restores the file byte-exactly.
      const restored = spliceVerse(edited, e.chapter, e.verseKey, raw.slice(e.start, e.end));
      expect(restored === raw).toBe(true);
    }
  });
});
