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
