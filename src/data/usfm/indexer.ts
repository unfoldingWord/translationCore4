// Verse-range indexer — pure functions over the RAW whole-book USFM string
// (arch §7.2, checklist C1a.2). The editor holds the book as a raw string;
// usfm-js provides structure for rendering only and NEVER re-serializes (D8/AD-1).
// This module therefore works on the raw string alone.
//
// A verse BODY is the editable text after `\v <key> ` up to the next line-start
// marker that ends a body: the next `\v`, `\c`, or a paragraph-level marker line.
// Inline markup that USFM permits inside verse text (`\w`, `\zaln-s/-e`, `\f`,
// `\k`, `\add`, …) belongs to the body even when it starts a line — aligned
// tC3-imported drafts put `\zaln-s`/`\w` at line starts (T7). Trailing line
// terminators before the next marker stay OUTSIDE the body, so a splice can
// never eat the line structure around a verse.

export interface VerseEntry {
  /** Exact `\c` token, e.g. "1". Compared as a string. */
  chapter: string;
  /** Exact `\v` token. Span verses keep the exact span string ("9-10") —
   * readers and writers MUST NOT coerce with Number() (BURRITO-SPEC §4.1). */
  verseKey: string;
  /** Char range [start, end) of the verse body in the raw book string. */
  start: number;
  end: number;
}

// Paragraph-level base tags (USFM 3.0): identification, headings, titles,
// intro material, paragraphs, poetry, lists, tables. A line-start marker whose
// digit-stripped tag is in this set ends the current verse body. `ts` (the
// translator's-section milestone, `\ts\*`) is included on purpose: it is
// presentation grouping, never verse text (D14), so it stays outside editable
// ranges. Unknown tags fall through as INLINE (body content) — the paragraph
// set is closed in USFM, while inline/custom (z-namespace) markers are not.
const BODY_ENDING_TAGS = new Set([
  // identification + headers
  'id',
  'usfm',
  'ide',
  'sts',
  'rem',
  'h',
  'toc',
  'toca',
  // introductions
  'imt',
  'is',
  'ip',
  'ipi',
  'im',
  'imi',
  'ipq',
  'imq',
  'ipr',
  'iq',
  'ib',
  'ili',
  'iot',
  'io',
  'ior',
  'iex',
  'imte',
  'ie',
  // titles / sections
  'mt',
  'mte',
  'cl',
  'cd',
  'ms',
  'mr',
  's',
  'sr',
  'r',
  'd',
  'sp',
  'sd',
  // chapter presentation
  'cp',
  'pb',
  // paragraphs
  'p',
  'm',
  'po',
  'pr',
  'cls',
  'pmo',
  'pm',
  'pmc',
  'pmr',
  'pi',
  'mi',
  'nb',
  'pc',
  'ph',
  'b',
  'lit',
  // poetry
  'q',
  'qr',
  'qc',
  'qa',
  'qm',
  'qd',
  // lists
  'lh',
  'li',
  'lf',
  'lim',
  // tables
  'tr',
  'th',
  'thr',
  'tc',
  'tcr',
  // sidebars + translator's-section milestones
  'esb',
  'esbe',
  'ts',
  'ts-s',
  'ts-e',
]);

// A line-start marker tag: optional `+` (nested), letters first, then letters/
// digits/hyphens (milestones like `zaln-s`). `\v` and `\c` match here too and
// are handled before the set lookup.
const LINE_MARKER = /^\\\+?([a-z][a-z0-9-]*)/i;

/** Digit-stripped tag: q1→q, pi2→pi, toc1→toc, imt2→imt. Hyphenated milestone
 * tags keep their suffix (zaln-s stays zaln-s). */
const baseTag = (tag: string): string => (tag.includes('-') ? tag : tag.replace(/\d+$/, ''));

const endsBody = (tag: string): boolean => BODY_ENDING_TAGS.has(baseTag(tag.toLowerCase()));

/** Walk back over line terminators so trailing `\n`/`\r\n` (and blank lines
 * before the next marker) stay outside the body range. */
const trimLineBreaksBack = (raw: string, from: number, floor: number): number => {
  let end = from;
  while (end > floor && (raw[end - 1] === '\n' || raw[end - 1] === '\r')) end -= 1;
  return end;
};

/**
 * Index a raw whole-book USFM string. Returns entries in document order.
 * A partial-book file (missing chapters/verses) is legal [D26]: only what is
 * present gets indexed — callers must not assume whole-book coverage. A `\v`
 * before any `\c` cannot be addressed by (chapter, verse) and is not indexed.
 */
export const indexBook = (rawBook: string): VerseEntry[] => {
  const entries: VerseEntry[] = [];
  let chapter: string | null = null;
  let open: {
    chapter: string;
    verseKey: string;
    start: number;
    /** Insertion point right after `\v <key>[ ]` on the marker line itself —
     * used when the body turns out empty, so an insert lands on the verse's
     * own line, not on the next marker's line. */
    markerEnd: number;
  } | null = null;

  const closeOpen = (boundary: number): void => {
    if (!open) return;
    let start = open.start;
    let end = Math.max(start, trimLineBreaksBack(rawBook, boundary, start));
    if (end === start && open.markerEnd < start) {
      // Empty body on a contentless `\v N` marker line. NOTE: with no trailing
      // space after the key, an insert here still touches the key (`\v 1NEW`)
      // — the platform never writes this shape (stubs are `\v N ___`,
      // BURRITO-SPEC §4.1); byte-identity is unaffected either way.
      start = open.markerEnd;
      end = start;
    }
    entries.push({ chapter: open.chapter, verseKey: open.verseKey, start, end });
    open = null;
  };

  let lineStart = 0;
  const len = rawBook.length;
  while (lineStart < len) {
    let lineEnd = rawBook.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;
    const line = rawBook.slice(lineStart, lineEnd);
    const m = LINE_MARKER.exec(line);
    if (m) {
      const tag = m[1];
      if (tag === 'v') {
        closeOpen(lineStart);
        // `\v` + whitespace + key token (exact string; spans like "9-10" stay intact).
        const vm = /^\\v[ \t]+(\S+)[ \t]?/.exec(line);
        if (vm && chapter !== null) {
          const markerEnd = lineStart + vm[0].length;
          let start = markerEnd;
          // Marker line with no same-line text (aligned drafts put the body on
          // the following lines): the body starts past the line terminator.
          if (rawBook.slice(start, lineEnd).trim() === '') start = Math.min(lineEnd + 1, len);
          open = { chapter, verseKey: vm[1], start, markerEnd };
        }
      } else if (tag === 'c') {
        closeOpen(lineStart);
        const cm = /^\\c[ \t]+(\S+)/.exec(line);
        chapter = cm ? cm[1] : chapter;
      } else if (endsBody(tag)) {
        closeOpen(lineStart);
      }
      // Any other line-start marker is inline verse content — the body continues.
    }
    lineStart = lineEnd + 1;
  }
  closeOpen(len);
  return entries;
};

/**
 * Exact lookup. `chapter` accepts number for caller convenience (`String()` on
 * a chapter number is lossless); `verseKey` is an exact string and is never
 * coerced — `findVerse(entries, 2, "9")` does NOT match a "9-10" span.
 */
export const findVerse = (
  entries: readonly VerseEntry[],
  chapter: string | number,
  verseKey: string,
): VerseEntry | null => {
  const ch = String(chapter);
  return entries.find((e) => e.chapter === ch && e.verseKey === verseKey) ?? null;
};
