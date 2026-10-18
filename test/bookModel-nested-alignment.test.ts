// #782 — the plain text of a drafted verse whose words sit in nested alignments.
//
// `verseText` (src/data/bookModel.js) is the text that Translate, Align (the
// verse rail, the word bank), Check, the Community Checking preview and the PDF
// show for a drafted verse. en_ult aligns one English phrase to two Hebrew words
// with one `\zaln-s` inside another, so the words sit two levels down. Inputs are
// the pinned resources' own text (test/fixtures/README.md) and the USFM corpus.
//
// The ways this can fail, written before the fix:
//   1. A word two or more levels down is dropped: Gen 1:1 reads "created  and
//      the earth." (the reported defect), and Psalms lose the "Selah" that sits
//      in a `\zaln` inside `\qs … \qs*` (found in the #783 review).
//   2. The fix walks too far: footnote text (`\f … \f*`, a `\+w` inside it) or a
//      section heading joins the verse text.
//   3. A verse with no nested alignment (plain, footnoted, poetry with line
//      breaks, one-level aligned) gets a different text than before, so a stored
//      Check selection or an alignment no longer matches it.
//   4. The words come back out of order, or twice.
import { describe, expect, it } from 'vitest';
import { usfmjs } from '../src/data/vendor';
import { bookModel, verseText } from '../src/data/bookModel';
import { wordTokens } from '../src/data/align/tokenize';
import { __buildAlignmentSessionForTests as buildAlignmentSession } from '../src/state.jsx';
import { md5Hex } from '../src/data/httpStore';
import { indexBook } from '../src/data/usfm/indexer';
import { verseTextMd5 } from '../journal/fold.mjs';
import { decompose } from '../journal/skeleton.mjs';

// Real node builtins via the runtime (see CONTRIBUTING.md, "Write a test that reads files").
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures', rel), 'utf8');

type VerseObject = { type?: string; tag?: string; text?: string; children?: VerseObject[] };
type Verse = { verseObjects?: VerseObject[] };
const chaptersOf = (raw: string) =>
  (usfmjs.toJSON(raw) as unknown as { chapters: Record<string, Record<string, Verse>> }).chapters;

/** The text before #782, kept here as the reference for verses that nest no
 * alignment: it read one `\zaln` level down. */
const beforeFix = (v: Verse) =>
  (v?.verseObjects || [])
    .map((vo) => vo.text || vo.children?.map((c) => c.text || '').join('') || '')
    .join('')
    .trim();

/** True when a `\zaln` milestone sits inside another node: another `\zaln`
 * (Gen 1:1), or a character marker such as `\qs … \qs*` (Psalms "Selah"). The
 * one-level walk lost the words of both. */
const nests = (vos: VerseObject[] = [], inside = false): boolean =>
  vos.some((vo) => ((vo.tag === 'zaln' && vo.type === 'milestone' && inside) || nests(vo.children, true)));

/** The `\w` words of each verse of one chapter, in file order, read from the
 * raw USFM without usfm-js. Footnotes are cut first: their words are not verse text. */
const rawWords = (raw: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const body = raw.replace(/\\f .*?\\f\*/gs, '');
  const parts = body.split(/\\v (\d+(?:-\d+)?)\s/);
  for (let i = 1; i < parts.length; i += 2) {
    out[parts[i]] = [...parts[i + 1].split(/\\c \d+/)[0].matchAll(/\\w ([^|\\]+)\|/g)].map((m) => m[1]);
  }
  return out;
};

