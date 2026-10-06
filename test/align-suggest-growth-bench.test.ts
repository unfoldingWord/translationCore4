// #516 — the ramp-up bench: can suggestions grow verse by verse without
// waiting for training? It reproduces the 2026-10-02 measurement's protocol
// (docs/evidence/align-suggestions-growth-2026-10-02.md) on the shipped
// engine: a fixed held-out set is scored at each checkpoint for three models —
//   plain      wordMAP alone, alignment memory = the verses fed so far;
//   frozen     a booster trained once at FREEZE_AT verses, then only the
//              memory grows (appendVerse — the #516 save path);
//   retrained  the booster retrained at the checkpoint (bounded by the cap).
// Training verses are fed one at a time in canonical order, as a translator
// would produce them.
//
// Opt-in: it reads the rig's cached export, and the `retrained` column costs a
// full training per checkpoint. Run with
//   TC4_SUGGEST_GROWTH=1 npx vitest run test/align-suggest-growth-bench.test.ts
// Narrow it with TC4_SUGGEST_GROWTH_MAX=<verses> (default 250 — the full-depth
// numbers of record were produced in the owner's 2026-10-02 session, issue
// #516). TC4_SUGGEST_GROWTH_OT=1 runs Genesis and Psalms instead.
import { describe, expect, it } from 'vitest';
import WordMap from 'wordmap';
import { appendVerse, predictLinks, trainModel, type TrainedModel } from '../src/data/align/suggestEngine';
import type { RawLink, TrainingVerse } from '../src/data/align/suggest';
import { loadUltBooks, mulberry32 } from './helpers/ult-corpus';

const path = process.getBuiltinModule('node:path');
const RUN = process.env.TC4_SUGGEST_GROWTH === '1';
const ZIP = process.env.TC4_ULT_ZIP ?? path.resolve(process.cwd(), 'dev-env/resources-cache/en_ult-v89-unwrapped.zip');
const MAX = Number(process.env.TC4_SUGGEST_GROWTH_MAX ?? 250);
const OT_RUN = process.env.TC4_SUGGEST_GROWTH_OT === '1';
const SEED = Number(process.env.TC4_SUGGEST_GROWTH_SEED ?? 1);

const NT = ['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];
const OT = ['GEN', 'PSA'];
const CHECKPOINTS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const HELD_OUT = 100;
const FREEZE_AT = 50;

/** A memory-only TrainedModel over a bare WordMap — appendVerse and
 * predictLinks then exercise exactly the #516 memory path. */
const bareMemoryModel = (testament: 'ot' | 'nt'): TrainedModel => ({
  testament,
  verses: 0,
  boosted: 0,
  model: { wordMap: new WordMap({ sourceNgramLength: 3, targetNgramLength: 5, warnings: false, nGramWarnings: false, forceOccurrenceOrder: false }) } as never,
});

/** Held-out recall: a predicted link is correct when a gold link carries the
 * same source and target positions; recall = correct / gold links. (The
 * owner-session harness graded with the library's `is_correct_prediction`;
 * this exact-match grade is the stricter, dependency-free equivalent.) */
const recallOf = (predicted: RawLink[], gold: TrainingVerse['links']): { correct: number; gold: number } => {
  const key = (l: { source: number[]; target: number[] }) => `${[...l.source].sort((a, b) => a - b)}|${[...l.target].sort((a, b) => a - b)}`;
  const got = new Set(predicted.map(key));
  return { correct: gold.filter((g) => got.has(key(g))).length, gold: gold.length };
};

const score = (model: TrainedModel, heldOut: TrainingVerse[]): string => {
  let correct = 0;
  let gold = 0;
  for (const v of heldOut) {
    const r = recallOf(predictLinks(model, { source: v.source, target: v.target, manual: [] }), v.links);
    correct += r.correct;
    gold += r.gold;
  }
  return (correct / gold).toFixed(3);
};

describe.skipIf(!RUN)('#516 growth bench — plain memory vs frozen booster vs retrained booster, verse by verse', () => {
  it('scores the three models at each checkpoint', async () => {
    const testament = OT_RUN ? ('ot' as const) : ('nt' as const);
    const all = loadUltBooks(ZIP, OT_RUN ? OT : NT);
    // A fixed held-out set, drawn with a seeded RNG; the rest trains in
    // canonical order.
    const rng = mulberry32(SEED);
    const drawn = [...all.keys()].map((i) => ({ i, r: rng() })).sort((a, b) => a.r - b.r);
    const heldRefs = new Set(drawn.slice(0, HELD_OUT).map(({ i }) => all[i].ref));
    const heldOut = all.filter((v) => heldRefs.has(v.ref));
    const training = all.filter((v) => !heldRefs.has(v.ref));
    console.log(`[growth ${testament}] seed ${SEED}, ${training.length} training verses, ${heldOut.length} held out, checkpoints up to ${MAX}`);

    let plain = bareMemoryModel(testament);
    let frozen: TrainedModel | null = null;
    let fed = 0;
    let appendMs = 0;
    const feed = (upTo: number) => {
      for (; fed < upTo; fed++) {
        const t0 = performance.now();
        plain = appendVerse(plain, training[fed]);
        appendMs += performance.now() - t0;
        if (frozen) frozen = appendVerse(frozen, training[fed]);
      }
    };

    console.log('| verses aligned | plain wordMAP | frozen booster (trained at 50) | retrained booster | retrain time | append ms/verse |');
    console.log('|---|---|---|---|---|---|');
    for (const checkpoint of CHECKPOINTS.filter((c) => c <= Math.min(MAX, training.length))) {
      feed(checkpoint);
      if (!frozen && checkpoint >= FREEZE_AT) frozen = await trainModel(testament, training.slice(0, checkpoint));
      const t0 = Date.now();
      const retrained = await trainModel(testament, training.slice(0, checkpoint));
      const retrainS = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `| ${checkpoint} | ${score(plain, heldOut)} | ${frozen ? score(frozen, heldOut) : '–'} | ${score(retrained, heldOut)} | ${retrainS} s | ${(appendMs / fed).toFixed(2)} |`,
      );
      expect(plain.verses).toBe(checkpoint);
      expect(retrained.verses).toBe(checkpoint);
    }
  }, 6 * 60 * 60 * 1000);
});
