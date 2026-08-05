// S-0a (C0.5, TEST-PLAN §2.3) — word-aligner merge/unmerge round trip, headless
// in OUR toolchain (node + Vitest, via src/data/vendor.ts). Proves the retained
// tC3 kill-criterion capability without a browser. Behavioral reference:
// sample-burrito-validation/validate.mjs section 4.
import { afterAll, describe, expect, it } from 'vitest';
import { usfmjs, wordaligner, UsfmFileConversionHelpers } from '../src/data/vendor';
import { normalizeOccurrences } from '../src/data/align/occurrences';
import type { AlignedWord, Alignment, AlignmentFile } from '../src/data/align/zaln';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment [VERIFIED in this toolchain].
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Fixtures are read in place from the sibling sample-burrito (the guaranteed
// workspace layout; ../sample-burrito relative to the repo root, which is the
// Vitest cwd). Elsewhere the suite skips LOUDLY instead of passing empty.
const BURRITO = path.resolve(process.cwd(), '../sample-burrito');
const burritoPresent = fs.existsSync(path.join(BURRITO, 'metadata.json'));
if (!burritoPresent) {
  console.warn(
    `S-0a SKIPPED — sample-burrito not found at ${BURRITO}. ` +
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
const normAlignments = (als: Alignment[]) =>
  als.map((a) => ({
    topWords: a.topWords.map(normWord),
    bottomWords: a.bottomWords.map(normWord),
  }));

const evidence: string[] = [];

suite('S-0a — word-aligner merge/unmerge round trip (headless, sample-burrito TIT 1:1)', () => {
  const alignFile = JSON.parse(read('ingredients/checking/alignments/TIT.json')) as AlignmentFile;
  const stored = alignFile.chapters['1']['1'];
  const bookJson = usfmjs.toJSON(read('ingredients/TIT.usfm')) as unknown as {
    chapters: { [c: string]: { [v: string]: { verseObjects: Array<Record<string, unknown>> } } };
  };
  const verseText = bookJson.chapters['1']['1'].verseObjects
    .filter((vo) => vo.type === 'text' || vo.text)
    .map((vo) => (vo.text as string) || '')
    .join('')
    .trim();

  it('fixture sanity: TIT 1:1 sidecar has 10 alignments and 21 wordBank words (harness numbers)', () => {
    expect(stored.alignments).toHaveLength(10);
    expect(stored.wordBank).toHaveLength(21);
    expect(verseText.length).toBeGreaterThan(0);
    evidence.push(
      `input sidecar: ${stored.alignments.length} alignments, ${stored.wordBank.length} wordBank words; verse text ${verseText.length} chars`,
    );
  });

  it('merge → aligned verseObjects → aligned USFM (7 zaln-s opens; orig-language attributes survive)', () => {
    const merged = wordaligner.merge(stored.alignments, stored.wordBank, verseText, true);
    expect(Array.isArray(merged)).toBe(true);
    expect(merged.length).toBeGreaterThan(0);

    const usfmOut = UsfmFileConversionHelpers.convertVerseDataToUSFM({ verseObjects: merged });
    const zalnCount = (usfmOut.match(/\\zaln-s/g) || []).length;
    // 6 alignments carry bottomWords; one is 2-source (Ἰησοῦ Χριστοῦ) → 7 opens.
    expect(zalnCount).toBe(7);
    expect(usfmOut).toContain('x-strong="G39720"');
    expect(usfmOut).toContain('x-lemma="χριστός"');
    expect(usfmOut).toContain('x-content="Θεοῦ"');
    evidence.push(
      `merged USFM: ${zalnCount} \\zaln-s opens; strong/lemma/content attributes present`,
    );
  });

  it('unmerge back: alignments + wordBank deep-equal the input after occurrence normalization', () => {
    const merged = wordaligner.merge(stored.alignments, stored.wordBank, verseText, true);
    const usfmOut = UsfmFileConversionHelpers.convertVerseDataToUSFM({ verseObjects: merged });

    // Chunk parse returns `verses`, not `chapters` (PLATFORM-NOTES #4 [VERIFIED]).
    const reparsed = (
      usfmjs.toJSON(`\\v 1 ${usfmOut}`, { chunk: true }) as unknown as {
        verses: { [v: string]: { verseObjects: Array<Record<string, unknown>> } };
      }
    ).verses['1'].verseObjects;

    // The sidecar's topWords in file order ARE the orig verse tokens (§5.1).
    const origWords = stored.alignments
      .flatMap((a) => a.topWords)
      .map((t) => ({
        tag: 'w',
        type: 'word',
        text: t.word,
        strong: t.strong,
        lemma: t.lemma,
        morph: t.morph,
        occurrence: t.occurrence,
        occurrences: t.occurrences,
      }));

    const re = wordaligner.unmerge({ verseObjects: reparsed }, { verseObjects: origWords });
    const reAlignments = (re.alignment ?? re.alignments ?? []) as Alignment[];
    const reWordBank = re.wordBank as AlignedWord[];

    expect(reAlignments).toHaveLength(10);
    expect(reWordBank).toHaveLength(21);
    // USFM attributes come back as strings; normalize at the boundary (I-2),
    // then require FULL deep equality — not just the harness's projection.
    expect(normAlignments(reAlignments)).toEqual(normAlignments(stored.alignments));
    expect(reWordBank.map(normWord)).toEqual(stored.wordBank.map(normWord));
    evidence.push(
      `round trip: ${reAlignments.length}/10 alignments and ${reWordBank.length}/21 wordBank words deep-equal after occurrence normalization`,
    );
  });

  afterAll(() => {
    console.log('\n[S-0a evidence] word-aligner headless round trip (TIT 1:1):');
    for (const line of evidence) console.log(`  - ${line}`);
  });
});
