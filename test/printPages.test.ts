// The preview's page filling (#20): pages take verses in reading order until
// the next would not fit; a verse that does not fit is split between words, and
// its rest opens the next page with no number and no chapter head. A browser
// measures `fits`; here a page holds a fixed number of words (or characters).
import { describe, expect, it } from 'vitest';
import { paginate, partsOf, wordsOf } from '../src/views/print/PrintPages.jsx';

type Verse = { n: string; drafted: boolean; text: string; rest?: string };
type Atom = { gap?: [number, number]; c?: number; head?: boolean; v?: Verse };

const verse = (c: number, n: number, words: number, head = n === 1): Atom => ({
  c,
  head,
  v: { n: String(n), drafted: true, text: Array.from({ length: words }, (_, i) => `c${c}v${n}w${i + 1}`).join(' ') },
});
const shown = (atom: Atom): string => atom.v!.rest ?? atom.v!.text;
const wordCount = (atom: Atom): number => (atom.gap ? 1 : shown(atom).trim().split(/\s+/).filter(Boolean).length);
/** A page holds `capacity` words; a gap line counts as one. */
const fitsWords = (capacity: number) => (_page: number, atoms: Atom[]) => atoms.reduce((sum, a) => sum + wordCount(a), 0) <= capacity;
/** Each verse rebuilt from its pieces across pages, in order. */
const rebuilt = (pages: Atom[][]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const a of pages.flat()) if (a.v) out[`${a.c}:${a.v.n}`] = (out[`${a.c}:${a.v.n}`] ?? '') + shown(a);
  return out;
};

describe('paginate', () => {
  it('fills pages in reading order and splits a verse between words at the page end', () => {
    // Chapter 1: verses of 4, 4 and 6 words; a page holds 10 words.
    const atoms = [verse(1, 1, 4), verse(1, 2, 4), verse(1, 3, 6)];
    const pages = paginate(atoms, fitsWords(10)) as Atom[][];
    expect(pages).toHaveLength(2);
    // Page 1: verses 1 and 2 whole, then the first 2 words of verse 3.
    expect(pages[0].map((a) => a.v!.n)).toEqual(['1', '2', '3']);
    expect(pages[0][2].v!.text.trim()).toBe('c1v3w1 c1v3w2');
    expect(pages[0][2].v!.rest).toBeUndefined(); // the first piece keeps its number
    // Page 2: the rest of verse 3, with no number and no chapter head.
    expect(pages[1]).toHaveLength(1);
    expect(pages[1][0]).toMatchObject({ c: 1, head: false, v: { n: '3' } });
    expect(pages[1][0].v!.rest!.trim()).toBe('c1v3w3 c1v3w4 c1v3w5 c1v3w6');
  });

  it('tells fits when the page ends inside a chapter, so that part is measured with no bottom margin', () => {
    const calls: boolean[] = [];
    const atoms = [verse(1, 1, 3), verse(1, 2, 3), verse(2, 1, 3)];
    paginate(atoms, (page: number, list: Atom[], continues: boolean) => {
      if (page === 0 && list.length === 1 && list[0].v!.rest === undefined && list[0].v!.text.split(' ').length === 3) calls.push(continues);
      return list.reduce((sum, a) => sum + wordCount(a), 0) <= 3;
    });
    expect(calls).toEqual([true]); // verse 1:1 alone on the page: chapter 1 goes on to verse 1:2
  });

  it('carries a chapter across a page as one continuation part, and keeps gap lines in their place', () => {
    const atoms: Atom[] = [verse(1, 1, 3), verse(1, 2, 3), { gap: [2, 3] }, verse(4, 1, 3), verse(4, 2, 3)];
    const pages = paginate(atoms, fitsWords(5)) as Atom[][];
    const shape = pages.map((page) => partsOf(page).map((part: { gap?: number[]; c?: number; head?: boolean }) => (part.gap ? 'gap' : `${part.c}${part.head ? '' : '…'}`)));
    // Page 1: chapter 1 (head) with verse 1 and 2 words of verse 2; page 2: the rest of chapter 1, the gap
    // line and 3 words of chapter 4; page 3: the rest of chapter 4.
    expect(shape).toEqual([['1'], ['1…', 'gap', '4'], ['4…']]);
  });

  it('never loses or adds a character, whatever the page size', () => {
    const atoms = [verse(1, 1, 7), verse(1, 2, 1), verse(2, 1, 9), verse(2, 2, 2)];
    for (const capacity of [1, 2, 3, 5, 8, 13, 100]) {
      const pages = paginate(atoms, fitsWords(capacity)) as Atom[][];
      expect(rebuilt(pages), `capacity ${capacity}`).toEqual(Object.fromEntries(atoms.map((a) => [`${a.c}:${a.v!.n}`, a.v!.text])));
      expect(pages.every((page) => page.length > 0)).toBe(true);
    }
  });

  it('splits a verse written without spaces (Thai) between words, and loses nothing', () => {
    const thai = 'ในปฐมกาลพระเจ้าทรงเนรมิตสร้างฟ้าและแผ่นดินแผ่นดินนั้นก็ร้างเปล่าอยู่';
    expect(thai).not.toContain(' ');
    expect(wordsOf(thai).length).toBeGreaterThan(5); // Intl.Segmenter finds the word boundaries
    const atoms: Atom[] = [{ c: 1, head: true, v: { n: '1', drafted: true, text: thai } }];
    // A page holds 20 characters: the verse needs several pages and every one must be filled, never cut.
    const pages = paginate(atoms, (_p: number, list: Atom[]) => list.reduce((sum, a) => sum + shown(a).length, 0) <= 20) as Atom[][];
    expect(pages.length).toBeGreaterThan(1);
    expect(rebuilt(pages)['1:1']).toBe(thai);
  });
});
