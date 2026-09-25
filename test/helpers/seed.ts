// Test oracle for the seeder (review finding B1): usfm-js reads the verse-key
// set, never the same reader that produced the seed.
import usfm from 'usfm-js';

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
