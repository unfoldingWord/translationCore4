# Releasing translationCore 4

How the app is built, tested and released for Windows, macOS and Linux (card G3; owner rulings
H3, H4, H10 and H16). The pipeline is `.github/workflows/release.yml`; its scripts are in
`scripts/release/`.

## What a release is

- **Version:** semver, from `[workspace.package] version` in `Cargo.toml`. The first public
  release is 4.1.0 (H16 part 1). Before it, `4.1.0-preview` (tag `v4.1.0-preview`) goes to named testers only: About says "preview". `4.1.0-preview2` (tag `v4.1.0-preview2`) is the build at the format 1.0 freeze, for the same testers; CI's `format-older-reader` job drives that build on every merge-queue run (H9, `rulings/2026-10-27-H9.md` and `rulings/2026-11-09-H9-freeze.md`; STORAGE §12.3). A patch fixes, a minor adds, a major breaks an older
  project or sync peer.
- **Names (H16 part 3):** the app shows itself as **translationCore**; it is installed as
  **translationCore 4** (install folder, Start menu, Applications). The download page is
  https://translationcore.com/tc4.
- **Platforms (H3):** Windows 10 x64 and later, macOS 13 and later on Apple silicon, Ubuntu 22.04
  x64 and later. The runners that build and test them are windows-2025, macos-15 and ubuntu-24.04.
- **Files:** `translationCore4-<version>-windows-x64.exe` (`-unsigned` when not signed), a per-user
  installer that needs no administrator; `translationCore4-<version>-macos-arm64-unsigned.pkg`;
  `translationCore4-<version>-linux-x64.zip`; and one `BUILD-MANIFEST-<platform>.json` each.
