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
      if (vo.type === 'footnote' || vo.tag === 'f') continue;
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
      // Same content rule as verseText historically applied: a section node's
      // own text is dropped but its children are walked; any other node with
      // text contributes the text and its children are NOT walked.
      if (vo.text != null && vo.type !== 'section') {
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
 * A quote is contiguous in the ORIGIN text (\u0026-spans aside), and its
 * `occurrence` is verse-level for the whole quote. We cannot see origin word
 * order directly — only alignment groups in gateway order, each naming its
 * origin word INSTANCES (content + verse-level occurrence). So:
 *
 * 1. CANDIDATES — anchor at every group carrying the first quote word and
 *    greedy-match forward; a later word may sit in the SAME group (one zaln
 *    group often renders several quote words).
 * 2. CLASSES — candidates sharing ANY matched origin instance are the same
 *    occurrence of the quote (distinct occurrences use disjoint instances);
 *    within a class the TIGHTEST span is the real rendering. This is what
 *    kills the wrong-anchor match: en_tn TIT 2:2 "τῇ ἀγάπῃ" anchors at τῇ#1
 *    ("in faith") AND τῇ#2 ("in love"); both share ἀγάπῃ#1, and the τῇ#2
 *    candidate spans one group, so "in love" wins (2026-08-31 review R1).
 * 3. The N-th class in verse order is the N-th occurrence; fewer classes than
 *    N means NO match — fall back to per-word matching, exact when the note
 *    names a single word (2026-08-31 review R3: never return occurrence 1's
 *    words for occurrence 2).
 */
export const matchQuote = (
  tokens: SourceToken[],
  quote: Array<{ word: string }> | string,
  occurrence: number,
): Set<number> => {
  const words = quoteToWords(quote);
  const hits = new Set<number>();
  if (words.length === 0) return hits;
  const groups = groupInstances(tokens);

  const instancesOf = (g: GroupInstance, word: string): string[] =>
    g.orig.filter((o) => normalizeWord(o.content) === word).map((o) => `${o.content}#${o.occurrence}`);

  interface Cand {
    picked: number[];
    instances: Set<string>;
    span: number;
  }
  const cands: Cand[] = [];
  for (let start = 0; start < groups.length; start++) {
    if (!groupHas(groups[start], words[0])) continue;
    const picked = [start];
    let at = start;
    let complete = true;
    for (let w = 1; w < words.length; w++) {
      let next = -1;
      for (let j = at; j < groups.length; j++) {
        if (groupHas(groups[j], words[w])) {
          next = j;
          break;
        }
      }
      if (next === -1) {
        complete = false;
        break;
      }
      picked.push(next);
      at = next;
    }
    if (!complete) continue;
    const instances = new Set(picked.flatMap((g, i) => instancesOf(groups[g], words[i])));
    cands.push({ picked, instances, span: picked[picked.length - 1] - picked[0] });
  }

  // Classes in verse order; a candidate joins the first class it shares an
  // instance with, and the tightest candidate represents the class.
  const classes: Cand[][] = [];
  for (const c of cands) {
    const cls = classes.find((k) => k.some((m) => [...m.instances].some((i) => c.instances.has(i))));
    if (cls) cls.push(c);
    else classes.push([c]);
  }
  const want = Math.max(1, Number(occurrence) || 1);
  const cls = classes[want - 1];
  if (cls) {
    const best = cls.reduce((a, b) => (b.span < a.span ? b : a));
    // Expand each matched instance to EVERY group naming it: one origin word
    // is often rendered by several gateway groups (en_ult TIT 1:1 carries
    // ἐκλεκτῶν#1 twice — "of" and "the chosen people") and the quote covers
    // the whole rendering.
    groups.forEach((g) => {
      if (g.orig.some((o) => best.instances.has(`${o.content}#${o.occurrence}`)))
        g.tokenIdxs.forEach((i) => hits.add(i));
    });
    return hits;
  }

  // Fallback: no such occurrence of the whole quote. A single-word quote
  // still resolves exactly through the zaln verse-level occurrence attribute;
  // a multi-word one degrades to content matching (visible, never invented).
  const exactOcc = words.length === 1 ? want : undefined;
  groups.forEach((g) => {
    if (words.some((w) => groupHas(g, w, exactOcc))) g.tokenIdxs.forEach((i) => hits.add(i));
  });
  return hits;
};

/** The GATEWAY-language rendering of a quote — the words matchQuote resolves,
 * joined in verse order, with an ellipsis where the quote is discontinuous.
 * The shipped TSV7 helps carry only the original-language quote (the TSV9
 * GLQuote column is gone), so the gateway text the user reads is DERIVED from
 * the alignment, exactly like the highlight. Null when nothing resolves —
 * callers fall back to the original-language quoteString. */
export const gatewayQuote = (
  tokens: SourceToken[],
  quote: Array<{ word: string }> | string,
  occurrence: number,
): string | null => {
  const hits = matchQuote(tokens, quote, occurrence);
  if (hits.size === 0) return null;
  const parts: string[] = [];
  let sawGap = false;
  tokens.forEach((tok, i) => {
    if (!tok.word) return;
    if (hits.has(i)) {
      if (sawGap && parts.length > 0) parts.push('…');
      parts.push(tok.text);
      sawGap = false;
    } else {
      sawGap = true;
    }
  });
  return parts.join(' ');
};
