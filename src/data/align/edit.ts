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
import { hasLinks, needsReview, recordWords } from './review.mjs';
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

/** One verse's text as the reflow compares it: the stored slot (`decompose(toNfc(book)).verses[ref]`),
 * the export's word list of that slot (#796) and the slot's hash (#795). */
export interface VerseText {
  slot: string;
  words: VerseWord[];
  md5: string;
}

/**
 * #789 — an LCS diff of two word-string lists (no pinned or Pankosmia code diffs by position, D106).
 * Returns, for each index of `a`, the index in `b` of the word it matches, or -1. Equal words match,
 * so matches go as early as they can and each insert or delete goes as late as it can. The table is
 * the suffix LCS, `L[i][j]` = the LCS of `a[i:]` and `b[j:]`; the walk starts at the front. A verse
 * is under 70 words, so the table is small (about 0.015 ms on the longest Genesis verse).
 */
export const matchWords = (a: string[], b: string[]): Int32Array => {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const L = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const match = new Int32Array(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) match[i++] = j++;
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
    else j++;
  }
  return match;
};

/** One diff pass: where each word of the before list goes in the after list (`dest`, -1 when it
 * is gone), and the first before index and first after index of every string that no match holds. */
interface Pass {
  dest: Int32Array;
  firstLostBefore: Map<string, number>;
  firstNewAfter: Map<string, number>;
}

/** A word no match holds is a delete or an insert. The k-th deleted copy of a string and the k-th
 * inserted copy of the same string are one move: the word keeps its identity (D106 point 1). */
const passOf = (before: string[], after: string[], match: Int32Array): Pass => {
  const held = new Set<number>();
  for (const k of match) if (k >= 0) held.add(k);
  const newAfter = new Map<string, number[]>();
  after.forEach((s, k) => {
    if (held.has(k)) return;
    const list = newAfter.get(s);
    if (list) list.push(k);
    else newAfter.set(s, [k]);
  });
  const firstNewAfter = new Map([...newAfter].map(([s, ks]) => [s, ks[0]]));
  const next = new Map<string, number>();
  const firstLostBefore = new Map<string, number>();
  const dest = Int32Array.from(match);
  before.forEach((s, i) => {
    if (match[i] >= 0) return;
    if (!firstLostBefore.has(s)) firstLostBefore.set(s, i);
    const at = next.get(s) ?? 0;
    next.set(s, at + 1);
    dest[i] = newAfter.get(s)?.[at] ?? -1;
  });
  return { dest, firstLostBefore, firstNewAfter };
};

/** The late pass puts each insert and delete as late as it can; the early pass, run on the
 * reversed lists and mapped back, as early as it can. */
const passesOf = (before: string[], after: string[]): { late: Pass; early: Pass } => {
  const n = before.length;
  const m = after.length;
  const back = matchWords([...before].reverse(), [...after].reverse());
  const early = new Int32Array(n);
  for (let i = 0; i < n; i++) early[i] = back[n - 1 - i] < 0 ? -1 : m - 1 - back[n - 1 - i];
  return { late: passOf(before, after, matchWords(before, after)), early: passOf(before, after, early) };
};

/**
 * #789 — a record's links moved to the verse after a save, each with its word, and whether the
 * text can say that they moved right (D106 point 2). `before` and `after` are the verse's word
 * lists on either side of the save; every placed word of `record` is a word of `before`
 * (`reconcileToWords` makes it so). A link goes to `after[late.dest]` with that word's occurrence
 * and counts; a word with no destination is gone, with its link, and it is not in the bank. The
 * bank is every after word that no link holds, in verse order.
 * `flag` is true when, for a linked word: an insert or delete of a copy of its string sits before
 * it, or its occurrence number changes, in either pass (it moved because of the edit); or the two
 * passes disagree where it goes (the text does not say which copy changed). An edit that touches
 * no copy of a linked word, or only copies after it, flags nothing.
 */
