// edit.ts — alignment editing (C2.11/C2.12, J5).
//
// The stored shape is BURRITO-SPEC §5.1: per verse, `alignments` (each pairing
// original-language topWords with target bottomWords) plus a `wordBank` of the
// target words not yet linked. tC4 never stores `\zaln` at rest (I-1); the
// sidecar IS the alignment, and zaln is only produced for export.
//
// Two invariants this module is responsible for:
//   I-2  occurrence/occurrences are INTEGERS at the store boundary. usfm-js
//        parses the attributes as strings and word-aligner fails hard on the
//        mismatch (PLATFORM-NOTES #2), so every word crossing this boundary is
//        normalized — including the ones word-aligner itself hands back.
//   I-3  `targetVerseMd5` records the draft the alignment was made against, so
//        a later edit is detectable rather than silently invalidating. The hash
//        is the export's own (`verseTextMd5` of the stored verse slot, #795); the
//        caller makes it and these functions only stamp and compare it.
import { wordaligner } from '../vendor';
import { normalizeOccurrences } from './occurrences';
import { sameWords } from './verseWords.mjs';
import type { AlignedWord, Alignment, AlignmentVerseRecord, VerseWord } from './zaln';

const asWords = (list: unknown[]): AlignedWord[] =>
  (list as AlignedWord[]).map((w) => normalizeOccurrences(w));

/** Source words are NFC, as the journal seal writes a saved record (I-4, D109).
 * A verse that was never saved then holds the same spelling of a word as a saved
 * one, so the suggestion memory, which keys by exact text, finds it (#793). */
const NFC_FIELDS = ['word', 'lemma', 'text', 'content'] as const;
const asSourceWords = (list: unknown[]): AlignedWord[] =>
  asWords(list).map((w) => {
    const out: AlignedWord = { ...w };
    for (const f of NFC_FIELDS) {
      const v = out[f];
      if (typeof v === 'string') out[f] = v.normalize('NFC');
    }
    return out;
  });

/**
 * C2.12 — the bootstrap: what an unaligned (or undrafted) verse starts from.
 *
 * One alignment per original word with NO target words yet, and every target
 * word sitting in the wordBank. The cards are the ones `unmerge` makes for the
 * original words alone (an empty target gives an empty bank): the same `unmerge`
 * the conformance harness uses, so the bootstrap and the round-trip agree by
 * construction. The bank is `words`, the export's word list of the stored verse
 * (#796, verseWords.mjs), so it is the list `merge` will check.
 */
export const bootstrapVerse = (
  words: VerseWord[],
  origVerseObjects: Array<Record<string, unknown>>,
  sourceVersion: string,
  md5: string,
): AlignmentVerseRecord => {
  const unmerged = wordaligner.unmerge(
    { verseObjects: [] },
    { verseObjects: origVerseObjects },
  ) as unknown as { alignment?: unknown[]; alignments?: unknown[] };
  const raw = (unmerged.alignment ?? unmerged.alignments ?? []) as Array<{
    topWords: unknown[];
    bottomWords: unknown[];
  }>;
  return {
    alignments: raw.map((a) => ({
      topWords: asSourceWords(a.topWords),
      bottomWords: asWords(a.bottomWords),
    })),
    wordBank: words.map((w) => ({ word: w.word, occurrence: w.occurrence, occurrences: w.occurrences })),
    invalid: false,
    targetVerseMd5: md5,
    sourceVersion,
  };
};

/** Identity of a target word inside one verse: the word plus its occurrence. */
const sameWord = (a: AlignedWord, b: AlignedWord): boolean =>
  a.word === b.word && Number(a.occurrence) === Number(b.occurrence);

/**
 * C2.11 — link one banked target word to an alignment. Returns a NEW record;
 * the word leaves the bank so it can never be double-linked.
 */
