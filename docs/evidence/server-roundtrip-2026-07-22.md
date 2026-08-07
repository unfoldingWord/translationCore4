# Server round-trip of tC4 custom work — verified live (2026-07-22)

> **CORRECTION 2026-07-27** (`evidence/zip-roundtrip-correction-2026-07-27.md`): Finding 1
> ("zip export and zip import are mutually incompatible") is **withdrawn**. This test paired
> the export with `remake_burrito_from_zip`, a tC4-prototype support tool — not the general
> import. `POST /burrito/zipped/<repo_path>` imports the server's own export unmodified
> (verified live). Draft issue 1 below is withdrawn — do not send it. The other findings
> in this file are unaffected.

**Question:** can pankosmia-web round-trip this format's custom work — `checking/` sidecars,
`x-` ingredient roles, native `relationships`, Phase-2 journal streams (`.jsonl`, `_project.`,
`actor.json`), span-verse USFM — through every server operation that rewrites files or metadata?

**Method:** `sample-burrito-validation/validate-roundtrip.mjs` (`npm run validate:roundtrip`)
against the dev-env rig (`pankosmia_web =0.17.0`, the latest published crate). **Result: 12/12.**
Operates on a copy; the seeded sample stays pristine. R7 re-runs the 27-check conformance
harness on the server-touched copy (`BURRITO=<path> npm run validate` — the harness target is
env-overridable).

## Verdict table

| Server operation | Custom-work survival at 0.17.0 |
|---|---|
| Ingredient write (`.jsonl` journals, `_project.` streams, `actor.json`) | ✅ writes cleanly (R0) |
| Read path (every ingredient: USFM, JSON, JSONL) | ✅ byte-faithful (R1) |
| Write + `update_ingredients` regeneration | ✅ all files registered w/ correct md5; **`relationships` AND ingredient `role`s DROPPED** (R2; corrected 2026-07-22 — see finding 2) |
| `remake-ingredients` full rescan | ✅ completes; scope/identification/languages survive; **`relationships` AND `role`s DROPPED** (R3) |
| Content bytes across all metadata ops | ✅ byte-identical, only `metadata.json` rewritten (R4) |
| Delete → revert (`.bak` undo) on a sidecar | ✅ restored byte-identically (R5) |
| Zip export | ✅ (R6a) — includes `.git` and `.DS_Store`; entries unwrapped at zip root |
| Zip import of the server's **own export** | ❌ **VERIFIED DEFECT** — 500 (R6b) |
| Zip import, DCS-shaped (single wrapper dir) | ✅ every custom ingredient byte-identical after export→rewrap→import (R6c/R6d) |
| Conformance after all of the above | ✅ **Stage-1: 23/23** · Stage-2: 0/2 as predicted (roles/relationships await upstream Change 1) (R7) |

**Bottom line:** the format survives today's server exactly at the level the spec claims —
paths-authoritative Stage-1 holds through every operation; only the two Stage-2 fields
(`role`/`relationships`) are wiped, which is precisely what upstream Change 1 fixes. This suite
is also **Change 1's ready-made acceptance test**: when it lands, R2/R3's observations flip and
the harness's Stage-2 goes 2/2.

## Findings detail

1. **Zip export/import are mutually incompatible (0.17.0).** `make_zip_file` writes entries
   unwrapped (`metadata.json` at zip root); `remake_burrito_from_zip` unpacks with
   `only_depth = Some(1)` (expects one DCS-style wrapper directory) — root-level entries strip
   to an empty path and `File::create` panics (`utils/zip.rs:85`) → 500. The server cannot
   re-import its own export; a wrapper directory fixes it. → PLATFORM-NOTES #22. Minimal
   standalone repro (any server, any repo, non-destructive; prints `500` then control `200`):
   `sample-burrito-validation/zip-roundtrip-repro/repro.sh [api-base] [repo-path]`.
2. **CORRECTION (same day):** an earlier version of this finding claimed the write-path
   regeneration preserves `role`s. That was an instrument error — R2's baseline was captured
   after R0's own `update_ingredients` writes had already wiped the roles (0 === 0 read as
   "survived"). The live repro exposed it; the suite baseline is fixed. Verified truth: **both
   paths wipe roles and relationships** — the write path replaces the entire ingredients map
   (`post_raw_ingredient.rs`: `*ingredients = new_ingredients`). Stage rules S-1/S-2 unchanged.
   Live demonstration: `metadata-drop-repro/live-repro.sh` (three server-read snapshots).
3. **PLATFORM-NOTES #7 downgraded:** since 0.17.0, a missing/non-string `payload` returns a clean
   500 JSON instead of panicking the handler (fixed upstream).
4. `remake_burrito_from_zip` requires the target repo to **already exist** (400 otherwise) —
   it remakes, it does not create.
5. Zip export includes `.git` and `.DS_Store` — fine for backup semantics; worth knowing for
   any user-facing export claim.

## Session summary (2026-07-24)

