// C1a.3 property tests — the splice engine is THE ONLY mutation path for book
// text (arch §7.2 AD-1/AD-4). Byte-strict: every byte outside the replaced
// range identical (FR-7). Corpora as in indexer.test.ts.
import { describe, expect, it } from 'vitest';
import { indexBook } from '../src/data/usfm/indexer';
import { spliceSection, spliceVerse, verseBody, VerseNotFoundError } from '../src/data/usfm/splice';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Relative to the repo root (the Vitest cwd), as the S-0 suites do.
const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const corpora: Record<string, string> = {
  'sample TIT (plain draft)': read('test/fixtures/sample-burrito/TIT.usfm'),
  'sample JON (plain draft, span verse)': read('test/fixtures/sample-burrito/JON.usfm'),
  'en_ult TIT (aligned)': read('test/fixtures/en_ult/TIT.usfm'),
  'en_ust TIT (aligned)': read('test/fixtures/en_ust/TIT.usfm'),
};

const MARKER = 'XX_EDIT_XX';

describe('property 1 — identity: splicing a verse body back in changes nothing', () => {
  it.each(Object.entries(corpora))('%s', (_name, raw) => {
    for (const e of indexBook(raw)) {
      const body = verseBody(raw, e.chapter, e.verseKey);
      expect(body).not.toBeNull();
      const respliced = spliceVerse(raw, e.chapter, e.verseKey, body as string);
      // Whole-string equality — byte-strict (FR-7).
      expect(respliced === raw).toBe(true);
    }
  });
});

describe('property 2 — locality: an edit changes ONLY the indexed range', () => {
  it.each(Object.entries(corpora))('%s', (_name, raw) => {
    const entries = indexBook(raw);
    const originalBodies = new Map(
      entries.map((e) => [`${e.chapter}:${e.verseKey}`, raw.slice(e.start, e.end)]),
    );
    for (const e of entries) {
      const edited = spliceVerse(raw, e.chapter, e.verseKey, MARKER);
      // Bytes before start and after end are identical.
      expect(edited.slice(0, e.start) === raw.slice(0, e.start)).toBe(true);
      expect(edited.slice(e.start + MARKER.length) === raw.slice(e.end)).toBe(true);
      // Re-indexing finds the new body at the same verse key…
      expect(verseBody(edited, e.chapter, e.verseKey)).toBe(MARKER);
      // …and every OTHER verse body is byte-identical.
      const reindexed = indexBook(edited);
      expect(reindexed).toHaveLength(entries.length);
      for (const r of reindexed) {
        const key = `${r.chapter}:${r.verseKey}`;
        const expected = key === `${e.chapter}:${e.verseKey}` ? MARKER : originalBodies.get(key);
        expect(edited.slice(r.start, r.end)).toBe(expected);
      }
    }
  });
});

describe('property 3 — span keys are exact strings', () => {
  const jon = corpora['sample JON (plain draft, span verse)'];

  it('JON 2:9-10 round-trips under its exact span key', () => {
    const body = verseBody(jon, 2, '9-10');
    expect(body).toContain('La salvación viene de Jehová');
    const edited = spliceVerse(jon, 2, '9-10', 'nueva redacción del tramo');
    expect(edited).toContain('\\v 9-10 nueva redacción del tramo\n');
    expect(verseBody(edited, '2', '9-10')).toBe('nueva redacción del tramo');
    // Splicing the original body back restores the file byte-exactly.
    expect(spliceVerse(edited, 2, '9-10', body as string) === jon).toBe(true);
  });

  it('the span members are not addressable individually', () => {
    expect(verseBody(jon, 2, '9')).toBeNull();
    expect(() => spliceVerse(jon, 2, '9', 'x')).toThrow(VerseNotFoundError);
    expect(() => spliceVerse(jon, 2, '10', 'x')).toThrow(VerseNotFoundError);
  });

  it('Number-coercion regression: a NaN-ish key never resolves', () => {
    // Number("9-10") is NaN — the prototype fixtureStore bug class
    // (BURRITO-SPEC §4.1: readers/writers MUST NOT coerce verse keys).
    expect(() => spliceVerse(jon, 2, String(Number('9-10')), 'x')).toThrow(VerseNotFoundError);
  });
});

describe('property 5 — partial-book files (D26)', () => {
  const partial = [
    '\\id TST partial book — only chapter 2 present',
    '\\c 2',
    '\\p',
    '\\v 1 uno',
    '\\v 2 dos',
    '',
  ].join('\n');

  it('splice works on the chapter that is present', () => {
    const edited = spliceVerse(partial, 2, '1', 'UNO');
    expect(edited).toBe(partial.replace('\\v 1 uno', '\\v 1 UNO'));
    expect(verseBody(edited, 2, '2')).toBe('dos');
  });

  it('nothing assumes chapter 1 exists', () => {
    expect(verseBody(partial, 1, '1')).toBeNull();
    expect(() => spliceVerse(partial, 1, '1', 'x')).toThrow(VerseNotFoundError);
  });
});

