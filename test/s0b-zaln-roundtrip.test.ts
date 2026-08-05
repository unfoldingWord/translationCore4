// S-0b (C0.6, TEST-PLAN §2.3) — zaln round trip through the app's own store
// shapes: sidecar → aligned USFM → sidecar, byte/deep-equivalent, using
// src/data/align/zaln.ts for EVERY verse present in the TIT alignment sidecar.
// Also proves I-1: the draft ingredient at rest carries no zaln markup.
// Behavioral reference: sample-burrito-validation/validate.mjs section 4.
import { afterAll, describe, expect, it } from 'vitest';
import {
  mergeVerseToZalnUsfm,
  extractVerseFromZalnUsfm,
  origWordsFromAlignments,
  verseTextFromObjects,
} from '../src/data/align/zaln';
import type { AlignedWord, Alignment, AlignmentFile } from '../src/data/align/zaln';
import { normalizeOccurrences } from '../src/data/align/occurrences';
import { deriveTargetBible } from '../src/data/derive';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// ../sample-burrito relative to the repo root (the Vitest cwd).
const BURRITO = path.resolve(process.cwd(), '../sample-burrito');
const burritoPresent = fs.existsSync(path.join(BURRITO, 'metadata.json'));
if (!burritoPresent) {
  console.warn(
    `S-0b SKIPPED — sample-burrito not found at ${BURRITO}. ` +
      'The Increment-0 gate needs the sibling fixture checkout; this run is NOT gate evidence.',
  );
}
// Vitest executes a describe callback even for `describe.skip` — it collects the skipped
// test names — so guarding the suite alone does NOT stop the fixture reads in the body from
// throwing when the sibling checkout is absent. That made CI fail with "3 suites failed /
// (0 test)" on any standalone clone. Register a placeholder skipped suite instead and never
// enter the real body. The sample-burrito is a GENERATED artifact of the harness, so it is
// deliberately not vendored here — a copy would be a second source of truth (BURRITO-SPEC).
const suite = (name: string, body: () => void) => {
  if (burritoPresent) {
    describe(name, body);
    return;
  }
  describe.skip(name, () => {
    it('requires the sibling ../sample-burrito checkout — not gate evidence in this run', () => {});
  });
};

const read = (p: string) => fs.readFileSync(path.join(BURRITO, p), 'utf8');
// AlignedWord carries no index signature; a fresh spread literal satisfies
// WithOccurrences (implicit index signature) without touching the read-only modules.
const normWord = (w: AlignedWord) => normalizeOccurrences({ ...w });
// The persisted §5.1 alignment payload, occurrence-normalized at the store
// boundary (I-2) — the shape a writer would put back on disk.
const persistedShape = (alignments: Alignment[]) =>
  alignments.map((a) => ({
    topWords: a.topWords.map(normWord),
    bottomWords: a.bottomWords.map(normWord),
  }));

const evidence: string[] = [];

suite('S-0b — zaln round trip through the store shapes (all sidecar verses)', () => {
  const draftUsfm = read('ingredients/TIT.usfm');
  const alignFile = JSON.parse(read('ingredients/checking/alignments/TIT.json')) as AlignmentFile;
  const book = deriveTargetBible(draftUsfm);
  const verseRefs: Array<[string, string]> = Object.entries(alignFile.chapters).flatMap(
    ([ch, verses]) => Object.keys(verses).map((v): [string, string] => [ch, v]),
  );

  it('sidecar covers at least one verse (whole verse set is exercised below)', () => {
    expect(verseRefs.length).toBeGreaterThanOrEqual(1);
    evidence.push(
      `verse set: ${verseRefs.length} verse(s) in the sidecar — ${verseRefs.map(([c, v]) => `${c}:${v}`).join(', ')}`,
    );
  });

  it.each(verseRefs)(
    'TIT %s:%s — sidecar → zaln USFM → sidecar is byte- and deep-equivalent (integer occurrences)',
    (ch, v) => {
      const record = alignFile.chapters[ch][v];
      const verseText = verseTextFromObjects(book.chapters[ch][v].verseObjects);

      const zalnUsfm = mergeVerseToZalnUsfm(record, verseText);
      expect(zalnUsfm).toContain('\\zaln-s');
      expect(zalnUsfm).toContain('\\w ');

      const origWords = origWordsFromAlignments(record.alignments);
      const extracted = extractVerseFromZalnUsfm(zalnUsfm, origWords);

      // Store-boundary normalization (I-2), then deep equivalence…
      const got = {
        alignments: persistedShape(extracted.alignments),
        wordBank: extracted.wordBank.map(normWord),
      };
      const want = {
        alignments: persistedShape(record.alignments),
        wordBank: record.wordBank.map(normWord),
      };
      expect(got.alignments).toHaveLength(record.alignments.length);
      expect(got.wordBank).toHaveLength(record.wordBank.length);
      expect(got).toEqual(want);
      // …and byte equivalence of the serialized persisted payload.
      const gotBytes = JSON.stringify(got);
      const wantBytes = JSON.stringify(want);
      expect(gotBytes).toBe(wantBytes);

      const zalnCount = (zalnUsfm.match(/\\zaln-s/g) || []).length;
      evidence.push(
        `TIT ${ch}:${v}: ${record.alignments.length} alignments + ${record.wordBank.length} wordBank words ` +
          `round-tripped byte-equal (${gotBytes.length} bytes); merged USFM has ${zalnCount} \\zaln-s opens`,
      );
    },
  );

  it('I-1: the DRAFT ingredient at rest contains no zaln markup', () => {
    expect(draftUsfm.includes('\\zaln')).toBe(false);
    expect(draftUsfm).toContain('\\v 1');
    evidence.push(
      'draft ingredients/TIT.usfm: 0 occurrences of \\zaln (zaln only in derived output)',
    );
  });

  afterAll(() => {
    console.log('\n[S-0b evidence] zaln round trip via src/data/align/zaln.ts:');
    for (const line of evidence) console.log(`  - ${line}`);
  });
});
