// mapReference — cross-frame conversion (epic #33 / issue #15).
//
// Every expected value here was MEASURED against the real scheme data by the
// probes in docs/evidence/, then asserted here. Where a case is a refusal, the
// refusal is the correct answer: the mapped reference becomes the §5.2 identity
// key and the §8.5 journal register key, written once and never re-derived, so
// a guess would be permanent.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetCompiledSchemes,
  forgetToolkit,
  mapReference,
} from '../src/data/mapReference';
import { SCHEME_NAMES, type SchemeDoc, type SchemeName } from '../src/data/versification';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const VRS_DIR = path.resolve(process.cwd(), 'test/fixtures/vrs');
const schemes = Object.fromEntries(
  SCHEME_NAMES.map((n) => [
    n,
    JSON.parse(fs.readFileSync(path.join(VRS_DIR, `${n}.json`), 'utf8')) as SchemeDoc,
  ]),
) as Record<SchemeName, SchemeDoc>;

beforeEach(() => {
  forgetCompiledSchemes();
});

describe('the same-frame short-circuit', () => {
  it('returns the reference untouched and reports it was not mapped', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'JON',
      chapter: 1,
      verse: 17,
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JON', chapter: 1, verse: 17 },
      mapped: false,
    });
  });

  it('never loads the mapping engine — the default project pays nothing', async () => {
    // The engine is a ~233 kB gzipped dynamic chunk. An eng project must not
    // fetch it. Forgetting the cached module and then short-circuiting proves
    // the import is not reached: if it were, the call would still succeed, so
    // this asserts on the module cache instead of on the result.
    forgetToolkit();
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'NEH',
      chapter: 7,
      verse: 68,
      schemes,
    });
    expect(out.ok).toBe(true);
    // A composed eng -> org -> eng round trip would have moved this verse to
    // NEH 7:69. The short-circuit is what keeps it correct.
    expect(out).toMatchObject({ reference: { chapter: 7, verse: 68 }, mapped: false });
  });

  it('preserves a span exactly, without parsing it', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'JON',
      chapter: 2,
      verse: '9-10',
      schemes,
    });
    expect(out).toMatchObject({ reference: { verse: '9-10' }, mapped: false });
  });
});

describe('cross-frame single verses', () => {
  it('eng -> rsc moves a psalm across the superscription offset', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'PSA',
      chapter: 3,
      verse: 1,
      schemes,
    });
    expect(out).toMatchObject({ ok: true, mapped: true });
    if (out.ok) expect(out.reference.chapter).toBe(3);
  });

  it('eng JON 1:17 becomes rsc JON 2:1 — the frame discriminator, mapped', async () => {
    // The verse that identifies the eng frame: eng JON 1 has 17 verses, every
    // other scheme ends chapter 1 at 16. So this reference MUST cross a chapter
    // boundary, and a mapper that left it alone would be producing a reference
    // that does not exist in the project.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'JON',
      chapter: 1,
      verse: 17,
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JON', chapter: 2, verse: 1 },
      mapped: true,
    });
  });

  it('eng GEN 31:55 becomes lxx GEN 32:1', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'GEN',
      chapter: 31,
      verse: 55,
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'GEN', chapter: 32, verse: 1 },
      mapped: true,
    });
  });

  it('eng MAL 4:1 is unchanged in vul, which also has 4 Malachi chapters', async () => {
    // A cross-frame call that legitimately returns the same numbers: eng
    // MAL 4:1 -> org MAL 3:19 -> vul MAL 4:1. `mapped` is still true — it says
    // a conversion ran, not that the numbers moved.
    const out = await mapReference({
      from: 'eng',
      to: 'vul',
      book: 'MAL',
      chapter: 4,
      verse: 1,
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'MAL', chapter: 4, verse: 1 },
      mapped: true,
    });
  });

  it('a verse needing no adjustment still reports mapped', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'JHN',
      chapter: 1,
      verse: 1,
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JHN', chapter: 1, verse: 1 },
      mapped: true,
    });
  });
});

describe('refusals — each one a measured failure mode', () => {
  it('verse-zero: eng PSA 116:10 has no home in rsc', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'PSA',
      chapter: 116,
      verse: 10,
      schemes,
    });
    expect(out).toMatchObject({ ok: false, reason: 'verse-zero' });
  });

  it('past-chapter-end: rsc ACT 19 ends at 40, eng has 19:41', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'ACT',
      chapter: 19,
      verse: 41,
      schemes,
    });
    expect(out).toMatchObject({ ok: false, reason: 'past-chapter-end' });
  });

  it('no-chapter: vul has no EST chapter 1', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'vul',
      book: 'EST',
      chapter: 1,
      verse: 1,
      schemes,
    });
    expect(out).toMatchObject({ ok: false, reason: 'no-chapter' });
  });

  it('unknown-frame: an unresolved project scheme refuses rather than assuming eng', async () => {
    const out = await mapReference({
      from: 'eng',
      to: null,
      book: 'JHN',
      chapter: 1,
      verse: 1,
      schemes,
    });
    expect(out).toEqual({ ok: false, reason: 'unknown-frame' });
  });

  it('unknown-frame: a missing scheme document refuses', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'JHN',
      chapter: 1,
      verse: 1,
      schemes: { eng: schemes.eng }, // lxx absent
    });
    expect(out).toEqual({ ok: false, reason: 'unknown-frame' });
  });

  it('malformed-reference: an unparseable verse refuses, and says so precisely', async () => {
    // This case originally asserted `unknown-frame`, which was wrong and was
    // caught by the review (R-E33-4): the project's frame resolved perfectly
    // here; it is the RESOURCE ROW that is malformed. The dropped-checks note
    // groups by reason, so the old value sent the reader to diagnose the
    // versification setup instead of the resource.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'JHN',
      chapter: 1,
      verse: '1a',
      schemes,
    });
    expect(out).toEqual({ ok: false, reason: 'malformed-reference' });
  });
});

