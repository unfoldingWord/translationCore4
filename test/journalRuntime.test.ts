// Runtime fold/materialization parity — issue #62 ("Provide a production
// fold/materialization library that shares or imports the reference conformance
// semantics. Do not maintain an independent untested interpretation. Run the
// runtime implementation against the same vectors as journal/.")
//
// src/data/journal/runtime.ts IMPORTS the reference modules, so the only way the
// two could diverge is the pipeline itself: the app bundle resolves the modules
// through vite (which aliases Node builtins to browser mocks), while the
// conformance suite runs them natively. This suite therefore executes the SAME
// vectors through BOTH pipelines and asserts identical output — the proof that
// the de-Node-ification of fold/checkpoint/reconcile (md5.mjs, static usfm-js,
// pure posix resolve) changed nothing observable.
import { describe, expect, it } from 'vitest';
import {
  classifyDivergence,
  decompose,
  derivedProjections,
  fold,
  recompose,
  reconcileUsfm,
  seedFromSidecars,
  slotKeysOf,
  verseTextMd5,
  type FoldOutput,
} from '../src/data/journal/runtime';
import type { JournalEvent } from '../src/data/journal/seal';
import { md5Hex as productMd5Hex } from '../src/data/httpStore';

// The NATIVE reference, loaded outside the vite pipeline (the same workaround as
// test/journalStore.test.ts: Node >=22 supports require of ESM).
const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
const refFold = nodeRequire('./journal/fold.mjs') as {
  fold(events: unknown[]): unknown;
  verseTextMd5(content: string): string;
};
const refCheckpoint = nodeRequire('./journal/checkpoint.mjs') as {
  derivedProjections(foldOut: unknown, opts: unknown): Record<string, string>;
};
const refReconcile = nodeRequire('./journal/reconcile.mjs') as {
  seedFromSidecars(inputs: unknown): unknown[];
  reconcileUsfm(...args: unknown[]): unknown[];
};
const refSkeleton = nodeRequire('./journal/skeleton.mjs') as {
  decompose(usfm: string): { skeleton: string; verses: Record<string, string> };
};
const refMd5 = nodeRequire('./journal/md5.mjs') as {
  md5Hex(text: string): string;
};

const ACTOR = 'a1234567890abcde';
let tick = 0;
const ts = (): string =>
  `2026-08-19T10:00:${String(10 + tick).padStart(2, '0')}.${String((tick += 1)).padStart(3, '0')}Z|0000|${ACTOR}`;

// A small book with non-ASCII content, so the md5 swap (node:crypto -> md5.mjs)
// and the usfm-js import swap are both exercised over multi-byte UTF-8.
const USFM = [
  '\\id TIT parity vector',
  '\\usfm 3.0',
  '\\h Tíite',
  '\\mt Tíite',
  '\\c 1',
  '\\p',
  '\\v 1 Pablo, siervo de Dios — δοῦλος Θεοῦ.',
  '\\v 2 ___',
  '\\c 2',
  '\\q1',
  '\\v 1 Pero tú enseña — ἃ πρέπει.',
  '',
].join('\n');

