# Evidence: the two-gateway-language path, measured end to end

**Date:** 2026-08-04 · **Method:** live DCS reads, the local rig
(pankosmia-web 0.18.5, `99fd9be`), the product unit suite, and Playwright journey J13.
Every number below was produced by a command recorded here.

## Why this exists

Increment 2 built the two-language-set schema (D17/D30), the gateway change (D23a/D30.2)
and the carry-over rule (D36) — but **every journey ran on English alone**. One language
set cannot exercise a ladder, a change, or a carry-over. The path was tested only in unit
tests over hand-built pins.

This record covers running it against a real second suite.

## The second suite

Cached with `zsh dev-env/scripts/cache-resource.zsh <owner>/<repo> <tag> <sha>`, which
fetches and unwraps through the app's own `sbZipUrl` / `unwrapExport` / `rezip`. Every SHA
was verified against `es419-suite-pins-2026-07-31.md` and matched:

| Repo | Tag | Export revision | Cached bytes |
|---|---|---|---|
| `Es-419_gl/es-419_tn` | `v66` | `22f3d0c61e2ab4701cb869547de9c3c43da07208` | 261,295 |
| `Es-419_gl/es-419_tw` | `v37` | `7586f4ff1f0483ea40a4a68e5e1f33158e08c208` | 9,716,469 |
| `Es-419_gl/es-419_ta` | `v4` | `26606b578c37cc2c0ee09bb7b9a291860ff59444` | 1,375,215 |

`es-419_tn` v66 carries 4 book TSVs (3JN, JON, RUT, TIT) — partial coverage, which is the
condition D30.1 exists for. `es-419_tw` v37 carries 66 book TSVs plus the articles, so
**D34 holds for Spanish too**: one repo serves both tW slots.

`dev-env/scripts/seed.zsh` now sideloads all three.

## Defect 1 — a DCS export names the org AS IT WAS AT EXPORT TIME

The es-419 exports declare `identification.primary.dcs` = **`Idiomas-Puentes/es-419_tn`**
(and `_tw`, `_ta`). Measured live 2026-08-04:

```
GET /api/v1/orgs/Idiomas-Puentes          -> 404   (no redirect)
GET /api/v1/orgs/Es-419_gl                -> 200
GET /api/v1/repos/Es-419_gl/es-419_tn     -> full_name: es-419_gl/es-419_tn
GET /api/v1/repos/Idiomas-Puentes/es-419_tn/tags -> 404
GET /api/v1/repos/es-419_gl/es-419_tn/tags       -> 200, v66 sha matches tag v66
```

The org was renamed; the 2024 export was not regenerated. `discoverOnDisk` identified
resources from that metadata, so a seeded or hand-sideloaded Spanish suite produced
`git.door43.org/Idiomas-Puentes/es-419_tn` — an address no pin names and no tag lookup
resolves. Consequences: the suite read as **incomplete** (no gateway change offerable) and
the resources read as **not local** (a false offline verdict).

**English hides this completely** — `unfoldingWord` was never renamed.

Fixed: `discoverOnDisk` takes an org resolver; `orgForRepoName` returns the configured org
when exactly one configured gateway publishes that language, and null when ambiguous
(`fr_tn` has two publishers, so the metadata stays the only evidence). Recorded as
PLATFORM-NOTES #30, covered by 7 checks in `test/installed.test.ts`.

## Defect 2 — the gateway change had no entry point, and read the wrong install list

Two independent gaps, both invisible without a second suite:

1. `GatewayChange.jsx` was mounted in `App.jsx`, but **nothing called
   `askGatewayChange`** — the dialogue was unreachable. Added: a "Use for checking"
   action in the source-texts modal (offered only for a complete installed suite that is
   not already the project's language), plus a "Source texts →" link on the Check screen,
   because the checking language is a property of the open project.
2. `previewGatewayChange` and `setProjectGateway` read `readInstalled()` — the machine
   record ONLY. A seeded or hand-sideloaded suite is not in that record, so a language the
   app had just offered could not be pinned. Both now use `resolutionContext()`, the same
   recorded-plus-discovered picture the readiness check uses.

## Defect 3 — a repo path was compared as a raw string, and case differs in real data

Found by looking at the running app, not by a test: the preflight behind the change
dialogue said **"needs downloading"** for two resources that were installed, and the modal
offered to change to the language the project already used.

Cause: the conformance sample pinned `git.door43.org/Es-419_gl/es-419_tn` (written
2026-07-31 from the evidence of that date), while `data/gateways.ts` and DCS today both
say `es-419_gl`. Measured: `GET /api/v1/repos/Es-419_gl/es-419_tn` -> 200,
`full_name: es-419_gl/es-419_tn`. The two strings are the same address.

Resolved per **D37** (owner ruling, 2026-08-04 — "maintain DCS casing so there is as
little conversion needed as possible"):

- **The stored form is DCS's form.** The sample, `generate.mjs` and the BURRITO-SPEC
  §5.2/§5.3 examples now carry `es-419_gl`. Coverage keys and pins are stored verbatim;
  the lower-casing map key (`pathKey`) is gone. Harness re-generated: **34/34**.
- **Comparison stays tolerant**, and only comparison — `samePath` in
  `src/data/resolve.ts`, used by `isPinLocal`, `preferInstalledVersion`, `covers()`,
  `recordMatchesResolution`, `resolutionWarning`, `consequencesOfGatewayChange`, the
  decision-file relabel guard, and the modal's "is this already the project's language?"
  test. Nothing stored is converted; a burrito written elsewhere in another casing still
  resolves instead of demanding a re-download.

After the fix the same screen reads **READY** for both tools, and the modal says "This
project already checks against Spanish (Latin American)."

### Owner assessment on Defect 1

"Probably a pretty rare case — most users will be using the latest version." Recorded,
with one measured qualification: for es-419 the affected releases **are** the latest —
`es-419_tn v66`, `es-419_tw v37`, `es-419_ta v4`, all published 2024-07-17 [VERIFIED live
2026-08-04] — so the stale org is that suite's current state, not an old-version artifact.
The handling stays as built and is not treated as a headline risk.

## Measured carry-over on real data (D36)

`carryOverDecisions` run over the rig's own project, both tools, TIT:

```
translationNotes/TIT: stored=2  en=157 es=112  -> carried=2 invalidated=0 undecided=110
translationWords/TIT: stored=2  en=182 es=223  -> carried=2 invalidated=0 undecided=221
```

**Every stored decision re-attached across the language change.** D17 works on real
Spanish/English data: the two resources differ in note language and check id but quote the
same original-language words.

A second measurement explains why that is not the whole story. es-419_tn is a *translation
of* en_tn, so it keeps most check ids, and `reattachAcrossResource` matches on `checkId`
before it falls back to the cross-language key. Differencing the two derived lists on
checkId AND identity key AND cross key:

```
TIT: 58 of the 157 English checks are unplaceable in Spanish
```

Journey J13 seeds one of those 58 as a decided check, then runs the change. Result: it
comes back `invalidated: true` + `status: "invalid"`, kept in full, while the placeable
decisions carry over — D36 exactly.

## Test results at this record

```
Unit:        277 passed (21 files)
Journeys:    30 passed, 20 skipped (later increments) — J13 is 7 of the 30
Conformance: 34 passed, 0 failed  +  journal 59 passed, 0 failed
typecheck + lint: clean
```

Three defects were found by running this path, and all three were invisible with one
language set: a stale org name in every DCS export (#30), a repo path compared as a raw
string when real data differs in case (#31), and a gateway change with no entry point that
also read the wrong install list.
