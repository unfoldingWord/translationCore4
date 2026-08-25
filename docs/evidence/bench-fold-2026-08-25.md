# Journal size and speed cost — the issue #80 record

**Date:** 2026-08-25. **Commit:** f538335. **Machine:** Apple M2 Pro (10 cores), 16 GB
RAM, macOS 26.5.1, Node v22.14.0, `pankosmia-web` 0.18.5 rig.

The source of the fold numbers is `conformance/bench-fold.mjs` (`node bench-fold.mjs`
for the aligned NT; `node bench-fold.mjs --bible` for the checked whole Bible). Each
fold number is the median of 3 repetitions. [VERIFIED — the full outputs are below:
the NT run 2026-08-25 18:51 UTC, the whole-Bible run 2026-08-25 19:14 UTC, both at
f538335.]

## What the benchmark folds

The benchmark builds a synthetic aligned New Testament journal from real material:

- Verse counts: `conformance/fixtures/vrs/eng.json`, the 27 NT books — 7,959 verses.
- Verse text: the Spanish TIT verse texts of `conformance/sample-burrito` (cycled).
- Alignment records: the complete §5.1 TIT records (cycled). The benchmark computes
  `targetVerseMd5` again for the cycled text, so each alignment is valid at projection.
- Events: one `book.add` for each book, then one `text.verse.set` and one
  `align.verse.set` for each verse — 15,945 events.

