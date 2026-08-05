// Seeding: structure from the pinned source, stub bodies, no forbidden markers
// (INCREMENT-1 pre-chunked promise; D14; I-1; PLATFORM-NOTES #19).
import { describe, it, expect } from 'vitest';
import { seedBookFromSource, seedMatchesSource } from '../src/data/seed';
import { indexBook } from '../src/data/usfm/indexer';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ULT_TIT = fs.readFileSync(path.join(HERE, 'fixtures', 'en_ult', 'TIT.usfm'), 'utf8');
const UST_TIT = fs.readFileSync(path.join(HERE, 'fixtures', 'en_ust', 'TIT.usfm'), 'utf8');

describe('sortCanonical (owner 2026-07-31: canon order everywhere, not alphabetical)', () => {
  it('orders the platform-alphabetical list canonically', async () => {
    const { sortCanonical } = await import('../src/data/bookNames');
    expect(sortCanonical(['1CO', 'GEN', 'TIT', 'JON', 'MAT'])).toEqual([
      'GEN',
      'JON',
      'MAT',
      '1CO',
      'TIT',
    ]);
  });
});

describe('seedBookFromSource', () => {
  const seeded = seedBookFromSource(ULT_TIT, {
    bookCode: 'TIT',
    bookName: 'Titus',
    projectName: 'inc1 seed test',
  });

  it('keeps the source verse-key set exactly (spans included)', () => {
    const keys = (raw: string) => indexBook(raw).map((e) => `${e.chapter}:${e.verseKey}`);
    expect(keys(seeded)).toEqual(keys(ULT_TIT));
  });

  it('every verse body is the ___ stub', () => {
    for (const e of indexBook(seeded)) {
      expect(seeded.slice(e.start, e.end).trim()).toBe('___');
    }
  });

  it('carries no \\zaln, no \\w, no \\ts (I-1, D14)', () => {
    expect(seeded).not.toMatch(/\\zaln/);
    expect(seeded).not.toMatch(/\\w /);
    expect(seeded).not.toMatch(/\\ts/);
  });

  it('keeps chapter count and paragraph structure presence', () => {
    expect((seeded.match(/^\\c /gm) || []).length).toBe((ULT_TIT.match(/^\\c /gm) || []).length);
    expect(seeded).toMatch(/^\\p$/m);
  });

  it('seedMatchesSource accepts the seed and rejects a mutilated one', () => {
    expect(seedMatchesSource(seeded, ULT_TIT)).toBe(true);
    expect(seedMatchesSource(seeded.replace('\\v 3 ___', '\\v 3 words'), ULT_TIT)).toBe(false);
  });

  it('works for the UST source too', () => {
    const s = seedBookFromSource(UST_TIT, {
      bookCode: 'TIT',
      bookName: 'Titus',
      projectName: 'x',
    });
    expect(seedMatchesSource(s, UST_TIT)).toBe(true);
  });
});
