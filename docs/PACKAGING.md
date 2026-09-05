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
[VERIFIED — `actions/upload-artifact` v7 `action.yml` `archive` input and
`src/upload/upload-artifact.ts:60-63`, read 2026-09-05; v7.0.0 release note].
Unpack it once. The execute bits of the launcher and the Electronite binaries
are the ones the build's own zip recorded, because nothing re-archives it.

History: the action's own archive normalizes every file it packs to mode 644
(its README, "Permission Loss"), so the build has always zipped the artifact
itself before upload. With the v4 action that zip was then wrapped in the
action's archive, and the download was a zip of the zip; testers unpacked
twice. `archive: false` removes the outer layer.

Pull request builds and merges to `main` produce the same file name; only the
retention differs (3 days and 30 days).

macOS witness of the single-layer download [VERIFIED — run 33981389105 (PR
#182), artifact 9973915962, `tC4-4.0.0-alpha.3-macos-arm64-unsigned.zip`,
142556909 bytes, sha256
`8600c6454e5291afd0f43440feb7db09e04c7378b1b23ce6a136dd43a9b44b72`; macOS
26.5.1 arm64, 2026-09-05]: the raw artifact download (`gh api
.../actions/artifacts/9973915962/zip`) is the zip itself (`file`: Zip archive
data, compression method=store). One `unzip` gave `translationCore4/` with
`start-tc4.command`, `bin/server.bin` and
`Electron.app/Contents/MacOS/Electron` all mode `-rwxr-xr-x`. With a fresh
`HOME`, `start-tc4.command` started the server on port 19119; `/` answered
`303` to `/clients/uw-tc4` and the client `200`; a second launch left one
server answering; `user_settings.json` resolved `repo_dir` to
`$HOME/pankosmia/tc4-projects`, empty. Note that `gh run download` extracts
the artifact archive, so with `archive: false` it yields the unpacked
`translationCore4/` folder directly, with the same modes.

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
   unpacked twice [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351, 2026-09-04, recorded on PR #146]; that layer is
   gone, see "What the pipeline does". The Debian witness below unpacked that
   two-layer download; the single layer is witnessed on macOS above and awaits
   its own Linux clean-machine witness.
3. Run `./translationCore4/start-tc4.sh`.

There is no installer and no desktop entry. #44 owns that work.

### The Chromium sandbox

Electron needs `chrome-sandbox` to be mode 4755 and owned by root. After
`unzip`, the file is not setuid [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351, 2026-09-04, recorded on PR #146]. The launcher therefore
tests the file:

- If the bit is set, the launcher starts Electronite with the sandbox.
- If the bit is not set, the launcher prints a note and starts Electronite
  with `--no-sandbox` [VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351, 2026-09-04, recorded on PR #146].

On the witness host the first launch opened the "translationCore 4" window with
an empty project list; the project store was `$HOME/pankosmia/tc4-projects`
with no `pankosmia_repos` directory; a second launch exited in about one second
and left the first instance serving (303 from `/`, 200 from `/clients/uw-tc4`)
[VERIFIED — clean-machine witness on Debian 13.6 x86_64, artifact 9854372667 from run 33649518351, 2026-09-04, recorded on PR #146].

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
