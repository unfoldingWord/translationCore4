// #1 — training-time measurement for the suggestion engine on the owner's
// responsiveness fixture (ruling 2026-09-12): the whole New Testament plus
// Genesis and Psalms of unfoldingWord en_ult v89, treated as a project's own
// confirmed alignments (every `\zaln` link), one model per testament.
//
// Opt-in: it reads the rig's cached export and takes minutes. Run with
//   TC4_SUGGEST_BENCH=1 npx vitest run test/align-suggest-bench.test.ts
// and record the numbers in docs/evidence/. Without the variable it skips.
import { describe, expect, it } from 'vitest';
import { MAX_COMPLEXITY, boundCorpus, trainModel, predictLinks } from '../src/data/align/suggestEngine';
import { loadUltBooks } from './helpers/ult-corpus';

const path = process.getBuiltinModule('node:path');
const RUN = process.env.TC4_SUGGEST_BENCH === '1';
const ZIP = process.env.TC4_ULT_ZIP ?? path.resolve(process.cwd(), 'dev-env/resources-cache/en_ult-v89-unwrapped.zip');

const NT = ['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];
const OT = ['GEN', 'PSA'];

describe.skipIf(!RUN)('#1 bench — training time per testament on NT + GEN + PSA (en_ult v89 alignments)', () => {
  it('trains both models and predicts once', async () => {
    const corpus = { nt: loadUltBooks(ZIP, NT), ot: loadUltBooks(ZIP, OT) };
    for (const testament of ['nt', 'ot'] as const) {
      const verses = corpus[testament];
      const kept = boundCorpus(verses, MAX_COMPLEXITY[testament]);
      const complexity = kept.reduce((n, v) => n + v.source.length * v.target.length, 0);
      const t0 = Date.now();
      const trained = await trainModel(testament, verses);
      const trainMs = Date.now() - t0;
      const probe = verses[verses.length - 1];
      const t1 = Date.now();
      const raw = predictLinks(trained, { source: probe.source, target: probe.target, manual: [] });
      const predictMs = Date.now() - t1;
      console.log(`[bench ${testament}] aligned verses ${verses.length}, in memory ${trained.verses}, boosted on ${trained.boosted} (cap ${MAX_COMPLEXITY[testament]}, boosted complexity ${complexity}), train ${trainMs} ms, one predict ${predictMs} ms, links ${raw.length}`);
      expect(trained.verses).toBeGreaterThan(0);
      expect(raw.length).toBeGreaterThan(0);
    }
  }, 30 * 60 * 1000);
});
