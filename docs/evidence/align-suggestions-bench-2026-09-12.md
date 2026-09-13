# Alignment suggestions — training time and the live witness (issue #1, 2026-09-12)

Two records for D72 point 3: how long the suggestion engine trains on the
owner's responsiveness fixture, and what the running app did on the dev rig.

## 1. Training time on the fixture (NT + Genesis + Psalms)

Fixture, per the owner's ruling of 2026-09-12: every `\zaln` link of
unfoldingWord `en_ult` v89 for the whole New Testament plus Genesis and Psalms,
read as if they were a project's own confirmed alignments; one model per
testament. Source: the rig's cached export
`dev-env/resources-cache/en_ult-v89-unwrapped.zip`. Runner:
`TC4_SUGGEST_BENCH=1 npx vitest run test/align-suggest-bench.test.ts` (opt-in,
skipped otherwise). Machine: the owner's macOS arm64 development machine, Node
22, nothing else running. Engine: `MorphJLBoostWordMap` with gatewayEdit's
options (sourceNgramLength 3, targetNgramLength 5, train_steps 1000), the
complexity cap 100 000 (NT) / 50 000 (OT), boosting on the capped share and
every remaining verse in alignment memory (`src/data/align/suggestEngine.ts`).

| Model | Aligned verses | In memory | Boosted on (cap) | Boosted complexity | Train | One prediction |
|---|---|---|---|---|---|---|
| NT (Greek) | 7 958 | 7 958 | 206 (100 000) | 99 825 | **273.3 s** | 101 ms |
| OT (Hebrew; GEN + PSA) | 3 994 | 3 994 | 110 (50 000) | 49 899 | **136.8 s** | 56 ms |

Whole run 414 s. A first run before the memory step measured 284.4 s / 133.6 s
with predictions of 148 ms / 65 ms — the memory step is an index, not a fit.
Both trainings sit inside gatewayEdit's 6–8 minute envelope for its default
caps [VERIFIED — `enhanced-word-aligner-rcl` 1.4.8 `dist/common/constants.js`:
`THRESHOLD_TRAINING_MINUTES = 8`, `MIN_THRESHOLD_TRAINING_MINUTES = 6`]. That
is the time the Web Worker spends off the main thread; the aligner's hands
never wait on it (the row reads "Learning from your aligned verses…" and
Suggest is disabled until the model answers).

What the cap means in practice: the booster is fitted on roughly 200 verses
of the NT corpus (the cap is a product of source × target token counts), while
all 7 958 verses feed the alignment memory that the prediction consults. This
is gatewayEdit's behaviour with its `keepAllAlignmentMemory` path, adopted as
the default here so the ruling "learns from the project's own confirmed
alignments" holds for every confirmed verse.

## 2. Live witness on the dev rig

Rig: pankosmia-web 0.18.5 (`99fd9be`), seeded sample project ("Equipo Ejemplo
— Tito y Jonás", es-419), Titus 1:1 with 6 placed words and 21 in the bank; the
UGNT pinned as the NT original text (the same pins J5 writes). Client from this
branch via `npm run dev`. Observations are DOM probes and disk reads, not
screenshot readings.

| Step | Observed |
|---|---|
| Open Align, switch off | Suggestions row `data-status="off"`, no Suggest button, bank 21 |
| Switch on | row → `training` → `ready`; status text "Drawn from 1 verses you have already aligned"; Suggest enabled |
| Suggest | one dashed chip (`el ✓`) under the `δὲ` card; bank shows 20; progress still "6 of 27 words placed" |
| No trace | sidecar sha256 `01203bb359b19c40…` unchanged; journal segments 2 → 2 |
| Mark valid while the chip stands | refused: "Confirm or reject the suggested links first."; button stays inactive; `done` absent on disk |
| Confirm the chip | chips 0; progress "7 of 27"; sidecar: `el` under card 4 (`δὲ`), occurrences integers, no `done`; journal segments 2 → 3, one `align.verse.set` |

Also witnessed in dev: Vite's first-use dependency optimization reloaded the
page when the worker first imported the engine packages; `optimizeDeps.include`
in `vite.config.js` pre-bundles them so this cannot recur (it is a dev-server
artifact; the production build has a fixed worker chunk).

The rig was reseeded afterwards.
