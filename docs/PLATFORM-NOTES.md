# Platform notes & verification recipes

Each entry is a behavior of the Pankosmia platform, or of a library in its ecosystem, that is not
evident from the API surface. Read this document before you touch platform endpoints.

**How to read an entry.** Every entry carries a type and a citation. The type says what kind of
claim it is, because the four kinds need different evidence and are easy to confuse:

| Type | Meaning | Evidence it needs |
|---|---|---|
| `[PLATFORM]` | A behavior of `pankosmia-web` or a core client, general to any product | Source read at a stated version + hash + date |
| `[LIBRARY]` | A behavior of an npm package or a component library | The exact package version, ideally an executable proof |
| `[TC3 CONVENTION]` | A data convention of the tC3 ecosystem | The convention's own source |
| `[EXTERNAL]` | DCS / Door43 behavior, not Pankosmia at all | A live measurement, dated |
| `[TC4-ONLY]` | Observed only in the `desktop-app-tc4` product | Named as such — **never generalize it** |
| `[OUR ERROR]` | We got this wrong. Kept because the lesson is the value | What misled us, and the rule adopted |
| `[UNVERIFIED]` | Was true once; not re-checked at the current version | The date it last held |

**Two rules that produce those types.** They exist because we broke both, more than once:

1. **A platform claim must name the surface it was read from, and must hold in at least one
   product that is not `desktop-app-tc4`.** A behavior seen only in the tC4 product — or only on
   our own dev rig — is a tC4 finding until it reproduces in `desktop-app-pithekos` or
   `desktop-app-renaissance`, or is found in the server's general endpoint set, or is documented in
   Pankosmia-Documentation. Entry #26(a) is what happens when this rule is skipped.
2. **Cite version + hash + date, never a bare hash.** A hash alone does not say whether the code is
   current. Run the freshness check first.

Both rules, and the recipes for applying them, are in the final section of this document,
"Verifying a platform claim". Read it before adding an entry here.

## Notes

1. **The platform drafting editor removes alignment markup on save.** The `usfm2draftJson` function in `core-client-workspace` keeps only text tokens. `draftJson2usfm` cannot emit `\w`/`\zaln`. A save overwrites the whole book. The proof executes the platform's own files (`sample-burrito-validation/zaln-strip-repro/`). Consequences: do not point that editor at tC4 data. Do not store `\zaln` at rest (BURRITO-SPEC I-1).
    · `[PLATFORM]` — generality confirmed 2026-08-04 (`core-client-workspace` is in all three product rosters); behavior proven by executable repro, not re-read at a pinned client version.
2. **Occurrence types.** `usfm-js` parses `x-occurrence` attributes as **strings**. `word-aligner` requires **integers**, and it fails fully on a mismatch. Normalize the values on write (BURRITO-SPEC I-2).
    · `[LIBRARY]` — `usfm-js@3.4.3` + `word-aligner@1.0.3`; proven executably by the harness.
3. **`npm install` fails without `legacy-peer-deps`.** `word-aligner@1.0.3` declares a `usfm-js@^2` peer; production pairs it with 3.4.3. The harness ships `.npmrc`. New packages need the same file.
    · `[LIBRARY]` — npm peer-dependency resolution; proven by install.
4. **`usfm-js` single-verse parsing:** `toJSON('\v 1 …', {chunk:true})` returns `verses['1']`, **not** `chapters`. Whole-book parses return `chapters` + `headers`.
    · `[LIBRARY]` — `usfm-js@3.4.3`; proven executably by the harness.
