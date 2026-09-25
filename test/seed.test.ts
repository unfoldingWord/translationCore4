// Seeding: structure from the pinned source, stub bodies, no forbidden markers
// (INCREMENT-1 pre-chunked promise; D14; I-1; PLATFORM-NOTES #19).
import { describe, it, expect } from 'vitest';
import { seedBookFromSource } from '../src/data/seed';
import { indexBook } from '../src/data/usfm/indexer';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
// The test/ folder, from the repository root (the Vitest cwd). A URL pathname
// is not a file path: on Windows it gives /C:/... (#404).
const HERE = path.resolve(process.cwd(), 'test');
const ULT_TIT = fs.readFileSync(path.join(HERE, 'fixtures', 'en_ult', 'TIT.usfm'), 'utf8');

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
});
