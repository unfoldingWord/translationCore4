# The fold off the main thread — the issue #94 record

**Date:** 2026-09-14. **Branch:** `issue-94-fold-worker` (worktree `wt-94`), baseline
`origin/main` at 16f1ad6 (its `src/` is byte-identical to the `wt-9` tree that served the
baseline). **Machine:** Apple M2 Pro, macOS 26.5.1, Chromium (the Claude Code browser
pane), Vite dev client on :5199, `pankosmia-web` 0.18.5 rig on :19998.

## What was measured

The freeze a save causes on the main thread, with the journal large enough for the fold
to be felt. `sample_burrito_large` (4,002 segments) folds too fast to register on either
branch, so a heavier fixture was generated with the same generator:
`node scripts/seed-large-project.mjs <rig>/repos/_local_/_local_/sample_burrito_xl --edits 40000`
— Titus with 40,000 saved verse edits, 40,002 segments, clean fold. The project was opened
in each client (81 s and 90 s to interactive — the open scan is #80's known cost, unchanged
by this issue), then one verse was edited and saved twice.

Probe, installed in the page before each save:

```js
new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); })
  .observe({ type: 'longtask' });                      // every main-thread task > 50 ms
setInterval(() => { gap = Math.max(gap, performance.now() - last - 16); last = performance.now(); }, 16);
```

`lt` is the list of long tasks during the save; `gap` is the longest stretch the 16 ms
interval could not run — the time typing and clicking would have stalled.

## Results

| Client | Save | Long tasks during the save | Longest input stall | Save reached `saved` |
|---|---|---|---|---|
| main (fold on the main thread) | 1 | **222 ms** | **214 ms** | yes |
| main | 2 | **213 ms** | **209 ms** | yes |
| `issue-94-fold-worker` (fold in the worker) | 1 | none | 31 ms | yes |
| `issue-94-fold-worker` | 2 | none | 10 ms | yes |

On the 4,002-segment `sample_burrito_large`, main already shows no long task during a
save (longest stall 27 ms): that fixture is below the threshold on both branches.

The worker is observable: the dev server serves
`/src/data/journal/foldWorker.ts?worker_file&type=module` when the project opens
[VERIFIED — network log of the branch client, 2026-09-14].

## What this does and does not claim

- The fold's cost did not move: a 40k-event journal still folds for about 0.2 s. It now
  runs in the fold worker, so the interface keeps painting and taking input while it runs.
- Save latency (edit → `saved`) is unchanged in kind: it is dominated by the publish and
  the checkpoint writes, not by the fold, on this fixture.
- The open scan (81–90 s for 40k segments) is issue #80's transport cost and is not
  touched here.

## Structural proof

`test/foldRunner.test.ts` asserts that `src/data/journal/journalingStore.ts` neither
imports nor calls `fold` — every fold goes through its `FoldRunner`, which is the Web
Worker in the browser and the inline function in Node — and that overlapping saves
through a jittery runner fold to the same state as sequential saves (three rounds).
