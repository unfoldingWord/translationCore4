# Test fixtures — provenance

These files are pinned copies. Do not edit them. Tests read them read-only.

| File | Source | Version | Commit (revision in the export's metadata.json) | How fetched | Date |
|---|---|---|---|---|---|
| `en_ult/TIT.usfm` | unfoldingWord en_ult (aligned USFM) | v89 | `84c73ba00fc8a95a9033f9efb14bb905a2a52ee4` | DCS sb-zip export (`/sb/<tag>.zip`) | 2026-07-30 |
| `en_ust/TIT.usfm` | unfoldingWord en_ust (aligned USFM) | v89 | `37ec223166bbd73fb55abc7840be8310c0fee7f2` | DCS sb-zip export (`/sb/<tag>.zip`) | 2026-07-30 |

The copies came from the dev rig at
`dev-env/state/work/repos/_local_/_sideloaded_/en_ult|en_ust/ingredients/TIT.usfm`.
The commit hashes above match the `revision` field in each sideloaded burrito's
`metadata.json` (verified 2026-07-30). The copies make the tests independent of
rig state.

The plain-draft corpora are in `sample-burrito/`:

| File | Source | Contents | Date |
|---|---|---|---|
| `sample-burrito/TIT.usfm` | generated `sample-burrito/ingredients/TIT.usfm` | plain draft, `___` stubs | 2026-07-30 |
| `sample-burrito/JON.usfm` | generated `sample-burrito/ingredients/JON.usfm` | plain draft, `___` stubs, JON 2:9-10 span verse | 2026-07-30 |

`test/indexer.test.ts` and `test/splice.test.ts` read these two files.

These two files are a **dated snapshot**, not a live mirror. The generator makes the
live copy: run `npm run generate` in the `sample-burrito-validation` workspace, which
writes `../sample-burrito/`. That workspace is not part of this repository. Do not edit
the snapshot. To refresh it, run the generator and copy the two draft files again.
