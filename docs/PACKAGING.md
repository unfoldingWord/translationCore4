# Desktop packaging (#57, #119)

This document records the build recipe for the unsigned desktop artifacts.
Issue #119 added Linux x64 beside the proven macOS arm64 path, and the
single-layer download. Issue #181 adds Windows x64 (Increment 6); issue #44
adds signing. Neither must replace this recipe.

## What the pipeline does

`scripts/package-desktop.zsh` builds one unsigned artifact for the host it
runs on: macOS arm64, or Linux x64.
`.github/workflows/package-desktop.yml` runs the script on two runners
(`macos-15` and `ubuntu-24.04`) on every merge to `main` and on pull requests
that touch packaging inputs, and uploads each zip as a workflow artifact.

The upload is a single layer. The workflow uses `actions/upload-artifact@v7`
with `archive: false`, which uploads the zip as one file. The action then
ignores `name`: the artifact is named after the file,
`tC4-<version>-<os>-<arch>-unsigned.zip`, and the download is that file
[VERIFIED — `actions/upload-artifact` v7.0.1 (tag `v7` = `043fb46d`, 2026-04-10):
`action.yml` `archive` input; `src/upload/upload-artifact.ts:60-63` (the single-file
check) and `:81-82` (`skipArchive`); the v7.0.0 release note; read 2026-09-05].
Unpack it once. The execute bits of the launcher and the Electronite binaries
are the ones the build's own zip recorded, because nothing re-archives it.