/** The words of `text` in order, as a test of "each word, in order, once". */
const holdsInOrder = (text: string, words: string[]) => {
  let at = 0;
  for (const w of words) {
    const found = text.slice(at).search(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u'));
    if (found < 0) return false;
    at += found + w.length;
  }
  return true;
};

describe('verseText reads words inside nested alignments (#782)', () => {
  it('Gen 1:1 of en_ult reads the whole verse, "the heavens" included (way 1)', () => {
    const gen11 = chaptersOf(read('en_ult/GEN-1-1.usfm'))['1']['1'];
    expect(nests(gen11.verseObjects)).toBe(true);
    expect(verseText(gen11)).toBe('In the beginning God created the heavens and the earth.');
  });

  it('every verse of en_ult Genesis 1 holds its \\w words in file order (ways 1 and 4)', () => {
    const raw = read('en_ult/GEN-1.usfm');
    const chapter = chaptersOf(raw)['1'];
    const words = rawWords(raw);
    const nested = Object.keys(words).filter((v) => nests(chapter[v].verseObjects));
    // The fixture must hold nested verses, or way 1 cannot show here.
    expect(nested.length).toBeGreaterThan(0);
    const missing = Object.keys(words).filter((v) => !holdsInOrder(verseText(chapter[v]), words[v]));
    expect(missing).toEqual([]);
  });

  it('Translate reads the same text: bookModel gives Gen 1:1 and 1:4 whole (ways 1 and 4)', () => {
    const { byChapter } = bookModel(read('en_ult/GEN-1.usfm'));
    const verses = byChapter['1'] as Array<{ n: string; text: string }>;
    const verse = (n: string) => verses.find((v) => v.n === n)?.text;
    expect(verse('1')).toBe('In the beginning God created the heavens and the earth.');
    expect(verse('4')).toBe('And God saw the light, that {it was} good. Then God separated between the light and the darkness.');
  });

  it('the Align session of Gen 1:1 banks "the" and "heavens": every word of the verse (way 1)', async () => {
    // The real session build: the draft is en_ult's Gen 1:1, the original is
    // hbo_uhb's. The J5 #782 journey shows the same bank in the app.
    const store = { readAlignmentsWithMd5: async () => ({ value: null, md5: null }) };
    const st = { book: 'GEN', bookRaw: read('en_ult/GEN-1-1.usfm'), project: { scriptDirection: 'ltr' } };
    const source = { testament: 'ot', pin: { repoPath: 'unfoldingWord/hbo_uhb', version: 'v3.0.0' }, usfmText: '' };
    const orig = chaptersOf(read('hbo_uhb/GEN-1-1.usfm'))['1']['1'].verseObjects;
    const session = await buildAlignmentSession(store, null, st, '1:1', source, orig);
    const bank = session.record.wordBank.map((w: { word: string }) => w.word);
    expect(bank).toEqual(expect.arrayContaining(['the', 'heavens']));
    // A bootstrapped bank is not in verse order; its words are the verse's words.
    expect([...bank].sort()).toEqual(wordTokens('In the beginning God created the heavens and the earth.').map((t) => t.text).sort());
  });

  it('Ps 3:2 keeps its aligned "Selah", which en_ult wraps in \\qs … \\qs* (way 1)', () => {
    const v2 = chaptersOf(read('en_ult/PSA-3.usfm'))['3']['2'];
    expect(nests(v2.verseObjects)).toBe(true);
    expect(beforeFix(v2)).not.toMatch(/Selah/);
    expect(verseText(v2)).toMatch(/\nSelah$/);
  });

  it('footnotes and section headings stay out of the verse text (way 2)', () => {
    const chapter = chaptersOf(read('usfm-corpus/exotic-poetry-footnotes.usfm'))['1'];
    for (const v of ['1', '2', '3', '4-5']) {
      const text = verseText(chapter[v]);
      expect(text, v).not.toMatch(/manuscripts|explained|carry a footnote|one span verse|Poetry/);
    }
  });

  it('a verse with no nested alignment keeps the text it had before #782, line breaks included (way 3)', () => {
    let compared = 0;
    for (const rel of [
      'usfm-corpus/exotic-poetry-footnotes.usfm',
      'usfm-corpus/exotic-partial-book.usfm',
      'usfm-corpus/sample-TIT-draft.usfm',
      'usfm-corpus/sample-JON-span.usfm',
      'usfm-corpus/en_ult-TIT-aligned.usfm',
      'usfm-corpus/en_ust-TIT-aligned.usfm',
      'en_ult/GEN-1.usfm',
      'en_ult/PSA-3.usfm',
    ]) {
      for (const [c, verses] of Object.entries(chaptersOf(read(rel)))) {
        for (const [v, verse] of Object.entries(verses)) {
          if (v === 'front' || nests(verse.verseObjects)) continue;
          expect(verseText(verse), `${rel} ${c}:${v}`).toBe(beforeFix(verse));
          compared++;
        }
      }
    }
    // A poetry verse keeps its line breaks, as it did before.
    expect(verseText(chaptersOf(read('usfm-corpus/exotic-poetry-footnotes.usfm'))['1']['4-5'])).toContain('\n');
    expect(compared).toBeGreaterThan(50);
  });

  it('plain drafts: the client I-3 stamp equals the journal hash of the stored verse', () => {
    // The export weave and the fold check verseTextMd5 of the stored verse; the client
    // stamps md5Hex(verseText). On plain drafts the two must agree, or no alignment exports.
    const differ: string[] = [];
    let compared = 0;
    for (const rel of [
      'conformance/sample-burrito/ingredients/TIT.usfm',
      'conformance/sample-burrito/ingredients/JON.usfm',
      'test/fixtures/usfm-corpus/sample-TIT-draft.usfm',
      'test/fixtures/usfm-corpus/sample-JON-span.usfm',
      'test/fixtures/usfm-corpus/exotic-partial-book.usfm',
      'test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm',
    ]) {
      const raw = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      const chapters = chaptersOf(raw);
      const verses = decompose(raw).verses as Record<string, string>;
      for (const e of indexBook(raw)) {
        const body = raw.slice(e.start, e.end).trim();
        if (body === '' || body === '___') continue;
        const ref = `${e.chapter}:${e.verseKey}`;
        // 1:3 holds inline \zaln, which I-1 forbids in a stored book (#553): the journal hash reads only top-level text, so it misses the aligned words.
        if (rel.endsWith('exotic-poetry-footnotes.usfm') && ref === '1:3') continue;
        if (md5Hex(verseText(chapters[e.chapter][e.verseKey])) !== verseTextMd5(verses[ref])) differ.push(`${rel} ${ref}`);
        compared++;
      }
    }
    expect(differ).toEqual([]);
    expect(compared).toBe(22);
  });
});