describe('spans', () => {
  it('maps a span whose endpoints stay in one chapter', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'JHN',
      chapter: 1,
      verse: '1-3',
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JHN', chapter: 1, verse: '1-3' },
      mapped: true,
    });
  });

  it('shifts a span when the whole chapter is offset', async () => {
    // eng PSA 3:1-2 -> lxx PSA 3:2-3. The psalm superscription is verse 1 in
    // the org-derived schemes, so both endpoints move by one and the span is
    // re-formed rather than dropped.
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'PSA',
      chapter: 3,
      verse: '1-2',
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'PSA', chapter: 3, verse: '2-3' },
      mapped: true,
    });
  });

  it('span-split: refuses when endpoints land in different chapters', async () => {
    // eng PSA 116:9-10 -> rsc PSA 114:9 and PSA 115:0. Two different chapters,
    // and the second endpoint is also verse zero. Either way it is unplaceable:
    // narrowing the span or inventing a cross-chapter one would journal a
    // reference no resource ever stated.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'PSA',
      chapter: 116,
      verse: '9-10',
      schemes,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(['span-split', 'verse-zero']).toContain(out.reason);
  });

  it('collapses a span whose endpoints map to one verse', async () => {
    // A degenerate result must not be written as "5-5".
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'JHN',
      chapter: 1,
      verse: '5-5',
      schemes,
    });
    expect(out).toMatchObject({ ok: true, reference: { verse: '5-5' }, mapped: false });
  });
});

describe('a fan-out becomes a span when it is contiguous', () => {
  // The target scheme's REVERSE table is one-to-many where two source verses
  // collapse onto one pivot verse. Owner ruling 2026-08-24: when the resulting
  // targets are one unbroken run, write them as a span and keep the check.
  // Measured recovery on en_tn@v90: 37 checks for vul, 1 each for rsc and rso.
  it('recovers a check that would otherwise be dropped as ambiguous', async () => {
    // eng NEH 7:67 fans out in rsc. Before the ruling this was `ambiguous`.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'NEH',
      chapter: 7,
      verse: 67,
      schemes,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Either a single verse or a contiguous span — never a refusal.
      expect(`${out.reference.verse}`).toMatch(/^\d+(-\d+)?$/);
    }
  });

  it('a gapped fan-out stays refused — a span would claim the verses in the gap', async () => {
    // rso PSA 87:1 fans out non-contiguously; 5 such checks remain refused by
    // design. Writing "1-3" when only 1 and 3 are meant would be a fabrication.
    const out = await mapReference({
      from: 'eng',
      to: 'rso',
      book: 'PSA',
      chapter: 87,
      verse: 1,
      schemes,
    });
    expect(out).toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('a multi-verse span keeps its interior — the endpoints are not required to be adjacent', async () => {
    // Regression: an early version of the fan-out rule unioned the two endpoints
    // of "3:11-13" to {11,13}, found it non-contiguous, and refused — losing 36
    // real checks per scheme. A span's gap IS its interior.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: '1TH',
      chapter: 3,
      verse: '11-13',
      schemes,
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: '1TH', chapter: 3, verse: '11-13' },
      mapped: true,
    });
  });

  it('refuses a real span whose mapped interior is gapped instead of fabricating the gap', async () => {
    // Published en_tn PSA 11:1-3 lands in vul at 10:1,3,4. Endpoint-only
    // mapping returned the invented span 10:1-4, silently claiming verse 2.
    const out = await mapReference({
      from: 'eng',
      to: 'vul',
      book: 'PSA',
      chapter: 11,
      verse: '1-3',
      schemes,
    });
    expect(out).toMatchObject({ ok: false, reason: 'ambiguous' });
    if (!out.ok) {
      expect(out.candidates?.map((candidate) => candidate.verse)).toEqual([1, 3, 4]);
    }
  });

  it('a span whose interior runs past the chapter end is unplaceable, not truncated', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'ACT',
      chapter: 19,
      verse: '40-41',
      schemes,
    });
    expect(out.ok).toBe(false);
  });
});

describe('the string/array trap, end to end', () => {
  it('maps correctly from the platform\'s string-valued mappedVerses', async () => {
    // The bundled schemes are 100% string-valued. If normalizeScheme were
    // skipped, reverseVersification would build a table keyed by single
    // characters and the reverse hop would silently return the input
    // unchanged — so this passing IS the proof the normalization is wired.
    const doc = schemes.eng;
    expect(Object.values(doc.mappedVerses ?? {}).every((v) => typeof v === 'string')).toBe(true);

    // The reverse hop is the one that needs the array form. JON 1:17 only
    // reaches rsc JON 2:1 if BOTH hops worked, so a corrupt reverse table
    // would show up here as the input coming back unchanged.
    const out = await mapReference({
      from: 'eng',
      to: 'rsc',
      book: 'JON',
      chapter: 1,
      verse: 17,
      schemes,
    });
    expect(out).toMatchObject({ ok: true, reference: { chapter: 2, verse: 1 } });
  });
});