- **THIRD-PARTY-NOTICES.txt** (beside `LICENSE` in the installed app; in
  `Contents/Resources` on macOS): the licence of every crate in `Cargo.lock`, tc-rst's NOTICE
  files, the fonts' OFL texts, Electronite's licence, and an attribution block (title, creator,
  rights, source, changes) for each bundled Door43 resource, as CC BY-SA asks. About
  translationCore shows it under Third-party licenses, read from this file with no network: the
  launcher passes its path to `tc4 serve --notices` (#606).
- **BUILD-MANIFEST.json** (also inside each installed app): the commit, the version, the platform,
  Electronite's tag and archive sha256, and the sha256 and size of every shipped file. About shows
  the same commit (`app/hello`'s `build.commit`), and the smoke test checks they match. The
  manifest records every shipped regular file as it ships, after signing (the symbolic links
  inside Electron's frameworks are not files and are not recorded), with two exceptions on macOS,
  named in its `unrecorded` list: `Contents/MacOS/Electron` and
  `Contents/_CodeSignature/CodeResources`. They hold the bundle's own signature, which seals the
  manifest in, so they are written after it and cover it rather than the other way round
  (`scripts/release/seal-macos.sh`; #969). On Windows and Linux `unrecorded` is empty.
  `node scripts/release/manifest.mjs --check <BUILD-MANIFEST.json> --root <app>` checks a
  staged or installed app against its manifest; packaging and the smoke test run it.

## Where things live on the translator's computer

| What | Where |
|---|---|
| The app | Windows `%LOCALAPPDATA%\Programs\translationCore 4`; macOS `/Applications/translationCore 4.app`; Linux the unzipped `translationCore 4` folder |
| Projects | `translationCore4/projects` in the home folder (H16 part 2) |
| App data: resources, settings, drafts, logs | `app-data` in the shell's user-data folder: Windows `%APPDATA%\translationCore4`, macOS `~/Library/Application Support/translationCore4`, Linux `~/.config/translationCore4` |

Uninstalling or updating replaces only the app. Projects and app data stay (tC4 #44); the smoke
test checks it.

A newer installer replaces the installed app (#1016). On Windows, Inno Setup finds the earlier
install by its `AppId` and installs into the same folder. On macOS the pkg writes only
`/Applications/translationCore 4.app`, so its scripts (`scripts/release/macos-preinstall.sh`,
run before and after the install) look for a translationCore 4 anywhere else: by bundle id
through Spotlight, in Applications and the home folder of the person at the screen, and, for a
Mac that does not index, in Applications and that person's Applications, Desktop and Downloads.
A copy on another disk or in another person's folder is not looked for, nor is one outside
those four folders on a Mac that does not index.

- When a translationCore 4 is found, at the install location or elsewhere, the installer asks
  before anything is replaced. *Replace* installs, then removes the copies elsewhere that it
  listed. *Cancel*, or no answer in five minutes, installs nothing and removes nothing; Installer
  then reports a failed installation, which is the only way a pkg script can stop.
- With nobody to ask (`installer -pkg` in a terminal, or nobody logged in), or when the question
  cannot be shown, it installs and removes nothing elsewhere: no copy is removed that a person
  was not shown.
- The tC4 4.0 beta (`translationCore4.app`, the same bundle id) is not a translationCore 4 and
  stays beside it (H16 part 3).

On Linux the translator deletes the old folder and unzips the new one.

The installed bundle's `CFBundleShortVersionString` and the pkg receipt (`pkgutil --pkg-info
org.unfoldingword.translationcore4`) carry the app's whole version, such as `4.1.0-preview2`;
`CFBundleVersion` carries its numbers, `4.1.0`.

## Cutting a release

Each release has one GitHub issue, opened from the **Release** issue template
(`.github/ISSUE_TEMPLATE/release.md`), titled `Release v<version>`. It is the checklist for the
steps below and for what the pipeline does not check: the translations handed to the owner, the
help pages re-vendored from tc-website, the download page, the installed check by a person, and
the evidence written afterwards. A box is ticked only with a link to its evidence.

1. On the default branch, when the release is ready, the owner (or someone the owner names)
   pushes the tag: `git tag v4.1.0-preview2 && git push origin v4.1.0-preview2`. Nobody else pushes release tags.
2. The tag runs `release`. It builds nothing for a tag while any interface string is untranslated
   (job `translations`, `cargo test --release -p tc-api --test refusals`; rulings/2026-10-22-H10.md).
   A `-preview` tag skips that one check, so testers see any pending string in English (#848).
3. Each platform is built, installed on a fresh runner of its own system and smoke-tested there.
   Only when every job passed does `publish` make a **draft** GitHub release with the installers
   and manifests.
4. The owner reads the draft, adds the release notes (what the translator gets, from the merge
   subjects since the last tag), and publishes it. The notes name the previous version and the
   project format (`FORMAT_MAJOR`.`FORMAT_MINOR` in `crates/tc-journal/src/format.rs`), so a
   translator who has to go back knows which version to take and what it can open.

A tag run signs the Windows build inside the `windows-signing` environment (below). Until signing
is set up, the tag's Windows build fails at signing and nothing is published; `publish` also
refuses any Windows installer named `-unsigned` (tC4 #456). So a release always carries a signed
Windows installer. To try signing without a tag, run the workflow by hand on the default branch
with **sign** ticked.

## Signing (H4)

Yakob signs, as for tC4. Windows is signed with Azure Artifact Signing through GitHub's OIDC token,
exactly as tC4's `package-desktop.yml` (#456): no password or key is stored in this repository.
macOS stays unsigned and not notarized, as tC4 4.0 rc.2; the app is ad-hoc signed so Apple
silicon runs it, and the pkg's README says how to open it (System Settings, Privacy & Security,
Open Anyway). The ad-hoc seal must still be valid on the translator's Mac: `seal-macos.sh` signs
the staged bundle, writes the manifest inside it, re-signs the app over the manifest, and
verifies the result; nothing writes into the bundle after that (#969: every bundle shipped
before it had its manifest added after the seal, and failed verification). `package.sh` verifies
the seal and the manifest again before it packages, and the smoke test once more on the
installed app, so a release never carries an invalid seal. Check a bundle by hand:

```sh
codesign --verify --deep --strict "/Applications/translationCore 4.app"
```

What must be set up once in the GitHub repository, by someone with admin rights (owner action A4):

- An environment named **`windows-signing`**, with deployment rules (*Selected branches and
  tags*) that allow only the default branch and tags matching `v*`. tC4 allows its `release/*`
  branches the same way. Give the environment a **required reviewer** (the person who cuts
  releases), so no tag pushed from an unreviewed commit is signed without their yes.
- A tag ruleset (Settings, Rules, Rulesets, *Tag*) for `v*` that only release managers may
  create, update or delete.
- Five repository variables (Settings, Secrets and variables, Actions, **Variables**; they are not
  secret): `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`,
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` — the same values tC4's repository uses.
- In Azure, on the app registration `AZURE_CLIENT_ID` names: a federated credential for GitHub
  Actions with organization and repository of **this** repository, entity type *Environment*,
  environment `windows-signing` (subject `repo:<owner>/<repo>:environment:windows-signing`).

A tag run, or a manual run with **sign** ticked on the default branch, then signs every `.exe`, `.dll` and
`.node` file of the app, the installer and its uninstaller; files Microsoft already signed keep
their signature. Any other run builds unsigned and its file names say `-unsigned`. Check a
signature in PowerShell:

```powershell
Get-AuthenticodeSignature .\translationCore4-4.1.0-preview2-windows-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
```

## Secrets

- `TC_HELP_DESK_TOKEN` and `TC_HELP_DESK_EMAIL` (repository secrets, the same as tC4's): the
  help-desk key the shell uses to send feedback (docs/contracts/SHELL.md item 11; H15). A build
  without them still works but cannot send feedback.

## Testing the pipeline from a branch

A push that changes `.github/workflows/release.yml` or `scripts/release/` runs every build and
smoke test on that branch, unsigned, and publishes nothing. Once the workflow is on the default
branch, it can also be run by hand from the Actions tab on any branch.

## The checks on every release

| Check | Job | What it proves |
|---|---|---|
| `translations` | translations | no interface string ships untranslated (H10) |
| `release_has_no_test_hooks` | build | the shipped `tc4` has no test flag, route or text |
| `tc4_exe_imports_no_vcruntime` | build (Windows) | `tc4.exe` needs no Visual C++ runtime (tC4 #284) |
| Electronite sha256 | build | the shell is the pinned Electronite v44.9.3-graphite |
| `fetch-pinned.mjs`, then `bundle_store` ends `, 0 skipped,` | common | every archive `bundle/en/fetched.lock` pins (the OBS pictures) is downloaded, matches the lock's size and sha256, and is installed in the bundle |
| `notices.mjs` | build | the notices name every crate in `Cargo.lock` and every bundled resource |
| the Windows installer is signed | publish | no release carries an `-unsigned` Windows installer |
| `seal-macos.test.mjs`, `seal-macos.sh` | build (macOS) | the staged bundle passes `codesign --verify --deep --strict` with its manifest inside, and the manifest is the record of its files (#969) |
| `package.sh` | build | only a stage whose manifest matches its files, and on macOS whose seal is valid, is packaged; a failed build job skips `smoke` and `publish` |
| `macos-preinstall.test.mjs` | build (macOS) | the pkg's scripts find a translationCore 4 under another name or in another folder and leave the tC4 4.0 beta and other apps; Replace removes the other copies only after the install, Cancel stops it and removes nothing, and with nobody to ask nothing elsewhere is removed; the pkg records the whole version. The person's answer is a stub: the dialog itself is checked by hand (#1016) |
| `the_installed_app_and_receipt_show_the_app_s_version` | smoke (macOS) | Finder's version and the pkg receipt are the app's version, not Electronite's (#1016) |
| `installing_over_leaves_one_translationcore_4`, `installing_over_keeps_app_data_and_projects` | smoke (Windows, macOS) | the newest published release is installed and started, then this build is installed over it with no uninstall: one app is there, and every file the older build wrote in app data, and a file put in the projects folder, is still there (#1016) |
| `installed_manifest_is_the_build_s` | smoke | the installed manifest is the build's |
| `installed_files_are_the_manifest_s` | smoke | every installed file has the size and sha256 the manifest records, and nothing else is there but Inno Setup's uninstaller |
| `installed_app_seal_is_valid` | smoke (macOS) | the installed bundle passes `codesign --verify --deep --strict` (#969) |
| `app_starts_and_starts_tc4` | smoke | the installed app starts with no arguments and brings up tc4 |
| `smoke.mjs` steps | smoke | address line, About's commit, resources offline, a project made, a verse saved and read back after a restart, one server per app-data folder |
| `uninstall_keeps_app_data`, `uninstall_keeps_the_projects_folder` | smoke | removing the app keeps the translator's work (tC4 #44) |
| `smoke.mjs --reopen` steps | smoke | after an uninstall and a reinstall over the kept folders (the previous release's installer once there is one), the project and its verse are there; a project a newer version wrote opens read-only or is refused, and is never written (#46) |

## Rolling back a bad release

When a release breaks something, translators go back to the version before it, and the owner
stops anyone else from taking the bad one. Going back never costs a translator their work.

### The translator: go back to the previous version

The previous release stays on the [GitHub Releases page](https://github.com/unfoldingWord/translationCore4/releases)
as `translationCore4-<version>-<platform>` files. Only release managers can change or delete a
release tag (the `v*` tag ruleset above), so it stays there.

1. Close translationCore.
2. Remove the app. Windows: Settings, Apps, **translationCore 4**, Uninstall. macOS: move
   **translationCore 4** from Applications to the Trash. Linux: delete the `translationCore 4`
   folder.
3. Install the previous version as a new one: Windows, run its `.exe`; macOS, open its `.pkg`
   (its README says how to open an unsigned one); Linux, unzip its `.zip` where the old folder
   was.

Removing the app removes only the app. Projects (`translationCore4/projects`) and app data stay
(table above). The smoke test does these three steps on each system and opens the project again.

### The owner: stop a bad release

- **Before publishing** (the release is still a draft): delete the draft, fix the problem on the
  default branch, and tag a patch version.
- **After publishing:** mark the release as a pre-release and start its notes with "Do not
  install this version", naming the version to use instead. Point the download page,
  https://translationcore.com/tc4, back to the previous version's files. Publish a patch that
  fixes the problem as soon as it is ready.
- **Translators who installed it already** follow the steps above, or wait for the patch.

The app does not check for new versions (below). The download page and the release notes are the
only ways to reach translators, so say there what happened and what to do.

### What the previous version does with work the newer one saved

A project records its format in `ingredients/tc/format.json`: a `major`, a `minor` and
`minReaderMinor`, the oldest minor that can still save to it (`docs/STORAGE.md` §12). Every
version reads these three numbers the same way, whatever else a later version changes in the
file. What the older version does:

| The newer version saved | Open | Sync with a teammate | Receive a file |
|---|---|---|---|
| A newer major | Refused: "This project was saved by a newer translationCore (project format N). Update translationCore, then open the project again. Nothing was changed." | Stops: "A teammate uses a newer translationCore (project format N). Update translationCore, then sync again. Nothing changed." | Refused: "This file was saved by a newer translationCore (project format N). Update translationCore, then receive the file again. Nothing was changed." |
| A newer minor the older version cannot save to (`minReaderMinor` above its minor) | Read-only: "This project needs a newer version of translationCore to save changes. You can read and export it." | Stops, with the sync words above | Refused, with the receive words above |
| A newer minor it can save to | Opens and saves. Changes of a kind it does not know are kept and counted, never dropped | Syncs | Received |

Changes and pending saves a newer version wrote are carried unread and listed as "Made by a newer
translationCore", never as damaged. In every case nothing is lost: the older version writes
nothing it cannot read, and updating again opens the project as it was.

This holds from 4.1 on. Projects from the 4.0 preview (`4.1.0-preview` and earlier builds) were
for testing only, and going back across them promises nothing.

## What the app does not do

The app does not check for new versions (tC4 #259). Translators get a new version from the
download page.
