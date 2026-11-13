---
name: Release
about: One issue per release tag, from the first check on main to the download page, with every step a person or an AI agent can verify.
title: "Release v"
labels: epic
---

<!--
Title: "Release v<version>" (`Release v4.1.0`, `Release v4.1.0-preview`). One issue per tag; a
release candidate that is replaced gets a new issue that links this one.
How a release works is in `docs/RELEASE.md`; this issue is the checklist for one release of it.
Never type live state into this issue (which jobs are green, how many strings are pending): link
the run, the file or the test that shows it. A box is ticked only with a link to its evidence.
Two kinds of tag:
- A `-preview` tag goes to named testers only. Its `translations` job skips the one test
  `release_has_no_pending_translation`, so testers see pending strings in English (#848); About
  says "preview"; the project format need not be frozen (ruling H9,
  docs/rulings/2026-10-27-H9.md).
- A public tag (`v4.1.0`, `v4.1.1`) needs every box below.
Strike the lines marked *(public only)* for a preview. Delete these comments when you file.
-->

## What this release is

<!-- Two or three sentences: the version, whether it is a preview or public, what a translator
gets that the previous version did not, and the version it follows. Name the milestone. -->

- **Version:** v
- **Follows:** v
- **Milestone:**
- **Kind:** preview to named testers | public

## Dates

<!-- As tC4's release issues did (#546): a cut, after which only a release blocker may enter
(data loss, a project that cannot open, an install that fails); the tag; the publication. A gate
that is not green moves the date; a feature that is not green leaves the release. -->

- **Cut:**
- **Tag:**
- **Published:**

## Blocked by

<!-- Add every issue this release waits for to GitHub's "blocked by" list on this issue, so the
list is live. Below, only the gates: the issues that move the date rather than leave the
release. -->

## Before the cut

### Scope

- [ ] Every screen or behavior changed from tC4 4.0 has its entry in `docs/DIFFERENCES.md`.
- [ ] `docs/P-LEDGER.md` names a job and tests for each of P1–P10 that this release claims
      (`scripts/tools/claims.test.mjs` passes).
- [ ] *(public only)* The project format this release writes is frozen (H9,
      `docs/rulings/2026-11-09-H9-freeze.md`): `fixtures/capsules/<major>.<minor>/FROZEN`
      exists for `FORMAT_MAJOR`.`FORMAT_MINOR` in `crates/tc-journal/src/format.rs`, and the
      P10 pins pass (`every_kind_has_the_pinned_wire_form`, `the_encoding_is_pinned`,
      `tokens_have_the_pinned_byte_form_and_key`).
- [ ] *(public only)* `format-older-reader` is green on the commit to tag: the build at the
      last freeze meets folders this build wrote (`docs/STORAGE.md` §12.3). If this release
      raises the format, its capsule set and `FROZEN` marker are merged first.

### Localization

<!-- tC4's catalogs are in `crates/tc-ui/assets/i18n`; the rebuild's own strings are in
`crates/tc-ui/assets/i18n-rebuild` (its README says how). A key still in `<id>.pending.json`
shows in English in that language. The owner translates (ruling H10,
docs/rulings/2026-10-22-H10.md); the release workflow's `translations` job refuses to build a
public tag while any key is pending. -->

- [ ] Every new or changed interface string is in `i18n-rebuild/en.json`, and listed as pending
      in every other language until translated.
- [ ] **Owner:** the pending keys are handed over, and the translated files are merged
      (key into `<id>.json`, out of `<id>.pending.json`).
- [ ] `cargo test --release -p tc-api --test refusals` passes on `main`.
- [ ] *(public only)* `release_has_no_pending_translation` passes too, so no
      `<id>.pending.json` holds a key.
- [ ] A preview: the release notes say which languages still show some English.
- [ ] The Arabic interface, and Hebrew and Arabic scripture text, were opened once on a built
      app after the string changes; the P8 journeys are green on the tip.

### Help in the app

<!-- The help pages are translationCore-Suite-website's `public/tc-help/` (the help of
https://translationcore.com/tc-help/), copied byte for byte by
`crates/tc-ui/vendor-help.sh [REV]` and listed with their blob ids in
`crates/tc-ui/help-pages.txt` (APP-DESIGN AD29, #1031). `cargo test -p tc-ui`
(`tests/help_pages.rs`) checks every byte, and `cargo test -p tc-server --test help_links` checks
that every link resolves in the app. Order: change the pages in translationCore-Suite-website
first, then re-vendor, then test; a page cannot be edited in this repository. tc-website's
`tc-help/` is retired. -->

- [ ] Every screen or flow this release adds or changes has its help page in
      translationCore-Suite-website, and "What's new" (`section-whats-new`) describes this
      release's changes. Link the translationCore-Suite-website pull request.
- [ ] `crates/tc-ui/vendor-help.sh <commit>` was run at the translationCore-Suite-website
      commit above; `help-pages.txt` records that commit; `HELP_PIN` in
      `crates/tc-ui/tests/help_pages.rs` is set to it; `cargo test -p tc-ui` and
      `cargo test -p tc-server --test help_links --test help_overlay` pass.
- [ ] Help names no tC4 build, so it cannot disagree with About (journey
      `help_home_shows_no_rc1_build_text_offline` is green). What Help may say about its own
      version is still the owner's open question Q31 (`docs/TC4-DELTA-2026-10-19.md`); if it is
      answered for this release, link the answer.
- [ ] The licence record in the header of `help-pages.txt` still says CC BY-SA 4.0, as the owner
      decided (APP-DESIGN Q-19, #1031).

### Pins and third parties

<!-- These are checked by the release workflow (`docs/RELEASE.md` "The checks on every
release"); here, say what changed and link the run that checked it. -->

- [ ] Electronite: the tag and archive sha256 agree in `.github/workflows/release.yml` and
      `scripts/release/stage.sh`. If the shell moved, link its issue and its evidence.
- [ ] `THIRD-PARTY-NOTICES.txt` names every crate in `Cargo.lock` and every bundled resource
      (`scripts/release/notices.test.mjs`); new crates and resources have their notice.
- [ ] Bundled resources: `bundle/en/fetched.lock` pins what the release ships; the `common`
      job's bundle step ends `, 0 skipped,` (`bundle_store` after `fetch-pinned.mjs`).
- [ ] Upgraded Door43 or Aquifer resources: the upgrade path from the previous release's pins
      was walked once on a built app (V4: the app announces, never installs silently).

### Version

- [ ] `[workspace.package] version` in `Cargo.toml` equals the tag without its `v`, on `main`,
      before the tag is pushed (the tag's `translations` job refuses a tag that differs, #966).
      About, the installer names and `BUILD-MANIFEST.json` all read it.
- [ ] The release notes draft names the previous version and the project format, so a
      translator who goes back knows which version to take and what it can open
      (`docs/RELEASE.md` "Rolling back").

### Signing and protections

<!-- `docs/RELEASE.md` "Signing" (ruling H4). Set up once by someone with admin rights; check
each release that it is still so, since a tag's Windows build fails at signing without it and
nothing is published. -->

- [ ] The `windows-signing` environment allows only the default branch and `v*` tags, and has a
      required reviewer.
- [ ] The `v*` tag ruleset lets only release managers create, update or delete release tags.
- [ ] The five `AZURE_*` repository variables and the federated credential are present (names
      only; never paste values).
- [ ] `TC_HELP_DESK_TOKEN` and `TC_HELP_DESK_EMAIL` are present, so the installed app can send
      Feedback (`docs/RELEASE.md` "Secrets").
- [ ] A manual run of `release` on the default branch with **sign** ticked produced a signed
      Windows installer, checked with `Get-AuthenticodeSignature` (command in `RELEASE.md`).

### The tip of main

- [ ] `scripts/gates.sh` is green on the commit to tag. Link the `ci`, `app-e2e` and `shell`
      runs.
- [ ] Each P1–P10 row of `docs/P-LEDGER.md` was read against those runs; any row skipped is
      named here with what it waits for.
- [ ] A branch run of `release` (a push that touches `.github/workflows/release.yml`,
      `scripts/release/`, `branding/` or `shell/`, or a manual run) built and smoke-tested all
      three platforms, unsigned.
- [ ] Nothing a translator can reach is open with `Priority/Critical`, or it is named below
      as a known limit with the owner's yes.

## The cut

<!-- After this date only a release blocker enters: data loss, a project that cannot open, an
install that fails. If one enters, the tag below is replaced by the next candidate and this
list is redone for it. -->

- [ ] Every open issue in the milestone is moved to the next milestone, and its edge removed
      from this issue's "blocked by" list.
- [ ] The commit to tag is named here: `<sha>`.

## The tag

- [ ] **Owner** (or the person the owner names) pushes `v<version>` on the default branch.
      Nobody else pushes release tags.
- [ ] `translations`, `common`, `build` ×3 and `smoke` ×3 are green on the tag run. Link the
      run.
- [ ] The Windows installer is signed (no `-unsigned` in its name).
- [ ] The installed files are the build's (`installed_manifest_is_the_build_s` and
      `installed_files_are_the_manifest_s` on the smoke run), and on macOS the installed app's
      seal is valid (`installed_app_seal_is_valid`, #969). The installers themselves are not in
      the manifest.
- [ ] `publish` made a **draft** release holding the three installers and three manifests.
- [ ] By hand, on one platform (the tag run reinstalls this build over itself, not the previous
      release): `scripts/release/smoke-installed.sh <platform> <this dist> <previous release's
      dist>`, so a project the previous version wrote opens, and a project this version wrote
      is read-only or refused in the previous one, never written (#46).

## Installed check by a person

<!-- The smoke test is a machine on a fresh runner. One person installs each platform's file
from the draft as a translator would, before the owner publishes. -->

- [ ] Windows: install from the `.exe` as a standard user; About shows this version and the
      tag's commit; Help opens offline.
- [ ] macOS: open the `.pkg` by the README's steps (Privacy & Security, Open Anyway); the app
      starts; About and Help as above.
- [ ] Linux: unzip, start; About and Help as above.
- [ ] On one platform: open a project saved by the previous release; draft a verse; check one
      item; align one verse; sync or exchange once; send one Feedback; restart; the work is
      there.
- [ ] On one platform: uninstall, then install the previous release over the kept folders;
      the project opens as `docs/RELEASE.md` "What the previous version does" says.

## Release notes and publication

- [ ] The notes say, in a translator's words, what this version gives them (from the merge
      subjects since the previous tag), the previous version, the project format, and the
      known limits (macOS unsigned and not notarized; anything struck above).
- [ ] **Owner** publishes the draft. A preview is published as a pre-release.

## The website

<!-- The app does not check for new versions; the download page and the notes are the only ways
to reach translators (`docs/RELEASE.md` "What the app does not do"). The page is
https://translationcore.com/desktop/ (ruling H16 part 3; its first address, /tc4, redirects there,
#1031), in translationCore-Suite-website. -->

- [ ] *(public only)* The download page offers this version's three files and names the
      version; the links resolve to the published release's assets.
- [ ] *(public only)* The download page says how to open the unsigned macOS package.
- [ ] A preview: the named testers were sent the pre-release link and told what still shows in
      English and what is not promised across a preview (H9).

## After publication

- [ ] `docs/evidence/release-<version>-<date>.md` records the tag's commit, the runs, each
      P row's result or what it waits for, the installed checks, and the rollback target
      (shape: `docs/evidence/rel-1-2026-10-27.md`).
- [ ] The milestone is closed; the next milestone exists.
- [ ] The help desk (the app's Feedback, `docs/contracts/SHELL.md` item 11) is watched for the
      first week; a release blocker found becomes a patch issue linked here.
- [ ] If this release is withdrawn: the steps in `docs/RELEASE.md` "The owner: stop a bad
      release" were followed and linked here.

## Known limits shipped on purpose

<!-- Each with its issue and the owner's yes. The notes repeat this list. -->

## Assumptions and open questions

<!-- Defaults chosen where the process was silent. Questions only the owner can answer
(what a translator would notice) get `needs definition`. Standing ones:
- Q31: what Help may say about the app's version (`docs/TC4-DELTA-2026-10-19.md`).
- Whether the help pages are also published on translationcore.com, and if so that the site
  shows the commit the app vendored. No document in this repository says they are. -->