describe('aligned-corpus splice — the tC3-imported leg of T7', () => {
  // Hand-made fixture leg: en_ult TIT stands in for a tC3-imported draft until
  // Increment 6 supplies the golden import fixture (checklist Phase-exit note).
  it('editing one verse inside en_ult TIT leaves every byte outside the verse unchanged', () => {
    const raw = corpora['en_ult TIT (aligned)'];
    const entries = indexBook(raw);
    const target = entries.find((e) => e.chapter === '2' && e.verseKey === '3');
    expect(target).toBeDefined();
    if (!target) return;
    const newBody = 'Older women likewise are to be reverent in behavior.';
    const edited = spliceVerse(raw, '2', '3', newBody);
    expect(edited.slice(0, target.start) === raw.slice(0, target.start)).toBe(true);
    expect(edited.slice(target.start + newBody.length) === raw.slice(target.end)).toBe(true);
    // The zaln markup of every other verse survives intact.
    const zalnCount = (s: string): number => s.split('\\zaln-s').length - 1;
    const zalnInOldBody = zalnCount(raw.slice(target.start, target.end));
    expect(zalnCount(edited)).toBe(zalnCount(raw) - zalnInOldBody);
    expect(zalnInOldBody).toBeGreaterThan(0);
    // 705 zaln-s in the corpus (test/fixtures/README.md provenance).
    expect(zalnCount(raw)).toBe(705);
  });
});

describe('verseBody reads', () => {
  it('returns the exact stub body for untranslated verses', () => {
    expect(verseBody(corpora['sample TIT (plain draft)'], 1, '6')).toBe('___');
  });

  it('returns null for a verse the book does not contain', () => {
    expect(verseBody(corpora['sample TIT (plain draft)'], 4, '1')).toBeNull();
    expect(verseBody(corpora['sample TIT (plain draft)'], 1, '17')).toBeNull();
  });
});

describe('VerseNotFoundError', () => {
  it('is a typed error carrying the failed address', () => {
    let caught: unknown = null;
    try {
      spliceVerse(corpora['sample TIT (plain draft)'], 9, '99', 'x');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerseNotFoundError);
    expect(caught).toBeInstanceOf(Error);
    const e = caught as VerseNotFoundError;
    expect(e.name).toBe('VerseNotFoundError');
    expect(e.chapter).toBe('9');
    expect(e.verseKey).toBe('99');
  });
});

// ---------------------------------------------------------------------------
// #63 — spliceSection: a verse span created or broken rewrites ONLY the verses
// that change, from the first to the last of them; every other byte stays.
// ---------------------------------------------------------------------------
describe('#63 — spliceSection', () => {
  const raw = ['\\id TST', '\\c 2', '\\p', '\\v 8 ocho', '\\v 9 ___', '\\v 10 ___', '\\v 11 once', ''].join('\n');

  it('creates a span: two stubs become one \\v 9-10 line, the rest byte-identical', () => {
    const out = spliceSection(raw, 2, ['9', '10'], [{ key: '9-10', body: 'nueve y diez' }]);
    expect(out).toBe(['\\id TST', '\\c 2', '\\p', '\\v 8 ocho', '\\v 9-10 nueve y diez', '\\v 11 once', ''].join('\n'));
  });

  it('breaks a span: one line becomes two; an empty body is the ___ stub', () => {
    const spanned = spliceSection(raw, 2, ['9', '10'], [{ key: '9-10', body: 'nueve y diez' }]);
    const out = spliceSection(spanned, 2, ['9-10'], [{ key: '9', body: 'nueve y diez' }, { key: '10', body: '' }]);
    expect(out).toBe(['\\id TST', '\\c 2', '\\p', '\\v 8 ocho', '\\v 9 nueve y diez', '\\v 10 ___', '\\v 11 once', ''].join('\n'));
  });

  it('rewrites only the changed verses of a longer section', () => {
    const out = spliceSection(raw, 2, ['8', '9', '10', '11'], [
      { key: '8', body: 'ocho' },
      { key: '9-10', body: 'nueve y diez' },
      { key: '11', body: 'once' },
    ]);
    // Verses 8 and 11 are untouched: their bytes were not rewritten at all.
    expect(out.slice(0, out.indexOf('\\v 9-10'))).toBe(raw.slice(0, raw.indexOf('\\v 9 ')));
    expect(out.slice(out.indexOf('\\v 11'))).toBe(raw.slice(raw.indexOf('\\v 11')));
    expect(out).toContain('\\v 9-10 nueve y diez\n\\v 11 once');
  });

  it('a section written back unchanged is the same string; an unknown key throws', () => {
    expect(spliceSection(raw, 2, ['9', '10'], [{ key: '9', body: '' }, { key: '10', body: '' }])).toBe(raw);
    expect(() => spliceSection(raw, 2, ['9', '12'], [{ key: '9-12', body: 'x' }])).toThrow(VerseNotFoundError);
  });

  it('the real corpora: a span create then break round-trips to the original bytes', () => {
    const tit = corpora['sample TIT (plain draft)'];
    const entries = indexBook(tit).filter((e) => e.chapter === '2');
    const [a, b] = [entries[3], entries[4]]; // two neighbouring verses of chapter 2
    const bodyA = verseBody(tit, '2', a.verseKey) as string;
    const bodyB = verseBody(tit, '2', b.verseKey) as string;
    const key = `${a.verseKey}-${b.verseKey}`;
    const spanned = spliceSection(tit, '2', [a.verseKey, b.verseKey], [{ key, body: `${bodyA} ${bodyB}` }]);
    expect(indexBook(spanned).some((e) => e.chapter === '2' && e.verseKey === key)).toBe(true);
    const back = spliceSection(spanned, '2', [key], [{ key: a.verseKey, body: bodyA }, { key: b.verseKey, body: bodyB }]);
    expect(back).toBe(tit);
  });
});