export const linkWord = (
  record: AlignmentVerseRecord,
  alignmentIndex: number,
  word: AlignedWord,
): AlignmentVerseRecord => {
  const target = record.alignments[alignmentIndex];
  if (!target) return record;
  if (!record.wordBank.some((w) => sameWord(w, word))) return record; // not banked
  const moved = normalizeOccurrences(word);
  return {
    ...record,
    alignments: record.alignments.map((a, i) =>
      i === alignmentIndex ? { ...a, bottomWords: [...a.bottomWords, moved] } : a,
    ),
    wordBank: record.wordBank.filter((w) => !sameWord(w, word)),
  };
};

/** A word's place in the verse: its position in `words`; a word the verse no
 * longer has goes last. One map serves a whole sort. */
const placeIn = (words: VerseWord[]) => {
  const position = new Map(words.map((w, i) => [`${w.word} ${w.occurrence}`, i]));
  return (w: AlignedWord): number => position.get(`${w.word} ${Number(w.occurrence)}`) ?? Number.MAX_SAFE_INTEGER;
};

/** #734: bank words in the verse's word order (tC3 kept its bank in verse
 * order). A word the verse no longer has goes last. `words` is the verse's
 * word list (#796, verseWords.mjs). */
export const inVerseOrder = (bank: AlignedWord[], words: VerseWord[]): AlignedWord[] => {
  const at = placeIn(words);
  return [...bank].sort((a, b) => at(a) - at(b));
};

/** #754: every card's target words in verse order, as tC3 kept them on every
 * drop and on load. Only `bottomWords` move; the exported USFM is already in
 * verse order (word-aligner `merge`), so this changes what the card shows and
 * what the file stores, never the export. */
export const cardsInVerseOrder = (record: AlignmentVerseRecord, words: VerseWord[]): AlignmentVerseRecord => {
  const at = placeIn(words);
  return {
    ...record,
    alignments: record.alignments.map((a) => ({ ...a, bottomWords: [...a.bottomWords].sort((x, y) => at(x) - at(y)) })),
  };
};

/** Unlink a target word, returning it to the bank in its place in the verse.
 * #734: the whole bank is put in verse order, so a bank stored in another
 * order is restored too. */
export const unlinkWord = (
  record: AlignmentVerseRecord,
  alignmentIndex: number,
  word: AlignedWord,
  words: VerseWord[],
): AlignmentVerseRecord => {
  const target = record.alignments[alignmentIndex];
  if (!target?.bottomWords.some((w) => sameWord(w, word))) return record;
  const bank = inVerseOrder([...record.wordBank, normalizeOccurrences(word)], words);
  return {
    ...record,
    alignments: record.alignments.map((a, i) =>
      i === alignmentIndex
        ? { ...a, bottomWords: a.bottomWords.filter((w) => !sameWord(w, word)) }
        : a,
    ),
    wordBank: bank,
  };
};

/**
 * #129 — merge two ADJACENT alignments into one phrase alignment. Adjacency
 * is required, not a convenience: group order is original-language verse
 * order, and the zaln export reads the flattened topWords in that order — a
 * non-adjacent merge would emit the phrase's words out of verse order
 * (PR #135 review round 1). Adjacent merges of contiguous groups keep every
 * span contiguous by induction. The group at the lower index keeps its
 * position; topWords and bottomWords concatenate in index order.
 */
export const mergeAlignments = (
  record: AlignmentVerseRecord,
  fromIndex: number,
  toIndex: number,
): AlignmentVerseRecord => {
  const from = record.alignments[fromIndex];
  const to = record.alignments[toIndex];
  if (!from || !to || Math.abs(fromIndex - toIndex) !== 1) return record;
  const keep = Math.min(fromIndex, toIndex);
  const drop = Math.max(fromIndex, toIndex);
  const first = record.alignments[keep];
  const second = record.alignments[drop];
  const merged: Alignment = {
    topWords: [...first.topWords, ...second.topWords],
    bottomWords: [...first.bottomWords, ...second.bottomWords],
  };
  return {
    ...record,
    alignments: record.alignments
      .map((a, i) => (i === keep ? merged : a))
      .filter((_, i) => i !== drop),
  };
};

