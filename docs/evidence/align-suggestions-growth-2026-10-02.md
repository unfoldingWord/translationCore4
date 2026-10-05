# Alignment suggestions: ramp-up and training-time measurement (2026-10-02)

The measurement behind [#516](https://github.com/unfoldingWord/translationCore4/issues/516)
and decision D92: where the suggestion engine's accuracy growth lives, what a
retrain costs, and which engine settings help. It was run in an owner session
on 2026-10-02 (cloud container: Intel Xeon 2.10 GHz, 4 cores, Node 22.22.0);
the full run logs are the two reports attached to #516
([report 1](https://github.com/unfoldingWord/translationCore4/issues/516#issuecomment-5951987361),
[report 2](https://github.com/unfoldingWord/translationCore4/issues/516#issuecomment-5952003609)).
The repository's reproduction of the ramp-up protocol on the shipped engine is
`test/align-suggest-growth-bench.test.ts` (opt-in, `TC4_SUGGEST_GROWTH=1`);
the training-time bench of 2026-09-12 stays `test/align-suggest-bench.test.ts`
(opt-in, `TC4_SUGGEST_BENCH=1`).

## Method

- **Harness.** Load aligned verses; hold out a fixed set at random (seeded);
  train exactly as `createTrainedWordAlignerModel` does (corpus index of the
  capped verses → `add_alignments_2` → every remaining verse into alignment
  memory); time each phase; score each held-out verse's first suggestion
  against the verse's real alignments. Reported: **recall** = correct predicted
  links / gold links; precision tracks recall within 0.02 at every checkpoint.
- **Corpus.** unfoldingWord ULT v88 aligned USFM as bundled in translationCore
  (51 books, 20 213 verses), read as a project's own confirmed alignments. A
  verse counts as aligned under gatewayEdit's rule (≥1 alignment, ≤15% of
  target words unaligned). NT: 27 books, 7 957 aligned verses. OT: 24 books,
  12 254 aligned verses. (The committed growth bench reads the rig's
  `en_ult-v89-unwrapped.zip` instead — one release newer; Door43 was not
  reachable from the measurement container.)
- **Ramp-up protocol** (the growth question): 100 held-out verses are fixed;
  the training verses are fed one at a time in canonical order. At each
  checkpoint three models are scored on the same 100 verses: **plain**
  (wordMAP alone, memory = the verses fed so far), **frozen** (a booster
  trained once at 50 verses, then only the memory grows), **retrained** (the
  booster retrained at that checkpoint, bounded by the complexity cap).
- **Negative control.** The harness fed a non-existent book code fails with an
  empty corpus; the real corpus trains and predicts.

## Where the training time goes (engine profile)

NT, seed 1, gatewayEdit defaults (`MorphJLBoostWordMap`, train_steps 1000,
tree_depth 5, cap 100 000). 228 verses fit under the cap. [VERIFIED — run
`nt-baseline`, report 2 of #516, 2026-10-02]

| phase | time | share |
|---|---|---|
| corpus index of the 228 capped verses | 4.3 s | 1% |
| wordMAP `engine.run` (candidate collection, 69 215 training rows) | 25.4 s | 5% |
| `JLBoost.train`, 1000 steps, depth 5 (432 trees accepted) | 466.9 s | **95%** |
| alignment memory for the remaining 7 429 verses | 1.1 s | <1% |

Appending one confirmed verse to the alignment memory costs **0.14–0.16 ms**.
Training time is almost all the gradient-boosting fit, not wordMAP.

## Settings and changes measured

Each candidate, and the ruling the measurement supports. The JLBoost patch is
upstream work (JEdward7777/wordmapbooster `src/JLBoost.ts`, ~70 lines; the full
diff is in report 2 of #516) and is **not** shipped by #516 — it sits in that
issue's Follow-up section.

| candidate | result | ruling |
|---|---|---|
| per-save memory append + budgeted retrain + memory-only answers before the booster fits | growth lives in the memory (tables below); append 0.14 ms | **adopted** (#516, D92) |
| JLBoost patch A (no per-step row clone) | bit-identical model, 1.2x uncontended (1.7x contended) | follow-up, upstream |
| JLBoost patch A + B (quickselect split, partition by value) with `train_steps: 300, tree_depth: 3` | booster fit 26x faster (NT 428 s → 36 s uncontended); recall UP on 6 of 7 seed/testament pairs (NT mean 0.639 → 0.669, OT 0.417 → 0.479) | follow-up, upstream — **do not set the two options on the shipped code** |
| `train_steps: 300` alone (shipped code) | 0.634 → 0.600 recall | rejected |
| `tree_depth: 3` alone (shipped code) | no accuracy gain (0.639 → 0.641 NT mean) | rejected |
| keep 3% of incorrect candidates (not 10%) | 0.634 → 0.609 recall | rejected |
| complexity cap 200 000 | no gain (0.649 → 0.645), predict 3722 ms/verse | rejected |

## Held-out recall by seed (the patched-engine configuration, for the record)

Baseline is the shipped configuration. Seed spread of the baseline: ±0.03 (NT),
±0.04 (OT); a single-seed difference under that is noise.

| config | NT s1 | NT s2 | NT s3 | NT mean | OT s1 | OT s2 | OT s3 | OT s4 | OT mean |
|---|---|---|---|---|---|---|---|---|---|
| baseline (defaults) | 0.634 | 0.659 | 0.624 | 0.639 | 0.471 | 0.405 | 0.396 | 0.396 | 0.417 |
| A + B, steps 300, depth 5 | 0.657 | 0.677 | 0.636 | 0.656 | 0.436 | 0.469 | 0.309 | 0.196 | 0.352 |
| A + B, steps 300, depth 3 | 0.681 | 0.663 | 0.662 | 0.669 | 0.430 | 0.475 | 0.512 | 0.499 | 0.479 |
| depth 3 on shipped code | 0.639 | 0.643 | — | 0.641 | 0.457 | — | — | 0.497 | 0.477 |

(Depth 5 with patch B over-fits the small OT boost set — two of four seeds
collapse; depth 3 is the regulariser. Details in report 1 §3–4 of #516.)

## Ramp-up, New Testament (seed 1; patched engine for the retrain times)

| verses aligned | plain wordMAP | frozen booster (trained at 50) | retrained booster | retrain time | ms per suggestion plain / boosted |
|---|---|---|---|---|---|
| 1 | 0.178 | – | – | – | 83 / – |
| 5 | 0.186 | – | 0.187 | 0.3 s | 74 / 359 |
| 10 | 0.204 | – | 0.275 | 0.6 s | 73 / 373 |
| 25 | 0.292 | – | 0.339 | 4.9 s | 80 / 395 |
| 50 | 0.366 | 0.462 | 0.435 | 21.8 s | 82 / 420 |
| 100 | 0.419 | 0.508 | 0.498 | 36.3 s | 81 / 417 |
| 250 | 0.497 | 0.555 | 0.540 | 68.0 s | 87 / 442 |
| 500 | 0.531 | 0.582 | 0.574 | 71.1 s | 99 / 457 |
| 1 000 | 0.588 | 0.622 | 0.619 | 71.1 s | 109 / 438 |
| 2 500 | 0.630 | 0.634 | 0.630 | 71.6 s | 102 / 425 |
| 5 000 | 0.653 | 0.629 | 0.639 | 70.1 s | 106 / 427 |
| 7 657 | **0.679** | 0.629 | 0.638 | 69.7 s | 102 / 433 |

## Ramp-up, Old Testament (seed 1, same protocol, cap 50 000)

| verses aligned | plain wordMAP | frozen booster (trained at 50) | retrained booster | retrain time | ms per suggestion plain / boosted |
|---|---|---|---|---|---|
| 1 | 0.094 | – | – | – | 116 / – |
| 5 | 0.088 | – | 0.080 | 0.5 s | 101 / 467 |
| 10 | 0.101 | – | 0.143 | 1.0 s | 101 / 476 |
| 25 | 0.127 | – | 0.153 | 3.6 s | 110 / 521 |
| 50 | 0.169 | 0.208 | 0.195 | 10.9 s | 118 / 516 |
| 100 | 0.208 | 0.239 | 0.238 | 28.8 s | 113 / 539 |
| 250 | 0.240 | 0.257 | 0.301 | 32.0 s | 112 / 514 |
| 500 | 0.291 | 0.306 | 0.305 | 25.5 s | 125 / 562 |
| 1 000 | 0.347 | 0.342 | 0.374 | 36.8 s | 128 / 534 |
| 2 500 | 0.410 | 0.348 | 0.435 | 36.7 s | 132 / 525 |
| 5 000 | 0.487 | 0.354 | 0.471 | 28.6 s | 132 / 504 |
| 7 657 | **0.516** | 0.369 | 0.469 | 26.0 s | 131 / 536 |

## What the tables say (the facts behind #516)

1. **The growth lives in the alignment memory, not in the booster.** Appending
   a confirmed verse costs 0.1–0.2 ms and takes effect on the next Suggest.
2. **A stale booster keeps growing with the memory.** Trained once at 50
   verses, it tracks a retrained booster within noise up to ~2 500 verses. A
   retrain is never something the translator has to wait for.
3. **The booster earns its keep only in a young project** (about 10 to 1 000
   verses, +0.04 to +0.09 recall NT). From ~2 500 verses on, plain wordMAP is
   equal or better and predicts 4x faster.
4. **wordMAP memory alone answers from the first verse** (0.18 recall at one
   verse, NT). There is no reason to show nothing before the fifth.

## Things to know before trusting this

- One corpus (ULT, English, one translation style). The seed spread is the
  honest error bar: ±0.03 NT, ±0.04 OT.
- Held-out verses were evaluated with no manual links placed — the "Suggest on
  an empty verse" case.
- Timing scale: the measurement container is ~1.8x slower on the baseline than
  the owner's machine recorded in
  `docs/evidence/align-suggestions-bench-2026-09-12.md`; expect the ratios,
  not the seconds.
- The committed growth bench runs the SHIPPED engine, so its `retrained`
  column at depth-5/1000-step defaults costs minutes per checkpoint — it
  defaults to `TC4_SUGGEST_GROWTH_MAX=250` and grades links by exact position
  match, which is stricter than the owner harness's
  `is_correct_prediction`. Its numbers prove the shape, not the exact values
  above.
