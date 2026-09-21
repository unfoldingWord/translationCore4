# Packaged resource binding: CI proof on all three platforms (issues #347, #348)

**Date recorded:** 2026-09-21. **Recorded by:** the project owner's session.
**Commit:** `552b73553045ed55cbb397a2d1d2774ab51327d2` (`main`, the merge of PR #354).
**CI run:** [35643034107](https://github.com/unfoldingWord/translationCore4/actions/runs/35643034107)
(`package-desktop`, push event). **Result:** every job passed.

## What this record proves

PLATFORM-NOTES #39 names two resource selectors in the server. PR #354 binds both to the
current package at startup. This run is the first execution of that fix on real artifacts,
on GitHub runners:

| Job | Runner | Artifact | Install path has spaces | Dev tools on PATH |
|---|---|---|---|---|
| `windows-x64` (build smoke) | windows-2025 | staged zip folder | no | yes |
| `smoke-windows-x64` (installed smoke, twice: install and reinstall) | windows-2025 | `tC4-4.0.0-alpha.7-windows-x64-unsigned.exe` at `C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke` | yes | no |
| `linux-x64`, `smoke-linux-x64` | ubuntu-24.04 | `tC4-4.0.0-alpha.7-linux-x64-unsigned.zip` | no | n/a |
| `macos-arm64` ×2, `smoke-macos-arm64` ×3 | macOS arm64 | pkg, zip, debug zip | debug: yes | n/a |

Each smoke does the following, in this order. The lines quoted below are from the Windows
installed smoke's transcript (artifact `smoke-installed-windows-x64`, file
`smoke-installed-windows.log`).

1. Copies the artifact's `lib/` to a "poison" tree, sets its `product.json` version to
   `4.0.0-poison-old` and converts its `01.md` story to CRLF, then launches the app with
   `APP_RESOURCES_DIR` pointing at that tree. The app must not use it.
2. Before any client write, creates a probe OBS project and compares all 50 served stories
   with the package's own template bytes:

   ```
   ok OBS template negative control: absent project rejected for content/01.md (...)
   ok OBS template probe: _local_/_local_/smoke_1790018310040probeobs served all 50 pre-seed bytes from the selected package resources
   ```

3. Seeds, checkpoints and edits a second OBS project over raw HTTP, and runs the bundled
   production `JournalingStore` over a third:

   ```
   ok OBS seed: _local_/_local_/smoke_1790018310040obs received all 50 title-normalized LF stories
   ok OBS checkpoint: _local_/_local_/smoke_1790018310040obs commit is clean; HTTP and disk bytes agree for all 50 stories
   ok OBS edit/checkpoint: story 1 changed and the other 49 stories remained byte-exact
   ok OBS real-client lifecycle: _local_/_local_/smoke_1790018310040clientobs seeded, listed on Home, edited, checkpointed, reopened, and journal-verified
   ```

4. Stops the app, rewrites the profile's `user_settings.json` so `app_resources_dir` points
   at the poison tree (the contaminated-profile case), and starts the app again. The saved
   selector must be rebound to the installed `lib\`, `/api/version` must match the package,
   and a fresh probe project must again serve the package's bytes:

   ```
   ok second start: installed app PID 4684, server PID 6712, port 19119
   ok resources: poisoned parent and saved profile rebound to C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke\lib\
   ok version: /api/version matches this package (4.0.0-alpha.7, 2026-09-21T19:13:06Z)
   ok OBS template probe: _local_/_local_/smoke_1790018310040probeobs served all 50 pre-seed bytes from the selected package resources
   ok OBS real-client lifecycle: _local_/_local_/smoke_1790018310040clientobs seeded, listed on Home, edited, checkpointed, reopened, and journal-verified
   ok OBS reopen: _local_/_local_/smoke_1790018310040obs retained the edited story after server restart
   SMOKE OK: C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke under USERPROFILE=D:\a\_temp\tC4 Pilot Profile; store D:\a\_temp\tC4 Pilot Profile\pankosmia\tc4-projects
   ```

The same sequence passed in the Linux and macOS jobs of the run. The build-time smokes
(`linux-x64`, `windows-x64`, `macos-arm64`) ran the same probes against the staged folder
before the zip was written.

The "committed bytes" leg is transitive: after each checkpoint the smoke asserts that the
server's `git/status` route reports no pending change, and separately that HTTP bytes equal
disk bytes. The installed smoke has no `git` on PATH, so it does not read `HEAD` directly.

## Retest on the affected machine: PASS

**Machine:** DESKTOP-SMQLQM3, Windows 11 10.0.26200, account `tc-win-test`. **Date:**
2026-09-21. **Run by:** the project owner. **Build:** the zip of run 35643034107, commit
`552b73553045ed55cbb397a2d1d2774ab51327d2`, `built_utc` `2026-09-21T19:13:06Z`, unzipped to
`C:\Users\tc-win-test\tc4-a8\app`. The poisoned process `APP_RESOURCES_DIR`
(`C:\Users\tc-win-test\tc4-a6\app\translationCore4\lib\`) stayed set for the whole run.
Transcript: [issue #347, comment of 2026-09-21](https://github.com/unfoldingWord/translationCore4/issues/347#issuecomment-5766881234).

| Step | Measured |
|---|---|
| Old selected template, alpha.6 tree `01.md` | 1225 bytes, 68 CR, 68 LF: the same bytes as the 2026-09-19 failing project. The mechanism is confirmed: the old template was copied, nothing converted it. |
| New build's template `01.md` | 1157 bytes, 0 CR, 68 LF |
| Negative control: 2026-09-19 unpack, fresh profile | `/api/version` 4.0.0-alpha.6, 2026-09-14T14:57:56Z; saved `app_resources_dir` = the alpha.6 path; new story 1225 bytes, 68 CR on disk and over HTTP |
| Run A: new build, fresh profile | `/api/version` 4.0.0-alpha.7, 2026-09-21T19:13:06Z; `app_resources_dir` = `C:\Users\tc-win-test\tc4-a8\app\lib\`; new story 1157 bytes, 0 CR on disk and over HTTP |
| Run B: new build, contaminated profile `home-obs-probe347` | `app_resources_dir` before launch = the alpha.6 path, after launch = `C:\Users\tc-win-test\tc4-a8\app\lib\`; version and story bytes as in Run A |

The harness needed two local PowerShell corrections before it ran (a path join after a
trailing `\`, and the `$home` variable renamed to avoid the automatic `$Home`). The product
under test was not changed.

## What this record does not prove

- **A profile written by a real older release under a user's own account.** Run B used the
  profile that alpha.7 wrote on 2026-09-19 under the poisoned variable, which has the same
  shape as one alpha.6 would write. An installer-upgraded user profile has not been exercised.

## Retest procedure for DESKTOP-SMQLQM3 (as run)

Run in the same PowerShell session that still carries the poisoned process variable. Do not
clear it: the point is that the fix wins over it.

1. Download `tC4-4.0.0-alpha.7-windows-x64-unsigned.zip` from run 35643034107 and unzip it to
   `C:\Users\tc-win-test\tc4-a8\app`. Record `BUILD-MANIFEST.json`: `commit` must be
   `552b73553045ed55cbb397a2d1d2774ab51327d2`, build date `2026-09-21T19:13:06Z`.
2. Print `$env:APP_RESOURCES_DIR`. Expected: the alpha.6 `lib\`. If it is empty, set it to
   `C:\Users\tc-win-test\tc4-a6\app\translationCore4\lib\` for the session, and say so in
   the transcript.
3. Measure the old selected template:
   `C:\Users\tc-win-test\tc4-a6\app\translationCore4\lib\templates\content_templates\text_stories\ingredients\content\01.md`
   (length, CR count, LF count). Compare with the 2026-09-19 failing project file
   (1225 bytes, 68 CR, 68 LF). This confirms or falsifies the selection mechanism.
4. Negative control: launch the OLD unpack (`C:\Users\tc-win-test\tc4-a7b\app`) under a fresh
   `USERPROFILE`. Expected, as on 2026-09-19: `/api/version` says alpha.6 with date
   `2026-09-14T14:57:56Z`, and a new OBS project's `01.md` has CR bytes. Stop it.
5. Run A, fresh profile: launch the NEW unpack under a fresh `USERPROFILE`
   (`C:\Users\tc-win-test\tc4-a8\home-a`). Record `/api/version` (expected alpha.7,
   `2026-09-21T19:13:06Z`), `pankosmia\tc4\user_settings.json` → `app_resources_dir`
   (expected `C:\Users\tc-win-test\tc4-a8\app\lib\`), then `POST /api/git/new-obs-resource`
   and measure the project's `01.md` on disk and over `GET /api/burrito/ingredient/raw/...`
   (expected 1157 bytes, 0 CR, 68 LF for both). Stop it.
6. Run B, contaminated profile: reuse `C:\Users\tc-win-test\tc4-a7b\home-obs-probe347` from
   2026-09-19 as `USERPROFILE`. Print its `app_resources_dir` before launch (expected: the
   alpha.6 path). Launch the NEW unpack. Print `app_resources_dir` after the server answers
   (expected: rebound to `C:\Users\tc-win-test\tc4-a8\app\lib\`), `/api/version`, then create
   a new OBS project and measure `01.md` as in step 5. Stop it.
7. Paste the transcript into issue #347 and add one line to PLATFORM-NOTES #39 with the
   result, machine, build and date.

Steps 4 to 6 use the launch and measurement commands of the owner's 2026-09-19 transcript
(issue #347, comment of 2026-09-19).