const followWords = (
  record: AlignmentVerseRecord,
  before: VerseWord[],
  after: VerseWord[],
): { record: AlignmentVerseRecord; flag: boolean } => {
  const { late, early } = passesOf(
    before.map((w) => w.word),
    after.map((w) => w.word),
  );
  const at = new Map(before.map((w, i) => [`${w.word} ${w.occurrence}`, i]));
  const shifted = (p: Pass, i: number): boolean => {
    const k = p.dest[i];
    if (k < 0) return false;
    const s = before[i].word;
    return (
      (p.firstLostBefore.get(s) ?? Infinity) < i ||
      (p.firstNewAfter.get(s) ?? Infinity) < k ||
      before[i].occurrence !== after[k].occurrence
    );
  };
  const held = new Set<number>();
  let flag = false;
  const alignments: Alignment[] = record.alignments.map((a) => ({
    ...a,
    bottomWords: a.bottomWords.flatMap((w): AlignedWord[] => {
      const i = at.get(`${w.word} ${Number(w.occurrence)}`);
      if (i === undefined) return [];
      if (shifted(late, i) || shifted(early, i) || late.dest[i] !== early.dest[i]) flag = true;
      const k = late.dest[i];
      if (k < 0) return [];
      held.add(k);
      return [normalizeOccurrences({ ...w, occurrence: after[k].occurrence, occurrences: after[k].occurrences })];
    }),
  }));
  const wordBank: AlignedWord[] = after
    .filter((_, k) => !held.has(k))
    .map((w) => ({ word: w.word, occurrence: w.occurrence, occurrences: w.occurrences }));
  return { record: cardsInVerseOrder({ ...record, alignments, wordBank }, after), flag };
};

/**
 * #213, #789 — reflow after a verse edit: a link follows its word, and the verse is flagged for
 * review when the text cannot show the link stayed right (D106). `before` is the verse as it read
 * before the save, `after` as it reads now; `before` is undefined when the old book held no slot
 * for the verse. The source side of a link is never touched, and no link is created (that is #1).
 *
 * Returns null when there is nothing to reflow: the record is absent, holds no link (the open builds
 * its bank, D105 point 2), or already fits the text after the save (the hash is current and no word
 * differs). Every other save returns the record, so no reflow declines (D106 point 4): `invalid`
 * and an emptied verse included. The steps:
 * 1. `review` is `needsReview` of the stored record against the text BEFORE the save (#796): a
 *    record that did not fit its own verse before the save still does not vouch for it after.
 * 2. With `before`, the record is made to fit `before` (`reconcileToWords`, #787) and its links
 *    move to `after` by `followWords`. Without `before` there is nothing to compare, so the links
 *    stay where word and occurrence say, and the verse is flagged.
 * 3. The record is stamped with the new hash, `done` follows the placed words (#271), and the
 *    verse is flagged `invalid: true` when `review` or the move said so. The flag stays until
 *    Mark valid (D105 point 4): `stampTargetVerse` does not clear it.
 */
export const reflowAlignment = (
  record: AlignmentVerseRecord | undefined,
  before: VerseText | undefined,
  after: VerseText,
): AlignmentVerseRecord | null => {
  if (!record || !hasLinks(record)) return null;
  if (record.targetVerseMd5 === after.md5 && sameWords(recordWords(record), after.words)) return null;
  if (!before) {
    // Nothing to compare with: the links stay where word and occurrence say, and the verse is flagged.
    return { ...settleDone(stampTargetVerse(reconcileToWords(record, after.words).record, after.md5)), invalid: true };
  }
  const review = needsReview(record, before.slot, { wordsOf: () => before.words, md5Of: () => before.md5 });
  const moved = followWords(reconcileToWords(record, before.words).record, before.words, after.words);
  const next = settleDone(stampTargetVerse(moved.record, after.md5));
  return review || moved.flag ? { ...next, invalid: true } : next;
};

/**
 * #796 — the one writer of an alignment edit: the edited record made to match
 * the verse's words (so the file always holds exactly the words `merge` checks),
 * stamped with the export's hash of the verse (I-3), and `done` settled (#271).
 */
export const finalizeEdit = (next: AlignmentVerseRecord, words: VerseWord[], md5: string): AlignmentVerseRecord =>
  settleDone(stampTargetVerse(reconcileToWords(next, words).record, md5));