const vector = (): JournalEvent[] => {
  tick = 0;
  const { skeleton, verses } = decompose(USFM);
  const addTs = ts();
  const events: JournalEvent[] = [
    {
      v: 1, op: 'project.vrs.set', actor: ACTOR, ts: ts(), base: null,
      seed: { source: 'creation' }, name: 'eng', bytes: '{"maxVerses":{"TIT":["16"]}}',
    },
    { v: 1, op: 'book.add', actor: ACTOR, ts: addTs, base: null, book: 'TIT', scope: [], skeleton, initialVerses: verses },
    {
      v: 1, op: 'text.verse.set', actor: ACTOR, ts: ts(), base: addTs,
      book: 'TIT', chapter: '1', verse: '2', text: 'Nueva línea — ἐπ᾽ ἐλπίδι.\n',
    },
    {
      v: 1, op: 'align.verse.set', actor: ACTOR, ts: ts(), base: null, generation: addTs,
      book: 'TIT', chapter: '1', verse: '1',
      alignments: [], wordBank: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }],
      targetVerseMd5: verseTextMd5('Pablo, siervo de Dios — δοῦλος Θεοῦ.'),
    },
    {
      v: 1, op: 'check.decision.set', actor: ACTOR, ts: ts(), base: null, generation: addTs,
      toolId: 'translationWords',
      decision: {
        contextId: {
          checkId: 'x1y2', occurrenceNote: '',
          reference: { bookId: 'tit', chapter: 1, verse: 1 },
          tool: 'translationWords', groupId: 'god', quote: 'Θεοῦ', quoteString: 'Θεοῦ',
          glQuote: '', occurrence: 1,
        },
        category: 'kt', selections: false, comments: false, reminders: false,
        nothingToSelect: false, verseEdits: false, invalidated: false,
        modifiedTimestamp: '2026-08-19T10:00:00.000Z',
      },
    },
    {
      v: 1, op: 'resource.pin.set', actor: ACTOR, ts: ts(), base: null,
      slot: 'languageSets.primary.translationNotes',
      entry: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: 'c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5', flavor: 'parascriptural/x-bcvnotes' },
    },
    {
      v: 1, op: 'resource.pin.set', actor: ACTOR, ts: ts(), base: null,
      slot: 'languageSets.fallback.translationNotes',
      entry: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: 'c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5', flavor: 'parascriptural/x-bcvnotes' },
    },
    { v: 1, op: 'settings.set', actor: ACTOR, ts: ts(), base: null, path: 'textDirection', value: 'ltr' },
  ];
  return events;
};

