// articles.ts — read the help article behind one check item (C2.5).
//
// Two shapes, both read from the INSTALLED burrito (never the network):
//   * tW: `payload/<category>/<slug>.md` inside `<lang>_tw` — the same repo the
//     TWL links came from (D34), and the links point at exactly this path.
//   * tA: `<section>/<slug>/01.md` + `title.md` inside `<lang>_ta`. The section
//     is not carried on the check item, so it is probed in order.
//
// PLATFORM-NOTES #12: a tN groupId is a tA module slug, and the human title lives in
// the module's own `title.md`. That file is authoritative and per-article, so
// it is used directly rather than parsing `toc.yaml` — which carries the same
// titles but needs a YAML parser and section walking to reach them.
import type { ServerApi } from './serverApi';

/** tA sections, in the order a module is most likely to be found. */
export const TA_SECTIONS = ['translate', 'checking', 'process', 'intro'] as const;

export interface Article {
  title: string;
  body: string;
  /** Where it was found, for the "could not find" message and for debugging. */
  ipath: string;
}

/** `readIngredient` resolves for a missing path on some builds, so treat a
 * platform error envelope as absence rather than trusting the status alone. */
const readOrNull = async (
  api: ServerApi,
  repoPath: string,
  ipath: string,
): Promise<string | null> => {
  // Round 35: null means CONFIRMED absent (a 404, or the platform's
  // is_good:false body). A transport or server failure PROPAGATES — the
  // callers state it as a retryable error, never as "this article does not
  // exist" (D30).
  try {
    const text = await api.readIngredient(repoPath, ipath);
    if (!text || text.startsWith('{"is_good":false')) return null;
    return text;
  } catch (error) {
    if ((error as { isNotFound?: boolean })?.isNotFound) return null;
    throw error;
  }
};

/** The tW article for a check item: category comes from the TWL link's own
 * path segment, so no guessing is involved. */
export const readTwArticle = async (
  api: ServerApi,
  twRepoPath: string,
  category: string,
  slug: string,
): Promise<Article | null> => {
  if (!category || !slug) return null;
  const ipath = `payload/${category}/${slug}.md`;
  const body = await readOrNull(api, twRepoPath, ipath);
  if (body === null) return null;
  // tW articles open with an H1 title line.
  const firstLine = body.split('\n', 1)[0] ?? '';
  const title = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '').trim() : slug;
  return { title, body, ipath };
};

/** The tA module for a tN check item's groupId. Probes the sections because
 * the item carries only the slug. Returns null when no section holds it —
 * a real case: en_tn v89 references modules the pinned tA release may not
 * carry, and the UI must say so rather than render an empty panel. */
export const readTaArticle = async (
  api: ServerApi,
  taRepoPath: string,
  slug: string,
): Promise<Article | null> => {
  if (!slug) return null;
  for (const section of TA_SECTIONS) {
    const body = await readOrNull(api, taRepoPath, `${section}/${slug}/01.md`);
    if (body === null) continue;
    const title = (await readOrNull(api, taRepoPath, `${section}/${slug}/title.md`))?.trim() || slug;
    return { title, body, ipath: `${section}/${slug}/01.md` };
  }
  return null;
};

/** One run of inline text. `text` carries no markdown marks. */
export interface ArticleSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ArticleBlock {
  kind: 'h' | 'p' | 'li';
  level?: number;
  /** The depth of the `>` quote that holds the block: 1 for `>`, 2 for `> >`. */
  quote?: number;
  /** The plain text of the block: the spans joined. */
  text: string;
  spans: ArticleSpan[];
}

// `__` and `_` open and close only at a word edge, so `figs_metaphor` stays literal.
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}_])';
const BOLD = new RegExp(`\\*\\*(?!\\s)(.+?)(?<!\\s)\\*\\*|${EDGE_BEFORE}__(?!\\s)(.+?)(?<!\\s)__${EDGE_AFTER}`, 'gu');
// The `*` of an `rc://*/…` link sits next to a `/`. It is a wildcard, not a mark.
// Nor is an escaped `\*`.
const ITALIC = new RegExp(`(?<![*\\\\])\\*(?![\\s*/])([^*]+?)(?<![\\s/])\\*(?!\\*)|${EDGE_BEFORE}_(?![\\s_])([^_]+?)(?<!\\s)_${EDGE_AFTER}`, 'gu');

/** Split a span at each match of `mark`; the matched part gets `style`. */
const splitSpans = (span: ArticleSpan, mark: RegExp, style: Partial<ArticleSpan>): ArticleSpan[] => {
  const out: ArticleSpan[] = [];
  let at = 0;
  for (const m of span.text.matchAll(mark)) {
    if (m.index > at) out.push({ ...span, text: span.text.slice(at, m.index) });
    out.push({ ...span, ...style, text: m[1] ?? m[2] });
    at = m.index + m[0].length;
  }
  if (at < span.text.length) out.push({ ...span, text: span.text.slice(at) });
  return out;
};

/** The first `length` characters of `spans`, with the style of each span kept. */
export const takeSpans = (spans: ArticleSpan[], length: number): ArticleSpan[] => {
  const out: ArticleSpan[] = [];
  let room = length;
  for (const span of spans) {
    if (room <= 0) break;
    out.push(span.text.length <= room ? span : { ...span, text: span.text.slice(0, room) });
    room -= span.text.length;
  }
  return out;
};

/** Minimal markdown rendering used by the article panels and the note cards.
 * Deliberately tiny: headings, list bullets, `>` quotes, bold, italics,
 * links-to-text. Anything else stays literal — better a plain line than a
 * wrong transform. */
export const renderArticleBlocks = (markdown: string): ArticleBlock[] => {
  const blocks: ArticleBlock[] = [];
  const inline = (s: string): Pick<ArticleBlock, 'text' | 'spans'> => {
    const plain = s
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\\n/g, ' ')
      // TSV notes carry literal "\n" escapes; collapsing runs keeps the result
      // readable prose rather than text pocked with double spaces.
      .replace(/\s+/g, ' ')
      .trim();
    const spans = splitSpans({ text: plain }, BOLD, { bold: true })
      .flatMap((span) => splitSpans(span, ITALIC, { italic: true }));
    return { text: spans.map((span) => span.text).join(''), spans };
  };
  for (const raw of markdown.split('\n')) {
    const marks = /^(?:>\s*)+/.exec(raw.trim())?.[0] ?? '';
    const quote = marks ? { quote: marks.replace(/\s/g, '').length } : {};
    const line = raw.trim().slice(marks.length);
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, ...quote, ...inline(heading[2]) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push({ kind: 'li', ...quote, ...inline(line.replace(/^[-*]\s+/, '')) });
      continue;
    }
    blocks.push({ kind: 'p', ...quote, ...inline(line) });
  }
  return blocks;
};
