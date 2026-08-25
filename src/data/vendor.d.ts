// Minimal ambient types for the retained tC3 logic libraries (arch §2: exact
// proven versions word-aligner@1.0.3 / word-aligner-lib@1.0.1 / usfm-js@3.4.3).
// The libraries ship no types; shapes are asserted behaviorally by the tests
// and the 27-check conformance harness — keep these declarations honest and
// loose rather than invented-precise.

declare module 'word-aligner' {
  const mod: {
    default: {
      merge: (
        alignments: unknown[],
        wordBank: unknown[],
        verseString: string,
        useVerseText?: boolean,
      ) => unknown[];
      unmerge: (
        verseData: { verseObjects: unknown[] },
        alignedVerseData: { verseObjects: unknown[] },
      ) => { alignment?: unknown[]; alignments?: unknown[]; wordBank: unknown[] };
    };
  };
  export default mod;
}

declare module 'word-aligner-lib' {
  export const AlignmentHelpers: {
    parseUsfmToWordAlignerData: (
      targetVerseUSFM: string,
      sourceVerseUSFM: string | null,
    ) => { targetWords: unknown[]; verseAlignments: unknown[] };
    addAlignmentsToVerseUSFM: (
      wordBankWords: unknown[],
      verseAlignments: unknown[],
      targetVerseText: string,
    ) => string | null;
    extractAlignmentsFromTargetVerse: (
      alignedTargetVerse: string,
      sourceVerse: unknown,
    ) => { alignment?: unknown[]; alignments?: unknown[]; wordBank: unknown[] } | null;
    areAlgnmentsComplete: (targetWords: unknown[], verseAlignments: unknown[]) => boolean;
    [key: string]: unknown;
  };
  export const UsfmFileConversionHelpers: {
    convertVerseDataToUSFM: (verseData: { verseObjects: unknown[] }) => string;
    [key: string]: unknown;
  };
  export const selectionsHelpers: {
    validateVerseSelections: (
      verseText: string,
      selections: unknown[],
    ) => { selectionsChanged: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
  export const groupDataHelpers: Record<string, unknown>;
}

declare module 'usfm-js' {
  const usfm: {
    toJSON: (usfm: string, options?: { chunk?: boolean }) => Record<string, unknown>;
    toUSFM: (json: unknown, options?: { forcedNewLines?: boolean }) => string;
  };
  export default usfm;
}

// bible-reference-range ships types but omits `doesReferenceContain`; augment
// the module to add just the member we use (proven uW range engine — B19/F6).
declare module 'bible-reference-range' {
  export function doesReferenceContain(ref: string, subref: string): boolean;
}

// string-punctuation-tokenizer ships no types. `tokenize` returns the word
// tokens of a string, punctuation stripped (§5.2 quote identity — B18; and the
// tN/tW target-word selection — B23). `occurrencesInString` counts a word's
// total occurrences (for the §5.2 selection's `occurrences`).
declare module 'string-punctuation-tokenizer' {
  export function tokenize(options: { text: string }): string[];
  export function occurrencesInString(text: string, subString: string): number;
}

// proskomma-core ships no types. It publishes as one prebuilt bundle, and this
// project uses exactly one corner of it: the versification mapping utilities
// (issue #15). Loaded by a DYNAMIC import in src/data/mapReference.ts so the
// ~233 kB gzipped chunk stays out of the main bundle — an `eng` project never
// fetches it. Keep this declaration loose and honest; the behaviour is asserted
// by test/mapReference.test.ts against the real scheme data.
declare module 'proskomma-core' {
  export const utils: {
    versification: {
      /** Builds per-book, per-chapter succinct mapping tables. Calls
       * preSuccinctVerseMapping internally, so it takes the RAW mappedVerses. */
      succinctifyVerseMappings: (
        mappedVerses: Record<string, string[]>,
      ) => Record<string, Record<string, unknown>>;
      /** Inverts a mappedVerses table. REQUIRES the array value form — handed a
       * string it iterates that string's characters and returns a silently
       * corrupt table (see normalizeScheme in src/data/versification.ts). */
      reverseVersification: (doc: { mappedVerses: Record<string, string[]> }) => {
        reverseMappedVerses: Record<string, string[]>;
      };
      /** [bookCode, [[chapter, verse], ...]]. The inner array may hold more than
       * one pair under the format's many-to-many form. */
      mapVerse: (
        succinctChapter: unknown,
        book: string,
        chapter: number,
        verse: number,
      ) => [string, [number, number][]] | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}
