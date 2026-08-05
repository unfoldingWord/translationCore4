// S-0c (C0.4, TEST-PLAN §2.3) — derive-and-merge parity with the conformance
// harness at app level (early T13). Behavioral reference:
// sample-burrito-validation/validate.mjs sections 3 and 7 — the same inputs must
// reproduce the harness's numbers through src/data/derive.ts.
import { afterAll, describe, expect, it } from 'vitest';
import {
  deriveTargetBible,
  deriveTwlItems,
  deriveCheckItems,
  mergeSavedDecisions,
  mergeKey,
  filterToScope,
  refInScope,
  scopeRangesFor,
  progressOf,
} from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';

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
    `S-0c SKIPPED — sample-burrito not found at ${BURRITO}. ` +
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

// The harness section-7 miniature TWL, verbatim.
const miniTwl = [
  'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
  '1:1\tt1g7\tkeyterm\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god',
  '1:1\ta9p2\tkeyterm\tἀπόστολος\t1\trc://*/tw/dict/bible/kt/apostle',
  '1:1\tx7k2\tkeyterm\tἸησοῦ\t1\trc://*/tw/dict/bible/kt/jesus',
].join('\n');

const evidence: string[] = [];

suite('S-0c — derive+merge parity with harness section 7 (sample-burrito TIT)', () => {
  const saved = (
    JSON.parse(read('ingredients/checking/translationWords/TIT.json')) as {
      decisions: CheckItem[];
    }
  ).decisions;

  it('deriveTargetBible: whole-book parse yields chapters 1-3 with 16/15/15 verses + headers (harness section 3)', () => {
    const book = deriveTargetBible(read('ingredients/TIT.usfm'));
    const counts = ['1', '2', '3'].map(
      (ch) => Object.keys(book.chapters[ch]).filter((k) => /^\d+/.test(k)).length,
    );
    expect(counts).toEqual([16, 15, 15]);
    const v1 = book.chapters['1']['1'].verseObjects.map((vo) => vo.text || '').join('');
    expect(v1).toContain('Pablo');
    expect(v1).toContain('piedad');
    expect(book.headers.some((h) => h.tag === 'h' && h.content === 'Tito')).toBe(true);
    evidence.push(
      `deriveTargetBible: chapters 1-3 have ${counts.join('/')} verses; 1:1 text + header "Tito" present`,
    );
  });

  it('derive+merge: saved decisions re-attach by stable key — progress 2/3 reconstructed (the harness 2/3 case)', () => {
    const derived = deriveTwlItems(miniTwl, 'tit');
    expect(derived).toHaveLength(3);
    expect(derived.every((i) => i.selections === false && i.nothingToSelect === false)).toBe(true);

    const merged = mergeSavedDecisions(derived, saved);
    const { decided, total } = progressOf(merged);
    expect(decided).toBe(2);
    expect(total).toBe(3);
    expect(merged[2].selections).toBe(false); // x7k2 has no stored decision → stays fresh
    expect(merged[0]).toBe(saved.find((d) => d.contextId.checkId === 't1g7')); // the stored record itself
    evidence.push(
      `derive+merge on the harness mini-TWL: progress ${decided}/${total} reconstructed`,
    );
  });

  it('refInScope: harness range fixtures + negative controls', () => {
    expect(refInScope(['1:1-2:5'], 2, 5)).toBe(true);
    expect(refInScope(['1:1-2:5'], 2, 6)).toBe(false);
    expect(refInScope(['3'], 3, 15)).toBe(true);
    expect(refInScope(['3'], 2, 1)).toBe(false);
    evidence.push(
      'refInScope: ["1:1-2:5"] accepts 2:5, rejects 2:6; ["3"] accepts 3:15, rejects 2:1',
    );
  });

  it('scope filter: ["1:1"] keeps 2/3 items; [] (whole book) keeps 3/3 (harness scoped-derive check)', () => {
    const scopedTwl = [
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
      '1:1\tt1g7\tkeyterm\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god',
      '1:1\ta9p2\tkeyterm\tἀπόστολος\t1\trc://*/tw/dict/bible/kt/apostle',
      '1:2\tq3z8\tkeyterm\tζωῆς\t1\trc://*/tw/dict/bible/kt/life',
    ].join('\n');
    const items = deriveTwlItems(scopedTwl, 'tit');
    const scoped = filterToScope(items, ['1:1']);
    const wholeBook = filterToScope(items, []);
    expect(scoped).toHaveLength(2);
    expect(scoped.every((i) => i.contextId.reference.verse === 1)).toBe(true);
    expect(wholeBook).toHaveLength(3);
    evidence.push(
      `scope ["1:1"] → ${scoped.length}/${items.length} items; [] → ${wholeBook.length}/${items.length}`,
    );
  });

  it('synthetic scope {TIT:["1:1-2:5"]}: the progress denominator shrinks with the scope (§4.2/D26)', () => {
    // Sample-burrito's own scope is whole-book ([] — the filter is identity there),
    // so this synthetic book proves the denominator behavior.
    const syntheticTwl = [
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
      '1:1\tt1g7\tkeyterm\tΘεοῦ\t1\trc://*/tw/dict/bible/kt/god', // stored decision attaches
      '2:5\tb2c3\tkeyterm\tἔργοις\t1\trc://*/tw/dict/bible/kt/works', // last in-scope verse
      '2:6\td4e5\tkeyterm\tσωφρονεῖν\t1\trc://*/tw/dict/bible/other/mind', // first out-of-scope verse
      '3:15\tf6g7\tkeyterm\tχάρις\t1\trc://*/tw/dict/bible/kt/grace', // out of scope
    ].join('\n');
    const scope = { TIT: ['1:1-2:5'] };

    const wholeBook = deriveCheckItems(syntheticTwl, 'tit', saved, []);
    const scoped = deriveCheckItems(syntheticTwl, 'tit', saved, scopeRangesFor(scope, 'TIT'));
    const pWhole = progressOf(wholeBook);
    const pScoped = progressOf(scoped);

    expect(pWhole).toEqual({ decided: 1, total: 4 });
    expect(pScoped).toEqual({ decided: 1, total: 2 }); // denominator 4 → 2
    expect(scoped.map((i) => i.contextId.checkId)).toEqual(['t1g7', 'b2c3']);
    evidence.push(
      `synthetic scope {TIT:["1:1-2:5"]}: progress ${pWhole.decided}/${pWhole.total} (whole book) → ` +
        `${pScoped.decided}/${pScoped.total} (scoped) — the denominator shrinks`,
    );
  });

  it('span discipline: a "9-10" verse reference is never Number()-coerced in items or keys (§5.2)', () => {
    const spanTwl = [
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
      '2:9-10\ts1p2\tkeyterm\tיְהוָה\t1\trc://*/tw/dict/bible/kt/yahweh',
    ].join('\n');
    const [item] = deriveTwlItems(spanTwl, 'jon');
    expect(item.contextId.reference.verse).toBe('9-10');
    const key = mergeKey(item.contextId);
    expect(key).toContain('|9-10|');
    expect(key).not.toContain('NaN');
    evidence.push(`span ref "2:9-10" derives verse key "9-10" (string); mergeKey = ${key}`);
  });

  afterAll(() => {
    console.log('\n[S-0c evidence] derive+merge parity via src/data/derive.ts:');
    for (const line of evidence) console.log(`  - ${line}`);
  });
});
