// versification.test.ts — epic #33 / issue #15.
//
// Every case here reproduces a MEASURED outcome, not a hypothetical. The
// numbers and examples come from the evidence records
// `docs/evidence/versification-format-and-frames-2026-08-24.md` and the probe
// scripts beside it.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEME,
  SCHEME_NAMES,
  canonicalizeScheme,
  isSchemeName,
  normalizeScheme,
  resolveProjectScheme,
  sameFrame,
  unplaceableReason,
  verseExists,
  type SchemeDoc,
  type SchemeName,
} from '../src/data/versification';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment, as test/indexer.test.ts records.
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// The platform's six bundled schemes, kept in-repo so this suite does not
// depend on a sibling dev-env checkout. Byte-identical to the upstream
// specification's standard mappings — see test/fixtures/vrs/README.md.
const VRS_DIR = path.resolve(process.cwd(), 'test/fixtures/vrs');
const load = (name: string): SchemeDoc =>
  JSON.parse(fs.readFileSync(path.join(VRS_DIR, `${name}.json`), 'utf8')) as SchemeDoc;
const schemes = Object.fromEntries(SCHEME_NAMES.map((n) => [n, load(n)])) as Record<
  SchemeName,
  SchemeDoc
>;

describe('scheme names', () => {
  it('knows the six the platform ships, and eng is the default', () => {
    expect([...SCHEME_NAMES]).toEqual(['eng', 'lxx', 'org', 'rsc', 'rso', 'vul']);
    expect(DEFAULT_SCHEME).toBe('eng');
  });

  it('rejects the store\'s "unrecorded" sentinel as a scheme name', () => {
    // resolveProjectScheme must fall through to fingerprinting for a project
    // tC4 did not create. It must not couple to the sentinel's exact spelling.
    expect(isSchemeName('unrecorded')).toBe(false);
    expect(isSchemeName('eng')).toBe(true);
    expect(isSchemeName('')).toBe(false);
  });
});

describe('normalizeScheme — the string/array trap', () => {
  it('coerces the platform\'s string form to the fork\'s array form', () => {
    const doc = {
      maxVerses: {},
      mappedVerses: { 'GEN 31:55': 'GEN 32:1', 'GEN 32:1-32': 'GEN 32:2-33' },
    } as SchemeDoc;
    expect(normalizeScheme(doc).mappedVerses).toEqual({
      'GEN 31:55': ['GEN 32:1'],
      'GEN 32:1-32': ['GEN 32:2-33'],
    });
  });

  it('leaves the fork\'s many-to-many array form alone', () => {
    const doc = {
      maxVerses: {},
      mappedVerses: { 'MAN 1:5': ['2CH 37:2', '2CH 37:3'] },
    } as SchemeDoc;
    expect(normalizeScheme(doc).mappedVerses).toEqual({ 'MAN 1:5': ['2CH 37:2', '2CH 37:3'] });
  });

  it('proves the corruption it prevents: iterating a string yields character keys', () => {
    // This is what proskomma's reverseVersification does to an un-normalized
    // value. It throws nothing, which is why normalization must be structural
    // rather than trusted to a caller remembering.
    const raw: string | string[] = 'GEN 32:1';
    const reversedRaw: Record<string, string[]> = {};
    for (const target of raw) (reversedRaw[target] ??= []).push('GEN 31:55');
    // Compared as a set: JS lists integer-like keys ("1", "2", "3") first, so
    // insertion order is not the point. The point is that the keys are the
    // string's CHARACTERS rather than the one reference it denotes.
    expect(new Set(Object.keys(reversedRaw))).toEqual(
      new Set(['G', 'E', 'N', ' ', '3', '2', ':', '1']),
    );

    const normalized = normalizeScheme({
      maxVerses: {},
      mappedVerses: { 'GEN 31:55': raw },
    } as SchemeDoc).mappedVerses!;
    const reversed: Record<string, string[]> = {};
    for (const [from, targets] of Object.entries(normalized))
      for (const target of targets as string[]) (reversed[target] ??= []).push(from);
    expect(reversed).toEqual({ 'GEN 32:1': ['GEN 31:55'] });
  });

  it('no bundled scheme uses the array form yet', () => {
    // The fork permits many-to-many; no shipped data exercises it. This test
    // is the tripwire for the day that changes.
    for (const name of SCHEME_NAMES) {
      const table = schemes[name].mappedVerses ?? {};
      expect(Object.values(table).filter(Array.isArray)).toEqual([]);
    }
  });
});

