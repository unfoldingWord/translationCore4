// C2.10 / OPEN-QUESTIONS #9 — how long does deriving a check list actually
// take, and does a disposable cache earn its complexity?
//
// This file MEASURES and reports; it does not assert a performance threshold,
// because no target has been agreed. The numbers it prints are the evidence
// the cache go/no-go decision needs.
//
// The worst realistic case is Psalms: en_tn v89 PSA.tsv is ~3.3 MB, by far the
// largest book file in the suite. It is read from the RIG rather than vendored
// — a 3.3 MB fixture would bloat the repo for a measurement — so this suite
// skips when the rig's resources are absent.
import { describe, expect, it } from 'vitest';
import { deriveTnItems, deriveTwlItems } from '../src/data/derive';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SIDELOADED = path.resolve(
  process.cwd(),
  '../dev-env/state/work/repos/_local_/_sideloaded_',
);
const bookFile = (repo: string, book: string) =>
  path.join(SIDELOADED, repo, 'ingredients', `${book}.tsv`);

const has = (repo: string, book: string) => fs.existsSync(bookFile(repo, book));
const rigReady = has('en_tn', 'PSA') && has('en_tw', 'PSA');
if (!rigReady) {
  console.warn(
    `perf-derive SKIPPED — no rig resources at ${SIDELOADED}. ` +
      'Run dev-env/scripts/seed.zsh to measure. This run is NOT perf evidence.',
  );
}
const suite = rigReady ? describe : describe.skip;

/** Median of `runs` timings, in milliseconds — median rather than mean so one
 * GC pause does not become the reported number. */
const timeMs = (fn: () => unknown, runs = 5): number => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
};

suite('derive performance on the largest real books (OQ #9)', () => {
  const report: Array<Record<string, unknown>> = [];

  it('measures tN derive across a size range and reports the numbers', () => {
    for (const book of ['TIT', 'JON', 'MAT', 'PSA']) {
      if (!has('en_tn', book)) continue;
      const tsv = fs.readFileSync(bookFile('en_tn', book), 'utf8');
      const ms = timeMs(() => deriveTnItems(tsv, book.toLowerCase()));
      const items = deriveTnItems(tsv, book.toLowerCase());
      report.push({
        tool: 'tN', book, kib: Math.round(tsv.length / 1024), items: items.length, ms: +ms.toFixed(1),
      });
      expect(items.length).toBeGreaterThan(0);
    }
    expect(report.length).toBeGreaterThan(0);
  });

  it('measures tW derive on the same books', () => {
    for (const book of ['TIT', 'JON', 'PSA']) {
      if (!has('en_tw', book)) continue;
      const tsv = fs.readFileSync(bookFile('en_tw', book), 'utf8');
      const ms = timeMs(() => deriveTwlItems(tsv, book.toLowerCase()));
      const items = deriveTwlItems(tsv, book.toLowerCase());
      report.push({
        tool: 'tW', book, kib: Math.round(tsv.length / 1024), items: items.length, ms: +ms.toFixed(1),
      });
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('prints the table that the cache decision reads', () => {
    console.log(
      '\nderive timings (median of 5, this machine):\n' +
        report
          .map(
            (r) =>
              `  ${r.tool} ${String(r.book).padEnd(4)} ${String(r.kib).padStart(5)} KiB  ` +
              `${String(r.items).padStart(5)} items  ${String(r.ms).padStart(7)} ms`,
          )
          .join('\n'),
    );
    const worst = report.reduce((a, b) => ((a.ms as number) > (b.ms as number) ? a : b));
    console.log(`  worst case: ${worst.tool} ${worst.book} at ${worst.ms} ms\n`);
    expect(worst.ms).toBeGreaterThan(0);
  });
});
