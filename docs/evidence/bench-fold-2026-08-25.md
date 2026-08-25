# Journal size and speed cost — the issue #80 record

**Date:** 2026-08-25. **Baseline commit:** 9aa17f2 (clean tree — the benchmark stamps
and refuses a dirty tree). **Machine:** Apple M2 Pro (10 cores), 16 GB RAM, macOS
26.5.1, Node v22.14.0, `pankosmia-web` 0.18.5 rig.

The source of the fold numbers is `conformance/bench-fold.mjs` (`node bench-fold.mjs`
for the aligned NT; `node bench-fold.mjs --bible` for the checked whole Bible). Each
fold number is the median of 3 repetitions. [VERIFIED — the full outputs are below,
both run 2026-08-25 20:33 UTC at 9aa17f2.]

## What the benchmark folds

The benchmark builds synthetic corpora from real material:

- Verse counts: `conformance/fixtures/vrs/eng.json`.
- Verse text: the Spanish TIT verse texts of `conformance/sample-burrito` (cycled).
- Alignment records: the complete §5.1 TIT records (cycled). The benchmark computes
  `targetVerseMd5` again for the cycled text, so each alignment is valid at
  projection.
- Check counts (`--bible` only): `conformance/fixtures/check-density.json` — the
  per-book TSV row counts of `en_tn` master and `en_twl` master (both manifest
  version 89, fetched from git.door43.org/unfoldingWord 2026-08-25).

The default corpus is an aligned New Testament: 27 books, 7,959 verses, one
`book.add` per book plus one `text.verse.set` and one `align.verse.set` per verse —
15,945 events. The `--bible` corpus is the checked whole Bible: 66 books, 31,104
verses, plus one `check.decision.set` for every real check — 107,220
translationNotes + 108,547 translationWords = 215,767 decisions, 278,041 events
total. One event = one save = one segment (D50).

