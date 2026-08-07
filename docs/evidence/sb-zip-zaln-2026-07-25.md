# Evidence: the DCS sb-zip export keeps `\zaln` (OPEN-QUESTIONS #5) — 2026-07-25

**Claim [VERIFIED]:** The DCS `/sb/<tag>.zip` export keeps the `\zaln` alignment markup.
Each USFM ingredient in the export is byte-identical to the same file at the git tag.

## Method

1. Download `https://git.door43.org/unfoldingWord/en_ult/sb/v89.zip` (7,709,900 bytes).
2. Clone the same repository at the same tag: `git clone --depth 1 --branch v89
   https://git.door43.org/unfoldingWord/en_ult.git`.
3. Compare each of the 55 USFM ingredients in the zip with its clone counterpart. Use
   `cmp` for the comparison. The zip names the files `TIT.usfm`. The clone names them
   `57-TIT.usfm`.

## Results

- 55 of 55 books are byte-identical. There are 0 mismatches.
- Spot check TIT: the zip file has 656 `\zaln-s` markers, and the clone file has 656.
- Negative-control note: the comparison uses `cmp`, which tests byte equality.
  A silent removal of markup cannot pass this test.

## Related findings (same session, feed OPEN-QUESTIONS #24)

- The export is made on demand. `meta.dateCreated` in `metadata.json` is the
  download time. The export records the generator as `go-rc2sb v0.4.0`.
- `identification.primary.dcs["<owner>/<repo>"].revision` in the export's
  `metadata.json` is equal to the commit SHA of the requested tag. This is verified on
  `en_twl` v86: revision `570e76d0024c847689e48a20e2ac1a1d2c6eb6e3` ==
  `refs/tags/v86` per `git ls-remote`.
- Consequence for pins: a pin can store (repoPath, tag, expected revision SHA).
  An import can then verify the SHA from the export's own metadata.
- Caveat: this test does not show that the bytes stay the same over time. A new
  `go-rc2sb` version can change the metadata or the layout. The ingredient bytes
  come from the tagged commit, so the USFM content is expected to stay stable. Verify
  the revision SHA at each import.
- DCS release notes (github.com/unfoldingWord/dcs): v1.25.6+dcs adds "RC to SB repo
  conversion with Zip and Tarball endpoints"; v1.25.7+dcs adds the repo topics
  `pushing2sb` / `sbFirst` (master → SB `main` conversion); v1.26.6+dcs adds TS→SB
  and TC→SB repo conversion.
