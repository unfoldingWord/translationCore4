// tokenize.ts — the ONE word split for alignment (#255, D72 point 3).
//
// Two sides of the app split a target verse into words: the alignment editor
// (bootstrap wordBank, I-2 occurrence numbering) and the bridge that feeds the
// suggestion engine (#1). The engine's `wordmap-lexer` calls
// `string-punctuation-tokenizer` 2.0.0 as `tokenize({ text, includePunctuation:
// false })` (Lexer.js:59) and numbers occurrences by exact token text. This
// module calls the SAME package at the SAME pinned version, so the two sides
// agree by construction rather than by two regexes happening to match. The
// agreement is asserted on real fixture verses by test/align-tokenize.test.ts.
//
// What the library treats as a word: runs of letters and marks, with U+200D
// (zero-width joiner) and U+2060 (word joiner) INSIDE a word — the Hebrew
// fixtures write וַֽ⁠יְהִי֙ with a joiner; the old regex split it in two — and
// runs of digits as a separate `number` token. Punctuation and whitespace are
// kept as separators so `tokenizeTargetVerse` can rebuild the verse around the
// `\w` markup. Characters the library classifies as neither (symbols, other
// format characters) are dropped from the token stream; that stream only ever
// feeds word identity and the bootstrap's throwaway `\w` string, never storage.
import { tokenize as sptTokenize } from 'string-punctuation-tokenizer';

export interface VerseToken {
  /** The token text exactly as it appears in the verse. */
  text: string;
  /** True for `word` and `number` tokens — the ones that carry alignment identity. */
  isWord: boolean;
  /** 1-based index of this word among identical word texts in the verse (words only). */
  occurrence?: number;
  /** Total count of this word text in the verse (words only). */
  occurrences?: number;
}

/**
 * Every token of a verse in order — words and numbers with I-2 occurrence
 * data, punctuation and whitespace as plain separators.
 */
export const tokenizeVerse = (text: string): VerseToken[] => {
  const typed = sptTokenize({
    text,
    includeWords: true,
    includeNumbers: true,
    includePunctuation: true,
    includeWhitespace: true,
    verbose: true,
  }) as Array<{ token: string; type: string }>;
  const totals: { [word: string]: number } = {};
  for (const t of typed) {
    if (t.type === 'word' || t.type === 'number') totals[t.token] = (totals[t.token] ?? 0) + 1;
  }
  const seen: { [word: string]: number } = {};
  return typed.map((t) => {
    if (t.type !== 'word' && t.type !== 'number') return { text: t.token, isWord: false };
    seen[t.token] = (seen[t.token] ?? 0) + 1;
    return { text: t.token, isWord: true, occurrence: seen[t.token], occurrences: totals[t.token] };
  });
};

/** The word tokens only — the sequence `wordmap-lexer` produces for the same verse. */
export const wordTokens = (text: string): Array<Required<VerseToken>> =>
  tokenizeVerse(text).filter((t): t is Required<VerseToken> => t.isWord);
