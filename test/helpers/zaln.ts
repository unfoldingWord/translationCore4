// The inverse of the aligned USFM export (issue #19): take one verse's `\zaln`
// markup back to a §5.1 record. The export tests (test/export/usfm.test.ts and
// e2e/j07-publish.spec.ts) use it as their oracle: unweaving the exported
// verse must give the stored record exactly.
import { usfmjs, wordaligner } from '../../src/data/vendor';
import type { AlignedWord, Alignment } from '../../src/data/align/zaln';
import { normalizeOccurrences } from '../../src/data/align/occurrences';

/** Rebuild original-language verseObjects from the stored alignments' topWords
 * — the sidecar's topWords in file order ARE the orig verse tokens (§5.1). */
export const origWordsFromAlignments = (alignments: Alignment[]): Array<Record<string, unknown>> =>
  alignments
    .flatMap((a) => a.topWords)
    .map((t) => ({ tag: 'w', type: 'word', text: t.word, strong: t.strong, lemma: t.lemma, morph: t.morph, occurrence: t.occurrence, occurrences: t.occurrences }));

/** Extract a sidecar-shaped {alignments, wordBank} from zaln-aligned verse
 * USFM. USFM attributes read back as strings, so occurrences are normalized to
 * integers the way the store normalizes them on write (I-2). */
export const extractVerseFromZalnUsfm = (
  zalnUsfm: string,
  origWords: Array<Record<string, unknown>>,
): { alignments: Alignment[]; wordBank: AlignedWord[] } => {
  // Chunk parse returns `verses`, not `chapters` (PLATFORM-NOTES #4 [VERIFIED]).
  const parsed = usfmjs.toJSON(`\\v 1 ${zalnUsfm}`, { chunk: true }) as {
    verses: { [v: string]: { verseObjects: Array<Record<string, unknown>> } };
  };
  const re = wordaligner.unmerge({ verseObjects: parsed.verses['1'].verseObjects }, { verseObjects: origWords });
  const alignments = (re.alignment ?? re.alignments ?? []) as Alignment[];
  return {
    // Project to exactly the persisted §5.1 shape (as the fixture generator does).
    alignments: alignments.map((a) => ({ topWords: a.topWords.map(normalizeOccurrences), bottomWords: a.bottomWords.map(normalizeOccurrences) })),
    wordBank: (re.wordBank as AlignedWord[]).map(normalizeOccurrences),
  };
};
