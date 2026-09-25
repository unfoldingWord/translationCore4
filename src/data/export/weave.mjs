// The whole-book aligned USFM weave (issue #19, BURRITO-SPEC §3 I-1 and §5.1):
// the stored book plus its alignment sidecar → one USFM file with `\zaln` and
// `\w` markup. One implementation: the USFM export (./usfm.ts) calls it in the
// app, and the conformance harness (conformance/validate.mjs, "Whole-book
// aligned USFM export") imports it. It is `.mjs`, not `.ts`, so that Node runs
// it with no build step, as it runs journal/*.mjs.
import usfmjs from 'usfm-js';
import wordAlignerModule from 'word-aligner';
import { verseTextMd5 } from '../../../journal/fold.mjs';
import { decompose } from '../../../journal/skeleton.mjs';

// Node hands us module.exports, whose `default` is the aligner; Vite may hand us the aligner itself.
const wordaligner = wordAlignerModule.default ?? wordAlignerModule;

/** True when a §5.1 record may be woven into the verse: not flagged invalid,
 * and its `targetVerseMd5` matches the verse's current text (I-3). */
const isValid = (record, content) => record.invalid !== true && content !== undefined && verseTextMd5(content) === record.targetVerseMd5;

/**
 * The aligned USFM of one book. Each verse with a valid §5.1 record is merged
 * with `wordaligner.merge`; every other verse keeps its stored content, so
 * nothing is invented for a verse the translator has not aligned.
 * @param {string} usfm the stored book file
 * @param {{ chapters: Record<string, Record<string, object>> } | null} alignments the book's §5.1 sidecar
 * @returns {string}
 */
export function weaveBook(usfm, alignments) {
  const json = usfmjs.toJSON(usfm);
  const slots = decompose(usfm).verses;
  for (const [chapter, verses] of Object.entries(alignments?.chapters ?? {})) {
    for (const [verse, record] of Object.entries(verses)) {
      const target = json.chapters[chapter]?.[verse];
      if (!target || !isValid(record, slots[`${chapter}:${verse}`])) continue;
      const text = target.verseObjects.map((vo) => vo.text || '').join('');
      target.verseObjects = wordaligner.merge(record.alignments, record.wordBank, text.trim(), true);
    }
  }
  return usfmjs.toUSFM(json, { forcedNewLines: true });
}
