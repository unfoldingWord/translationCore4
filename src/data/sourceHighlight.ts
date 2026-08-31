// Quote → source-word highlighting (epic #104 fidelity, F3 2026-08-31).
//
// The gateway source panes (ULT/UST) are aligned USFM: usfm-js parses each
// verse into verseObjects where every gateway word sits inside one or more
// \zaln milestones, and each milestone names the original-language word it
// renders — `content` plus the word's VERSE-LEVEL `occurrence`/`occurrences`
// [VERIFIED — en_ult v89 TIT 1:1 parse, 2026-08-31]. A helps item (tN note,
// TWL word) carries its origin quote and occurrence (derive.ts §5.2). This
// module turns a verse into display tokens and resolves a quote to the token
// indices to highlight. Display only — nothing here is ever re-serialized.

export interface SourceToken {
  /** Display text, exactly as the USFM carries it. */
  text: string;
  /** True for a gateway word (highlightable); false for bare text/punctuation. */
  word: boolean;
  /** Original-language words the enclosing zaln stack aligns this word to. */
  orig: Array<{ content: string; occurrence: number }>;
}

interface VerseObject {
  type?: string;
  tag?: string;
  text?: string;
  content?: string;
  occurrence?: string | number;
  children?: VerseObject[];
  [key: string]: unknown;
}

/** Tokenize one verse's verseObjects for display. Footnotes and section
 * markers are dropped — the same content rule as verseText.js, so the token
 * stream reads identically to the plain flatten. */
export const tokenizeVerse = (vObj?: { verseObjects?: VerseObject[] }): SourceToken[] => {
  const out: SourceToken[] = [];
  const walk = (vos: VerseObject[], stack: SourceToken['orig']) => {
    for (const vo of vos) {
      if (vo.type === 'footnote' || vo.tag === 'f' || vo.type === 'section') continue;
      if (vo.tag === 'zaln' && vo.type === 'milestone') {
        const ref =
          vo.content != null
            ? [...stack, { content: String(vo.content), occurrence: Number(vo.occurrence ?? 0) }]
            : stack;
        walk(vo.children ?? [], ref);
        continue;
      }
      if (vo.type === 'word') {
        out.push({ text: vo.text ?? '', word: true, orig: stack });
        continue;
      }
      if (vo.text != null) {
        out.push({ text: vo.text, word: false, orig: [] });
        continue;
      }
      if (vo.children) walk(vo.children, stack);
    }
  };
  walk(vObj?.verseObjects ?? [], []);
  return out;
};

/** Plain display text of a token stream — byte-for-byte what the spans render. */
export const tokensText = (tokens: SourceToken[]): string => tokens.map((t) => t.text).join('');

// A quote word from either helps shape: tN quotes are word arrays
// (TnQuoteWord), TWL OrigWords is a plain string. "&" separates discontinuous
// spans in both and is never a word (derive.ts tnQuoteWords).
const normalizeWord = (w: string): string =>
  w
    .normalize('NFC')
    // Strip punctuation the TSV quote carries but the zaln `content` never
    // does (e.g. "Θεοῦ," in en_tn TIT 1:1) — edges only, the word is kept.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export const quoteToWords = (quote: Array<{ word: string }> | string): string[] =>
  (Array.isArray(quote) ? quote.map((q) => q.word) : String(quote).split(/\s+/))
    .filter((w) => w !== '' && w !== '&' && w !== '…')
    .map(normalizeWord)
    .filter((w) => w !== '');

/** One zaln group instance in gateway order: the orig words it names and the
 * word-token indices it covers. Consecutive word tokens with an identical
 * orig stack belong to one instance. */
interface GroupInstance {
  orig: SourceToken['orig'];
  tokenIdxs: number[];
}

const groupInstances = (tokens: SourceToken[]): GroupInstance[] => {
  const groups: GroupInstance[] = [];
  let prev: SourceToken['orig'] | null = null;
  tokens.forEach((tok, i) => {
    if (!tok.word || tok.orig.length === 0) {
      // Bare text between words does not break a group (spaces inside a
      // multi-word gateway phrase); a different alignment does.
      return;
    }
    if (prev !== null && tok.orig === prev) {
      groups[groups.length - 1].tokenIdxs.push(i);
    } else {
      groups.push({ orig: tok.orig, tokenIdxs: [i] });
    }
    prev = tok.orig;
  });
  return groups;
};

const groupHas = (g: GroupInstance, word: string, occurrence?: number): boolean =>
  g.orig.some(
    (o) =>
      normalizeWord(o.content) === word && (occurrence == null || o.occurrence === occurrence),
  );

/** Resolve a quote to the token indices to highlight.
 *
 * The quote's `occurrence` is verse-level for the WHOLE quote. Alignment
 * groups appear in gateway word order, which for the aligned literal texts is
 * locally monotone with the origin — so the N-th greedy subsequence match of
 * the quote words over the groups is the N-th occurrence of the quote. This
 * resolves the real repeated-word case exactly (en_tn TIT 1:1 "κατὰ πίστιν
 * ἐκλεκτῶν Θεοῦ…": the verse has two Θεοῦ instances and the scan picks the
 * second, because it follows ἐκλεκτῶν). If no full subsequence match exists
 * (an unaligned word, a cross-verse quote), fall back to per-word matching —
 * exact when the note names a single word, content-wide otherwise. */
export const matchQuote = (
  tokens: SourceToken[],
  quote: Array<{ word: string }> | string,
  occurrence: number,
): Set<number> => {
  const words = quoteToWords(quote);
  const hits = new Set<number>();
  if (words.length === 0) return hits;
  const groups = groupInstances(tokens);

  // N-th greedy subsequence scan over group instances in gateway order.
  const want = Math.max(1, Number(occurrence) || 1);
  let found = 0;
  for (let start = 0; start < groups.length; start++) {
    if (!groupHas(groups[start], words[0])) continue;
    const picked = [start];
    let at = start;
    for (let w = 1; w < words.length; w++) {
      let next = -1;
      for (let j = at + 1; j < groups.length; j++) {
        if (groupHas(groups[j], words[w])) {
          next = j;
          break;
        }
      }
      if (next === -1) break;
      picked.push(next);
      at = next;
    }
    if (picked.length === words.length) {
      found += 1;
      if (found === want) {
        // Expand each picked group to every group naming the SAME orig word
        // instance: one origin word is often rendered by several gateway
        // groups (en_ult TIT 1:1 carries ἐκλεκτῶν#1 twice — "chosen" and
        // "people"), and the quote covers the whole rendering.
        const pairs = new Set(
          picked.flatMap((g) => groups[g].orig.map((o) => `${o.content}#${o.occurrence}`)),
        );
        groups.forEach((g) => {
          if (g.orig.some((o) => pairs.has(`${o.content}#${o.occurrence}`)))
            g.tokenIdxs.forEach((i) => hits.add(i));
        });
        return hits;
      }
      // Overlapping restarts are wrong for whole-quote occurrences: resume
      // after this match's first group.
    }
  }

  // Fallback: no full subsequence at that occurrence. A single-word quote
  // still resolves exactly through the zaln verse-level occurrence attribute;
  // a multi-word one degrades to content matching (visible, never invented).
  const exactOcc = words.length === 1 ? want : undefined;
  groups.forEach((g) => {
    if (words.some((w) => groupHas(g, w, exactOcc))) g.tokenIdxs.forEach((i) => hits.add(i));
  });
  return hits;
};