/**
 * #129 — split one phrase alignment back into single-word alignments. The
 * linked target words stay on the FIRST resulting group (the aligner re-drags
 * them from there), matching the mockup's split behavior. A single-word
 * group returns unchanged.
 */
export const splitAlignment = (
  record: AlignmentVerseRecord,
  index: number,
): AlignmentVerseRecord => {
  const group = record.alignments[index];
  if (!group || group.topWords.length < 2) return record;
  const singles: Alignment[] = group.topWords.map((tw, k) => ({
    topWords: [tw],
    bottomWords: k === 0 ? group.bottomWords : [],
  }));
  return {
    ...record,
    alignments: [
      ...record.alignments.slice(0, index),
      ...singles,
      ...record.alignments.slice(index + 1),
    ],
  };
};

/** #129 — move a linked target word from one alignment to another in ONE
 * record step (drag between cards). The word never passes through the bank,
 * so a failed persist cannot strand it half-moved and the bank's order is
 * untouched (PR #135 review round 1: routing through unlink re-sorted the
 * whole bank as a side effect). */
export const moveWord = (
  record: AlignmentVerseRecord,
  fromIndex: number,
  toIndex: number,
  word: AlignedWord,
): AlignmentVerseRecord => {
  const from = record.alignments[fromIndex];
  if (!from || !record.alignments[toIndex] || fromIndex === toIndex) return record;
  if (!from.bottomWords.some((w) => sameWord(w, word))) return record;
  const moved = normalizeOccurrences(word);
  return {
    ...record,
    alignments: record.alignments.map((a, i) => {
      if (i === fromIndex) return { ...a, bottomWords: a.bottomWords.filter((w) => !sameWord(w, word)) };
      if (i === toIndex) return { ...a, bottomWords: [...a.bottomWords, moved] };
      return a;
    }),
  };
};

/** Re-stamp the draft hash after the alignment is edited against a verse.
 * `md5` is the export's hash of the stored verse (#795). It leaves `invalid` as
 * it is (#796, D105 point 4): a record the translator must review stays flagged
 * through every edit, and Mark valid (`markDone`) is the one place the flag clears. */
export const stampTargetVerse = (
  record: AlignmentVerseRecord,
  md5: string,
): AlignmentVerseRecord => ({ ...record, targetVerseMd5: md5 });

/** I-3: does this record still describe the verse as it now reads? */
export const alignmentIsStale = (record: AlignmentVerseRecord, md5: string): boolean =>
  record.targetVerseMd5 !== md5;

/** Every target word the verse has, linked or not — the aligner's full set. */
export const allTargetWords = (record: AlignmentVerseRecord): AlignedWord[] => [
  ...record.wordBank,
  ...record.alignments.flatMap((a: Alignment) => a.bottomWords),
];

/** #271 — every target word is placed and no source group is left without a
 * target word (tC3's `areAlgnmentsComplete`). An empty record is not aligned. */
export const isFullyAligned = (record: AlignmentVerseRecord): boolean =>
  record.wordBank.length === 0 &&
  record.alignments.some((a) => a.bottomWords.length > 0) &&
  record.alignments.every((a) => a.topWords.length === 0 || a.bottomWords.length > 0);

/** #271 — the `done` flag after an alignment edit: set when the verse is now
 * fully aligned (D73: "all aligned is done"), otherwise removed — any edit
 * takes back an earlier Mark valid, exactly as tC3 unchecked "Alignment
 * complete" on every change. Absent, never `false`, so a record that was
 * never done keeps its bytes. */
export const settleDone = (record: AlignmentVerseRecord): AlignmentVerseRecord => {
  if (isFullyAligned(record)) return { ...record, done: true };
  if (!('done' in record)) return record;
  const rest: AlignmentVerseRecord = { ...record };
  delete rest.done;
  return rest;
};

/** #271 — Mark valid: the translator says this verse is done, words in the
 * bank or not. The record vouches for the CURRENT text (I-3 restamp) and the
 * re-review flag is cleared (tC3 reset "invalidated" on finish), so a stale
 * or flagged record marked valid reads valid again. */
