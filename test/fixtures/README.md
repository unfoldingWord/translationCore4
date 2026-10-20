# Test fixtures — provenance

These files are pinned copies. Do not edit them. Tests read them read-only.

| File | Source | Version | Commit (revision in the export's metadata.json) | How fetched | Date |
|---|---|---|---|---|---|
| `en_ult/TIT.usfm` | unfoldingWord en_ult (aligned USFM) | v89 | `84c73ba00fc8a95a9033f9efb14bb905a2a52ee4` | DCS sb-zip export (`/sb/<tag>.zip`) | 2026-07-30 |
| `en_ult/GEN-1.usfm` | unfoldingWord en_ult (aligned USFM), Genesis header and chapter 1 only (lines 1–819 of `GEN.usfm`, cut before `\c 2`) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | rig cache `dev-env/resources-cache/en_ult-v91-unwrapped.zip` (DCS sb-zip export); full `GEN.usfm` sha256 `bcc81339556b4cb27de812590e89884243f3a69da70d3c8412bbc9291430e4e4` | 2026-10-16 |
| `en_ust/TIT.usfm` | unfoldingWord en_ust (aligned USFM) | v89 | `37ec223166bbd73fb55abc7840be8310c0fee7f2` | DCS sb-zip export (`/sb/<tag>.zip`) | 2026-07-30 |
| `hbo_uhb/JON.usfm` | unfoldingWord hbo_uhb (Hebrew, right-to-left; `\w` tokens with lemma/strong/morph, U+2060 word joiners inside words, maqaf U+05BE between words) | v3.0.0 | `74022f0fed012a3ef169886f595dd98e7b200543` (the tag's commit) | raw file `32-JON.usfm` at the tag; sha256 `55a36ef7ab573305e6281d5ae28223fe525e478f7e12e946b64099f6b646ca7b` | 2026-09-12 |
| `hbo_uhb/GEN-1-1.usfm` | unfoldingWord hbo_uhb, Genesis from the file start up to `\v 2` (the header and Genesis 1:1; the Hebrew is not NFC) | v3.0.0 | `74022f0fed012a3ef169886f595dd98e7b200543` | lines of the sideloaded `ingredients/GEN.usfm` (sha256 `5b9391454b6b6f358838f2cbfd4f5b5cd90b447ad4320e087b698f2b9c167d71`), cut before `\v 2`; extract sha256 `db5b57f90710b5ac39eb8bed25b222d279ca1ebd04940008a3de7e36c52f02f5` | 2026-10-16 |
| `en_ult/GEN-1-1.usfm` | unfoldingWord en_ult (aligned USFM), Genesis from the file start up to `\v 2` | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | lines of the sideloaded `ingredients/GEN.usfm` (sha256 `bcc81339556b4cb27de812590e89884243f3a69da70d3c8412bbc9291430e4e4`), cut before `\v 2`; extract sha256 `44fe75ea16c38732866e3c9a4ced1783060aa177ed836b2275508c126aa4d405` | 2026-10-16 |
| `en_ult/GEN-773.usfm` | unfoldingWord en_ult (aligned USFM), Genesis header plus verses 9:11, 11:31, 24:48, 33:5 and 49:6 only (each `\c` line and the lines of those verses from `GEN.usfm`) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | raw file `01-GEN.usfm` at the v91 tag (sha256 `bcc81339556b4cb27de812590e89884243f3a69da70d3c8412bbc9291430e4e4`, the same file as above); each verse parses to the same usfm-js verseObjects as in the full file, except that 49:6 lacks the trailing `\q1` marker of verse 7 (no text, no token); extract sha256 `a2a247ff5e2a5522d35d0abb386b4f2c4e835785861e97507097d1b63ecbc55c` | 2026-10-16 |
| `en_ult/PSA-3.usfm` | unfoldingWord en_ult (aligned USFM), Psalms header (the lines before `\c 1`) plus chapter 3 up to `\v 3` (the title and verses 1-2; verse 2 ends with an aligned "Selah" inside `\qs … \qs*`) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | rig cache `dev-env/resources-cache/en_ult-v91-unwrapped.zip`, `ingredients/PSA.usfm` (sha256 `f3753ca75732d3e7a1738014f4e845a39041c2ce8df7b5797f728f63b7baabbe`), lines 1-11 and 349-398; extract sha256 `6068efd5b0a5b47ac342b69a1caaf3b1c4be795d2ba039c6b189b48d3806b05a` | 2026-10-17 |
| `en_ult/1SA-2-812.usfm` | unfoldingWord en_ult (aligned USFM), 1 Samuel header, `\c 2` and verses 2:1-3 (2:2 holds a `\ts\*` between its poem lines) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | sideloaded `ingredients/1SA.usfm` (sha256 `40db4c5203752c3c12551015ecb2904fcd0e64c219a7b808605d570a3fb803cd`), lines 1-10, 817 and 819-893; extract sha256 `e74cac2c9e916bde232b5cb2d9e74b424bebb993f6f75a3d6f2f82bce39dda25` | 2026-10-19 |
| `en_ult/REV-7-812.usfm` | unfoldingWord en_ult (aligned USFM), Revelation header, `\c 7` and verses 7:11-13 (7:12 holds `\pi1`, `\ts\*` and `\m` lines) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | sideloaded `ingredients/REV.usfm` (sha256 `8d48f7ded5430aab8b5345692ad5e510c27a6dc97e9b1f54df2d39730ec59aac`), lines 1-10, 3416 and 3719-3802; extract sha256 `3d23c54297e13ea792f971139877db829d6b347d5ac05fa3b079b91cbff5f558` | 2026-10-19 |
| `en_ult/PSA-9-812.usfm` | unfoldingWord en_ult (aligned USFM), Psalms header, `\c 9` and verses 9:15-16 (9:15 holds a `\q3` line) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | sideloaded `ingredients/PSA.usfm` (sha256 `f3753ca75732d3e7a1738014f4e845a39041c2ce8df7b5797f728f63b7baabbe`), lines 1-11, 1603 and 1864-1907; extract sha256 `4476938ab2b9b8e24080b5184062e0d47e939b2d1b10d012ac81da931286b46e` | 2026-10-19 |
| `en_ult/MAT-27-812.usfm` | unfoldingWord en_ult (aligned USFM), Matthew header, `\c 27` and verses 27:9-10 (27:9 holds a `\pmo` line with text) | v91 | `35d215957f3203fd2e2fac5702ce14902d417f9d` | sideloaded `ingredients/MAT.usfm` (sha256 `0a473fb472968f95a668b29e599b112b6784d93c4d990b588223bb490ae27a57`), lines 1-10, 22678 and 22852-22905; extract sha256 `5422b32caea82e12da6b06942e7f77435f2f37cd104a1ca291bac17198d07b36` | 2026-10-19 |
| `en_ust/GEN-29-812.usfm` | unfoldingWord en_ust (aligned USFM), Genesis header, `\c 29` and verses 29:14-15 (29:14 holds an `\s1` heading and an `\sr` line, then more of the verse) | v91 | `85f274a74245cb418f85266e1a5b524bc3e91e9c` | sideloaded `ingredients/GEN.usfm` (sha256 `6238ec006e4d611b0b0081ffbec8dae4fe263775f6b418d9ee9d49557fe037ab`), lines 1-10, 22395 and 22771-22835; extract sha256 `bea0d0400320f4fe99ca5ebd0b9c2897de9cb01035881ff052a2b6c538723d17` | 2026-10-19 |

`test/align-tokenize.test.ts` (issue #255) reads `hbo_uhb/JON.usfm` for its right-to-left
verses. `test/align-source-nfc.test.ts` (issue #793) reads the same file for its non-NFC Hebrew
words. `test/align-gateway-label.test.ts` (issue #768) reads the two `GEN-1-1.usfm`
extracts; their commit hashes match the `revision` field of the sideloaded burritos
(verified 2026-10-16). `test/sourceHighlight.test.ts` (issue #773) reads `en_ult/GEN-773.usfm`;
its source file has the same sha256 as the full `GEN.usfm` above. `test/bookModel-nested-alignment.test.ts` (issue #782) reads `en_ult/GEN-1-1.usfm`, `en_ult/GEN-1.usfm`, `en_ult/PSA-3.usfm` and `hbo_uhb/GEN-1-1.usfm`. The two `en_*` TIT copies came from the dev rig at
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