const BASE_METADATA = {
  format: 'scripture burrito',
  meta: { category: 'source' },
  type: { flavorType: { name: 'scripture', currentScope: {} } },
  ingredients: {},
};
const RESOLUTIONS = {
  translationWords: {
    TIT: { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', languageSet: 'fallback' },
  },
};

describe('#62 runtime fold parity — the vite-pipeline import equals the native reference', () => {
  it('verseTextMd5 agrees over multi-byte UTF-8 (the node:crypto -> md5.mjs swap)', () => {
    for (const s of ['', 'plain', 'Pablo — δοῦλος Θεοῦ. ᾽ ῦ', '“quotes” and é vs é']) {
      expect(verseTextMd5(s)).toBe(refFold.verseTextMd5(s));
    }
  });

  // Known answers, not just parity: a bug SHARED by both md5 implementations
  // would pass the parity checks above. The RFC 1321 A.5 test suite plus one
  // multi-byte UTF-8 vector (built from code points so no source-encoding or
  // NFC ambiguity can change the bytes; expected digest derived independently
  // with node:crypto and /sbin/md5, 2026-08-22) pin the algorithm itself.
  it('md5Hex reproduces the RFC 1321 known-answer vectors (both implementations)', () => {
    const MULTIBYTE = String.fromCodePoint(
      0x03b4, 0x03bf, 0x1fe6, 0x03bb, 0x03bf, 0x03c2, 0x20,
      0x0398, 0x03b5, 0x03bf, 0x1fe6, 0x20, 0x2014, 0x20,
      0x00e9, 0x20, 0x0065, 0x0301,
    );
    const VECTORS: Array<[string, string]> = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
      ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
      [MULTIBYTE, '12b4d4b6393d9b73aa8585b525e5a322'],
    ];
    for (const [input, digest] of VECTORS) {
      expect(refMd5.md5Hex(input), `md5.mjs over ${JSON.stringify(input)}`).toBe(digest);
      expect(productMd5Hex(input), `httpStore md5Hex over ${JSON.stringify(input)}`).toBe(digest);
    }
  });

  it('decompose/recompose agree and round-trip byte-identically (R-8.4.2)', () => {
    const mine = decompose(USFM);
    const ref = refSkeleton.decompose(USFM);
    expect(mine).toEqual(ref);
    expect(recompose(mine.skeleton, mine.verses)).toBe(USFM);
    expect(slotKeysOf(mine.skeleton)).toEqual(['1:1', '1:2', '2:1']);
  });

  it('fold agrees event-for-event on a vector covering every runtime-used surface', () => {
    const events = vector();
    const mine = fold(events);
    const ref = refFold.fold(JSON.parse(JSON.stringify(events)));
    expect(JSON.parse(JSON.stringify(mine))).toEqual(JSON.parse(JSON.stringify(ref)));
    expect(mine.books.TIT.verses['1:2']).toBe('Nueva línea — ἐπ᾽ ἐλπίδι.\n');
    expect(mine.invalid).toEqual([]); // the align hash was computed with the SAME extraction
  });

  it('derivedProjections agree byte-for-byte (the checkpoint posix-resolve swap)', () => {
    const events = vector();
    const mine = derivedProjections(fold(events), {
      baseMetadata: BASE_METADATA,
      resolutions: RESOLUTIONS,
    });
    const ref = refCheckpoint.derivedProjections(refFold.fold(JSON.parse(JSON.stringify(events))), {
      baseMetadata: BASE_METADATA,
      resolutions: RESOLUTIONS,
    });
    expect({ ...mine }).toEqual({ ...ref });
    expect(Object.keys(mine).sort()).toEqual([
      'TIT.usfm',
      'checking/alignments/TIT.json',
      'checking/resources.json',
      'checking/settings.json',
      'checking/translationWords/TIT.json',
      'metadata.json',
      'vrs.json',
    ]);
  });

  it('derivedProjections refuses a path-escaping projection key in BOTH pipelines (R-8.7.6)', () => {
    const foldOut = fold(vector());
    const poisoned = {
      ...foldOut,
      books: { ...foldOut.books, '../ESCAPE': foldOut.books.TIT },
    } as FoldOutput;
    expect(() =>
      derivedProjections(poisoned, { baseMetadata: BASE_METADATA, resolutions: RESOLUTIONS }),
    ).toThrow(/refuse to project/);
    expect(() =>
      refCheckpoint.derivedProjections(JSON.parse(JSON.stringify(poisoned)), {
        baseMetadata: BASE_METADATA,
        resolutions: RESOLUTIONS,
      }),
    ).toThrow(/refuse to project/);
  });

  it('classifyDivergence tolerates audio and reports a deleted derived file as divergence', () => {
    const projections = { 'TIT.usfm': 'x', 'checking/settings.json': 'y' };
    const disk = { 'TIT.usfm': 'x', 'audio/TIT-1.mp3': 'zzz' };
    const verdict = classifyDivergence(disk, projections);
    expect(verdict.clean).toEqual(['TIT.usfm']);
    expect(verdict.tolerated).toEqual(['audio/TIT-1.mp3']);
    expect(verdict.diverged).toEqual(['checking/settings.json']);
  });

  it('seedFromSidecars and reconcileUsfm agree with the native reference', () => {
    const inputs = {
      actor: ACTOR,
      books: { TIT: USFM },
      settings: { schemaVersion: 1, textDirection: 'ltr' },
      vrs: { name: 'eng', bytes: '{"maxVerses":{"TIT":["16"]}}' },
      source: 'sidecar-migration' as const,
    };
    const mine = seedFromSidecars(inputs);
    const ref = refReconcile.seedFromSidecars(JSON.parse(JSON.stringify(inputs)));
    expect(JSON.parse(JSON.stringify(mine))).toEqual(JSON.parse(JSON.stringify(ref)));

    // fold-of-seed reproduces the pre-seed bytes exactly (R-8.8.2)
    expect(fold(mine).books.TIT.usfm).toBe(USFM);

    // out-of-band reconcile parity, and the #62 opts.seed=null form omits the marker
    const foldOut = fold(mine);
    const edited = USFM.replace('Pero tú enseña — ἃ πρέπει.', 'Pero tú enseña bien.');
    const fixed = (start: number) => {
      let n = start;
      return { issue: () => `2026-08-19T11:00:00.${String((n += 1)).padStart(3, '0')}Z|0000|${ACTOR}` };
    };
    const mineEvents = reconcileUsfm('TIT', edited, foldOut, fixed(0), ACTOR);
    const refEvents = refReconcile.reconcileUsfm(
      'TIT',
      edited,
      refFold.fold(JSON.parse(JSON.stringify(mine))),
      fixed(0),
      ACTOR,
    );
    expect(JSON.parse(JSON.stringify(mineEvents))).toEqual(JSON.parse(JSON.stringify(refEvents)));
    expect(mineEvents[0].seed).toEqual({ source: 'out-of-band-usfm', batch: expect.any(String) });
    const explicit = reconcileUsfm('TIT', edited, foldOut, fixed(0), ACTOR, { seed: null });
    expect(Object.hasOwn(explicit[0], 'seed')).toBe(false);
    expect(fold([...mine, ...explicit]).books.TIT.usfm).toBe(edited);
  });
});
