# Evidence: derive performance on the largest real books (OPEN-QUESTIONS #9 / C2.10)

**Date:** 2026-08-03 · **Command:** `cd translationCore4 && npx vitest run test/perf-derive.test.ts
--disable-console-intercept` · **Data:** the rig's installed en_tn v89 / en_tw v89 (real published
resources, not fixtures) · **Method:** median of 5 runs per book.

## Measured

| tool | book | file size | items derived | median |
|---|---|---|---|---|
| tN | TIT | 56 KiB | 157 | 0.4 ms |
| tN | JON | 81 KiB | 172 | 0.5 ms |
| tN | MAT | 1987 KiB | 5246 | 12.9 ms |
| **tN** | **PSA** | **3041 KiB** | **7971** | **20.6 ms** |
| tW | TIT | 9 KiB | 182 | 0.2 ms |
| tW | JON | 10 KiB | 200 | 0.2 ms |
| tW | PSA | 401 KiB | 7683 | 6.2 ms |

Psalms is the worst case in the canon: en_tn's largest book file by a wide margin. Cost scales
roughly linearly with file size (~6.8 µs per KiB for tN).

## Scope of the claim — read this before quoting the numbers

- **This measures `derive` only** — TSV → check items. A real session open also reads the file
  over HTTP from the platform, merges stored decisions, and revalidates. Those were not isolated
  here.
- **This machine is not a low-end machine.** The checklist asks for a low-end measurement; this is
  an Apple-silicon laptop. Treat the numbers as a lower bound. Even allowing a 10× slower device,
  the worst case lands near 200 ms.
- The suite **skips** when the rig's sideloaded resources are absent, and says so — a skipped run
  is not evidence.

## What it implies for the disposable cache (owner decision, not taken here)

The mitigation OPEN-QUESTIONS #9 designed — a disposable cache keyed by content hashes — was
scoped before any measurement existed. On this evidence the worst book in the canon derives in
~21 ms, and a 10×-slower device would still be far inside a normal screen transition. A cache
would add an invalidation surface (content hashes, staleness, eviction) to save time that does not
appear to be there.

**Recommendation: do not build the cache in Increment 2.** Re-measure if a real low-end device
shows session opens that users notice, or if derive gains work per item (for example
alignment-aware occurrence resolution).

This is a product call, so it is recorded as a recommendation and referred to the project owner.