describe('canonicalizeScheme — identity is meaning, not bytes', () => {
  it('identifies a re-serialized scheme as the same scheme', () => {
    // A published Septuagint burrito carries `org` with alphabetical keys and
    // different whitespace. A byte comparison identifies neither it nor the
    // platform's copy; canonicalization must.
    const org = schemes.org;
    const reserialized = JSON.parse(
      JSON.stringify({
        excludedVerses: org.excludedVerses,
        mappedVerses: org.mappedVerses,
        maxVerses: org.maxVerses,
        partialVerses: org.partialVerses,
      }),
    ) as SchemeDoc;
    expect(JSON.stringify(reserialized)).not.toBe(JSON.stringify(org)); // bytes differ
    expect(canonicalizeScheme(reserialized)).toBe(canonicalizeScheme(org)); // meaning does not
  });

  it('keeps the six schemes distinct from one another', () => {
    const fingerprints = SCHEME_NAMES.map((n) => canonicalizeScheme(schemes[n]));
    expect(new Set(fingerprints).size).toBe(SCHEME_NAMES.length);
  });
});

describe('resolveProjectScheme — the source ladder', () => {
  it('rung 1: a recorded scheme name wins', () => {
    expect(resolveProjectScheme({ name: 'lxx', bytes: '{}' }, schemes)).toEqual({
      name: 'lxx',
      source: 'recorded',
    });
  });

  it('rung 2: fingerprints a project tC4 did not create', () => {
    const register = { name: 'unrecorded', bytes: JSON.stringify(schemes.rsc) };
    expect(resolveProjectScheme(register, schemes)).toEqual({
      name: 'rsc',
      source: 'fingerprint',
    });
  });

  it('rung 2 survives re-serialization', () => {
    const alphabetical = Object.fromEntries(
      Object.entries(schemes.org).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    const register = { name: 'unrecorded', bytes: JSON.stringify(alphabetical, null, 2) };
    expect(resolveProjectScheme(register, schemes)).toEqual({
      name: 'org',
      source: 'fingerprint',
    });
  });

  it('rung 3: an unknown scheme is unknown — never silently eng', () => {
    const register = { name: 'unrecorded', bytes: '{"maxVerses":{"GEN":["99"]}}' };
    expect(resolveProjectScheme(register, schemes)).toEqual({ name: null, source: 'unknown' });
  });

  it('rung 3: an absent register is unknown, not the default', () => {
    // Three of five sampled published burritos carry no versification
    // ingredient at all, and one that does is eng — so absence carries no
    // information and must not be read as eng.
    expect(resolveProjectScheme(null, schemes)).toEqual({ name: null, source: 'unknown' });
  });

  it('rung 3: unparseable bytes are unknown, not a throw', () => {
    expect(resolveProjectScheme({ name: 'unrecorded', bytes: 'not json' }, schemes)).toEqual({
      name: null,
      source: 'unknown',
    });
  });
});

describe('sameFrame — the short-circuit that protects the default project', () => {
  it('is true only for two known, equal frames', () => {
    expect(sameFrame('eng', 'eng')).toBe(true);
    expect(sameFrame('eng', 'rsc')).toBe(false);
    expect(sameFrame(null, null)).toBe(false); // unknown never short-circuits
    expect(sameFrame('eng', null)).toBe(false);
  });

  it('an eng project short-circuits away 3 real losses', () => {
    // Composing eng -> org -> eng loses NEH 7:68, PSA 13:6 and ISA 64:1. The
    // helps suite is entirely eng, so an eng project must not compose at all.
    expect(sameFrame('eng', 'eng')).toBe(true);
    for (const [book, chapter, verse] of [
      ['NEH', 7, 68],
      ['PSA', 13, 6],
      ['ISA', 64, 1],
    ] as const) {
      expect(verseExists(schemes.eng, book, chapter, verse)).toBe(true);
    }
  });
});

describe('unplaceableReason — measured failure modes', () => {
  it('verse zero: eng PSA 116:10 maps to rsc PSA 115:0', () => {
    expect(unplaceableReason(schemes.rsc, 'PSA', 115, 0)).toBe('verse-zero');
  });

  it('past chapter end: rsc ACT 19 ends at 40, eng has 19:41', () => {
    expect(verseExists(schemes.eng, 'ACT', 19, 41)).toBe(true);
    expect(unplaceableReason(schemes.rsc, 'ACT', 19, 41)).toBe('past-chapter-end');
  });

  it('no chapter: vul has no EST 1, eng does', () => {
    expect(verseExists(schemes.eng, 'EST', 1, 1)).toBe(true);
    expect(unplaceableReason(schemes.vul, 'EST', 1, 1)).toBe('no-chapter');
  });

  it('a placeable reference returns null', () => {
    expect(unplaceableReason(schemes.eng, 'JHN', 1, 1)).toBeNull();
    expect(unplaceableReason(schemes.eng, 'JON', 1, 17)).toBeNull();
  });

  it('JON 1:17 exists only in eng — the frame discriminator', () => {
    // The single-verse test that identified every gateway helps resource as eng.
    expect(verseExists(schemes.eng, 'JON', 1, 17)).toBe(true);
    for (const name of ['org', 'rsc', 'rso', 'vul', 'lxx'] as const) {
      expect(verseExists(schemes[name], 'JON', 1, 17)).toBe(false);
    }
  });

  it('is case-insensitive on the book code', () => {
    // §5.2 stores bookId lowercase ("tit") while scope/filenames use TIT.
    expect(unplaceableReason(schemes.eng, 'tit', 1, 1)).toBeNull();
  });
});


describe('a scheme this code has never heard of still resolves', () => {
  // The French LSG case: a text that follows eng but numbers psalm
  // superscriptions needs a seventh scheme, and none exists yet. When one is
  // authored, a project created against it MUST map normally. An earlier version
  // typed SchemeName as a closed union of the six, so such a project fell through
  // both ladder rungs and dropped EVERY check as `unknown-frame`. These cases
  // pin that it cannot happen again.
  const lsg: SchemeDoc = {
    // eng's psalm counts plus one for the superscription — the shape the real
    // gap would take. Only the two psalms needed for the assertions.
    maxVerses: { PSA: ['6', '12', '9'], JHN: ['51'] },
    mappedVerses: { 'PSA 3:1-9': 'PSA 3:0-8' },
    excludedVerses: [],
    partialVerses: {},
  };

  it('a recorded name outside the six is accepted, not rejected', () => {
    expect(isSchemeName('lsg')).toBe(true);
    expect(resolveProjectScheme({ name: 'lsg', bytes: '{}' }, { ...schemes, lsg })).toEqual({
      name: 'lsg',
      source: 'recorded',
    });
  });

  it('a seventh scheme fingerprints like any other', () => {
    const register = { name: 'unrecorded', bytes: JSON.stringify(lsg) };
    expect(resolveProjectScheme(register, { ...schemes, lsg })).toEqual({
      name: 'lsg',
      source: 'fingerprint',
    });
  });

  it('the placeholder is still rejected, so rung 2 keeps working', () => {
    expect(isSchemeName('unrecorded')).toBe(false);
    expect(isSchemeName('')).toBe(false);
  });

  it('verse bounds come from the scheme document, not from a built-in list', () => {
    // The whole point: nothing about a new scheme is hard-coded.
    expect(verseExists(lsg, 'PSA', 2, 12)).toBe(true);
    expect(verseExists(lsg, 'PSA', 2, 13)).toBe(false);
    expect(unplaceableReason(lsg, 'PSA', 2, 13)).toBe('past-chapter-end');
  });
});
