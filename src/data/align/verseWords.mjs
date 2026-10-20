// verseWords.mjs — the ONE word list of a stored verse (#796).
//
// The export weaves a record with word-aligner `merge`. `merge` tokenizes the stored
// verse slot (`decompose(toNfc(book)).verses[ref]`) and refuses a record whose words
// are not exactly that list. So the Align bank, the cards and every Align write take
// their words from the same slot, through the same walk, and agree with `merge` on
// every shape of marker: a footnote, a nested `\+nd`, a `\qa`, a number, NFD text.
//
// The walk mirrors what `merge` does to the slot, with the same pinned libraries: the
// slot is made plain with word-aligner-lib's own `cleanAlignmentMarkersFromString`
// (it leaves a slot with no `\zaln-s` and no `\w` as it is), usfm-js parses it, and
// each text node is split by string-punctuation-tokenizer 2.0.0 into the tokens
// `word` or `number` accepts. Occurrences are numbered over the whole verse, in one
// pass. The conformance of this module with the library's own `wordMap` is test/
// align-verse-words.test.ts (B1, B2).
//
// It is `.mjs` with JSDoc types, not `.ts`, so that plain Node runs it with no build
// step, as it runs weave.mjs and journal/*.mjs.
import usfmjs from 'usfm-js';
import { UsfmFileConversionHelpers } from 'word-aligner-lib';
import { number, tokenize, word } from 'string-punctuation-tokenizer';

/** @typedef {import('./zaln').VerseWord} VerseWord */

/** The words of one text node and of its children, in verse order.
 * @param {Array<{ text?: string, type?: string, children?: unknown[] }>} objects
 * @param {string[]} out
 */
const collect = (objects, out) => {
  for (const vo of objects) {
    if (vo.text) {
      for (const t of tokenize({ text: vo.text, includePunctuation: true })) {
        if (word.test(t) || number.test(t)) out.push(t);
      }
    }
    // A `text` object is a leaf. Any other object (a footnote, `\+nd`, `\add`, ...) may hold more words.
    if (vo.type !== 'text' && vo.children) collect(/** @type {Array<{ text?: string, type?: string, children?: unknown[] }>} */ (vo.children), out);
  }
};

/**
 * The words of a stored verse slot, as word-aligner `merge` counts them.
 * An empty or missing slot has none.
 * @param {string | undefined} slot the stored verse content, after `\v <n> `
 * @returns {VerseWord[]}
 */
export const verseWords = (slot) => {
  if (!slot) return [];
  const plain = /** @type {{ cleanAlignmentMarkersFromString: (s: string) => string }} */ (UsfmFileConversionHelpers).cleanAlignmentMarkersFromString(slot);
  const parsed = /** @type {{ verses: Record<string, { verseObjects?: unknown[] }> }} */ (
    /** @type {unknown} */ (usfmjs.toJSON(`\\v 1 ${plain}`, { chunk: true }))
  );
  /** @type {string[]} */
  const seq = [];
  collect(/** @type {Array<{ text?: string, type?: string, children?: unknown[] }>} */ (parsed.verses['1']?.verseObjects ?? []), seq);
  /** @type {Map<string, number>} */
  const total = new Map();
  for (const w of seq) total.set(w, (total.get(w) ?? 0) + 1);
  /** @type {Map<string, number>} */
  const seen = new Map();
  return seq.map((w) => {
    const occurrence = (seen.get(w) ?? 0) + 1;
    seen.set(w, occurrence);
    return { word: w, occurrence, occurrences: /** @type {number} */ (total.get(w)) };
  });
};

/** Two word lists hold the same words: the same multiset of `word`, `occurrence`
 * and `occurrences`, in any order. A numeric string counts as its number (I-2).
 * @param {Array<{ word: string, occurrence: number | string, occurrences: number | string }>} a
 * @param {Array<{ word: string, occurrence: number | string, occurrences: number | string }>} b
 * @returns {boolean}
 */
export const sameWords = (a, b) => {
  if (a.length !== b.length) return false;
  /** @type {Map<string, number>} */
  const left = new Map();
  for (const w of a) {
    const key = `${w.word}|${Number(w.occurrence)}|${Number(w.occurrences)}`;
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  for (const w of b) {
    const key = `${w.word}|${Number(w.occurrence)}|${Number(w.occurrences)}`;
    const n = left.get(key);
    if (!n) return false;
    left.set(key, n - 1);
  }
  return true;
};
