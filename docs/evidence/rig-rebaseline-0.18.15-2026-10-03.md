# Rig re-baseline at pankosmia-web 0.18.15 — 2026-10-03

**Trigger:** issue #461 and the owner's ruling D90: move the server pin from 0.18.5 to
0.18.15, not 0.18.14.

**Pin mechanics.** `dev-env/server/Cargo.toml` pins
`{ git = "https://github.com/pankosmia/pankosmia-web.git", rev = "a83725b67593b018f815fdb25a3920ce03e833e7" }`.
`cargo update -p pankosmia_web` changed only the `pankosmia_web` entry of `Cargo.lock`
(0.18.5 → 0.18.15; no other crate moved). `cargo build --release` finished clean. crates.io
publishes `pankosmia_web 0.18.15`; its `.cargo_vcs_info.json` says
`"sha1": "a83725b67593b018f815fdb25a3920ce03e833e7"`, and its `new_obs_resource.rs` equals
the file at that commit. The pin stays a rev pin, because `scripts/prove.mjs:142` reads the
build revision from `Cargo.toml`.

**Method.** Two rigs ran side by side on macOS, each on a fresh seed of this branch:

- the new pin, `pkg_version 0.18.15`, on `127.0.0.1:19997`;
- a 0.18.5 control (the binary built from `99fd9be` on 2026-07-30), on `127.0.0.1:19996`.

The harness was the same for both runs. Each section below shows the command output.

## Before the harness change (origin/main harness, 0.18.15 rig)

```
FAIL  T1: rig server is the pinned latest crate — pkg_version=0.18.15
PASS  T1: seeded sample_burrito is served
PASS  T2: multi-branch pull-repo merge target measured (HEAD@aaa→aaa-branch; HEAD@zzz→aaa-branch)
PASS  T3: A1 integrates via HTTP scratch (copy→remote/add→pull-repo→regenerate→commit→pull-to-main) — merge_type=fast-forward
FAIL  T3: publication commits are journal-only paths (publication isolation holds over HTTP) — ["ingredients/checking/journal/actor-a/segments/2026-06-01T00_00_05.000Z,0000,actor-a.action.json","metadata.json"]
FAIL  T3: B1 integrates while A is offline; both texts present
FAIL  T3: A2 submits WITHOUT receiving B1 — clean HTTP integration; A2+B1 both survive
PASS  T3: counterexample — integrating the full offline working projection conflicts, and main is untouched
FAIL  T3: receive rebuilds replacement from main (union present); old working repo untouched until swap
PASS  T4: zero-trust intake rejects shared-file / foreign-segment / rewrite / invalid-segment / malformed- and mismatched-actor.json contributions; main byte-identical

Transport rig: 5 passed, 5 failed (server http://127.0.0.1:19997/api, pankosmia_web 0.18.15)
```

With `RIG_DEBUG=1`, the pulls showed the cause:

```
  [a1] pull: 200 {"has_conflicts":false,"is_good":true,"merge_type":"fast-forward","reason":"ok"}
  [b1] pull: 200 {"has_conflicts":true,"is_good":true,"merge_type":"normal","reason":"ok"}
  [a2] pull: 200 {"has_conflicts":true,"is_good":true,"merge_type":"normal","reason":"ok"}
```

The same harness on the 0.18.5 control (CI run 37130007245 on `main` 6f219aa, 2026-10-03, and
the local control): `Transport rig: 10 passed, 0 failed`.

## The cause: each commit rewrites metadata.json

`add-and-commit` on a clean copy of `sample_burrito`, on both rigs:

```
== 19996 (0.18.5) status: []
{"is_good":true,"reason":"ok"}
3a2e2b6 clean-tree probe
  (empty commit)
== 19997 (0.18.15) status: []
{"is_good":true,"reason":"ok"}
9858a63 clean-tree probe
 metadata.json | 242 +---------------------------------------------------------
 1 file changed, 1 insertion(+), 241 deletions(-)
```

The fields that the 0.18.15 commit changed:

```
changed /identification/primary/local/ejemplo_tj/revision | 1 -> 825f1734-4e5e-4a92-a0c3-638ba3612bd0
changed /identification/primary/local/ejemplo_tj/timestamp | 2026-07-02T12:00:00.000Z -> 2026-10-03T22:42:43.000Z
changed /ingredients/ingredients/checking/alignments/TIT.json/role | x-alignment -> None
changed /ingredients/ingredients/checking/resources.json/role | x-resource-links -> None
changed /ingredients/ingredients/checking/settings.json/role | x-check-settings -> None
changed /ingredients/ingredients/checking/translationNotes/TIT.json/role | x-check-decisions -> None
changed /ingredients/ingredients/checking/translationWords/TIT.json/role | x-check-decisions -> None
changed /meta/dateCreated | 2026-07-02T12:00:00.000Z -> 2026-10-03T22:42:43.000Z
```

