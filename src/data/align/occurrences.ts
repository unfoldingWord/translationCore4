// INVARIANT I-2 (BURRITO-SPEC §5): all occurrence/occurrences fields are
// integers. USFM attribute parsing yields strings; the alignment libraries
// fail wholesale on string occurrences (PLATFORM-NOTES #2 [VERIFIED]). Writers
// normalize at the store boundary (arch §6) with this helper.

export interface WithOccurrences {
  occurrence?: number | string;
  occurrences?: number | string;
  [key: string]: unknown;
}

/** Normalize occurrence/occurrences to integers, preserving key order. */
export const normalizeOccurrences = <T extends WithOccurrences>(w: T): T => ({
  ...w,
  ...(w.occurrence !== undefined ? { occurrence: Number(w.occurrence) } : {}),
  ...(w.occurrences !== undefined ? { occurrences: Number(w.occurrences) } : {}),
});
