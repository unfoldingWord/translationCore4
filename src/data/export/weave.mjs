// The whole-book aligned USFM weave (issue #19, BURRITO-SPEC §3 I-1 and §5.1):
// the stored book plus its alignment sidecar → one USFM file with `\zaln` and
// `\w` markup. One implementation: the USFM export (./usfm.ts) calls it in the
// app, and the conformance harness (conformance/validate.mjs, "Whole-book
// aligned USFM export") imports it. It is `.mjs`, not `.ts`, so that Node runs
// it with no build step, as it runs journal/*.mjs.
//
// Each verse is woven by word-aligner-lib's
// `AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge`. The Pankosmia
// checking client's USFM export (pankosmia/uw-client-checks
// src/pages/UsfmExport.jsx) calls a repo-local copy of the same function
// [VERIFIED — pankosmia/uw-client-checks 0.0.9 (main 1b0dbc6, 2026-04-10)]. It merges into the verse's USFM, so a footnote or
// another marker inside the verse stays. Only the woven verse slots change;
// the rest of the book is the stored bytes (journal/skeleton.mjs). The
// helpers come from the caller, as Ajv does for ../import/burritoCheck.mjs:
// the app and the harness each carry their own copy of the pinned library,
// and plain Node cannot load its ES build.
import { decompose, recompose } from '../../../journal/skeleton.mjs';
import { hasLinks, needsReview } from '../align/review.mjs';

/** Why a verse that has an alignment of the translator's is left out of the weave (#796): the
 * stored verse holds imported markup, the record needs review (`needsReview`), or `merge`
 * refused the record.
 * @typedef {'inline-alignment' | 'needs-review' | 'merge-refused'} SkipReason */

/** True when a stored verse still holds the `\zaln-s` markup of an aligned
 * import (an I-1 violation that #553 will extract to the sidecar). */
export const holdsInlineAlignment = (content) => typeof content === 'string' && /\\zaln-s\b/.test(content);

/**
 * The aligned USFM of one book. A verse is woven only from a record that vouches
 * for it: the record has a placed word, and `needsReview` says no. Every other
 * verse keeps its stored content, so nothing is invented for a verse the
 * translator has not aligned (a record with no placed word is such a verse), and
 * nothing is written over text the record does not describe. `report` hears each
 * verse that has an alignment of the translator's and is left out, with the reason
 * (#796, D105); a verse with no alignment of theirs, or with no slot in the book,
 * is not reported.
 * @param {string} usfm the stored book file
 * @param {{ chapters: Record<string, Record<string, object>> } | null} alignments the book's §5.1 sidecar
 * @param {{ addAlignmentsToTargetVerseUsingMerge: (verseUsfm: string, record: object) => string | null }} AlignmentHelpers word-aligner-lib's
 * @param {(skip: { ref: string, reason: SkipReason }) => void} [report]
 * @returns {string}
 */
export function weaveBook(usfm, alignments, AlignmentHelpers, report = () => {}) {
  const { skeleton, verses } = decompose(usfm);
  for (const [chapter, records] of Object.entries(alignments?.chapters ?? {})) {
    for (const [verse, record] of Object.entries(records)) {
      const ref = `${chapter}:${verse}`;
      const slot = verses[ref];
      if (slot === undefined) continue;
      // Until #553 extracts it, the imported markup is the verse's alignment: keep it.
      if (holdsInlineAlignment(slot)) {
        if (hasLinks(record)) report({ ref, reason: 'inline-alignment' });
        continue;
      }
      if (needsReview(record, slot)) {
        report({ ref, reason: 'needs-review' });
        continue;
      }
      // A record with no placed word weaves every word with `\w` and no `\zaln`: the stored bytes are the verse.
      if (!hasLinks(record)) continue;
      // null when the record does not merge into the verse: keep the stored content.
      const woven = AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge(slot, record);
      if (woven === null) report({ ref, reason: 'merge-refused' });
      else verses[ref] = woven;
    }
  }
  return recompose(skeleton, verses);
}
