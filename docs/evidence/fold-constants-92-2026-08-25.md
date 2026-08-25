# Fold constants cut — the issue #92 record

**Date:** 2026-08-25. **Commit:** 6a149f2 (clean tree — the benchmark stamps and
refuses a dirty tree). **Machine:** Apple M2 Pro (10 cores), 16 GB RAM, macOS 26.5.1,
Node v22.14.0. **Baseline:** the issue #80 record
(`docs/evidence/bench-fold-2026-08-25.md`, measured at 9aa17f2 on the same machine).

## The three changes (`conformance/journal/fold.mjs`)

1. `canon()` serializes directly with sorted keys. The former path rebuilt every
   object with one `Object.defineProperty` per field before `JSON.stringify` — 22%
   of a whole-Bible fold's profile samples. The output string is byte-identical.
2. The decision sort computes each record's canonical key ONCE. The comparator used
   to call `canon(contextId)` on every comparison — ~7.6M serializations for
   215,767 records. The comparator logic and element order are unchanged, so the
   permutation is identical.
3. The alignment orphan backstop uses one memoized slot Set per book. It used to
   re-derive the whole book's slot list (a regex walk of the full skeleton) for
   EVERY alignment head.

No semantic change. Proof: the journal suite (336, including the 200-run
fast-check no-throw/conservation property), the harness (39) and the normative
gate (72/72) all pass, and the client suite (635 tests) is green against the
modified module. `npm run verify` exit 0.

## Results (medians of 3, `node bench-fold.mjs` / `--bible`)

| Fold | #80 baseline (9aa17f2) | After #92 (6a149f2) | Change |
|---|---|---|---|
| Aligned NT (15,945 events) | 671 ms | **329 ms** | −51% |
| Checked whole Bible (278,041 events) | 9,279 ms | **4,239 ms** | −54% |
| Whole Bible, minus align.verse.set only | 6,207 ms | 2,926 ms | −53% |
| Whole Bible, text-only | 278 ms | 332 ms | noise-level |

Attribution at whole-Bible scale, after the fix:

- Decision projection: ≈ 2.6 s (was ≈ 5.9 s) — the sort-key fix.
- Alignment projection by difference: 1,313 ms (was 3,072 ms) — the slot-Set memo.
- The `[C1] breakdown` line still prints ~2.5 s: that micro-measure times the OLD
  per-head `slotKeysOf(...).includes(...)` pattern directly, as a reference. The
  fold no longer executes that pattern — the by-difference number is the real cost.
- The largest single REMAINING constant is the per-fold re-validation of all
  events (~1.8 s at whole-Bible scale, per the #80 profile). That is §8.6 step 1
  behavior; skipping it for pre-validated events needs a spec ruling (noted in
  #92 as out of scope). The structural fix for the save path stays #93.

The open() scan numbers are unchanged in kind (the fold is not the scan):
reference scan 39.8 s / scan+fold 42.8 s at 278k segments in this run — I/O
variance against the baseline's 33.2/41.3 s, same curve shape, same on-disk
size (259,580,461 bytes).

## What this means for the save path

The whole-journal re-fold a save pays (see the #80 record, "When a user pays these
costs") drops from ~9.3 s to **~4.2 s** at checked-whole-Bible scale, and from
~0.67 s to **~0.33 s** for an aligned NT — before the #93 per-book scoping and the
#94 worker offload, which remain the structural fixes.

## Full outputs

```
bench-fold — issue #80
date: 2026-08-25T21:25:01.262Z  commit: 6a149f2  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median)
corpus: 27 books, 7959 verses, 0 check decisions, 15945 events total, 7986 events (text-only)

[fold] aligned NT (15945 events, 7959 alignment heads, 0 decisions): 328.8 ms  (runs: 310.5, 328.8, 340.4)
[C1] verseTextMd5 over the 7959 projected alignment texts: 26.8 ms  (0.003 ms/parse)
[C1] control — same fold minus align.verse.set ONLY (7986 events, decisions kept): 55.9 ms  (alignment projection cost by difference: 272.9 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 346.8 ms over 7959 heads
[C2] text-only union: 7986 events, 8013 head keys; base fold 53.9 ms
[C2] + one constant-shape rename apply, 0 mapped keys: 70.6 ms; 500 mapped keys: 92.4 ms
[C2] marginal scan cost: 0.044 ms per mapped key over 8013 head keys (5.4 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]    7 books,  5663 events,  5670 head keys: 35.7 ms
[C3]   14 books,  6566 events,  6580 head keys: 41.3 ms
[C3]   27 books,  7986 events,  8013 head keys: 54.6 ms
[open] full-scan baseline — REFERENCE READER (fs), a LOWER BOUND on the production HTTP open path; one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]     1000 segments: scan 57.9 ms, scan+fold 74.6 ms  (write of last batch: 269.8 ms)
[open]     2000 segments: scan 112.4 ms, scan+fold 166.2 ms  (write of last batch: 260.7 ms)
[open]     4000 segments: scan 219.6 ms, scan+fold 310.5 ms  (write of last batch: 498.5 ms)
[open]     8000 segments: scan 449.1 ms, scan+fold 623.1 ms  (write of last batch: 1023.5 ms)
[open]    15945 segments: scan 994.3 ms, scan+fold 1393.1 ms  (write of last batch: 2010.2 ms)
[open] on-disk journal: 15945 segments, 34,907,865 bytes (33.3 MiB content; avg 2189 B/segment)
```

```
bench-fold — issue #80
date: 2026-08-25T21:25:24.053Z  commit: 6a149f2  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median) — checked whole Bible
corpus: 66 books, 31104 verses, 215767 check decisions, 278041 events total, 31170 events (text-only)

[fold] checked whole Bible (278041 events, 31104 alignment heads, 215767 decisions): 4238.7 ms  (runs: 4053.5, 4238.7, 4628.9)
[C1] verseTextMd5 over the 31104 projected alignment texts: 104.9 ms  (0.003 ms/parse)
[C1] control — same fold minus align.verse.set ONLY (246937 events, decisions kept): 2926.0 ms  (alignment projection cost by difference: 1312.7 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 2512.1 ms over 31104 heads
[C2] text-only union: 31170 events, 31236 head keys; base fold 331.7 ms
[C2] + one constant-shape rename apply, 0 mapped keys: 340.4 ms; 500 mapped keys: 718.5 ms
[C2] marginal scan cost: 0.756 ms per mapped key over 31236 head keys (24.2 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]   17 books, 12887 events, 12904 head keys: 100.3 ms
[C3]   33 books, 22718 events, 22751 head keys: 186.2 ms
[C3]   66 books, 31170 events, 31236 head keys: 297.2 ms
[open] full-scan baseline — REFERENCE READER (fs), a LOWER BOUND on the production HTTP open path; one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]     8000 segments: scan 541.4 ms, scan+fold 892.1 ms  (write of last batch: 2150.1 ms)
[open]    32000 segments: scan 3570.6 ms, scan+fold 3546.0 ms  (write of last batch: 5593.1 ms)
[open]   128000 segments: scan 15104.8 ms, scan+fold 17736.2 ms  (write of last batch: 24999.4 ms)
[open]   278041 segments: scan 39805.8 ms, scan+fold 42827.2 ms  (write of last batch: 40031.8 ms)
[open] on-disk journal: 278041 segments, 259,580,461 bytes (247.6 MiB content; avg 934 B/segment)
```
