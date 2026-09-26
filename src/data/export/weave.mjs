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
import { verseTextMd5 } from '../../../journal/fold.mjs';
import { decompose, recompose } from '../../../journal/skeleton.mjs';

/** True when a §5.1 record may be woven into the verse: not flagged invalid,
 * and its `targetVerseMd5` matches the verse's current text (I-3). */
const isValid = (record, content) => record.invalid !== true && content !== undefined && verseTextMd5(content) === record.targetVerseMd5;

/**
 * The aligned USFM of one book. Each verse with a valid §5.1 record gets its
 * alignments; every other verse keeps its stored content, so nothing is
 * invented for a verse the translator has not aligned.
 * @param {string} usfm the stored book file
 * @param {{ chapters: Record<string, Record<string, object>> } | null} alignments the book's §5.1 sidecar
 * @param {{ addAlignmentsToTargetVerseUsingMerge: (verseUsfm: string, record: object) => string | null }} AlignmentHelpers word-aligner-lib's
 * @returns {string}
 */
export function weaveBook(usfm, alignments, AlignmentHelpers) {
  const { skeleton, verses } = decompose(usfm);
  for (const [chapter, records] of Object.entries(alignments?.chapters ?? {})) {
    for (const [verse, record] of Object.entries(records)) {
      const key = `${chapter}:${verse}`;
      if (!isValid(record, verses[key])) continue;
      // null when the record does not merge into the verse: keep the stored content.
      const woven = AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge(verses[key], record);
      if (woven !== null) verses[key] = woven;
    }
  }
  return recompose(skeleton, verses);
}
