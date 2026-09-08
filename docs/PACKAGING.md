# Desktop packaging (#57, #119, #181)

This document records the build recipe for the unsigned desktop artifacts.
Issue #119 added Linux x64 beside the proven macOS arm64 path, and the
single-layer download. Issue #181 added Windows x64 (Increment 5). Issue #44
adds signing; it must not replace this recipe.

## What the pipeline does

`scripts/package-desktop.zsh` builds one unsigned artifact for the host it
runs on: macOS arm64, Linux x64, or Windows x64.
`.github/workflows/package-desktop.yml` runs the script on three runners
(`macos-15`, `ubuntu-24.04` and `windows-2025`) on every merge to `main` and on
pull requests that touch the packaging recipe (the two scripts, the workflow,
or `dev-env/server/`), and uploads each zip as a workflow artifact. A pull
request that changes only the app does not build the artifacts; the `ci` and
`rig` workflows prove it, and the merge to `main` packages it [decided
2026-09-08 — owner, after PR #226]. `workflow_dispatch` builds any branch on
demand.

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
| Project store | `$HOME/pankosmia/tc4-projects` — isolated store (#70) | `$HOME/pankosmia/tc4-projects-debug` — separate store |
| Seeds | the English suite, seeded by the launcher on first run (#163) | the English suite (#163) plus the conformance sample burrito, seeded by the launcher on first run |
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

## Windows x64 (#181)

The `windows-x64` job runs the same script on `windows-2025`, under MSYS2's
`zsh`. Only the host-specific steps differ. Nothing is signed; signing and an
installer are #44.

### Artifact layout

The zip holds one folder, `translationCore4\` (`translationCore4 DEBUG\` for
the debug variant). That folder holds:

| Item | What it is |
|---|---|
| `start-tc4.cmd` | the launcher — the only entry point (a batch file) |
| `electronite\` | the unpacked Electronite release (`electron.exe`, Chromium data) |
| `electron\` | the template startup files plus `tc4-main.js` (the #4 single-instance guard) |
| `bin\server.exe` | the pinned pankosmia-web server; the template's startup script spawns `bin\server.exe` on Windows |
| `lib\`, `resources\` | clients, app resources, templates, webfonts; the bundled English suite (#163) |
| `Rocket.toml`, `LICENSE`, `licenses\`, `THIRD-PARTY-NOTICES.md`, `BUILD-MANIFEST.json` | the same as macOS and Linux |
| `smoke-installed.zsh` | shipped for parity; it does not run on Windows yet (see "Known limits") |

### Install and launch

1. Download `tC4-<version>-windows-x64-unsigned.zip` from the workflow run.
2. Unpack it once. Explorer's `Extract All…`, `Expand-Archive` in PowerShell,
   or any archiver works: Windows has no permission bits to lose.
3. Run `translationCore4\start-tc4.cmd` (double-click, or from a terminal). A
   console window stays open while the app runs. Closing that window stops
   the app.
4. The build is unsigned. On the first launch Windows SmartScreen can show
   "Windows protected your PC". Click `More info`, then `Run anyway`. If the
   browser marked the download, Explorer keeps the mark on every extracted
   file, and the same dialog appears; `Unblock` in the zip's Properties before
   you extract it avoids that. [PROPOSED — to be witnessed on a clean machine;
   the witness record goes under "Known limits"]

The project store is `%USERPROFILE%\pankosmia\tc4-projects` (#70); the server's
working directory is `%USERPROFILE%\pankosmia\tc4`. The app never touches
`%USERPROFILE%\pankosmia_repos`. On the first run the launcher copies the
bundled English suite into the store (#163). A second launch exits by itself
and focuses the first window (#4).

### CI runner assumptions

- `windows-2025`, with MSYS2 preinstalled. `msys2/setup-msys2@v2`
  (`msystem: MSYS`, `path-type: inherit`) installs `zsh`, `zip`, `unzip` and
  `curl` and keeps the runner's `node`, `cargo` and `git` on the PATH. The
  script is one file for the three platforms; MSYS2 supplies the shell it needs.
- Node 22 from `actions/setup-node`; the Rust stable MSVC toolchain from
  `rustup`; `cmake` for `libgit2-sys`'s bundled libgit2. No OpenSSL: on
  Windows `git2` uses WinHTTP and `ureq` uses rustls [VERIFIED — pankosmia-web
  `99fd9be` `Cargo.toml`; the desktop-app-template at `4cb7576` builds the same
  server with a plain `cargo build --release` on `windows-2025`
  (`.github/workflows/windows-build-steps.yml`); read 2026-09-07].
- The smoke test opens a real window on the runner's desktop session; no
  `xvfb`.
- The server resolves its profile through the `home` crate, which reads
  `USERPROFILE` first [VERIFIED — pankosmia-web `99fd9be`
  `src/utils/paths.rs:139`, read 2026-09-07]. The smoke test sets `USERPROFILE`
  to a fresh directory for both launches, creates `AppData\Local` and
  `AppData\Roaming` in it, and points `APPDATA` and `LOCALAPPDATA` at them:
  Windows expands its shell folders from `%USERPROFILE%`, and Chromium stops
  with `EXCEPTION_BREAKPOINT` before its logging starts when those folders do
  not exist [VERIFIED — CI runs 34176032154 to 34178970511 on PR #226: every
  launch with the override and no `AppData` died; the same launch under the
  runner's real profile booted; 2026-09-08]. Electron's `userData`, and with it
  the #4 singleton lock, then live under the smoke home. The MSYS2 shell also
  exports `TMP=/tmp` and `TEMP=/tmp`; the launch gets a Windows-form temp
  directory.
- On a failure the job uploads `dist-desktop/smoke-*.log` as
  `tc4-desktop-windows-x64-smoke-logs`.

### Known limits

- **No post-install smoke job on Windows.** `smoke-installed.zsh` needs `zsh`,
  `lsof` and a POSIX launcher. On the Windows artifact it stops with one line
  that says so. The build-time smoke test in the `windows-x64` job covers the
  same guards (#4, #70, root 303, client 200).
- **Unsigned.** SmartScreen warns on every clean machine until #44.
- **A console window.** The launcher is a batch file. A launcher without a
  console is part of #44's installer work.
- **Witnessed on a real machine, one step open.** Windows 10 Pro 10.0.19045,
  no developer checkout, artifact 10056395396 (run 34227273789, head `8fbb62f`,
  188,346,325 bytes, sha256 `20582ef6…8d0cba`): unpacked once, launched,
  created a project, reached the tC4 dashboard with the bundled English suite
  and the Hebrew pane [VERIFIED — the owner, 2026-09-08; record and
  screenshot: `docs/evidence/desktop-windows-witness-2026-09-08.md`]. The
  first `main` artifact (10054337157) showed an error dialog at project
  creation; that was #228, fixed in PR #229 and absent from every later build.
  Still open on a real machine: the second-launch check (#4) and the
  SmartScreen step above; CI proves the first on every build.

### Evidence

First green `windows-x64` job [VERIFIED — run 34179734677 on PR #226 (head
`84aa25c`), `windows-2025`, 2026-09-08]: `electron.exe --version` v37.1.0;
self-spawned server on port 19119; `/` 303 to `/clients/uw-tc4` and the
client 200; the #4 guard ("second launch exited by itself; one server only");
the working directory under the smoke home; the #70 guard ("production store
holds only `_local_/_sideloaded_/` with seeded English suite on first boot");
artifact `tC4-4.0.0-alpha.4-windows-x64-unsigned.zip`, 188345159 bytes,
artifact id 10038663195. The server built with the MSVC toolchain in 7m14s
uncached (run 34174403634). The real-machine witness is
`docs/evidence/desktop-windows-witness-2026-09-08.md`.

## Smoke tests: build-time and post-install (#45)

Two smoke tests exist. They answer two different questions.

| | Build-time smoke test | Post-install smoke test |
|---|---|---|
| Where | `scripts/package-desktop.zsh`, step 6/7, on the staged folder, before the zip is written | `smoke-installed.zsh`, shipped in the artifact folder; the source is `scripts/smoke-installed.zsh` |
| Question | Can this artifact start on the build host? | Does the installed app work for a pilot? |
| What it proves | The launcher self-spawns the server; `/` answers 303 to `/clients/uw-tc4` and the client 200; a second launch exits by itself (#4); `repo_dir` is the isolated store and holds only the seeded English suite (#70, #163) | The same start and client checks on the INSTALLED folder; the store path (#70); bundled source text is readable offline (`source`, #163); a project created through the app's own HTTP surface with one book; one verse written and found on disk in the store; the app stopped and started again; the verse read back; the smoke project removed |
| Runs | In every build, in CI and by hand | On a fresh CI runner after every build (`smoke-macos-arm64`, `smoke-linux-x64` in `package-desktop.yml`), and by a person on a clean machine |
| Fails the build | Yes | The CI job fails; the tag rule (epic #59) needs the run to pass on each platform before a pre-release tags |

### Run the post-install smoke test

On the installed machine, from the unpacked folder:

```bash
zsh smoke-installed.zsh
```

The script needs `zsh`, `curl`, `lsof` and the folder. No `npm`, no checkout, no rig.
The JSON steps run under the artifact's own Electron in Node mode
(`ELECTRON_RUN_AS_NODE=1`), so the machine needs no `node`, `python` or `jq`.

Each step prints one line: `ok <step>: <what was seen>` or `FAIL <step>: <what was seen>`.
The script exits non-zero at the first failure. The last line of a good run is
`SMOKE OK: <folder> under HOME=<home>, store <repo_dir>`. Paste the whole output into the
pre-release notes.

Options:

- `TC4_SMOKE_HOME=<dir>`: the HOME the app runs under. CI passes a fresh directory. A pilot
  runs with the real HOME; the script then uses the real store and removes its smoke project
  at the end.
- `TC4_SMOKE_KEEP=1`: keep the smoke project (`_local_/_local_/smoke_<epoch>`).
- `TC4_SMOKE_LOGDIR=<dir>`: where the launcher's own output goes (`tc4-smoke-first.log`,
  `tc4-smoke-second.log`); default `$TMPDIR` or `/tmp`. CI uploads that directory with the
  transcript as the `smoke-installed-<platform>` artifact.
- A first argument names the folder when the script does not sit in it:
  `zsh scripts/smoke-installed.zsh /path/to/translationCore4`.

The smoke project is `smoke_<epoch>`, language `fr`, one book (Titus, `eng`
versification). The verse write goes through `POST /burrito/ingredient/raw/<repo>?ipath=TIT.usfm`,
the endpoint the client uses; it writes the raw ingredient and no journal segment, so the
project is a pre-journal project until the app opens it (universal seeding journals it then).

Records of runs live in `docs/evidence/` (one per close, machine, OS version, artifact id,
commit, date): see "Evidence" below.
## The offline run (#43)

tC4 is built for offline field use. This procedure proves one full session with the
network off, on the installed app, on a clean machine. Under the standing tag rule (epic #59), a pre-release from `v4.0.0-alpha.4` on tags only after this run passed once, or after
every step that failed names its open issue. One offline defect is known and open before
the first run: the fonts load from Google's CDN (#3). A run that reaches the end with only that named is a pass under the
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
3. Optional: start the app online once, create a project, open Home › `Source texts`.
   Note: an online start also lets Electron cache the fonts from Google's CDN, so after this
   step the font observation below no longer tests #3; skip this step when the run is about #3.
4. Turn the network off at the operating-system level, not in the app:
   - macOS: System Settings › Network, or the menu bar: turn Wi-Fi off and unplug Ethernet.
   - Linux: `nmcli networking off`, or `rfkill block all` plus unplug Ethernet. For a scripted
     run without touching the machine's network, start the app in its own network namespace
     with only the loopback interface, which `unshare` creates DOWN and the launcher does
     not bring up:
     `unshare -rn sh -c 'ip link set lo up && exec ./translationCore4/start-tc4.sh'`.
     Then every check below is made from inside that namespace, or by reading the app's
     screens; a browser or `ping` outside it is on the machine's normal network.
   - Windows: Settings › Network & internet › Airplane mode on, and unplug Ethernet.
   Check: a browser cannot open any web page; `ping 1.1.1.1` fails.

### Steps and expected results

| Step | Do | Expected |
|---|---|---|
| 1 | Start the app (`start-tc4.command` or `start-tc4.sh`). | The window opens on Home within 30 s. No error banner. |
| 2 | `+ New Bible`: name, language code, direction; `Create Bible →`. The `Add a book` dialog opens: `Start a blank book`, pick Titus, `Create book`. | Titus opens directly in `Translate` at chapter 1. |
| 3 | Mode tab `Understand`. | The passage's helps area shows for chapter 1 with English translation notes and translation questions. |
| 4 | Mode tab `Translate`. Chapter 1. | The chapter's verses show. The source pane shows ULT/UST text. |
| 5 | `Draft verse 1` (the dashed pill), type a verse, click outside the editor. | The save indicator shows `Saved`. |
| 6 | Mode tab `Check`. On the Translation Notes card, `Start checking` (or `Continue`). Pick one item; `✓ Mark valid`. | The item is decided; the progress line `N of M resolved` counts it. If the card reads `Unavailable offline`, read which resource it names: a lexicon (`en_ugl`, `en_uhl`; #218) is the known case; name it and go on. Any other missing resource is a new finding: file its issue. |
| 7 | On the tool picker (`← All checking tools` first, if a tool is open), `Align`. Click one word in the bank, then one card. | The word moves into the card; the bank has one word fewer. If the screen reads "The original-language text is not on this computer", that is a new finding: file its issue. A missing lexicon entry (`en_ugl`, `en_uhl`; #218) is the known case. |
| 8 | Leave the project (`Switch project`), then open Titus again from Home. Look at `Translate`; then at `Check` › Translation Notes and `Align` for each of steps 6 and 7 that you could do. | Home lists the project. The drafted verse is on screen. Each decision and alignment you made is still there: the progress line still counts the decision; the aligned word is still in its card. |
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
| Electronite | `v37.1.0-graphite`, zip sha256 verified — `a3dde44e…f59488` (darwin-arm64), `41218aa3…d8f8540` (linux-x64), `8146ca21…371b52` (win32-x64; matches the release asset digest, measured 2026-09-07) | `scripts/package-desktop.zsh` |
| desktop-app-template | `4cb7576` | `scripts/package-desktop.zsh` |
| resource-core | `54802be780af18ab02e426dd59014bc6adb158af` | `scripts/package-desktop.zsh` |
| webfonts-core | `eb52ccdad6806b5729ea8b45b1c59c793ffa32c3` | `scripts/package-desktop.zsh` |
| puppeteer-core / @puppeteer/browsers | `24.43.1` / `2.13.1`, exact; lockfile ships in the artifact (`electron/package-lock.json`) | `scripts/package-desktop.zsh` |
| en_ult | v89, sha `84c73ba00fc8a95a9033f9efb14bb905a2a52ee4` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| en_ust | v89, sha `37ec223166bbd73fb55abc7840be8310c0fee7f2` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| el-x-koine_ugnt | v0.34, sha `fc95b2b8aad08bb65ab54628ab685413a1139e97` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| hbo_uhb | v2.1.30, sha `106a441a788d9465846cd427538ea80b8cec6770` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| en_tn | v86, sha `c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| en_tw | v87, sha `eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| en_ta | v86, sha `c7caddfb474efd713f36b35a3ffc927866c7b180` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| en_tq | v89, sha `97c0a13e3b84d46d0e643ba2e8e9f1c295547a58` | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| uW/en_ugl (#218, D71) | no tag; sha `d9d29e2d589258ce27f92b59f753a3af03ab7a72`, fetched as the commit archive `archive/<sha>.zip` and verified against the zip's archive comment | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |
| uW/en_uhl (#218, D71) | no tag; sha `72df5ac25acf9d51e826b20e3ad883a5a657ef4e`, same fetch path | `src/data/installedSuite.js`, `scripts/package-desktop.zsh` |

Every artifact carries `BUILD-MANIFEST.json` at its root with the same data. A sha-only pin has `"version": null` there.

The eight `unfoldingWord` repos are fetched as the DCS sb-zip export `/sb/<tag>.zip`. The two lexicons come from the `uW` org on DCS (D71): those repos have no tag and no sb-zip export (`/sb/` answers 404), so the build fetches the Gitea commit archive `archive/<sha>.zip` and verifies the sha Gitea records in the zip's archive comment against the pin. Both paths run through the app's own fetch code (`src/data/resourceFetch.ts` `downloadPin`), called by `dev-env/scripts/cache-resource.zsh`.

## Bundled English suite (#163, #218)

Per D70, #163 and #218, the desktop artifact bundles the installed English suite (ten pinned repos: `en_ult`, `en_ust`, `el-x-koine_ugnt`, `hbo_uhb`, `en_tn`, `en_tw`, `en_ta`, `en_tq` from `unfoldingWord`; `en_ugl`, `en_uhl` from `uW`). The unpacker stages each resource at `<APPDIR>/resources/<owner lowercased>--<repo>/` (`unfoldingword--en_ult`, `uw--en_ugl`), and the launcher copies missing resources into the project store at `$HOME/pankosmia/tc4-projects/_local_/_sideloaded_/` before starting the application.

Artifact sizes before and after bundling the English suite:

| Platform | Before (#163, macOS alpha.3) | After (#163, alpha.4) | After the lexicons (#218) |
|---|---|---|---|
| macOS arm64 | 142556909 bytes | 173313348 bytes | pending the CI run of this change |
| Linux x64 | — | 180227460 bytes | pending |
| Windows x64 (#181) | — | 188345159 bytes (run 34179734677, PR #226) | pending |

Both "after" sizes are from the `package-desktop` CI run 34145714423 artifact listing (PR #217, 2026-09-07). A local macOS arm64 build of the same commit measured 174980433 bytes.

## Known limits (start of the pipeline, not the end)

- **Three platforms**: macOS arm64 (#57), Linux x64 (#119) and Windows x64
  (#181). macOS x64 and signing are #44.
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

Post-install smoke test on fresh runners, both platforms (#45):
`docs/evidence/smoke-installed-2026-09-06.md`.
