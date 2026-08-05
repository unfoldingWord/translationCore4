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
import usfm from 'usfm-js';

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
  bookName: string; // display name for \h/\toc/\mt
  projectName: string;
}

/** Build a stub target book from the source book's raw USFM. */
export function seedBookFromSource(sourceRaw: string, params: SeedParams): string {
  const { bookCode, bookName, projectName } = params;
  const out: string[] = [
    `\\id ${bookCode} ${projectName}`,
    '\\usfm 3.0',
    `\\ide UTF-8`,
    `\\h ${bookName}`,
    `\\toc1 ${bookName}`,
    `\\toc2 ${bookName}`,
    `\\toc3 ${bookCode}`,
    `\\mt ${bookName}`,
  ];
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
  if (!sawContent) throw new Error(`source for ${bookCode} has no \\c/\\v structure`);
  return out.join('\n') + '\n';
}

/** Sanity check a seeded book against its source, using usfm-js as an
 * INDEPENDENT oracle for the verse-key set (never the same reader that
 * produced the seed). */
export function seedMatchesSource(seeded: string, sourceRaw: string): boolean {
  const keys = (raw: string): string[] => {
    const chapters = (usfm.toJSON(raw).chapters ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const list: string[] = [];
    for (const c of Object.keys(chapters).sort((a, b) => Number(a) - Number(b))) {
      for (const v of Object.keys(chapters[c])) {
        if (/^\d/.test(v)) list.push(`${c}:${v}`);
      }
    }
    return list.sort();
  };
  const a = keys(seeded);
  const b = keys(sourceRaw);
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return false;
  if (/\\(zaln|ts\b|ts-s|ts-e|w )/.test(seeded)) return false;
  // every stub body is exactly ___ (line shape is \v KEY ___ or \d ___)
  return seeded
    .split('\n')
    .filter((l) => l.startsWith('\\v ') || l.startsWith('\\d'))
    .every((l) => l.endsWith(' ___'));
}