Source: `src/endpoints/git2/add_and_commit.rs:68-131` at a83725b (PLATFORM-NOTES #48).

## After the harness change (this branch)

0.18.15:

```
PASS  T1: rig server is the pinned latest crate — pkg_version=0.18.15
PASS  T1: seeded sample_burrito is served
PASS  T2: multi-branch pull-repo merge target measured (HEAD@aaa→aaa-branch; HEAD@zzz→aaa-branch)
PASS  T3: A1 integrates via HTTP scratch (copy→remote/add→pull-repo→regenerate→commit→pull-to-main) — merge_type=fast-forward
PASS  T3: publication commits are the journal segment plus the server's metadata.json rewrite (PLATFORM-NOTES #48) — ["ingredients/checking/journal/actor-a/segments/2026-06-01T00_00_05.000Z,0000,actor-a.action.json","metadata.json"]
PASS  T3: B1 integration while A is offline conflicts on metadata.json only, and main is untouched (PLATFORM-NOTES #48) — ["metadata.json"]
PASS  T3: A2 submits WITHOUT receiving main — conflicts on metadata.json only, and main is untouched (PLATFORM-NOTES #48) — ["metadata.json"]
PASS  T3: counterexample — integrating the full offline working projection conflicts, and main is untouched
PASS  T3: receive rebuilds replacement from main (main's union present); old working repo untouched until swap
PASS  T4: zero-trust intake rejects shared-file / foreign-segment / rewrite / invalid-segment / malformed- and mismatched-actor.json contributions; main byte-identical

Transport rig: 10 passed, 0 failed (server http://127.0.0.1:19997/api, pankosmia_web 0.18.15)
```

The 0.18.5 control on the same harness (negative control — the changed checks fail there):

```
FAIL  T1: rig server is the pinned latest crate — pkg_version=0.18.5
FAIL  T3: publication commits are the journal segment plus the server's metadata.json rewrite (PLATFORM-NOTES #48) — ["ingredients/checking/journal/actor-a/segments/2026-06-01T00_00_05.000Z,0000,actor-a.action.json"]
FAIL  T3: B1 integration while A is offline conflicts on metadata.json only, and main is untouched (PLATFORM-NOTES #48)
FAIL  T3: A2 submits WITHOUT receiving main — conflicts on metadata.json only, and main is untouched (PLATFORM-NOTES #48)
FAIL  T3: receive rebuilds replacement from main (main's union present); old working repo untouched until swap

Transport rig: 5 passed, 5 failed (server http://127.0.0.1:19996/api, pankosmia_web 0.18.5)
```

## Round-trip and Stage-1 (no change)

```
== 0.18.5 control
  harness on server-touched copy → Stage-1 (path-authoritative — holds on today's pankosmia-web): 38 passed, 0 failed | Stage-2 (role/relationships durability — x-roles non-durable by design, D28; client re-asserts after remake): 0 passed, 2 failed
Round-trip suite: 12 passed, 0 failed (server http://127.0.0.1:19996/api)
== 0.18.15
  harness on server-touched copy → Stage-1 (path-authoritative — holds on today's pankosmia-web): 38 passed, 0 failed | Stage-2 (role/relationships durability — x-roles non-durable by design, D28; client re-asserts after remake): 0 passed, 2 failed
Round-trip suite: 12 passed, 0 failed (server http://127.0.0.1:19997/api)
```

Stage-2 is 0/2 on both versions, so it is not a change of this pin move. The `x-` roles are
dropped by every remake (D28). The `relationships` values survive, but the server writes each
relationship's keys in sorted order (`flavor, id, relationType, revision`), and the check of
#359 compares the JSON text against `relationshipsFromPins`, which writes `relationType` first.
D27's "1/2" (2026-07-30) is older than that check.

## Rig-backed Vitest

Before the language change, on both rigs:

```
== 19996 (0.18.5)    Test Files  5 passed (5) · Tests  46 passed (46)
== 19997 (0.18.15)   Test Files  5 passed (5) · Tests  46 passed (46)
```

After `test/httpStore.integration.test.ts` and `test/serverApi.integration.test.ts` create with
`es-419` (negative control on 0.18.5):

```
== 19996 (0.18.5)
ServerApiError: /git/new-text-translation failed (HTTP 400): Language code 'es-419' is not custom (no 'x-') but has not been found in the BCP47 lookup table
 Test Files  2 failed (2) · Tests  6 failed | 15 passed | 15 skipped (36)
== 19997 (0.18.15)
 Test Files  2 passed (2) · Tests  36 passed (36)
```

## Language codes on the create routes

Requests built as `src/data/serverApi.ts` builds them. The invalid code runs first.

```
== 0.18.15
text "es_419!"     name=null            → 400 repo=no  Language code 'es_419!' is not Scripture Burrito schema valid
text "qqq"         name=null            → 400 repo=no  ... not custom (no 'x-') but has not been found in the BCP47 lookup table
text "x-abc"       name=null            → 400 repo=no  ... is custom ('x-') but no language name has been provided
text "es-419"      name=null            → 200 repo=yes stored tag="es-419" name.en="Spanish (419)"
text "sr-Latn-RS"  name=null            → 200 repo=yes stored tag="sr-Latn-RS" name.en="Serbian (Latn RS)"
text "x-abc"       name="Abc Language"  → 200 repo=yes stored tag="x-abc" name.en="Abc Language"
obs  "es_419!"     name=null            → 400 repo=no  Language code 'es_419!' is not Scripture Burrito schema valid
obs  "qqq"         name=null            → 400 repo=no  ... not custom (no 'x-') but has not been found in the BCP47 lookup table
obs  "x-abc"       name=null            → 400 repo=no  ... is custom ('x-') but no language name has been provided
obs  "es-419"      name=null            → 200 repo=yes stored tag="es-419" name.en="Spanish (419)"
obs  "sr-Latn-RS"  name=null            → 200 repo=yes stored tag="sr-Latn-RS" name.en="Serbian (Latn RS)"
obs  "x-abc"       name="Abc Language"  → 200 repo=yes stored tag="x-abc" name.en="Abc Language"
== 0.18.5 control
text "es_419!"     name=null            → 400 repo=yes ... has not been found in the BCP47 lookup table
text "qqq"         name=null            → 400 repo=yes ... has not been found in the BCP47 lookup table
text "x-abc"       name=null            → 400 repo=yes ... no language name has been provided
text "es-419"      name=null            → 400 repo=yes ... has not been found in the BCP47 lookup table
text "sr-Latn-RS"  name=null            → 400 repo=yes ... has not been found in the BCP47 lookup table
text "x-abc"       name="Abc Language"  → 200 repo=yes stored tag="x-abc" name.en="Abc Language"
obs  "es_419!"     name=null            → 200 repo=yes stored tag="x-es_419!" name.en="es_419!"
obs  "qqq"         name=null            → 200 repo=yes stored tag="x-qqq" name.en="qqq"
obs  "x-abc"       name=null            → 200 repo=yes stored tag="x-x-abc" name.en="x-abc"
obs  "es-419"      name=null            → 200 repo=yes stored tag="x-es-419" name.en="es-419"
obs  "sr-Latn-RS"  name=null            → 200 repo=yes stored tag="x-sr-Latn-RS" name.en="sr-Latn-RS"
obs  "x-abc"       name="Abc Language"  → 200 repo=yes stored tag="x-x-abc" name.en="x-abc"
```

## Other upstream changes checked (99fd9be...a83725b, source read 2026-10-03)

- **Net state at start** (`lib.rs:81-84`): the server starts online only when the product JSON
  says `"start_offline": false`. tC4's product files do not set it, so it starts offline, as
  at 0.18.5.
- **Working-directory start check** (`lib.rs:129`, `utils/bootstrap.rs`): unchanged.
- **Add remote** (`add_remote.rs`, 0fd1c2a): an existing remote now answers 400. tC4's
  `addRemote` contract ("a second add of the same name fails") still holds.
- **CORS**: no handler at a83725b, as at 0.18.5 (`vite.config.js` proxy stays).
- **`/api/version`** (`version.rs`): `os` can come from a dev setting (`force_os`), which only
  `POST /api/settings/dev-setting/<key>/<value>` sets (`settings2/post_dev_setting.rs:18`).
  tC4 does not call that route.
- **`POST /api/system/shutdown`** (bab524c): new; #206 uses it (D89 point 6).
- **Metadata model** (`structs.rs`): formatting only, plus `AppSettings.dev_settings`.

## Journeys (Playwright, full suite)

Each run used its own port lane and a fresh seed.

```
main 6f219aa, 0.18.5 control:            153 passed, 8 skipped, 0 failed (15.5m)
this branch, 0.18.15, first full run:    152 passed, 8 skipped, 2 failed (16.5m)
  J7/J23 OBS Scripture Burrito export — harness OBS group 5/7 (currentScope key order) → D90 point 7
  J7 PDF — a clean git status fell between the open's two commits (test wait) → fixed in the spec
this branch, 0.18.15, final run:         154 passed, 8 skipped, 0 failed (16.4m)
```

J9 failed on `metadata.json` byte equality before D90 point 6 (lane run of
`e2e/j09-import.spec.ts`, 2026-10-03). The new journey `e2e/language-tags.spec.ts` writes
`language-tags.json`: `obs-wizard es_419!` refused with the server's reason; `obs-wizard
es-419` → `es-419` / "Spanish (419)"; `obs-wizard x-abc` + "Abc Language" → stored with that
name; `obs-import es-419` → `es-419`; `obs-import es_419!` refused on the review page.

## Commit time (add-and-commit after one sidecar write, 5 runs, macOS)

```
                       0.18.5          0.18.15
sample_burrito         0.01–0.04 s     0.02–0.07 s
sample_burrito_large   0.64–0.91 s     0.92–1.34 s
```
