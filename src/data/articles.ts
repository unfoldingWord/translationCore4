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
  try {
    const text = await api.readIngredient(repoPath, ipath);
    if (!text || text.startsWith('{"is_good":false')) return null;
    return text;
  } catch {
    return null;
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

/** Minimal markdown → HTML-ish plain rendering used by the article panel.
 * Deliberately tiny: headings, bold, italics, links-to-text, list bullets.
 * Anything else stays literal — better a plain line than a wrong transform. */
export const renderArticleBlocks = (
  markdown: string,
): Array<{ kind: 'h' | 'p' | 'li'; level?: number; text: string }> => {
  const blocks: Array<{ kind: 'h' | 'p' | 'li'; level?: number; text: string }> = [];
  const inline = (s: string) =>
    s
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .replace(/\\n/g, ' ')
      // TSV notes carry literal "\n" escapes; collapsing runs keeps the result
      // readable prose rather than text pocked with double spaces.
      .replace(/\s+/g, ' ')
      .trim();
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: inline(heading[2]) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push({ kind: 'li', text: inline(line.replace(/^[-*]\s+/, '')) });
      continue;
    }
    blocks.push({ kind: 'p', text: inline(line) });
  }
  return blocks;
};