**Purpose.** Prove that pankosmia-web `=0.17.0` can round-trip all tC4 custom work through every
server operation that rewrites files or metadata. Custom work = `checking/` sidecars, `x-`
ingredient roles, root `relationships`, Phase-2 journal streams (`.jsonl`, `_project.*`,
`actor.json`), span-verse USFM.

**Method.** Built `sample-burrito-validation/validate-roundtrip.mjs` (npm `validate:roundtrip`).
Runs 12 checks (R0–R7) on a live copy of the seeded sample against the dev-env rig. R7 re-runs
the 27-check Stage-1/Stage-2 conformance harness on the server-touched copy.

**Result.** 12 passed, 0 failed. Stage-1 conformance holds at 23/23 on the touched copy. Stage-2
lands at 0/2 exactly as the spec predicts. The format survives today's server at the level the
spec claims; only the two Stage-2 fields (`role` and `relationships`) are wiped by regeneration.

**Findings that need upstream action.** Two — both documented in "Findings detail" above and
drafted as issues at the end of this file: (1) zip export and zip import are mutually
incompatible; (2) both regeneration paths wipe `role` and `relationships` (this is upstream
Change 1's target; the suite is Change 1's ready-made acceptance test).

**Same-day correction.** An earlier version of Finding 2 claimed the write path preserved
`role`s. That was an instrument error — the R2 baseline was captured after R0's own
`update_ingredients` writes had already wiped the roles (0 === 0 read as "survived"). Live
repro exposed it; suite baseline fixed. `metadata-drop-repro/live-repro.sh`.

**Files changed.**

- `sample-burrito-validation/validate-roundtrip.mjs` — new 12/12 suite.
- `sample-burrito-validation/zip-roundtrip-repro/repro.sh` — standalone repro for Finding 1.
- `sample-burrito-validation/metadata-drop-repro/live-repro.sh` — live server demo for Finding 2.
- `docs/evidence/server-roundtrip-2026-07-22.md` — this file.
- `docs/PLATFORM-NOTES.md` — #22 added, #5 corrected, #7 downgraded.
- the decision log — D21 added (now `DECISIONS.md` D21).
- The owner's session handoff notes — round-trip suite added to §2; parked items updated.

## Draft upstream issues

Drafts only. Owner-routed. Prune to three-line shape before sending — file paths, line numbers,
and repro paths are the load-bearing parts.

### Draft 1 — zip round-trip

**Title:** `remake_burrito_from_zip` cannot import the output of `GET /burrito/zipped/`

At 0.17.0, the zip export endpoint and the zip import endpoint are shape-incompatible.

`make_zip_file` writes entries at the zip root (`metadata.json`, `ingredients/…`).
`remake_burrito_from_zip` calls `unzip_with(only_depth = Some(1))`, which expects one DCS-style
wrapper directory. Root-level entries strip to an empty path. `File::create("")` then panics at
`utils/zip.rs:85` and the endpoint returns 500. The server cannot re-import its own export.
A wrapper directory around the entries fixes it.

Minimal repro (four `curl` calls plus a control; non-destructive):
`sample-burrito-validation/zip-roundtrip-repro/repro.sh [api-base] [repo-path]` — prints `500`
for the raw round-trip and `200` for a control call that wraps the same bytes in one top-level
directory.

Adjacent notes in the same area: the export includes `.git` and `.DS_Store`;
`remake_burrito_from_zip` requires the target repo to exist (400 otherwise) — it remakes, it
does not create.

### Draft 2 — metadata fidelity (Change 1 acceptance)

**Title:** Ingredient regeneration drops `role` and root `relationships`

At 0.17.0, both ingredient regeneration paths remove fields the Scripture Burrito spec permits
and that clients rely on.

The write path (`POST /burrito/ingredient/raw/…?update_ingredients`) replaces the whole
ingredients map with a fresh scan (`post_raw_ingredient.rs`: `*ingredients = new_ingredients`).
`POST /burrito/metadata/remake-ingredients/…` does the same. `structs.rs` models neither the
`role` field on an ingredient nor the root `relationships` object, and has no
`#[serde(flatten)]` catch-all, so the fields drop on the next serialization.

Effect: any client that writes `role` (for example, an `x-` sidecar role such as
`x-checking-decisions`) or `relationships` (for example, links from a project ingredient to its
sources) loses those fields the next time regeneration runs.

Live demonstration (three server-read snapshots — before write, after write, after remake):
`sample-burrito-validation/metadata-drop-repro/live-repro.sh`.

Proposed direction (Change 1 as discussed): preserve metadata the server does not model. One
implementation: add `#[serde(flatten)] extra: Map<String, Value>` on the ingredient struct and
on the root metadata struct, so unknown fields round-trip unchanged.

Acceptance test, ready today: `sample-burrito-validation` ships `validate:roundtrip` (12 checks).
When this change lands, R2 and R3 flip from "dropped" to "survived", and the Stage-2 conformance
harness goes from 0/2 to 2/2 on the server-touched copy.