Each corpus folds clean: no forks, no retained heads, no invalid alignments. The
benchmark makes sure of this before it measures. The fold under test is
`conformance/journal/fold.mjs`. The production client imports the same module
(issue #62), so the fold numbers measure the real client fold.

## Headline numbers

| Measurement | Result |
|---|---|
| Full fold, aligned NT (15,945 events) | **671 ms** |
| Full fold, checked whole Bible (278,041 events) | **9,279 ms** |
| Reference-reader scan + fold, NT (15,945 segments) | 1,652 ms (scan alone: 938 ms) |
| Reference-reader scan + fold, whole Bible (278,041 segments) | **41,258 ms** (scan alone: 33,171 ms) |
| Measured HTTP transport, production open path (2 full scans per open) | 0.319 ms/read × 2 → **+10.2 s NT, +177 s whole Bible** |
| Journal content on disk | NT 33.3 MiB (avg 2,189 B/segment); whole Bible **247.6 MiB** (avg 934 B/segment) |
| Application build size (`dist/`, vite production) | **2,233,128 bytes (2.13 MiB)** raw; JS gzip ≈ 580 kB |
| Application start-up, cold, rig-served production build | **334 ms** median to interactive |

## The three cost centres (issue #80), aligned NT

**C1 — one usfm-js parse for each alignment head at projection.** This expected
dominant cost is NOT dominant. All 7,959 `verseTextMd5` parses together cost
**25 ms** (0.003 ms per parse). The control removes `align.verse.set` events ONLY
(decisions stay in — there are none in the NT corpus): the fold drops from 671 ms to
50 ms, so alignment projection costs **620 ms**. The measured breakdown points at
`slotKeysOf(skeleton).includes(vkey)`: for EACH alignment head, the fold derives the
whole book's slot list again (a regex walk of the full skeleton) and then does a
linear membership test — **350 ms** over 7,959 heads on its own. A later
optimization must start at that slot-list recomputation, not at the parser.

**C2 — a scan of all heads for each mapped key inside `text.structure.apply`.**
Measured with CONSTANT-SHAPE variants: one apply that RENAMES M slots against an
identity apply (M=0) — same slot count, same transition count, same texts; only the
mapped-key set differs. On the text-only union (7,986 events, 8,013 head keys):
M=0 costs 69 ms, M=500 costs 86 ms → **0.035 ms per mapped key** (≈ 4.3 ns per
mapped-key×head). Negligible.

**C3 — a scan of all heads for each book at projection.** Text-only fold time
against book count: 7 books → 35 ms; 14 → 41 ms; 27 → 55 ms. Superlinear in shape,
small in absolute terms. Not a concern.

## The open() baseline (deferred from #62) — reference reader, a LOWER BOUND

`open()` reads and validates EVERY segment of every actor, then folds the union.
The benchmark models this with the SYNCHRONOUS filesystem reference reader
(`readUnion`): one sealed segment per event, on local disk. Medians of 3:

| Segments | Scan (read + validate) | Scan + fold |
|---|---|---|
| 1,000 | 59 ms | 111 ms |
| 2,000 | 122 ms | 205 ms |
| 4,000 | 220 ms | 402 ms |
| 8,000 | 459 ms | 844 ms |
| 15,945 (NT) | 938 ms | 1,652 ms |
| 32,000 | 2,679 ms | 3,904 ms |
| 128,000 | 12,661 ms | 16,607 ms |
| 278,041 (whole Bible) | 33,171 ms | 41,258 ms |

The per-segment scan cost grows with the count (0.059 → 0.119 ms) — all segments of
one actor live in one directory, and a 278k-file directory adds filesystem overhead.

**This is NOT the production open path.** The client fetches each segment with one
sequentially-awaited HTTP request (`ServerApi.readIngredient`), and it does so
TWICE per open (PR #96 review, second pass): `JournalStore.open()` ratchets the
clock by reading and validating every actor's segments
(`journalStore.ts:255,284`), and `recoverAndConverge` then calls `readUnion()`,
which fetches every segment AGAIN (`journalingStore.ts:918`). The transport term
was measured against the live rig (500 sequential ingredient reads, warm):
**0.319 ms per read**. Scaled at 2 scans per open: **+10.2 s** for the NT journal,
**+177 s** for the whole Bible [extrapolated from the measured per-read cost]. A
realistic production open at checked-whole-Bible scale is therefore on the order
of **three to four minutes** (≈177 s transport + validation twice + the 9.3 s fold
+ recovery work), not the 41 s reference figure. The double scan itself is an
optimization target: the ratchet needs only each segment's max ts, which the union
read already computes. A later open() shortcut must beat the whole path and prove
semantic equivalence under out-of-order action timestamps (#62).

## The checked whole Bible (`--bible`)

| Measurement | Result |
|---|---|
| Full fold (278,041 events) | **9,279 ms** |
| Fold minus `align.verse.set` only (246,937 events, decisions kept) | 6,207 ms |
| Fold, text-only (31,170 events) | 278 ms |
| Journal content on disk | 259,580,461 bytes (247.6 MiB), avg 934 B/segment |

The corrected attribution (the C1 control keeps decisions in):

- **Alignment projection: 3,072 ms** — of which the per-head slot-list recomputation
  is 2,042 ms and all 31,104 parses are 112 ms.
- **Decision projection and validation: ≈ 5,930 ms** (6,207 ms minus the 278 ms
  text-only fold).
- C2 at Bible scale: 0.324 ms per mapped key over 31,236 head keys. C3: 88 → 176 →
  277 ms at 17 → 33 → 66 books.

**Profile of the fold** [VERIFIED — `node --cpu-prof` with `BENCH_FOLD_ONLY=1
--bible`, 2026-08-25, 31,033 samples; the fold source at the profiled tree is
byte-identical to 9aa17f2]. Per fold, the self-time concentrates in:

- **~3.5 s — canonicalization for the §8.6 decision sort.** The sort comparator
  calls `canon(contextId)` on EACH comparison: ~7.6M calls for 215,767 records. The
  inner cost is `putOwn` (22.2% of all samples — one `Object.defineProperty` per
  copied field inside `sortKeys`) plus `sortKeys` (7.5%) and `canon` (7.0%).
- **~1.4 s — `slotKeysOf`** (14.3% — the C1 hotspot, seen again).
- **~1.8 s — step-1 re-validation of all 278k events on every fold** (`isNfc` 6.3%,
  `isCalendarInstant` 3.6%, `jsonRoundTripError` 3.3%, `nfcKeysError` 2.9%).
- The rest: fold bookkeeping self-time (9.4%), GC (6.1%), `joinHead`/`resolveKey`.

**Defect found by this measurement.** The first whole-Bible run CRASHED in
`readUnion` (`conformance/journal/files.mjs`): `events.push(...readSegments(...))`
spreads one actor's whole event array as call arguments, and ~278k arguments exceed
the V8 stack — `RangeError: Maximum call stack size exceeded`. The reference reader
could not open a journal past roughly 100k events at all. Fixed in this change set
(an element-wise loop); the journal suite stays green (336/336). The client has the
same pattern in bounded per-segment positions (`src/data/journal/verify.ts:115`,
`journalingStore.ts:671/1585/2160`) — bounded by one action's event count today.

**When a user pays these costs.** [VERIFIED — source read 2026-08-25.] The journal
path is wired into the UI since #62 (merged in #88):

- The FULL SCAN + FOLD runs on every project open: `openProject`
  (`src/state.jsx:1635`) awaits `JournalingStore.open()`.
- A WHOLE-JOURNAL RE-FOLD runs on every save: drafting (`writeBook`, via the
  SaveScheduler at `src/state.jsx:1643`), aligning (`writeAlignments`,
  `src/state.jsx:963`) and checking (`upsertDecision`, `src/state.jsx:1199`) each
  call `foldNow()` on the write path (`journalingStore.ts:1691/1775/1838`) and again
  after publish to regenerate the checkpoint files.
- Reads do NOT pay the fold: `readAlignments`/`readDecisions` read the checkpoint
  files directly (`journalingStore.ts:329-349`).

At whole-Bible scale that is a ~9.3 s UI-thread freeze for each save, and a project
open on the order of three to four minutes over the production HTTP path
(which scans every segment twice — see the open() section).

**How the journal compresses** [VERIFIED — 8,058 sealed sample segments in corpus
proportions, avg 930 B (the real corpus: 934 B), gzip level 6]: 2.33x per file (a
zip archive, or git loose objects), 17.62x as one stream (cross-segment
redundancy). Scaled to the whole-Bible journal: **~106 MiB as a per-file zip;
~14 MiB as one solid stream**. A git pack sits between the two. The burrito at rest
is a git working tree — NOT zipped; the sb-zip form exists for transport only.

**Burrito size at this scale.** The journal alone is 247.6 MiB of content in
278,041 files. On APFS each small file occupies at least one 4 KiB block, so the
journal allocates **~1.1 GiB** on disk. The checkpoint ingredients (§8.7) come on
top: the projected USFM (~5 MiB plain text), the §5.1 alignment sidecars (~100 MiB
at these record sizes), and the decision files (~50–90 MiB) — estimates from the
corpus record sizes, not measured. Real journals grow further with every re-edit:
this corpus is exactly one save per record.

## Build size

`npm run build` (vite 7, production; measured at f538335 — the built assets at
9aa17f2 carry the same content hashes):

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
`docs/evidence/tools/bench-startup.mjs` (Playwright Chromium). Each run uses a
fresh browser context, so each load is cold. The clock stops when the Home
"New Bible" button is visible. 5 cold loads after 1 warm-up:

```
ready 296 / 393 / 334 / 295 / 471 ms  → median 334 ms
(domContentLoaded 253–432 ms; load event within 1 ms of it)
```

Start-up does not include a journal fold: the Home screen lists projects and opens
none. When the user opens a project, the open() costs above apply.

## Full benchmark output — aligned NT

```
bench-fold — issue #80
date: 2026-08-25T20:33:14.480Z  commit: 9aa17f2  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median)
corpus: 27 books, 7959 verses, 0 check decisions, 15945 events total, 7986 events (text-only)

[fold] aligned NT (15945 events, 7959 alignment heads, 0 decisions): 670.5 ms  (runs: 651.6, 670.5, 688.8)
[C1] verseTextMd5 over the 7959 projected alignment texts: 25.1 ms  (0.003 ms/parse)
[C1] control — same fold minus align.verse.set ONLY (7986 events, decisions kept): 50.2 ms  (alignment projection cost by difference: 620.3 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 349.9 ms over 7959 heads
[C2] text-only union: 7986 events, 8013 head keys; base fold 53.4 ms
[C2] + one constant-shape rename apply, 0 mapped keys: 68.8 ms; 500 mapped keys: 86.1 ms
[C2] marginal scan cost: 0.035 ms per mapped key over 8013 head keys (4.3 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]    7 books,  5663 events,  5670 head keys: 35.0 ms
[C3]   14 books,  6566 events,  6580 head keys: 41.1 ms
[C3]   27 books,  7986 events,  8013 head keys: 54.9 ms
[open] full-scan baseline — REFERENCE READER (fs), a LOWER BOUND on the production HTTP open path; one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]     1000 segments: scan 59.1 ms, scan+fold 111.2 ms  (write of last batch: 271.7 ms)
[open]     2000 segments: scan 122.2 ms, scan+fold 204.9 ms  (write of last batch: 246.8 ms)
[open]     4000 segments: scan 219.8 ms, scan+fold 401.7 ms  (write of last batch: 496.5 ms)
[open]     8000 segments: scan 459.2 ms, scan+fold 843.5 ms  (write of last batch: 919.0 ms)
[open]    15945 segments: scan 938.3 ms, scan+fold 1651.7 ms  (write of last batch: 1982.4 ms)
[open] on-disk journal: 15945 segments, 34,907,865 bytes (33.3 MiB content; avg 2189 B/segment)
```

## Full benchmark output — checked whole Bible (`--bible`)

```
bench-fold — issue #80
date: 2026-08-25T20:33:40.361Z  commit: 9aa17f2  node: v22.14.0
machine: Apple M2 Pro (10 cores), 16 GB, darwin 25.5.0
mode: full (3 repetitions, median) — checked whole Bible
corpus: 66 books, 31104 verses, 215767 check decisions, 278041 events total, 31170 events (text-only)

[fold] checked whole Bible (278041 events, 31104 alignment heads, 215767 decisions): 9278.8 ms  (runs: 9199.2, 9278.8, 9391.8)
[C1] verseTextMd5 over the 31104 projected alignment texts: 111.7 ms  (0.004 ms/parse)
[C1] control — same fold minus align.verse.set ONLY (246937 events, decisions kept): 6207.0 ms  (alignment projection cost by difference: 3071.8 ms)
[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: 2042.4 ms over 31104 heads
[C2] text-only union: 31170 events, 31236 head keys; base fold 278.3 ms
[C2] + one constant-shape rename apply, 0 mapped keys: 309.3 ms; 500 mapped keys: 471.4 ms
[C2] marginal scan cost: 0.324 ms per mapped key over 31236 head keys (10.4 ns per mapped-key×head)
[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):
[C3]   17 books, 12887 events, 12904 head keys: 87.7 ms
[C3]   33 books, 22718 events, 22751 head keys: 176.3 ms
[C3]   66 books, 31170 events, 31236 head keys: 276.5 ms
[open] full-scan baseline — REFERENCE READER (fs), a LOWER BOUND on the production HTTP open path; one segment per event, 3 repetition(s) per size (read+validate, then +fold):
[open]     8000 segments: scan 370.9 ms, scan+fold 672.3 ms  (write of last batch: 1783.0 ms)
[open]    32000 segments: scan 2679.4 ms, scan+fold 3903.7 ms  (write of last batch: 4818.7 ms)
[open]   128000 segments: scan 12661.3 ms, scan+fold 16607.3 ms  (write of last batch: 22001.1 ms)
[open]   278041 segments: scan 33170.9 ms, scan+fold 41258.1 ms  (write of last batch: 34242.9 ms)
[open] on-disk journal: 278041 segments, 259,580,461 bytes (247.6 MiB content; avg 934 B/segment)
```

## Conclusions

1. The aligned-NT fold is **under 0.7 s** and its reference-reader open is under
   2 s (+10.2 s HTTP transport in production, which scans twice). Usable at NT scale.
2. The CHECKED WHOLE BIBLE is a different story: fold **9.3 s** per save, and a
   production open on the order of **three to four minutes** (reference scan+fold
   41 s, plus a measured 0.319 ms/read sequential HTTP transport over TWO full
   scans ≈ 177 s). The double scan (ratchet, then union) is itself a target. This is the
   baseline the #62 open() shortcut and the save-path work must beat.
3. The usfm-js parse count (the presumed dominant cost in issue #80) is NOT the
   cost: 31k parses ≈ 112 ms. The measured fold hotspots, in order: the decision
   projection (~5.9 s by difference; the profile puts ~3.5 s in the sort's per-
   comparison canonicalization), the per-alignment-head slot-list recomputation
   (~2 s; one memoized slot Set per book removes it), and the per-fold
   re-validation of all events (~1.8 s). Follow-on work: #92, #93, #94, #95.
4. The structural-apply head scan (C2) and the per-book projection scan (C3) are
   negligible at both scales.
5. This measurement found and fixed a real defect: `readUnion` crashed on any
   journal past ~100k events (spread-as-arguments). The whole-Bible corpus is now
   the only executable proof at that scale — keep `--bible` runnable.
