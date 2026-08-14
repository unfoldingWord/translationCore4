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
npm run validate   # 34 checks in three groups (BURRITO-SPEC §7):
                   #  Stage-1 (30): SB schema, ingredient integrity, versification
                   #   (vrs.json presence/shape/scope coverage), scope grammar
                   #   ([] + range arrays, negative controls), targetBible shape,
                   #   alignment round-trip + staleness guard, selections validity +
                   #   invalidation, decision-shape lint incl. triage status, derive+merge
                   #   progress reconstruction incl. scope-filtered derive, cross-language
                   #   re-attach (groupId tiebreak, ambiguity → review), multi-book
                   #   scope, two-language-set resource pins (D17/D30), (tool, book)
                   #   resolution records + two-rung coverage ladder, extraScripture
                   #   source pins, zaln export, verse-span key semantics
                   #  Stage-2 (2): role-tagged ingredients + SB relationships — held by the
                   #   sample; a server rescan drops them because the scan rebuilds the
                   #   table from disk. Non-durable BY DESIGN (D28) — tC4 re-asserts its
                   #   roles after each remake; no upstream fix is pending
                   #  Phase-2 (2): two-actor journal merge — reproduces the metadata.json
                   #   conflict and proves the §8.4 resolve+regenerate rule (needs git)
```

Two more scripts exist here but are rig-gated: `npm run validate:transport` and
`npm run validate:roundtrip` need a running Pankosmia rig (set `RIG_REPOS` to its
repos directory). Do not run them on a clean clone.

`zaln-strip-repro/` is a separate, preserved empirical test in the maintainer
workspace (not published here). The test executes the conversion files of the
pankosmia drafting editor (`usfm2draftJson.js` → `draftJson2usfm.js`, copied
from core-client-workspace). It runs them under proskomma-core 0.11.2 against
zaln-aligned Titus USFM. The test shows that a save operation strips all
`\zaln`/`\w` markup. This finding is the basis for BURRITO-SPEC invariant I-1 and the
sidecar-alignment design (PLATFORM-NOTES #1; rationale in ARCHITECTURE.md).

All findings were verified against recorded repository versions. The file
`../docs/evidence/investigated-commits.txt` lists these versions.