The corpus folds clean: no forks, no retained heads, no invalid alignments. The
benchmark makes sure of this before it measures. The fold under test is
`conformance/journal/fold.mjs`. The production client imports the same module
(issue #62), so the numbers measure the real client path.

## Headline numbers

| Measurement | Result |
|---|---|
| Full fold, aligned NT (15,945 events) | **684 ms** |
| The same fold without alignments (7,986 events) | 53 ms |
| open() full scan + fold, 15,945 segments | **1,880 ms** (scan alone: 1,121 ms) |
| Full fold, CHECKED WHOLE BIBLE (278,041 events) | **9,431 ms** — see the `--bible` section |
| open() scan + fold, checked whole Bible | **43,658 ms**; journal content 247.6 MiB |
| Application build size (`dist/`, vite production) | **2,233,128 bytes (2.13 MiB)** raw; JS gzip ≈ 580 kB |
| Application start-up, cold, rig-served production build | **334 ms** median to interactive |

## The three cost centres (issue #80)

**C1 — one usfm-js parse for each alignment head at projection.** This expected
dominant cost is NOT dominant. All 7,959 `verseTextMd5` parses together cost **26 ms**
(0.003 ms for each parse). The full alignment-projection cost, by difference (the fold
with alignments minus the fold without), is **630 ms**. The measured breakdown points
at `slotKeysOf(skeleton).includes(vkey)`: for EACH alignment head, the fold derives the
whole book's slot list again (a regex walk of the full skeleton) and then does a linear
membership test. That step alone costs **363 ms** over 7,959 heads. The remainder of
the difference is in the same loop: `resolveKey` for each head, the record rebuild, and
the projected-verse lookup. A later optimization must start at the slot-list
recomputation, not at the parser.

**C2 — a scan of all heads for each mapped key inside `text.structure.apply`.**
Measured on the text-only union (7,986 events, 8,013 head keys), with one apply event
that merges M verse pairs. M=1 costs 81 ms total; M=500 costs 111 ms. The marginal scan
cost is **0.060 ms for each mapped key** over 8,013 head keys (≈ 7.5 ns for each
mapped-key×head). A usual structural action has few mapped keys and costs less than
1 ms of scan. A 500-key restructure adds approximately 30 ms. This cost is negligible
at NT scale.

**C3 — a scan of all heads for each book at projection.** Text-only fold time against
book count: 7 books / 5,670 head keys → 35 ms; 14 books / 6,580 → 43 ms; 27 books /
8,013 → 53 ms. The growth is more than linear (the scan is O(books × head keys)), but
the total is small: the full text-only NT fold is ~53 ms. This is not a concern now.

## The open() full-scan baseline (deferred from #62)

`open()` reads and validates EVERY segment of every actor, then folds the union. The
model: one sealed action segment for each event (the D50 write model — one save, one
segment), on a local disk. Medians of 3:

| Segments | Scan (read + validate) | Scan + fold |
|---|---|---|
| 1,000 | 60 ms | 113 ms |
| 2,000 | 127 ms | 228 ms |
| 4,000 | 250 ms | 513 ms |
| 8,000 | 521 ms | 951 ms |
| 15,945 | 1,121 ms | 1,880 ms |

The scan grows linearly at ≈ **0.07 ms for each segment** (read + JSON parse + sha256 +
schema validation). A full aligned-NT journal, held as one segment for each save, opens
in less than 2 s on this machine. A later shortcut that replaces the full scan must
beat this curve AND show semantic equivalence under out-of-order action timestamps
(#62).

## The checked whole Bible (measured, `--bible`)

The `--bible` mode measures the full product scale: all 66 books, drafted and aligned,
PLUS one `check.decision.set` for every real check. The check counts come from
`conformance/fixtures/check-density.json`: the per-book TSV row counts of `en_tn`
master and `en_twl` master (both manifest version 89, fetched from
git.door43.org/unfoldingWord 2026-08-25). Totals: **107,220 translationNotes checks +
108,547 translationWords checks = 215,767 decisions**. The corpus: 66 books, 31,104
verses, **278,041 events** — one save for each event, one segment for each save (D50).

| Measurement | Result |
|---|---|
| Full fold, checked whole Bible (278,041 events) | **9,431 ms** |
| The same fold, text-only (31,170 events) | 273 ms |
| open() full scan, 278,041 segments | **34,722 ms** |
| open() scan + fold, 278,041 segments | **43,658 ms** |
| Journal content on disk | **259,580,461 bytes (247.6 MiB)**, avg 934 B/segment |

The open() scan curve (medians of 3):

| Segments | Scan (read + validate) | Scan + fold | ms per segment (scan) |
|---|---|---|---|
| 8,000 | 355 ms | 674 ms | 0.044 |
| 32,000 | 2,461 ms | 3,292 ms | 0.077 |
| 128,000 | 12,108 ms | 16,359 ms | 0.095 |
| 278,041 | 34,722 ms | 43,658 ms | 0.125 |

The per-segment cost GROWS with the segment count — the scan is worse than linear.
All segments of one actor live in one directory; 278k files in one directory add
filesystem overhead per open. At full scale, **a project open that reads the whole
journal costs ~44 s on this machine**. This is the number a later open() shortcut
(#62 baseline rule) must beat.

Cost centres at Bible scale: the C1 breakdown holds. All 31,104 usfm-js parses cost
100 ms; the per-head `slotKeysOf(...).includes(...)` recomputation costs **2,039 ms**
(PSA alone has 2,461 slots, and the walk is O(slots) for each head). C2 at Bible
scale: 0.513 ms per mapped key over 31,236 head keys. C3: text-only fold grows
77 → 156 → 273 ms at 17 → 33 → 66 books.

**Profile of the fold remainder** [VERIFIED — `node --cpu-prof` with
`BENCH_FOLD_ONLY=1 --bible`, 2026-08-25, 31,033 samples over the corpus build + 4
folds]. The former ~7 s flag is resolved; per fold, the self-time splits:

- **~3.5 s — canonicalization for the §8.6 decision sort.** The sort comparator
  (fold.mjs:820) calls `canon(contextId)` on EACH comparison: ~7.6M calls for 215,767
  records. The cost concentrates in `putOwn` (22.2% of all samples — one
  `Object.defineProperty` per copied field inside `sortKeys`) plus `sortKeys` (7.5%)
  and `canon` (7.0%). Fix shape: compute each record's sort key ONCE (and rebuild
  `canon` without per-field defineProperty).
- **~1.4 s — `slotKeysOf`** (14.3% — the C1 hotspot, seen again).
- **~1.8 s — step-1 re-validation of all 278k events on every fold**
  (`isNfc` 6.3%, `isCalendarInstant` 3.6%, `jsonRoundTripError` 3.3%,
  `nfcKeysError` 2.9%, `validateEvent` 1.1%). §8.6 step 1 validates
  unconditionally; a store that already validated at intake pays it again on each
  re-fold.
- The rest: fold bookkeeping self-time (9.4%), GC (6.1%), `joinHead`/`resolveKey`
  (~1.7% combined).

**How the journal compresses** [VERIFIED — 8,058 sealed sample segments in corpus
proportions, avg 930 B (the real corpus: 934 B), gzip level 6]: 2.33x per file
(each small segment gzipped alone — a zip archive, or git loose objects), 17.62x as
one stream (cross-segment redundancy). Scaled to the 259,580,461-byte journal:
**~106 MiB as a per-file zip; ~14 MiB as one solid stream**. A git pack sits between
the two (zlib per object, plus deltas across similar JSON). The burrito at rest is a
git working tree — NOT zipped; the sb-zip form exists for transport only.

**Defect found by this measurement.** The first whole-Bible run CRASHED in
`readUnion` (`conformance/journal/files.mjs`): `events.push(...readSegments(...))`
spreads one actor's whole event array as call arguments, and ~278k arguments exceed
the V8 stack — `RangeError: Maximum call stack size exceeded`. The reference reader
could not open a journal past roughly 100k events at all. Fixed in the same change
set (an element-wise loop); the journal suite still passes 336/336. The client has
the same pattern in bounded per-segment positions (`src/data/journal/verify.ts:115`,
`journalingStore.ts:671/1585/2160`) — bounded by one action's event count today, but
the same defect class if an action ever carries tens of thousands of events.

**When a user pays these costs.** [VERIFIED — source read 2026-08-25 at f538335.]
The journal path is wired into the UI since #62 (merged in #88):

- The FULL SCAN + FOLD runs on every project open: `openProject`
  (`src/state.jsx:1635`) awaits `JournalingStore.open()`, which reads every segment
  of every actor and folds the union.
- A WHOLE-JOURNAL RE-FOLD runs on every save: drafting (`writeBook`, via the
  SaveScheduler at `src/state.jsx:1643`), aligning (`writeAlignments`,
  `src/state.jsx:963`) and checking (`upsertDecision`, `src/state.jsx:1199`) each
  call `foldNow()` on the write path (`journalingStore.ts:1691/1775/1838`) and again
  after publish to regenerate the checkpoint files.
- Reads do NOT pay the fold: `readAlignments`/`readDecisions` read the checkpoint
  files directly (`journalingStore.ts:329-349`).

At the measured whole-Bible scale that is ~44 s for each project open and ~9.4 s for
each save, on this machine.

**Burrito size at this scale.** The journal alone is **247.6 MiB** of content in
278,041 files. On APFS each small file occupies at least one 4 KiB block, so the
journal allocates **~1.1 GiB** on disk. In git the JSON packs well (deflate), but
278k blobs also cost object-count overhead at status/clone time. The checkpoint
ingredients (§8.7) come on top: the projected USFM (~5 MiB plain text), the §5.1
alignment sidecars (~100 MiB at these record sizes), and the decision files
(~50–90 MiB) — estimates from the corpus record sizes, not measured. Real journals
grow further with every re-edit: this corpus is exactly one save per record.

## Build size

`npm run build` at f538335 (vite 7, production):

| Artifact | Raw | Gzip |
|---|---|---|
| `assets/index-CxQXzdh4.js` | 947,765 B | 311,990 B |
| `assets/index-D_3FDXx0.js` | 1,042,794 B | 268,134 B |
| `assets/index-DMvnoCBN.css` | 964 B | 428 B |
| **Total `dist/`** (with HTML + 3 logo PNGs) | **2,233,128 B** | JS ≈ 580 kB |

Vite warns that the two JS chunks are larger than 500 kB minified. The build has no
code-splitting configuration.

## Start-up time

The measurement uses the production build, installed into the rig
(`scripts/rig-install.zsh`) and served by `pankosmia-web` 0.18.5 at
`/clients/uw-tc4/` — the packaged-app path. The probe is
`docs/evidence/tools/bench-startup.mjs` (Playwright Chromium). Each run uses a fresh
browser context, so each load is cold. The clock stops when the Home "New Bible"
button is visible. 5 cold loads after 1 warm-up:

```
ready 296 / 393 / 334 / 295 / 471 ms  → median 334 ms
(domContentLoaded 253–432 ms; load event within 1 ms of it)
```

Start-up does not include a journal fold: the Home screen lists projects and opens
none. When the user opens a project, the open() cost above applies.

## Full benchmark output

```
bench-fold — issue #80
date: 2026-08-25T18:51:50.456Z  commit: f538335  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median)
corpus: 27 books, 7959 verses, 15945 events (aligned), 7986 events (text-only)

[fold] aligned NT (15945 events, 7959 alignment heads): 683.5 ms  (runs: 677.2, 683.5, 745.6)
[C1] verseTextMd5 over the 7959 projected alignment texts: 25.9 ms  (0.003 ms/parse)
[C1] cross-check — same fold WITHOUT alignments: 53.3 ms  (alignment projection cost by difference: 630.2 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 362.7 ms over 7959 heads
[C2] text-only union: 7986 events, 8013 head keys; base fold 53.3 ms
[C2] + one apply, 1 mapped key(s): 81.4 ms; 500 mapped keys: 111.4 ms
[C2] marginal scan cost: 0.060 ms per mapped key over 8013 head keys (7.5 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]    7 books,  5663 events,  5670 head keys: 34.9 ms
[C3]   14 books,  6566 events,  6580 head keys: 43.0 ms
[C3]   27 books,  7986 events,  8013 head keys: 52.8 ms
[open] full-scan baseline: one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]    1000 segments: scan 60.2 ms, scan+fold 112.5 ms  (write of last batch: 283.8 ms)
[open]    2000 segments: scan 126.6 ms, scan+fold 227.9 ms  (write of last batch: 320.7 ms)
[open]    4000 segments: scan 250.2 ms, scan+fold 512.9 ms  (write of last batch: 646.5 ms)
[open]    8000 segments: scan 520.7 ms, scan+fold 951.0 ms  (write of last batch: 1141.6 ms)
[open]   15945 segments: scan 1121.0 ms, scan+fold 1880.2 ms  (write of last batch: 2339.9 ms)
```

## Full benchmark output — checked whole Bible (`--bible`)

```
bench-fold — issue #80
date: 2026-08-25T19:14:28.652Z  commit: f538335  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median) — checked whole Bible
corpus: 66 books, 31104 verses, 215767 check decisions, 278041 events total, 31170 events (text-only)

[fold] checked whole Bible (278041 events, 31104 alignment heads, 215767 decisions): 9430.6 ms  (runs: 9277.8, 9430.6, 9567.6)
[C1] verseTextMd5 over the 31104 projected alignment texts: 100.4 ms  (0.003 ms/parse)
[C1] cross-check — same fold WITHOUT alignments: 272.6 ms  (alignment projection cost by difference: 9158.1 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 2038.8 ms over 31104 heads
[C2] text-only union: 31170 events, 31236 head keys; base fold 272.6 ms
[C2] + one apply, 1 mapped key(s): 278.5 ms; 500 mapped keys: 534.3 ms
[C2] marginal scan cost: 0.513 ms per mapped key over 31236 head keys (16.4 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]   17 books, 12887 events, 12904 head keys: 77.1 ms
[C3]   33 books, 22718 events, 22751 head keys: 156.0 ms
[C3]   66 books, 31170 events, 31236 head keys: 272.9 ms
[open] full-scan baseline: one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]     8000 segments: scan 355.2 ms, scan+fold 674.0 ms  (write of last batch: 1649.7 ms)
[open]    32000 segments: scan 2460.6 ms, scan+fold 3292.2 ms  (write of last batch: 4925.6 ms)
[open]   128000 segments: scan 12108.3 ms, scan+fold 16359.3 ms  (write of last batch: 20661.2 ms)
[open]   278041 segments: scan 34721.5 ms, scan+fold 43657.8 ms  (write of last batch: 50430.3 ms)
[open] on-disk journal: 278041 segments, 259,580,461 bytes (247.6 MiB content; avg 934 B/segment)
```

## Conclusions

1. The full aligned-NT fold is **less than 0.7 s**. open() with a 16k-segment journal
   is **less than 2 s**. The current design is usable at NT scale with no optimization.
2. The CHECKED WHOLE BIBLE is a different story. The fold is **9.4 s** and a
   full-journal open() is **~44 s** (278k segments, 247.6 MiB, ~1.1 GiB allocated on
   APFS). At full product scale the open() full scan and the projection loops need
   the optimization work that #62 and this record baseline.
3. The usfm-js parse count (the presumed dominant cost in issue #80) is NOT the cost:
   31k parses ≈ 100 ms total. The profiled fold hotspots, in order: the decision-sort
   canonicalization (~3.5 s — one `canon()` per comparison, with `putOwn`'s
   per-field defineProperty as the inner cost), the per-alignment-head slot-list
   recomputation (`slotKeysOf`: 363 ms NT, ~2 s Bible; one memoized slot Set for
   each book removes it), and the per-fold re-validation of all events (~1.8 s).
   All three have small, semantics-preserving fixes.
4. The structural-apply head scan (C2) and the per-book projection scan (C3) are
   negligible at both scales.
5. This measurement found and fixed a real defect: `readUnion` crashed on any
   journal past ~100k events (spread-as-arguments). The whole-Bible corpus is now
   the only executable proof at that scale — keep `--bible` runnable.