5. **Regeneration rebuilds the ingredients from disk and wipes the `x-` roles — permanently, by design.** This was verified live at 0.17.x (`structs.rs` then had no fields, no flatten): **both** regeneration paths wipe root `relationships` *and* every ingredient `role`. The write path (`?update_ingredients`) replaces the entire ingredients map with a fresh scan (`post_raw_ingredient.rs`: `*ingredients = new_ingredients`). `remake-ingredients` does the same. (A 2026-07-22 claim said that the write path preserves roles. That claim was an instrument error — the baseline was captured after the roles were already wiped. The claim was corrected on the same day; live repro: `sample-burrito-validation/metadata-drop-repro/live-repro.sh`.) `structs.rs` now models `pub role` and `pub relationships` [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30)], but a rescan cannot know the `x-` roles, so they stay non-durable. Stage rules S-1/S-2 (paths authoritative) are permanent rules, and tC4 re-asserts its own roles client-side after every remake [decided 2026-07-30 — D28].
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `post_raw_ingredient.rs:120-121` and `post_remake_ingredients_metadata.rs:64-66`.
6. **The ingredient path sanitizer** rejects dot-prefixed segments and many special characters (BURRITO-SPEC §2). `.tc4/` layouts are impossible. `checking/` is the reserved directory.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `utils/paths.rs:19` `forbidden_path_strings()`, `:64`/`:92` `starts_with(".")`.
7. **The raw-ingredient write endpoint requires `{"payload": "<string>"}`**, as stringified JSON. (History: at ≤0.16.x, a missing or non-string payload **panicked** the handler. The defect was fixed at 0.17.0 with a clean 500 — verified in the 0.16.20→0.17.0 diff.)
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `post_raw_ingredient.rs:75` `json_form["payload"].as_str()`, `:85` clean bad-json response.
8. **The `no_bak` semantics are the opposite of the handler's doc-comment:** if the parameter is present, the endpoint SKIPS the `.bak` backup. The `.bak` file is the only undo. Delete = rename-to-`.bak`. Revert restores the file.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): doc-comment `:19` against `:61` `if !no_bak.is_some()`. The inversion is still present.
9. **Nothing auto-commits. `add-and-commit` sweeps the whole repo. Branch operations refuse on dirty trees.** Commit at checkpoints, and always commit before branch operations (BURRITO-SPEC W-4).
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `add_and_commit.rs:44` `.add_all(&["."], …)`; `set_branch.rs:48-64` dirty-tree refusal.
10. **Flavor→client routing:** the content grid uses only `editTable[flavor][0]`. When both are bundled, one client shadows the others. tC4's own product bundle omits the content and workspace clients, so it never enters this contest. (The prototype `desktop-app-tc4` DOES bundle both, at CLIENT2 and CLIENT11.)
    · `[PLATFORM]` — re-verified 2026-08-04 in `core-client-content/src/components/DataGridComponent.jsx:280-281` at HEAD (pushed 2026-07-31). Generality confirmed: `core-client-workspace` (declared id `core-local-workspace`) and `core-contenthandler_text_translation` both claim the `textTranslation` flavor, in **all three** product rosters — so this is general, not a tC4 configuration effect.
    · `[PLATFORM]` — ordering established 2026-08-14 (closes the re-verification item, issue [#31](https://github.com/unfoldingWord/translationCore4/issues/31) claim 1). The table order is **alphabetical by client id**, not roster order. Chain: `editTable` is built from `GET /api/client-interfaces` by `Object.entries` insertion order (`core-client-content/src/components/DataGridComponent.jsx:13-31,48` at e504268, 2026-04-10). The server builds that response as a `BTreeMap` keyed by client id (`pankosmia-web src/endpoints/clients.rs:49-99`, insert at `:97`) at 0.18.5 (99fd9be, 2026-07-30) — so the JSON serializes sorted by client id, and JS object iteration keeps that order. `editTable[flavor][0]` therefore selects the alphabetically first client id that claims the flavor with an `edit` endpoint. Roster order (`app_setup.json` array order, kept by `merged_clients`, `src/utils/bootstrap.rs:211-238`) governs `/list-clients` only — the earlier "roster order decides" sentence was wrong and is retracted.
11. **SB schema bundle defects:** the root `$id` is `"."`, and `scripture_flavor_type.schema.json` contains a trailing comma (not strict JSON). The broken file is an orphan (no file references it). Thus the server's `boon`-based `/burrito/audit` does not touch it today. If the file is wired in, it panics the audit (measured). The harness re-keys the `$id`s and removes the trailing commas. Repros: `upstream-prs/findings.md`, `sample-burrito-validation/boon-validation-repro/`.
    · `[UNVERIFIED]` — `resource-core` schema bundle; last read 2026-07-06. Not re-checked in the 2026-08-04 pass.
12. **Case conventions:** `contextId.reference.bookId` is lowercase (`tit`). Filenames and scope are uppercase (`TIT`). The tN `quote` field is a word-occurrence **array** — do not flatten it. tN groupIds are renamed with tA `translate/toc.yaml` on load and are reverse-mapped on save.
    · `[TC3 CONVENTION]` — a data convention of the tC3 ecosystem, not platform behavior.
13. **tN categories** in the reference client come from a hardcoded map (`T_NOTES_CATEGORIES` in `uw-client-checks` constants.js). TSV column layouts differ by resource era (7-col current). Treat TSV parsing as versioned.
    · `[TC4-ONLY]` — `uw-client-checks` appears in no product roster except `desktop-app-tc4`. True of that client; not a platform fact.
14. **Empty selections are `false`, not `[]`** in check items. This is a tC3 convention; keep it.
    · `[TC3 CONVENTION]` — a tC3 data convention, not platform behavior.
15. **`Checker` requires `translate`** (an i18n function). It auto-selects the first check when `contextId={}`.
    · `[LIBRARY]` — `core-client-rcl` component contract, not a server behavior.
16. **The DCS `/sb/<ver>.zip` export preserves `\zaln` byte-identically** — OPEN-QUESTIONS #5 is CLOSED (2026-07-25): all 55/55 books are byte-identical to the tag, with 656 `\zaln` in TIT [VERIFIED — `evidence/sb-zip-zaln-2026-07-25.md`]. A `git clone` arrives verbatim [VERIFIED]. The sb-zip export is the resource pin target: the pin is (repoPath, tag, expected SHA), and each import fetches `/sb/<tag>.zip` and verifies the tag's commit SHA from the export's `metadata.json` [decided 2026-07-25 — D23(b)]. Do not assume that the zips are byte-stable across `go-rc2sb` generator versions — verify the SHA on every import.
    · `[EXTERNAL]` — DCS/Door43 behavior, not Pankosmia.
17. **The public `pull-repo` endpoint has no branch parameter.** It fetches with an empty refspec, and it merges the target that `FETCH_HEAD` resolves to. Ref-ordering is not a safe contract (probe, 2026-07-10). OPEN-QUESTIONS #23 is CLOSED (2026-07-18): one single-branch publication repo per actor makes `pull-repo` deterministic — one head, so no incorrect head can be selected [VERIFIED — transport rig 10/10, `evidence/transport-rig-2026-07-18.md`]. Multi-branch `pull-repo` stays ordering-steered and unsafe.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `pull_repo.rs:122-129` resolves `FETCH_HEAD` into `merge_analysis`; no branch parameter exists.
18. **Desktop-app template dev loop** (verified in tc4-POC-2, 2026-07-16):
    · `[PLATFORM]` — `desktop-app-template` dev loop; verified empirically 2026-07-16, not re-verified in the 2026-08-04 pass.
    - When `build_server.zsh` runs in a script, it blocks on an interactive prompt — always pass `-s`.
    - The build step of the run script **wipes client registration** (the gitignored `app_setup.json`) — re-run the client's `install:server` after every build.
    - A client served under `/clients/<id>` needs Vite `base: './'` (absolute asset paths 404).
    - The template build scripts clone **live branches** (no pins), and they `sed`-mutate `Cargo.toml`/`Rocket.toml`.
    - Local projects live at `_local_/_local_/<name>`; user data at `~/pankosmia_working`; resource clones at `~/pankosmia_repos/git.door43.org/…`.
19. **`POST /git/new-scripture-book` writes no `\ts` chunk markers.** Instead, seed new books client-side from the pinned source skeleton (verified: en_ult TIT carries 23 `\ts\*`; tc4-POC-2, 2026-07-16).
    · `[PLATFORM]` — verified empirically 2026-07-16. The 2026-08-04 pass confirmed the handler writes from a USFM template (`new_scripture_book.rs:102-122`) but could not locate the template file in the checkout, so the output claim stands on the 2026-07-16 measurement.

20. **`add-and-commit` panics on a repo with zero commits** (`refs/heads/<branch>` not found — `add_and_commit.rs:50` @ 0.17.0). The platform's `new-*` endpoints always create an initial commit. Each other component that creates a repo must also create an initial commit (transport rig, 2026-07-18).
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `add_and_commit.rs:50` `repo.head().unwrap().peel_to_commit()`.
21. **Do not trust the working tree after a NORMAL `pull-repo` merge.** Merge-added files exist in the merge commit, but they do not exist on disk. Merge-modified files can be stale on disk (`normal_merge` ends with a non-force `checkout_head(None)`; only the fast-forward path does a force-checkout). An `add-and-commit` that follows sweeps the worktree, and it **commits the deletion of the merge-added files**. Read the post-merge state from the commit (`git show HEAD:<path>` semantics / ingredient reads after a re-checkout), or explicitly write the data that you validated before you commit. tC4's integrator writes the validated journal union via ingredient writes for exactly this reason (verified 2026-07-18; `evidence/transport-rig-2026-07-18.md`).
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `fast_forward:32` uses `.force()`, `normal_merge:68` uses `checkout_head(None)`.

22. **Do not use `remake_burrito_from_zip` as the general zip import — CORRECTED 2026-07-27.** The 2026-07-22 claim "zip export and zip import are mutually incompatible" is withdrawn. That claim paired the export with the wrong importer. The general import is `POST /burrito/zipped/<repo_path>` (multipart field `file`). It accepts the server's own export without a change [VERIFIED — rig 0.17.0, `evidence/zip-roundtrip-correction-2026-07-27.md`: import 200; all 10 non-`.git` files byte-identical]. Its rules: the target path must start with `_local_/_sideloaded_/`. The target must not exist. If the target exists, the endpoint returns 400 — delete the local copy first, or change the id info in the zip [per upstream guidance relayed 2026-07-27; `evidence/zip-roundtrip-correction-2026-07-27.md`]. A zip without a root `metadata.json` and an `ingredients/` directory gets 400. `POST /burrito/remake_burrito_from_zip/` is a support tool of the tC4 prototype. It remakes an EXISTING burrito from a DCS-style wrapped zip (depth-1 stripping, `unpack_zip_file(..., Some(1))`). It returns 500 on unwrapped zips. That narrow 2026-07-22 finding is still correct, but it describes the contract of remake, not a platform defect. The export still includes `.git` + `.DS_Store`.
    · `[OUR ERROR]` — corrected 2026-07-27. The withdrawn claim came from reading a tC4-prototype support endpoint instead of the general import. Remake's own contract, described below, is a genuine platform fact.

23. *(retired 2026-08-04 — moved to "Verifying a platform claim" Rule 2 (final section of this document): run the freshness
    check and cite version + hash + date. Number retired so later references still resolve.)*

24. *(retired 2026-08-04 — moved to "Verifying a platform claim" Rule 3 (final section of this document): query the fresh
    `-main` worktree, not the stale checkout. Number retired.)*

25. **Register a client at `/clients/<product.homepage>`, or the 0.18.x server panics at startup.** Since 0.18.0 ("No more main"), the server panics when no client is registered at `/clients/<product.homepage>`. The default `homepage` is `dashboard`, but the bundled dashboard client declares `/clients/main`. Thus the rig's `product.json` sets `"homepage": "main"` [VERIFIED — rig re-baseline at pkg_version 0.18.3, 2026-07-30; D27(a)]. Set `homepage` to the tC4 client when tC4 becomes the landing client. That closes OPEN-QUESTIONS #4.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30). **Citation corrected:** the fatal `unwrap` is at `src/utils/launch.rs:293`, and the tolerant path at `src/lib.rs:75` (a `match` defaulting to `"dashboard"`) still coexists.
26. **Real sb-zips need raised Rocket limits and the unwrapped zip shape.** Trap (a) is **OUR ERROR, corrected 2026-08-04 — not a platform limitation.** The original write-up said the crate's `Rocket.toml` "raises only json/data", so a real sb-zip (en_ult v89 = 7.7 MB) hit Rocket's default 1 MiB `file` cap and returned a catcher-level "unknown error". The measurement was real; the attribution was wrong. At the very commit it cited, **every Pankosmia product already raises all six limits to 128MiB** [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-08-04 read) — `Rocket.toml` in the crate, in `desktop-app-template`, and in `desktop-app-pithekos`: `limits = { form, json, data, data-form, bytes, file }` all `"128MiB"`]. **The tC4 `dev-env` rig has no `Rocket.toml` at all**, so it alone fell back to Rocket's defaults. Rocket reads `Rocket.toml` from the running binary's working directory, not from the dependency crate, so a hand-assembled rig must supply its own — a product built from the template inherits one. The rig's `ROCKET_LIMITS` line (`dev-env/scripts/run.zsh:10`) compensates for our missing file and is the correct local fix. **There is no upstream ask here**; the earlier "route the deploy-level limit observation upstream" note is withdrawn. **Confirmed empirically 2026-08-04:** a `Rocket.toml` copied from `desktop-app-template` was added at `dev-env/server/Rocket.toml`; the server then reports `limits: … file = 128MiB, form = 128MiB` at startup with **no `ROCKET_LIMITS` env var**, and a real 7.2 MB sb-zip (en_tn v89) is read in full and answered by the handler (`400 {"is_good":false,"reason":"Zip does not look like a burrito"}` — trap (b)/#29, zero directory entries), not by the catcher. A limits rejection never reaches the handler, so the size ceiling is gone. Lesson: a limit observed only on our own rig is a rig finding until it reproduces on a product built from `desktop-app-template`. Trap (b) below is a genuine platform contract. (b) `POST /burrito/zipped` requires the **unwrapped** shape (`metadata.json` at zip root — `post_zipped_repo.rs` `check_burrito_zip`), but the DCS `/sb/<tag>.zip` export is **wrapped** (one `<repo>/` top dir). Strip the wrapper before import (`dev-env/resources-cache/*-unwrapped.zip`; `seed.zsh` replicates the import with a plain unzip — the handler does no git init). `remake_burrito_from_zip` is the opposite: it wants the wrapped shape and an existing target repo (D22, round-trip R6b/R6c).
    · `[OUR ERROR]` (trap a) + `[PLATFORM]` (trap b) — see the entry.
27. **`new-text-translation` rejects region-subtag language codes.** `POST /git/new-text-translation` with `content_language_code: "es-419"` returns `{"is_good":false,"reason":"Language code 'es-419' is not custom (no 'x-') but has not been found in the BCP47 lookup table"}` [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30), live rig integration test]. The lookup accepts bare codes (`es`, `en`) and `x-` custom codes only. Projects seeded by filesystem (the es-419 sample) are unaffected — the constraint binds only the creation endpoint. The create wizard MUST surface this error state; route the observation upstream through the project owner if a partner needs region subtags at creation.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `new_text_translation.rs:180` against the `bcp47-language_codes.json` lookup.
28. **A failed `new-text-translation` leaves a git-init'd debris repo.** The handler creates the repo directory and runs `git init` (line ~109) BEFORE it validates the language code (~line 179) [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30) source + live repro: an es-419 rejection left `_local_/_local_/<abbr>` on disk]. The debris blocks a corrected retry with the same name ("Repo already exists" / 400), and `list-local-repos` lists it even without `metadata.json`. Client duty: pre-check the name against `list-local-repos` before the create, and on a create failure delete the debris with `POST /git/delete/<repoPath>` — ONLY when the path did not exist before the attempt (the tC4 wizard implements exactly this guard). Route upstream through the project owner if wanted: validate-then-init would remove the class.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `Repository::init_opts` at `:109`, BCP47 validation at `:180`. Init precedes validation.

