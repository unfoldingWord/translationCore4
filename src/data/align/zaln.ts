// The alignment sidecar types (BURRITO-SPEC §5.1). zaln markup exists only in
// derived/merged output, never at rest (I-1).

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
  /** OPTIONAL, additive (#271, D73): the translator's "this verse is done" —
   * set when every word is placed, or by Mark valid with words still in the
   * bank; cleared by any alignment edit. Absent means not done. Read together
   * with I-3: a stale record is not done whatever the flag says. */
  done?: boolean;
}

/** checking/alignments/<BOOK>.json ingredient (role x-alignment). */
export interface AlignmentFile {
  schemaVersion: number;
  book: string;
  chapters: { [chapter: string]: { [verse: string]: AlignmentVerseRecord } };
}
