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
//        a later edit is detectable rather than silently invalidating.
import { usfmjs, wordaligner } from '../vendor';
import { md5Hex } from '../httpStore';
import { normalizeOccurrences } from './occurrences';
import type { AlignedWord, Alignment, AlignmentVerseRecord } from './zaln';

/** Split a verse into word and separator tokens, preserving punctuation. */
const tokenize = (text: string): string[] =>
  text.match(/[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+/gu) ?? [];

const isWord = (token: string): boolean => /[\p{L}\p{M}\p{N}]/u.test(token);

/** Render a plain draft verse as USFM3 `\w` tokens carrying occurrence data.
 * word-aligner's `unmerge` only banks words it can see as word objects, so a
 * plain-text verse yields an EMPTY wordBank [VERIFIED 2026-08-03] — the verse
 * must be tokenized first for the bootstrap to have anything to offer. */
export const tokenizeTargetVerse = (text: string): string => {
  const tokens = tokenize(text);
  const totals: { [word: string]: number } = {};
  for (const token of tokens) if (isWord(token)) totals[token] = (totals[token] ?? 0) + 1;
  const seen: { [word: string]: number } = {};
  let out = '';
  for (const token of tokens) {
    if (!isWord(token)) {
      out += token;
      continue;
    }
    seen[token] = (seen[token] ?? 0) + 1;
    out += `\\w ${token}|x-occurrence="${seen[token]}" x-occurrences="${totals[token]}"\\w*`;
  }
  return out;
};

const asWords = (list: unknown[]): AlignedWord[] =>
  (list as AlignedWord[]).map((w) => normalizeOccurrences(w));

/**
 * C2.12 — the bootstrap: what an unaligned (or undrafted) verse starts from.
 *
 * One alignment per original word with NO target words yet, and every target
 * word sitting in the wordBank. Produced by the same `unmerge` the conformance
 * harness uses, so the bootstrap and the round-trip agree by construction.
 */
export const bootstrapVerse = (
  targetText: string,
  origVerseObjects: Array<Record<string, unknown>>,
  sourceVersion: string,
): AlignmentVerseRecord => {
  const tokenized = tokenizeTargetVerse(targetText);
  const parsed = usfmjs.toJSON(`\\v 1 ${tokenized}`, { chunk: true }) as unknown as {
    verses: { [n: string]: { verseObjects: Array<Record<string, unknown>> } };
  };
  const targetObjects = parsed.verses['1']?.verseObjects ?? [];
  const unmerged = wordaligner.unmerge(
    { verseObjects: targetObjects },
    { verseObjects: origVerseObjects },
  ) as unknown as { alignment?: unknown[]; alignments?: unknown[]; wordBank: unknown[] };
  const raw = (unmerged.alignment ?? unmerged.alignments ?? []) as Array<{
    topWords: unknown[];
    bottomWords: unknown[];
  }>;
  return {
    alignments: raw.map((a) => ({
      topWords: asWords(a.topWords),
      bottomWords: asWords(a.bottomWords),
    })),
    wordBank: asWords(unmerged.wordBank),
    invalid: false,
    targetVerseMd5: md5Hex(targetText),
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

/** Unlink a target word, returning it to the bank in its original position. */
export const unlinkWord = (
  record: AlignmentVerseRecord,
  alignmentIndex: number,
  word: AlignedWord,
): AlignmentVerseRecord => {
  const target = record.alignments[alignmentIndex];
  if (!target?.bottomWords.some((w) => sameWord(w, word))) return record;
  const returned = normalizeOccurrences(word);
  const bank = [...record.wordBank, returned].sort(
    (a, b) =>
      Number(a.occurrence) - Number(b.occurrence) || String(a.word).localeCompare(String(b.word)),
  );
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

/** Re-stamp the draft hash after the alignment is edited against a verse. */
export const stampTargetVerse = (
  record: AlignmentVerseRecord,
  targetText: string,
): AlignmentVerseRecord => ({ ...record, targetVerseMd5: md5Hex(targetText), invalid: false });

/** I-3: does this record still describe the verse as it now reads? */
export const alignmentIsStale = (record: AlignmentVerseRecord, targetText: string): boolean =>
  record.targetVerseMd5 !== md5Hex(targetText);

/** Every target word the verse has, linked or not — the aligner's full set. */
export const allTargetWords = (record: AlignmentVerseRecord): AlignedWord[] => [
  ...record.wordBank,
  ...record.alignments.flatMap((a: Alignment) => a.bottomWords),
];