29. **`POST /burrito/zipped` needs an explicit `ingredients/` DIRECTORY entry, not just file paths** [VERIFIED — pankosmia-web 0.18.5 (99fd9be), source read of `endpoints/burrito2/post_zipped_repo.rs` after a live 400]. `check_burrito_zip` accepts the archive only when it finds a FILE entry named exactly `metadata.json` **and** an entry named `ingredients/` (or `ingredients`) for which `is_file()` is false. A zip built from a flat path map — `metadata.json` + `ingredients/TIT.tsv` — contains no directory records and is rejected with `Zip does not look like a burrito`, even though the tree is correct. Any client that re-zips (e.g. after stripping the DCS export's wrapper, #26b) MUST write the directory entries itself. tC4 does this in `src/data/resourceFetch.ts` `rezip()`, with a regression test.
    · `[PLATFORM]` — re-verified 2026-08-04 at 0.18.5 (99fd9be, 2026-07-30): `post_zipped_repo.rs:37-46` `check_burrito_zip`.

30. **A DCS sb-zip export records the org name AS IT WAS AT EXPORT TIME, so an org rename makes it stale — and it is NOT a live address.** [VERIFIED live 2026-08-04] `Es-419_gl/es-419_tn` `/sb/v66.zip` declares `identification.primary.dcs` = `Idiomas-Puentes/es-419_tn`; the same holds for `es-419_tw` v37 and `es-419_ta` v4. Measured today: `GET /api/v1/orgs/Idiomas-Puentes` → **404** (no redirect), `GET /api/v1/orgs/Es-419_gl` → 200, and `GET /api/v1/repos/Es-419_gl/es-419_tn` reports `full_name: es-419_gl/es-419_tn`. So the export's own metadata names an org that no longer exists. Consequences for any client that identifies an installed burrito from its metadata: (a) the SHA→tag lookup 404s, so the resource stays unidentified and contributes no coverage; (b) the derived repoPath matches no pin, so a resource that IS on disk reads as not-local (a false "unavailable offline" verdict). The metadata dcs key is **provenance**, not an address. tC4 handles this in `src/data/installed.ts` `discoverOnDisk`, which prefers the configured gateway org when exactly one configured org publishes a repo of that name, and falls back to the metadata path when the name is ambiguous (two orgs both publish `fr_tn`). English never shows this defect — `unfoldingWord` was never renamed — so it is invisible until a second gateway language is tested.
    · `[EXTERNAL]` — DCS/Door43 behavior, not Pankosmia. Measured live 2026-08-04.

31. **Store the repo path exactly as DCS reports it; compare it case-insensitively.** [decided 2026-08-04 — D37, owner ruling: "maintain DCS casing so there is as little conversion needed as possible"] A DCS repo path is a case-insensitive *address*: `GET /api/v1/repos/Es-419_gl/es-419_tn` returns 200 and reports `full_name: es-419_gl/es-419_tn` [VERIFIED live 2026-08-04]. So the catalogue's own form is the canonical stored form — pins, install records and coverage keys carry it unchanged, and no normalization step exists on read or write. The conformance sample was corrected to `es-419_gl` in the same change set (it had been written `Es-419_gl` on 2026-07-31, from the evidence of that date). The reason a comparison tolerance is still kept (`samePath` in `src/data/resolve.ts`): a burrito written by another tool, or by an earlier version of this one, may carry a different casing, and a raw string compare then makes an INSTALLED resource read as absent — which the preflight showed to the user as **"needs downloading"** for files sitting on disk. Same class as #30: the path string a burrito records is provenance, and only the catalogue is authoritative about the address.
    · `[EXTERNAL]` — DCS/Door43 behavior, not Pankosmia. Measured live 2026-08-04.

32. **The desktop template ships Electronite, not plain Electron.** [VERIFIED — desktop-app-template 4cb7576 (2026-08-14)] The wrapper answer for issue [#32](https://github.com/unfoldingWord/translationCore4/issues/32) and D20: the template's install scripts download prebuilt **Electronite v37.1.0-graphite** binaries from `github.com/unfoldingWord/electronite` releases, for macOS, Linux and Windows, arm64 and x64 (`macos/install/makeAllInstallsElectronite.sh:56-57`, `linux/install/makeAllInstallsElectronite.bsh:56-57`, `windows/install/makeAllInstallsElectronite.ps1:51`). No substitution is needed. There is no Electron npm dependency at all — the app dir carries only `electronStartup.js` plus a small node_modules subset, and the Electronite binary loads it directly. The template's `local_server` pins `pankosmia_web = "=0.16.20"` on `main` (dev tier 0.18.7 via `local_server.env`), which differs from our 0.18.5 rev pin — a tC4 package must build the server from `dev-env/server` instead. Witnessed 2026-08-14 on macOS arm64: an Electronite `v37.1.0-graphite` window (CDP reports Chrome/138.0.7204.35) booted into `/clients/uw-tc4` and rendered the tC4 project list against the 0.18.5 rig. Graphite font shaping in the packaged app is still unproven (the second acceptance item of #32).
    · `[PLATFORM]` — source read at desktop-app-template 4cb7576 (2026-08-14) + live boot. See `docs/PACKAGING.md`.

## Verification recipes

- **Conformance proof:** `cd conformance && npm install && npm run generate && npm run validate` (expect 34/34 — Stage-1 30, Stage-2 2, Phase-2 2) [VERIFIED — executed 2026-08-04, after the 1.7-draft D36 carry-over change set; 33/33 at the 1.6-draft D17/D30 two-language-set change set (OPEN-QUESTIONS #28); 31/31 at the 1.5-draft extraScripture change set; 30/30 at the 1.4-draft D25–D28 edits]. Journal suite: `npm run validate:journal` — the suite's own summary line is the authoritative count, and it grows with each review round (259 passed, 0 failed after review round 9's boundary half; 217 after round 8). Both: `validate:all`.
- **Editor data-loss repro:** `cd sample-burrito-validation/zaln-strip-repro && npm install && node test.mjs` (expect zero `\zaln`/`\w` in output).
- **Metadata-drop repro:** `cd sample-burrito-validation/metadata-drop-repro && cargo run -- ../../sample-burrito/metadata.json` (expect both drops reported).
- **Upstream freshness + graph reindex (run FIRST, before any platform claim):** `zsh scripts/upstream-freshness.zsh` (add `--report` to change nothing, `--no-index` to skip the reindex). Then scope graph queries to the `…-pankosmia-web-main` project.
- **Re-verify a platform claim at HEAD:** shallow-clone the repo(s). Diff the cited file/lines against the recorded commit. If the behavior changed, update the doc that makes the claim **and** open (or update) a `question` issue on the board, and cite the new commit.
- **Check a new burrito for conformance:** point the harness's `BURRITO` path at the burrito (top of `validate.mjs`), and run `npm run validate`.
- **Transport suite against the live server:** `dev-env/scripts/seed.zsh && dev-env/scripts/run.zsh`, then `cd conformance && npm run validate:transport` (expect 10/10).
- **Server round-trip of custom work: RE-SEED FIRST.** The suite degrades the seeded fixture as it
  runs — it leaves a `.bak` in `_local_/_local_/sample_burrito` and its `update_ingredients` write
  wipes the 6 `x-` roles. On a second run R2 then compares 0 roles against 0 and reports
  "roles SURVIVED", which is a false pass, and R2/R3/R7 fail on the stray `.bak` (measured twice,
  2026-08-04: 9/12 on a used fixture, 12/12 after `seed.zsh`). Always run
  `zsh dev-env/scripts/seed.zsh` immediately before the suite, then start the rig, then run
  `npm run validate:roundtrip` (expect 12/12 — incl. Stage-1 **30/30** on the server-touched copy [VERIFIED — re-baselined at pankosmia-web 0.18.5 (99fd9be, 2026-07-30), `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; the earlier flag on the stale 23/23 count is resolved]). The harness target is env-overridable: `BURRITO=<path> npm run validate`. On a server-rescanned copy the expected Stage-2 split is **1/2** at 0.18.5: `relationships` now SURVIVES regeneration (the D27 special measurement, answered), while `x-` roles are still wiped — the accepted condition, not a pending-fix acceptance test [decided 2026-07-30 — D28; S-1 authority unchanged]. The rig pin is the 0.18.5 git rev `99fd9be` (crates.io stops at 0.18.4, which was published from `5e5b693` WITHOUT the role/relationships modeling — verified from the crate's own `.cargo_vcs_info.json`). The pin includes the 0.18.4 `GET/POST /client-settings/<storage_id>` endpoints — available and optional for Increment-1 code.

---

## Verifying a platform claim

*(Moved here 2026-08-07 from `VERIFYING-PLATFORM-CLAIMS.md`, unchanged except heading levels
and this note. The verification tooling named below — `scripts/upstream-freshness.zsh`, the
`upstream/` mirrors, the graph index — lives in the maintainer workspace, not in this
repository. A contributor without that tooling states so and routes the claim to a
maintainer instead of asserting it.)*


Read this before you add an entry to this document, and before you tell anyone that the
Pankosmia platform does or does not do something.

Every rule below exists because this project broke it and produced a wrong statement about someone
else's code. The dates are kept so the pattern stays visible.

---

### Rule 1 — Name the surface, and prove it is general

**A behavior seen only in `desktop-app-tc4`, or only on our own dev rig, is not a platform fact.**

A Pankosmia product is a template plus a roster of clients in `app_config.env`. `desktop-app-tc4`
shares 9 of its 11 clients with the other products; only `core-contenthandler_t_core` and
`uw-client-checks` are unique to it [VERIFIED 2026-08-04]. The `core-` prefix is not a signal —
`core-contenthandler_t_core` carries it and is tC4-only. Org ownership is not a signal either —
`uw-client-checks` lives in the `pankosmia` org and is still tC4-only.

Before you generalize, do one of these:

1. **Check the rosters.** `app_config.env` in `desktop-app-pithekos` and `desktop-app-renaissance`.
   Present there → general. Only in `desktop-app-tc4` → tC4-specific, and label it `[TC4-ONLY]`.
2. **Check the flavor claims.** `pankosmia_metadata.json` in a client; the keys of its `endpoints`
   object are the flavors it claims. This is how to tell whether two clients collide on a flavor.
   Example: `core-client-workspace` (declared id `core-local-workspace`) and
   `core-contenthandler_text_translation` both claim `textTranslation`, in every product — so the
   routing behavior in `PLATFORM-NOTES` #10 is general. `core-contenthandler_t_core` claims
   `x-tcore`, a different flavor, so it does not collide.
3. **Check the general endpoint set.** Enumerate siblings before calling one endpoint's behavior a
   defect. `post_zipped_repo` sits directly beside `get_zipped_repo`; the server also ships
   `new_tcore_resource.rs`, which is tC4-shaped. One look at the directory listing distinguishes a
   general endpoint from a prototype support endpoint.
4. **Check the platform's own documentation.** `Pankosmia-Documentation` states the architecture
   and the project distinctives. Its prose lives in `_data/i18n.json`, not in the `.md` files,
   which are i18n templates.

**What this rule caught.** #26(a) claimed Rocket's default upload limits reject real sb-zips. Every
Pankosmia product raises all six limits to 128MiB; our rig shipped no `Rocket.toml` at all and was
the only thing hitting the defaults. It was written up as a platform limitation with an upstream ask
attached. (2026-07-27 and 2026-07-30 are two earlier instances of the same class.)

### Rule 2 — Cite version + hash + date, never a bare hash

Run this first, always:

```
zsh scripts/upstream-freshness.zsh
```

Add `--report` to change nothing, `--no-index` to skip the graph reindex. It fetches every mirror,
prints the checkout **version** against the `origin/main` **version**, keeps a `<repo>-main`
worktree pinned to `origin/main`, never touches local reference branches, and writes paste-ready
citations. It only fetches — the push URL is disabled on purpose.

Cite like this:

```
[VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30)]
```

A hash alone does not tell you whether the code is current. Upstream moves daily; it went
0.18.3 → 0.18.5 inside one session.

**What this rule caught.** On 2026-07-30 the `upstream/pankosmia-web` checkout was on a local
branch (`uw/pr2-merge-branch-endpoint`) at 0.16.18 while `origin/main` was at 0.18.4 — 17 commits
ahead. "Versification is unspecced" was reported to the project owner as a fact. **A stale checkout
looks exactly like an absent feature.**

### Rule 3 — Query the fresh worktree, never the stale checkout

Graph queries are the right tool for "does a general endpoint already exist?" — but scope every
query to the newly indexed `…-upstream-pankosmia-web-main` project. The whole-tree project also
contains the stale checkout, so an unscoped query can answer with structural confidence from old
code.

The graph does **not** cover the shipped client bundles, which are minified JS. For "does a client
already do this?", grep `dev-env/app-resources/clients/`.

### Rule 4 — Absolute paths in every shell call

The working directory persists between calls. A leftover `cd` makes a directory appear to vanish
and a relative `docs/…` path resolve inside an upstream worktree. Both have happened.

---

### Recording a claim

1. Run the freshness check.
2. Read the source in the `-main` worktree; note file and line.
3. Apply Rule 1 — establish generality, or label `[TC4-ONLY]`.
4. Add the entry to `PLATFORM-NOTES.md` with its type and its full citation.
5. If the claim affects the project format, the specification and the harness change in the same
   change set (`BURRITO-SPEC §9`).
6. If a claim turns out wrong, **keep the entry** and relabel it `[OUR ERROR]` with what misled us.
   The correction is worth more than the original claim, and an accurate account of our own mistake
   is never a criticism of anyone else's work.

### Entry numbers retired from PLATFORM-NOTES

`#23` and `#24` moved here on 2026-08-04 (Rules 2 and 3). Their numbers stay retired so every older
reference to `#25`–`#31` keeps resolving.
