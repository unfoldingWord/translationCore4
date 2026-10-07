// Client-side book seeding (INCREMENT-1 "a new book comes pre-chunked from the
// pinned source text"; PLATFORM-NOTES #19: the server skeleton has no structure).
// Derives a stub target book from the pinned SOURCE book's raw USFM: same
// chapters, same verse keys (spans preserved), same paragraph-level structure
// (\p, \q1, …) and \d superscription slots — but every verse body is the
// platform stub `___`, no source words, no \zaln/\w (I-1), and no \ts (D14:
// sections are presentation-only; the target never gains \ts).
//
// The walk is a MARKER STREAM over the raw text, not a line walk: real aligned
// corpora put `\v N` mid-line after a paragraph marker (`\q1 \v 3 \zaln-s …`)
// — 5,138 such lines across en_ult v89; a line-start-only reader silently
// drops those verses (review finding B1, 2026-07-30). usfm-js verse keys are
// the independent oracle in the tests.

const PARA_TAGS = new Set([
  'p', 'pi', 'pi1', 'pi2', 'pi3', 'q', 'q1', 'q2', 'q3', 'q4', 'qr', 'qc',
  'qm', 'qm1', 'qm2', 'qm3', 'qa', 'm', 'mi', 'b', 'nb', 'li', 'li1', 'li2',
  'li3', 'li4', 'lh', 'lf', 'lim', 'lim1', 'lim2', 'pc', 'ph', 'ph1', 'ph2',
  'po', 'pr', 'cls', 'pmo', 'pm', 'pmc', 'pmr',
]);

// Every backslash marker in document order. Group 1 = tag, group 2 = the
// number/span argument for \c and \v.
const MARKER_RE = /\\([a-z0-9]+)(?:\s+(\d+(?:-\d+)?))?/g;

export interface SeedParams {
  bookCode: string; // UPPERCASE USFM code, e.g. "TIT"
  bookName: string; // the English name: \h/\toc1/\toc2/\mt when the source names none
  projectName: string;
}

// #574 (D94, owner 2026-10-07): a new blank book writes the book NAME in \h,
// \toc1, \toc2 and \mt, and starts with \usfm 3.0. \toc3 stays the code.
const HEADER_TAGS = new Set(['usfm', 'ide', 'h', 'toc1', 'toc2', 'toc3', 'mt', 'mt1']);
const headerLines = (bookCode: string, bookName: string): string[] => [
  '\\usfm 3.0',
  '\\ide UTF-8',
  `\\h ${bookName}`,
  `\\toc1 ${bookName}`,
  `\\toc2 ${bookName}`,
  `\\toc3 ${bookCode}`,
  `\\mt ${bookName}`,
];

/** The text before the first chapter, where the book's identification lines live. */
const headerPart = (usfm: string): string => {
  const c = usfm.search(/^\\c\s/m);
  return c < 0 ? usfm : usfm.slice(0, c);
};

/** The book name a source book carries in its `\h` line (the gateway
 * language's name when the source is the gateway's Bible, e.g. "Tito" in
 * es-419_glt), or null when it has none. */
export function sourceBookName(sourceRaw: string): string | null {
  const m = headerPart(sourceRaw).match(/^\\h[ \t]+(.*\S)[ \t]*$/m);
  return m ? m[1] : null;
}

/** Rewrite a server skeleton's identification lines (`POST /git/new-scripture-book`
 * writes the bare code in \h, \toc1-3 and \mt, and no \usfm line) to the
 * blank-book header. The `\id` line, any other header line, and everything
 * from the first `\c` on are kept as they are. */
export function withBookHeader(usfm: string, params: { bookCode: string; bookName: string }): string {
  const head = headerPart(usfm);
  const body = usfm.slice(head.length);
  const lines = head.split(/\r?\n/).filter((l) => l.trim() !== '');
  const idAt = lines.findIndex((l) => /^\\id\s/.test(l));
  const id = idAt >= 0 ? lines[idAt] : `\\id ${params.bookCode}`;
  const others = lines.filter((l, i) => i !== idAt && !HEADER_TAGS.has(l.match(/^\\([a-z0-9]+)/)?.[1] ?? ''));
  return [id, ...headerLines(params.bookCode, params.bookName), ...others].join('\n') + '\n' + body;
}

/** Build a stub target book from the source book's raw USFM. The book name is
 * the source's own `\h` name, else `params.bookName` (#574). */
export function seedBookFromSource(sourceRaw: string, params: SeedParams): string {
  const { bookCode, projectName } = params;
  const bookName = sourceBookName(sourceRaw) ?? params.bookName;
  const out: string[] = [`\\id ${bookCode} ${projectName}`, ...headerLines(bookCode, bookName)];
  let pendingPara: string | null = null;
  let sawContent = false;
  for (const m of sourceRaw.matchAll(MARKER_RE)) {
    const tag = m[1];
    if (tag === 'c' && m[2]) {
      out.push(`\\c ${m[2]}`);
      pendingPara = null;
      sawContent = true;
    } else if (tag === 'v' && m[2]) {
      if (pendingPara) {
        out.push(pendingPara);
        pendingPara = null;
      }
      out.push(`\\v ${m[2]} ___`);
      sawContent = true;
    } else if (tag === 'd') {
      // Psalm superscription: translatable content — give it a stub slot.
      if (pendingPara) {
        out.push(pendingPara);
        pendingPara = null;
      }
      out.push('\\d ___');
    } else if (PARA_TAGS.has(tag)) {
      // Consecutive paragraph markers with no verse between them collapse to
      // the last one (the one that governs the next verse's placement).
      pendingPara = `\\${tag}`;
    }
    // every other marker (\zaln, \w, \f, \ts, headers, …) is dropped
  }
  if (!sawContent)
    // Review of the D30 sweep: this is a CONTENT verdict, not a transient
    // failure — callers may treat it as "source unusable for seeding" (the
    // documented server-skeleton state) without reopening catch-to-absence.
    throw Object.assign(new Error(`source for ${bookCode} has no \\c/\\v structure`), {
      seedUnusable: true,
    });
  return out.join('\n') + '\n';
}