History: the action's own archive normalizes every file it packs to mode 644
(its README, "Permission Loss"), so the build zips the artifact itself before
upload (`scripts/package-desktop.zsh:515-524` at `main` a513f1c). With the v4
action that zip was then wrapped in the action's archive, and the download was
a zip of the zip; testers unpacked twice. `archive: false` removes the outer
layer. [VERIFIED — README "Permission Loss" at `043fb46d`; the two-layer
download witnessed on Debian, run 33649518351 (head `fb888537`, PR #146), see
the tag in "Install and launch"; read 2026-09-05]

Pull request builds and merges to `main` produce the same file name; only the
retention differs (3 days and 30 days).

macOS witness of the single-layer download [VERIFIED — run 33981389105 (PR
#182, head `7f22ab7`; the build checked out the merge commit `e738c69`, per
`BUILD-MANIFEST.json`), artifact 9973915962,
`tC4-4.0.0-alpha.3-macos-arm64-unsigned.zip`, 142556909 bytes, sha256
`8600c6454e5291afd0f43440feb7db09e04c7378b1b23ce6a136dd43a9b44b72`; macOS
26.5.1 arm64, gh 2.86.0, 2026-09-05]: the raw artifact download (`gh api
repos/unfoldingWord/translationCore4/actions/artifacts/9973915962/zip`) is the
zip itself (`file`: Zip archive data, compression method=store). One `unzip`
gave `translationCore4/` with `start-tc4.command`, `bin/server.bin` and
`Electron.app/Contents/MacOS/Electron` all mode `-rwxr-xr-x`. With a fresh
`HOME`, `start-tc4.command` started the server on port 19119; `/` answered
`303` to `/clients/uw-tc4` and the client `200`; a second launch left one
server answering; `user_settings.json` resolved `repo_dir` to
`$HOME/pankosmia/tc4-projects`, empty. Measured in the same session: `gh run
download -n <file name>` (gh 2.86.0) extracts the artifact archive, so it
yields the unpacked `translationCore4/` folder directly, with the same three
files at mode `-rwxr-xr-x`.

Two build variants exist (`--debug` selects the second):

| | production (default) | debug (`--debug`) |
|---|---|---|
| Project store | `$HOME/pankosmia/tc4-projects` — starts EMPTY | `$HOME/pankosmia/tc4-projects-debug` — separate store |
| Seeds | none | the conformance sample burrito, seeded by the launcher on first run |
| Marking | none | app name `translationCore4 DEBUG`; version suffix `-debug`; artifact name suffix `-debug` |

## Project-store isolation (#70)

Owner ruling (2026-08-14, issue
[#70](https://github.com/unfoldingWord/translationCore4/issues/70), queued as
D49): the packaged app always uses a product-isolated project store, and MUST
NOT read or write the platform default `$HOME/pankosmia_repos` (shared with
every other Pankosmia desktop app).

- **Mechanism:** the build patches the shipped
  `lib/templates/user_settings.json` so `repo_dir` is
  `%%HOMEDIR%%/pankosmia/tc4-projects` (debug: `…/tc4-projects-debug`). The
  server substitutes `%%HOMEDIR%%` at first boot. The store sits BESIDE the
  server working dir (`$HOME/pankosmia/tc4`), never inside it — pre-creating
  anything inside the working dir before first boot makes the server skip
  first-boot initialization and panic on the missing `app_state.json`
  (measured while building this). The patch refuses to run if the upstream
  template's `repo_dir` shape changed (re-verify before building).
- **Guard, not convention:** the smoke test reads the BOOTED app's resolved
  `user_settings.json` and FAILS the build when `repo_dir` contains
  `pankosmia_repos` or differs from the expected isolated path — both
  variants. It also fails a production build whose store is not empty at
  first boot, and a debug build whose seed is missing.
- **Guard self-test:** `TC4_TEST_FORCE_SHARED_STORE=1` (test-only) skips the
  isolation patch so the guard's failure path can be exercised; a build with
  it set MUST fail.
- Side effect worth recording: no sibling Pankosmia app can write tC4's
  projects, which strengthens the D39 single-instance safety argument.
- Migration of existing shared-store projects is explicit import work
  (#21's family), never an automatic read.

## Single instance (#4, D39)

D39 rules that same-machine save safety may assume ONE running copy of tC4,
and that enforcement is a packaging/shell responsibility. Facts, measured
2026-08-25:

- The desktop-app-template launcher has NO single-instance lock. A second
  launch is worse than a duplicate window: the launcher's free-port scan
  moves to the next port and spawns a SECOND server over the SAME project
  store — the exact overlap D39 rules out.
- tC3's launcher (`electronite/index.js`) calls
  `app.requestSingleInstanceLock()` but never checks the result and never
  quits the second copy; in practice macOS enforces single-instance for
  `.app` bundles at the Finder level. Our artifact launches through
  `start-tc4.command`, which Finder runs as many times as it is clicked —
  so an explicit guard is load-bearing here.
- **Mechanism:** the build writes a tC4-owned `electron/tc4-main.js` that
  acquires Electron's singleton lock BEFORE the template startup loads. A
  refused second launch exits with no window and no server; the first
  window is restored and focused. `electron/package.json` `main` is patched
  to the wrapper, and the patch refuses to run if the template's entry
  point changed shape (the #70 patch discipline).
- **Guard, not convention:** the smoke test launches the entry point a
  SECOND time while the first instance runs, and FAILS the build unless the
  second process exits by itself, no second tc4 server appears on any scan
  port, and the first server still answers.
- **Scope, stated plainly:** the guard covers the packaged desktop app —
  D39's scope, the same layer tC3 used. A browser tab pointed manually at
  the local server port, or the dev rig, is outside it; the server binds
  127.0.0.1 and the port is not user-visible in normal use.

The recipe follows the Pankosmia
[desktop-app-template](https://github.com/pankosmia/desktop-app-template)
(MIT). The template is a read-only reference. Do not open issues or pull
requests there.

Steps, in order:

1. Build the tC4 client (`npm run build` → `dist/`).
2. Build the pinned server (`dev-env/server`, pankosmia-web 0.18.5, rev
   `99fd9be` — D27).
3. Clone read-only inputs: the desktop template (pinned rev), `resource-core`,
   and `webfonts-core`.
4. Assemble the app directory. The layout comes from the template:
   - `electron/` — the template's Electron startup files, with
     `puppeteer-core` and `@puppeteer/browsers` installed (the startup script
     imports them).
   - `bin/server.bin` — the pinned server binary.
   - `lib/` — `app_resources` (from `resource-core/runtime_resources`),
     `templates`, `webfonts`, `clients/uw-tc4` (the client build plus the
     three `rig/` registration files), `setup/`, and `product/product.json`
     with `"homepage": "uw-tc4"` (PLATFORM-NOTES #25).
   - `Rocket.toml` — upload limits (PLATFORM-NOTES #26a).
5. Stage the artifact: Electronite + app dir + license files +
   `THIRD-PARTY-NOTICES.md` + `BUILD-MANIFEST.json` (every input with its
   exact version, commit, and checksum — also echoed in the build log).
6. Smoke test **through the shipped entry point**: run the shipped launcher
   (`start-tc4.command` on macOS, `start-tc4.sh` on Linux)
   with a fresh `HOME` and no app-specific environment overrides. The app
   must self-spawn its bundled server (first free port from 19119) and serve
   `303` from `/` to `/clients/uw-tc4`, then `200` from the client page. The
   working directory must appear under the fresh `$HOME/pankosmia/tc4`, and
   the #70 store guard must pass (see "Project-store isolation").
7. Zip.

## The wrapper is Electronite [VERIFIED — desktop-app-template 4cb7576, 2026-08-14]

The desktop template does not use plain Electron. Its install scripts download
prebuilt **Electronite v37.1.0-graphite** binaries from
`github.com/unfoldingWord/electronite` releases, for all three OSes and both
architectures. This satisfies D20 (Graphite-enabled wrapper). Evidence:
`macos/install/makeAllInstallsElectronite.sh` lines 56–57 in the template.

Graphite font shaping in the packaged app is not proven yet. That proof is the
second acceptance item of #32.

## Linux x64 (#119)

The `linux-x64` job runs the same script on `ubuntu-24.04`. Only the
host-specific steps differ.

### Artifact layout

The zip holds one folder, `translationCore4/` (`translationCore4 DEBUG/` for
the debug variant). That folder holds:

| Item | What it is |
|---|---|
| `start-tc4.sh` | the launcher — the only entry point |
| `electronite/` | the unpacked Electronite release (`electron` binary, `chrome-sandbox`, Chromium data) |
| `electron/` | the template startup files plus `tc4-main.js` (the #4 single-instance guard) |
| `bin/server.bin` | the pinned pankosmia-web server |
| `lib/` | clients, app resources, templates, webfonts |
| `Rocket.toml`, `LICENSE`, `licenses/`, `THIRD-PARTY-NOTICES.md`, `BUILD-MANIFEST.json` | the same as macOS |

The macOS artifact keeps `Electron.app` at this level. The Linux release is a
flat directory, not an app bundle, so the build stages it as `electronite/`.
That name prevents a collision with the template's `electron/` startup
directory.

### Install and launch

1. Download `tC4-<version>-linux-x64-unsigned.zip` from the workflow run. Pull
   request builds and merges to `main` use the same file name; only the
   retention differs (3 days and 30 days).
2. Unpack once, with `unzip`. Do not use an archiver that drops permission
   bits. Before 2026-09-05 the download was a zip of this zip and had to be
   unpacked twice [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351 (head `fb888537`), 2026-09-04, recorded on PR #146]; that layer is
   gone, see "What the pipeline does". The Debian witness below unpacked that
   two-layer download; the single layer is witnessed on macOS above and awaits
   its own Linux clean-machine witness.
3. Run `./translationCore4/start-tc4.sh`.

There is no installer and no desktop entry. #44 owns that work.

### The Chromium sandbox

Electron needs `chrome-sandbox` to be mode 4755 and owned by root. After
`unzip`, the file is not setuid [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351 (head `fb888537`), 2026-09-04, recorded on PR #146]. The launcher therefore
tests the file:

- If the bit is set, the launcher starts Electronite with the sandbox.
- If the bit is not set, the launcher prints a note and starts Electronite
  with `--no-sandbox` [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351 (head `fb888537`), 2026-09-04, recorded on PR #146].

On the witness host the first launch opened the "translationCore 4" window with
an empty project list; the project store was `$HOME/pankosmia/tc4-projects`
with no `pankosmia_repos` directory; a second launch exited in about one second
and left the first instance serving (303 from `/`, 200 from `/clients/uw-tc4`)
[VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351 (head `fb888537`), 2026-09-04, recorded on PR #146].

To enable the sandbox:

```
sudo chown root:root ./translationCore4/electronite/chrome-sandbox
sudo chmod 4755 ./translationCore4/electronite/chrome-sandbox
```

### CI runner assumptions

The job installs these packages before the build [VERIFIED — the `linux-x64` job of run 33649518351 on PR #146, 2026-09-04]:

- `zsh` and `zip` — the script's shell and its archiver.
- `pkg-config`, `libssl-dev`, `zlib1g-dev` — `openssl-sys` and `libgit2-sys`
  link the system libraries. `dev-env/server` enables no vendored feature.
- Electron's shared libraries (the GTK, NSS, ALSA, and X11 sets).
- `xvfb` — the smoke test opens a real window. The job runs the script under
  `xvfb-run -a`.

On a failure the job uploads `dist-desktop/smoke-*.log` as
`tc4-desktop-linux-x64-smoke-logs`.

## The offline run (#43)

tC4 is built for offline field use. This procedure proves one full session with the
network off, on the installed app, on a clean machine. Under the standing tag rule (epic
#59), a pre-release from `v4.0.0-alpha.4` on tags only after this run passed once, or after
every step that failed names its open issue. Two offline defects are known and open before
the first run: the artifact ships no English scripture (#163), and the fonts load from
Google's CDN (#3). A run that reaches the end with only those two named is a pass under the
rule.

The run is done by a person and recorded. The Playwright check below catches regressions
between runs; it does not replace the run.

### Before you start

1. Install the artifact on a machine that never ran tC4 (or under a fresh `HOME`): download
   the zip for the platform, unpack it once with `unzip`. Linux: "Install and launch" above.
   macOS: the first launch of the unsigned app meets Gatekeeper; allow it through System
   Settings › Privacy & Security › "Open Anyway" ("Known limits" below). Do not start the
   app before step 4 unless step 3 says so.
2. If the unpacked folder contains `smoke-installed.zsh` (#45; artifacts built after pull
   request #192 merged carry it, and the section "Smoke tests" describes it), run it once,
   online: `zsh smoke-installed.zsh`. Expected: `SMOKE OK`. An older artifact has no such
   file; skip this step and say so in the record.
3. Optional, for a project with source text: start the app online once, create a project,
   open Home › `Source texts`, and download the English package. Then quit the app. Without
   this step, the source pane shows "This source text is not on this computer." offline
   (#163): expected until #163 lands. Note: an online start also lets Electron cache the
   fonts from Google's CDN, so after this step the font observation below no longer tests
   #3; skip this step when the run is about #3.
4. Turn the network off at the operating-system level, not in the app:
   - macOS: System Settings › Network, or the menu bar: turn Wi-Fi off and unplug Ethernet.
   - Linux: `nmcli networking off`, or `rfkill block all` plus unplug Ethernet. For a scripted
     run without touching the machine's network, start the app in its own network namespace
     with only the loopback interface, which `unshare` creates DOWN and the launcher does
     not bring up:
     `unshare -rn sh -c 'ip link set lo up && exec ./translationCore4/start-tc4.sh'`.
     Then every check below is made from inside that namespace, or by reading the app's
     screens; a browser or `ping` outside it is on the machine's normal network.
   - Windows: not covered until #181.
   Check: a browser cannot open any web page; `ping 1.1.1.1` fails.

### Steps and expected results

| Step | Do | Expected |
|---|---|---|
| 1 | Start the app (`start-tc4.command` or `start-tc4.sh`). | The window opens on Home within 30 s. No error banner. |
| 2 | `+ New Bible`: name, language code, direction; `Create Bible →`. The `Add a book` dialog opens: `Start a blank book`, pick Titus, `Create book`. | Titus opens directly in `Translate` at chapter 1. |
| 3 | Mode tab `Understand`. | The passage's helps area shows for chapter 1. With no English package on this computer, the source text reads "This source text is not on this computer." and the helps read "The pinned resource is not on this computer and the app is offline." (#163). |
| 4 | Mode tab `Translate`. Chapter 1. | The chapter's verses show. The source pane shows ULT/UST text, or the #163 message "This source text is not on this computer." |
| 5 | `Draft verse 1` (the dashed pill), type a verse, click outside the editor. | The save indicator shows `Saved`. |
| 6 | Mode tab `Check`. On the Translation Notes card, `Start checking` (or `Continue`). Pick one item; `✓ Mark valid`. | The item is decided; the progress line `N of M resolved` counts it. If the card reads `Unavailable offline`, read which resource it names: a resource of the English package that the artifact does not ship (`en_tn`, `en_tw`, `en_ta`, `en_tq`, `en_ult`, `en_ust`, `el-x-koine_ugnt`, `hbo_uhb`; #163) is the known case; name it, stay on the tool picker, and go to step 7. Any other missing resource is a new finding: file its issue. |
| 7 | On the tool picker (`← All checking tools` first, if a tool is open), `Align`. Click one word in the bank, then one card. | The word moves into the card; the bank has one word fewer. If the screen reads "The original-language text is not on this computer", that is the Greek text of the English package (#163) on a clean install; with the package downloaded in step 3, it is a new finding: file its issue. |
| 8 | Leave the project (`Switch project`), then open Titus again from Home. Look at `Translate`; then at `Check` › Translation Notes and `Align` for each of steps 6 and 7 that you could do. | Home lists the project. The drafted verse is on screen. Each decision and alignment you made is still there: the progress line still counts the decision; the aligned word is still in its card. A step you could not do (#163) has nothing to check here. |
| 9 | Export the book. | Not yet possible: #19 (export) is not built. Skip and name #19. |
| 10 | Quit the app. Turn the network on again. | |

Look at the screen fonts during the run. With the network off, the interface uses system
fonts instead of Mulish, Charis SIL, Noto Serif and Amiri (#3). Right-to-left projects are
hit hardest. Name #3 in the record; do not stop.

### Record the run

Write `docs/evidence/offline-run-<date>.md` per `docs/evidence/README.md`: machine, OS
version, how the network was turned off and how you checked it, artifact id and sha256,
commit, date; then one line per step with what the screen showed. Every step that failed
names its issue; a network dependency without an issue gets one (the request's host or URL,
and the screen it broke). Paste the step lines into the pre-release notes.

### The regression check between runs

`e2e/j02-draft-verse.spec.ts` carries the test "a drafting session talks to no host but the
local server (FR-31, #43)". It records every request and every WebSocket the client opens
while a project is opened and a verse is drafted, waits out the save's follow-up writes,
checks that no service worker is registered (a worker's requests would not be seen), and
fails when a host outside the local server appears that is not on the known-defect list. That list is `fonts.googleapis.com` and `fonts.gstatic.com`
(#3); it shrinks to nothing in the pull request that closes #3. The check runs on the dev
client against the rig, not on the packaged app; the packaged app's offline behavior is this
procedure's subject.

## Pins

| Input | Pin | Where |
|---|---|---|
| pankosmia-web | 0.18.5, rev `99fd9be` | `dev-env/server/Cargo.toml` |
| Electronite | `v37.1.0-graphite`, zip sha256 verified — `a3dde44e…f59488` (darwin-arm64), `41218aa3…d8f8540` (linux-x64) | `scripts/package-desktop.zsh` |
| desktop-app-template | `4cb7576` | `scripts/package-desktop.zsh` |
| resource-core | `54802be780af18ab02e426dd59014bc6adb158af` | `scripts/package-desktop.zsh` |
| webfonts-core | `eb52ccdad6806b5729ea8b45b1c59c793ffa32c3` | `scripts/package-desktop.zsh` |
| puppeteer-core / @puppeteer/browsers | `24.43.1` / `2.13.1`, exact; lockfile ships in the artifact (`electron/package-lock.json`) | `scripts/package-desktop.zsh` |

Every artifact carries `BUILD-MANIFEST.json` at its root with the same data.

## Known limits (start of the pipeline, not the end)

- **Two platforms**: macOS arm64 (#57) and Linux x64 (#119). Windows x64 is
  #181 (Increment 6); macOS x64 and signing are #44.
- **Linux is unsigned and un-installed**: the artifact is a plain zip with no
  installer, no desktop entry, and no signature. Most desktops refuse to run
  it from the file manager, so the user must run `start-tc4.sh` from a
  terminal. The launcher also drops the Chromium sandbox when
  `chrome-sandbox` is not setuid root — see "The Chromium sandbox" above.
- **Minimal client set**: the artifact bundles only `uw-tc4`. The core
  Pankosmia clients (dashboard, content, workspace, content handlers) are not
  bundled. Reason: the template builds them from source at branch tiers
  (`main` tier pins pankosmia_web 0.16.20; `dev` tier 0.18.7), and no tier is
  proven compatible with our 0.18.5 rev pin. The server panics at boot on a
  `minServerVersion`/`maxServerVersion` mismatch (`bootstrap.rs` version
  check). Picking and proving a client set is issue
  [#71](https://github.com/unfoldingWord/translationCore4/issues/71).
- **Unsigned**: macOS Gatekeeper blocks the app on a clean machine.
  Signing and notarization are #44. Two facts, measured 2026-08-25:
  - The upstream Electronite v37.1.0-graphite release ships an app bundle
    whose signature FAILS verification (`codesign --verify` on the pristine
    zip: "code has no resources but signature indicates they must be
    present"). A quarantined download of such a bundle gets Gatekeeper's
    "damaged — move to Trash" verdict, and macOS offers NO "Open Anyway" for
    that verdict. The build therefore RE-SEALS `Electron.app` with a forced
    ad-hoc signature (`codesign --force --deep --sign -`) and fails if the
    result does not verify. The witnessed "damaged" dialog came from the
    2026-08-25 CI artifact on macOS 15 (owner's machine).
  - With the valid ad-hoc seal, Gatekeeper still blocks the first launch
    (unidentified developer), but the ordinary escape works: System
    Settings → Privacy & Security → "Open Anyway". Pilot install
    instructions MUST include that step until #44 ships signing.
    On macOS 15, right-click → Open no longer bypasses Gatekeeper for
    unsigned apps; `xattr -dr com.apple.quarantine` remains the terminal
    workaround.
- **Archive structure diverges from the template**: the spike ships a plain
  folder (`Electron.app` or `electronite/`, plus `electron/` + `bin/` +
  `lib/` + a `start-tc4` launcher). The template instead builds a single
  self-contained `<App>.app` bundle and wraps it in a `.pkg` installer
  (`macos/install/makeInstallElectronite.sh`: payload `APP_NAME.app`, a
  `Contents/MacOS` launcher script, `pkgbuild`). The divergence is deliberate
  for the spike — it keeps the recipe inspectable and avoids the installer
  toolchain before signing exists. #44 MUST converge on the template's
  app-bundle + installer structure.
- **Shared project store — RESOLVED by #70** (history: the earlier "demo
  seed data" claim was wrong, see the evidence record; the platform default
  `repo_dir` is the shared `$HOME/pankosmia_repos`). The build now pins an
  isolated store and the smoke test guards it — see "Project-store
  isolation (#70)" above.

## Evidence

Witnessed boots (rig and packaged artifact, with screenshots):
`docs/evidence/desktop-packaging-spike-2026-08-14.md`.
