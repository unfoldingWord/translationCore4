// source.mjs — the source side of a §5.1 record, fitted to the pinned original-language verse
// (#790, D107; BURRITO-SPEC §5.1 "Source cards").
//
// A stored record holds the source words of the verse it was made against. The verse the project
// pins now can differ: a tC3 import made against another UGNT version, a record made against an
// older pin, cards that cover only some of the words, or two cards on one word. tC3 repaired this
// when it loaded a verse (wordAlignment ae083b8, verse.js 308-352): a group that uses a source word
// the pin does not hold is removed with its links, each source word that no group holds gets a new
// single card, and the cards are in the order of their first source word. This module does the
// same, on the stored record, with no positions: §5.1 stores none.
//
// The Align open, every Align write and the aligned export call `fitSourceCards`, so they flag the
// same records. It is `.mjs` with JSDoc types, like review.mjs, so that plain Node (the conformance
// harness) runs it.

/** @typedef {import('./zaln').AlignedWord} AlignedWord */
/** @typedef {import('./zaln').Alignment} Alignment */
/** @typedef {import('./zaln').AlignmentVerseRecord} AlignmentVerseRecord */

/** The identity of a source word, as tC3's `isSameOccurrence` has it: the word (NFC, D109), its
 * occurrence and its occurrences. strong, lemma and morph are not part of it.
 * @param {{ word: string, occurrence: number | string, occurrences: number | string }} w
 * @returns {string}
 */
const keyOf = (w) => `${String(w.word).normalize('NFC')}|${Number(w.occurrence)}|${Number(w.occurrences)}`;

/**
 * A record's source cards made to cover the pinned verse. `sourceWords` are the pinned verse's
 * words, in order. The steps:
 * 1. Each key (NFC word, occurrence, occurrences) maps to the LIST of its positions in
 *    `sourceWords`. A key can occur twice: the UHB holds some words in two Unicode forms, `unmerge`
 *    counts each form apart, and NFC makes them one key.
 * 2. For each stored card, in stored order: each `topWords` word takes the first position of its
 *    key that no committed card holds and no earlier word of the same card holds. The card commits
 *    its positions only when every word finds one. Otherwise the whole card drops (its target
 *    words go back to the bank when the open or an edit reconciles the record) and its positions
 *    stay free. A card with no `topWords` also drops. A dropped card counts in `dropped` when it
 *    held a target word.
 * 3. A kept card keeps its `bottomWords`. Its `topWords` become the pin's word objects, in order.
 * 4. Each pinned word that no card holds gets a card `{ topWords: [word], bottomWords: [] }`.
 * 5. The cards are sorted by their first position. `reshaped` is true when the fit dropped a card
 *    or added one. The record gets `invalid: true` when a card with a link dropped, or when the
 *    record is `done` and reshaped (a `done` record with an empty card breaks D73). Every other
 *    field stays as it is: `done`, the hash, `sourceVersion` and `wordBank`.
 * `sourceWords` is always an array: the open sets it on the session, so a call without one is a
 * programming error and throws.
 * @param {AlignmentVerseRecord} record
 * @param {AlignedWord[]} sourceWords the pinned verse's words, in order
 * @returns {{ record: AlignmentVerseRecord, dropped: number, reshaped: boolean }}
 */
export const fitSourceCards = (record, sourceWords) => {
  if (!Array.isArray(sourceWords)) throw new TypeError("fitSourceCards: sourceWords must be an array of the pinned verse's words");
  /** @type {Map<string, number[]>} */
  const positions = new Map();
  sourceWords.forEach((w, i) => {
    const key = keyOf(w);
    const list = positions.get(key);
    if (list) list.push(i);
    else positions.set(key, [i]);
  });
  /** @type {Set<number>} */
  const held = new Set();
  /** @type {Array<{ first: number, card: Alignment }>} */
  const kept = [];
  let dropped = 0;
  let reshaped = false;
  for (const card of record.alignments) {
    /** @type {number[]} */
    const mine = [];
    let fits = card.topWords.length > 0;
    for (const w of card.topWords) {
      const p = positions.get(keyOf(w))?.find((q) => !held.has(q) && !mine.includes(q));
      if (p === undefined) {
        fits = false;
        break;
      }
      mine.push(p);
    }
    if (!fits) {
      reshaped = true;
      if (card.bottomWords.length > 0) dropped += 1;
      continue;
    }
    for (const p of mine) held.add(p);
    mine.sort((a, b) => a - b);
    kept.push({ first: mine[0], card: { ...card, topWords: mine.map((p) => sourceWords[p]) } });
  }
  sourceWords.forEach((w, p) => {
    if (held.has(p)) return;
    kept.push({ first: p, card: { topWords: [w], bottomWords: [] } });
    reshaped = true;
  });
  kept.sort((a, b) => a.first - b.first);
  const flagged = dropped > 0 || (record.done === true && reshaped);
  return { record: { ...record, alignments: kept.map((k) => k.card), ...(flagged ? { invalid: true } : {}) }, dropped, reshaped };
};

/**
 * What `sourceVersion` names: the original-language pin that Align last fitted the cards to
 * (D107). `dcs::<last two segments of repoPath>@<version>`; D58 made `version` optional and `sha`
 * the identity of a pin, so a pin with no `version` gives the `sha`. `undefined` with no pin.
 * @param {{ repoPath?: string, version?: string, sha?: string } | null | undefined} pin
 * @returns {string | undefined}
 */
export const sourceVersionOf = (pin) =>
  pin?.repoPath ? `dcs::${pin.repoPath.split('/').slice(-2).join('/')}@${pin.version ?? pin.sha}` : undefined;

/** The record stamped with the pin it was fitted to.
 * @param {AlignmentVerseRecord} record
 * @param {string | undefined} version
 * @returns {AlignmentVerseRecord}
 */
export const stampSource = (record, version) => ({ ...record, sourceVersion: version });
