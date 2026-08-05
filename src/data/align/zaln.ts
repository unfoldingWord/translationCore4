// Sidecar ⇄ zaln-USFM round-trip machinery — the harness section-4 mechanism
// (sample-burrito-validation/validate.mjs) as an app-level module, using the
// retained tC3 logic layer at the exact proven versions (arch §1, §7.2).
// zaln markup exists only in derived/merged output, never at rest (I-1).
import { usfmjs, wordaligner, UsfmFileConversionHelpers } from '../vendor';

/** One aligned word (BURRITO-SPEC §5.1). Original-language words carry
 * strong/lemma/morph; target words only word+occurrence(s). */
export interface AlignedWord {
  strong?: string;
  lemma?: string;
  morph?: string;
  occurrence: number | string;
  occurrences: number | string;
  word: string;
  // The alignment libraries carry extra keys through (tag/type/text on their
  // way in). Loose rather than invented-precise, per the vendor.d.ts rule.
  [key: string]: unknown;
}

export interface Alignment {
  topWords: AlignedWord[];
  bottomWords: AlignedWord[];
}

/** Per-verse alignment record (BURRITO-SPEC §5.1). */
export interface AlignmentVerseRecord {
  alignments: Alignment[];
  wordBank: AlignedWord[];
  invalid: boolean;
  targetVerseMd5: string;
  sourceVersion: string;
}

/** checking/alignments/<BOOK>.json ingredient (role x-alignment). */
export interface AlignmentFile {
  schemaVersion: number;
  book: string;
  chapters: { [chapter: string]: { [verse: string]: AlignmentVerseRecord } };
}

/** Verse plain text from usfm-js verseObjects (harness section-3/4 mechanism). */
export const verseTextFromObjects = (verseObjects: Array<Record<string, unknown>>): string =>
  verseObjects
    .filter((vo) => vo.type === 'text' || vo.text)
    .map((vo) => (vo.text as string) || '')
    .join('');

/** Rebuild original-language verseObjects from the stored alignments' topWords
 * — the sidecar's topWords in file order ARE the orig verse tokens (§5.1). */
export const origWordsFromAlignments = (
  alignments: Alignment[],
): Array<Record<string, unknown>> =>
  alignments
    .flatMap((a) => a.topWords)
    .map((t) => ({
      tag: 'w',
      type: 'word',
      text: t.word,
      strong: t.strong,
      lemma: t.lemma,
      morph: t.morph,
      occurrence: t.occurrence,
      occurrences: t.occurrences,
    }));

/** Merge one verse's sidecar record into zaln-aligned verse USFM. */
export const mergeVerseToZalnUsfm = (record: AlignmentVerseRecord, verseText: string): string => {
  const merged = wordaligner.merge(record.alignments, record.wordBank, verseText.trim(), true);
  return UsfmFileConversionHelpers.convertVerseDataToUSFM({ verseObjects: merged });
};

/** Extract a sidecar-shaped {alignments, wordBank} from zaln-aligned verse
 * USFM. Occurrences may come back as strings (USFM attributes) — the store
 * boundary normalizes them on write (I-2), not this reader. */
export const extractVerseFromZalnUsfm = (
  zalnUsfm: string,
  origWords: Array<Record<string, unknown>>,
): { alignments: Alignment[]; wordBank: AlignedWord[] } => {
  // Chunk parse returns `verses`, not `chapters` (PLATFORM-NOTES #4 [VERIFIED]).
  const parsed = usfmjs.toJSON(`\\v 1 ${zalnUsfm}`, { chunk: true }) as {
    verses: { [v: string]: { verseObjects: Array<Record<string, unknown>> } };
  };
  const reparsed = parsed.verses['1'].verseObjects;
  const re = wordaligner.unmerge({ verseObjects: reparsed }, { verseObjects: origWords });
  const alignments = (re.alignment ?? re.alignments ?? []) as Alignment[];
  return {
    // Project to exactly the persisted §5.1 shape (as the fixture generator does).
    alignments: alignments.map((a) => ({ topWords: a.topWords, bottomWords: a.bottomWords })),
    wordBank: re.wordBank as AlignedWord[],
  };
};
