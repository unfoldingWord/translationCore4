# Open time at the large fixture's scale, second run — the issue #95 record, run 2

**Date:** 2026-09-05. **Commit:** `6978910` (the same tree as `open-time-2026-09-05.md`).
**Machine:** Apple M2 Pro (10 cores), 16 GB RAM, macOS 26.5.1, Node v22.14.0, `pankosmia-web`
0.18.5 rig (git rev `99fd9be`), the Vite dev server (`npm run dev`) at :5199, Chromium via
Playwright 1.61.1.

## Why a second record

The first run's spec had a missing `await` on its last assertion (it did not affect the
measurement, which is taken before that line). The spec was corrected and run again on the same
tree. `docs/evidence/README.md` rule 3: a record is never edited to change a measurement, so the
second run is its own record.

## Command

```bash
dev-env/scripts/stop.zsh; dev-env/scripts/seed.zsh; dev-env/scripts/run.zsh   # the workspace rig, reseeded
npx playwright test e2e/j15-slow-open.spec.ts
```

## What was measured

The same as the first record: the app's own open path — `JournalingStore.open()` over HTTP — on
`_local_/_local_/sample_burrito_large` (4,002 segments, 2,044,187 bytes of sealed segments,
average 510 bytes), from the click on Home to the opened book's text on screen, with every
indicator value recorded. Not the packaged application.

## Result

```
J15 open-time: sample_burrito_large · 4002 segments · 4620 ms click-to-text · stages journal>state>prepare · 96 distinct values, first 5, last 100
  3 passed (19.5s)
```

| Measurement | Result |
|---|---|
| Segments the open listed and read (one scan of a clean open) | 4,002 |
| Click to book text on screen | **4,620 ms** |
| Per segment, all-in (transport + validation + fold + UI) | ≈ 1.15 ms |
| Distinct progress values shown | 96 (5 → 100) |
| Stages shown, in order | reading the journal → checking the project state → preparing the project |
| Fold-compare verifier on the fixture after the open | verified (teardown green) |

Two runs on one machine (5,135 ms and 4,620 ms); point estimates, not a median. The criterion
this record serves is that a slow open shows real progress, not a speed target (owner's ruling,
2026-08-25).

That the union read fetches each listed segment once on a clean open is proved by
`test/openProgress.test.ts` ("a fresh open reads every segment exactly once", a spy on
`ServerApi.readIngredient`). An open that recovers a staged intent first probes that intent's
own path in `replayStaged()`; that is one read per staged intent, not a second scan.

## Limits

- The fixture's segments are small `text.verse.set` edits (510 bytes sealed on average);
  alignment and decision segments are larger and validate more slowly.
- Development build (Vite dev server, unminified modules); the packaged application was not
  measured.
- Not measured: a cold rig process, a spinning disk, a second actor's directory.
