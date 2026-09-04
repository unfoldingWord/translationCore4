# sample-burrito validation harness

This harness generates and validates `sample-burrito/` (in this directory). That directory
is the reference project format for tC4 Phase 1 (normative definition:
`../docs/BURRITO-SPEC.md`).
The harness uses the real production libraries (usfm-js 3.4.3, word-aligner
1.0.3, word-aligner-lib 1.0.1). It also uses the Scripture Burrito schema
bundle in `sb-schema/`. This bundle is a verbatim copy from pankosmia
`resource-core`.

```bash
npm install        # .npmrc sets legacy-peer-deps (word-aligner@1.0.3 declares a
                   # usfm-js ^2 peer; production pairs it with 3.4.3 the same way)
npm run generate   # rebuilds JON stub (incl. the 2:9-10 verse-span fixture), alignment
                   # sidecar (via real wordaligner.unmerge), and metadata.json with true
                   # md5/size per ingredient
npm run validate   # the Phase-1 suite (BURRITO-SPEC §7); the three groups are below
```

`npm run validate` runs <!-- manifest: conformance:validate passed -->40 checks in three
groups:

- **Stage-1 (<!-- manifest: conformance:validate summary[Stage-1] -->35):** SB schema,
  ingredient integrity, versification (vrs.json presence/shape/scope coverage), scope
  grammar ([] + range arrays, negative controls), targetBible shape, alignment round-trip +
  staleness guard, selections validity + invalidation, decision-shape lint incl. triage
  status, derive+merge progress reconstruction incl. scope-filtered derive, cross-language
  re-attach (groupId tiebreak, ambiguity → review), multi-book scope, two-language-set
  resource pins (D17/D30), (tool, book) resolution records + two-rung coverage ladder,
  extraScripture source pins, zaln export, verse-span key semantics.
- **Stage-2 (<!-- manifest: conformance:validate summary[Stage-2] -->2):** role-tagged
  ingredients + SB relationships — held by the sample; a server rescan drops them because
  the scan rebuilds the table from disk. Non-durable BY DESIGN (D28) — tC4 re-asserts its
  roles after each remake; no upstream fix is pending.
- **Phase-2 (<!-- manifest: conformance:validate summary[Phase-2] -->3):** two-actor
  journal merge — reproduces the metadata.json conflict, proves the §8.4
  resolve+regenerate rule, and checks that the fixture journals are the §8.1
  sealed-segment stream form (needs git).

The counts above are marked as manifest-derived. `npm run docs:gate` (repository root)
fails when they disagree with `docs/evidence/manifest.json`, which `npm run prove` writes.

Two more scripts exist here but are rig-gated: `npm run validate:transport` and
`npm run validate:roundtrip` need a running Pankosmia rig (set `RIG_REPOS` to its
repos directory). Do not run them on a clean clone.

## Notes on the sample's pins (formerly a `note` field inside resources.json)

Two-language-set resource pinning (D17/D30, BURRITO-SPEC §5.3). Path-authoritative;
metadata.json `relationships` mirrors these pins. The tW slots both name `<lang>_tw`:
its sb-zip export carries the TWL link TSVs and the payload articles together (D34).
Pins verified: `docs/evidence/es419-suite-pins-2026-07-31.md` +
`tw-twl-sbzip-combined-2026-08-03.md`. The field moved here because the §8.8 seed
round-trip must reproduce resources.json from the §5.3 flatten, which carries pin
slots only — an unknown top-level field refuses the seed instead of being dropped.
The sample is REQUIRED to be seedable: its sidecar files carry records in the fold's
canonical projection order and no fields the checkpoint projections cannot reproduce.

`zaln-strip-repro/` is a separate, preserved empirical test in the maintainer
workspace (not published here). The test executes the conversion files of the
pankosmia drafting editor (`usfm2draftJson.js` → `draftJson2usfm.js`, copied
from core-client-workspace). It runs them under proskomma-core 0.11.2 against
zaln-aligned Titus USFM. The test shows that a save operation strips all
`\zaln`/`\w` markup. This finding is the basis for BURRITO-SPEC invariant I-1 and the
sidecar-alignment design (PLATFORM-NOTES #1; rationale in ARCHITECTURE.md).

All findings were verified against recorded repository versions. The file
`../docs/evidence/investigated-commits.txt` lists these versions.
