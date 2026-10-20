// review.mjs — the ONE rule for "this alignment record needs review" (#796, D105 point 4).
//
// The Align rail's red dot, the editor's banner and the Mark valid gate all ask the
// same question: does the stored record still vouch for the verse as it now reads?
// They used to answer with three rules: the rail read `invalid` or the hash, the
// banner read the hash or "the open rebuilt the words", and neither read the words
// alone. Each caller now asks `needsReview`, so they cannot disagree.
//
// A record that holds no link and is not `done` vouches for nothing: it is the
// bootstrap of a verse the translator has not worked on, so a change of the verse
// text is not a change to anything they approved. `invalid` is different: it is a
// flag the translator must clear (Mark valid), and no edit clears it.
//
// It is `.mjs` with JSDoc types, like verseWords.mjs, so that plain Node runs it.
import { verseTextMd5 } from '../../../journal/fold.mjs';
import { sameWords, verseWords } from './verseWords.mjs';

/** @typedef {import('./zaln').AlignmentVerseRecord} AlignmentVerseRecord */
/** @typedef {import('./zaln').VerseWord} VerseWord */

/** Does any card of the record hold a target word?
 * @param {AlignmentVerseRecord} record
 * @returns {boolean}
 */
export const hasLinks = (record) => record.alignments.some((a) => a.bottomWords.length > 0);

/** Does the record say the translator worked on this verse: a link, or Mark valid / all placed?
 * @param {AlignmentVerseRecord} record
 * @returns {boolean}
 */
export const vouches = (record) => hasLinks(record) || record.done === true;

/** Every target word the record holds, banked or placed. A stored record may lack `wordBank`.
 * @param {AlignmentVerseRecord} record
 * @returns {Array<{ word: string, occurrence: number | string, occurrences: number | string }>}
 */
export const recordWords = (record) => [...(record.wordBank ?? []), ...record.alignments.flatMap((a) => a.bottomWords)];

/**
 * Does this stored record need the translator's review for the verse as it now reads?
 * The steps run in this order, and the work after a step is skipped when it answers:
 * 1. `invalid` is true: yes, whatever else holds.
 * 2. The record does not vouch (no link, not `done`): no.
 * 3. The book holds no slot for the verse: yes, as the record then points at nothing.
 * 4. The record's hash is not the slot's hash (I-3): yes.
 * 5. Otherwise: yes when the record's words are not the verse's words (word, occurrence and
 *    occurrences, banked or placed; order does not count).
 * `wordsOf` and `md5Of` are lazy: a caller that already holds the slot's memoized words or
 * hash passes them, and a verse that step 1 to 4 settle never pays for a parse.
 * @param {AlignmentVerseRecord} record
 * @param {string | undefined} slot the stored verse content (`decompose(toNfc(book)).verses[ref]`)
 * @param {{ wordsOf?: () => VerseWord[], md5Of?: () => string | undefined }} [lazy]
 * @returns {boolean}
 */
export const needsReview = (record, slot, { wordsOf = () => verseWords(slot), md5Of = () => verseTextMd5(slot) } = {}) => {
  if (record.invalid === true) return true;
  if (!vouches(record)) return false;
  if (slot === undefined) return true;
  if (record.targetVerseMd5 !== md5Of()) return true;
  return !sameWords(recordWords(record), wordsOf());
};