export const markDone = (record: AlignmentVerseRecord, md5: string): AlignmentVerseRecord => ({
  ...stampTargetVerse(record, md5),
  invalid: false,
  done: true,
});

/**
 * #787 — a record's words made to match the verse, and nothing else. `words`
 * is the verse's word list (#796, verseWords.mjs). A placed word stays when its
 * word and occurrence are still in the verse, numbered again from the verse;
 * when two placed words share a word and occurrence, the first card keeps it.
 * The bank is every other word of the verse, in verse order, and each card's
 * words are in verse order. No guard and no restamp — `invalid`, `done`, the
 * hash, the source version and every `topWords` stay as they are. `changed` is
 * true when the words (word + occurrence + occurrences, linked or banked) differ
 * from the input's: a new word, a removed word, a dropped link, a doubled word
 * or a count change. Order alone is not a change.
 */
export const reconcileToWords = (
  record: AlignmentVerseRecord,
  words: VerseWord[],
): { record: AlignmentVerseRecord; changed: boolean } => {
  const present = new Map(words.map((w) => [`${w.word} ${w.occurrence}`, w]));
  const kept = new Set<string>();
  const alignments: Alignment[] = record.alignments.map((a) => ({
    ...a,
    bottomWords: a.bottomWords.flatMap((w): AlignedWord[] => {
      const key = `${w.word} ${Number(w.occurrence)}`;
      const now = present.get(key);
      if (!now || kept.has(key)) return [];
      kept.add(key);
      return [normalizeOccurrences({ ...w, occurrence: now.occurrence, occurrences: now.occurrences })];
    }),
  }));
  const wordBank: AlignedWord[] = words
    .filter((w) => !kept.has(`${w.word} ${w.occurrence}`))
    .map((w) => ({ word: w.word, occurrence: w.occurrence, occurrences: w.occurrences }));
  const next = cardsInVerseOrder({ ...record, alignments, wordBank }, words);
  // A stored record may lack `wordBank`; the old reflow did not read it, so count it as empty.
  const before = allTargetWords({ ...record, wordBank: record.wordBank ?? [] });
  return { record: next, changed: !sameWords(before, allTargetWords(next)) };
};

/**
 * #213 — reflow after a verse edit: keep every link whose target word is
 * still in the verse, drop the rest, and rebuild the bank from the verse. Word
 * identity is word plus occurrence (I-2) in the export's word list (#796); the
 * counts are recomputed for the verse. The source side of a link is never
 * touched, and no link is created (that is #1).
 *
 * Returns null when there is nothing to reflow — the record is absent, already
 * flagged `invalid` (a span create/break, #63), holds no placed word, or still
 * matches the verse (the hash is current and no word changed) — and when the
 * verse has no words at all. In every null case the caller leaves the record
 * exactly as it is: invalidate-and-retain (D36) stays the outcome the I-3 hash
 * already produces.
 */
export const reflowAlignment = (
  record: AlignmentVerseRecord | undefined,
  words: VerseWord[],
  md5: string,
): AlignmentVerseRecord | null => {
  if (!record || record.invalid === true) return null;
  if (!record.alignments.some((a) => a.bottomWords.length)) return null;
  if (!words.length) return null;
  const reconciled = reconcileToWords(record, words);
  if (!alignmentIsStale(record, md5) && !reconciled.changed) return null;
  // #271: a reflow is an edit — `done` follows the reflowed record (set when
  // every surviving word is placed and the bank is empty, else removed).
  return settleDone(stampTargetVerse(reconciled.record, md5));
};

/**
 * #796 — the one writer of an alignment edit: the edited record made to match
 * the verse's words (so the file always holds exactly the words `merge` checks),
 * stamped with the export's hash of the verse (I-3), and `done` settled (#271).
 */
export const finalizeEdit = (next: AlignmentVerseRecord, words: VerseWord[], md5: string): AlignmentVerseRecord =>
  settleDone(stampTargetVerse(reconcileToWords(next, words).record, md5));
