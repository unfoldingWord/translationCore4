# dev-env — the local Pankosmia server rig

The tC4 client runs against a Pankosmia server. This directory builds a scripted,
isolated `pankosmia-web` server for development and for the rig-backed test suites.
Tests that need it are labelled `needs-rig` and skip without it.

The server is pinned by git rev to **pankosmia-web 0.18.5
(`99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a`)**. A rev pin, not crates.io, because
crates.io stops at 0.18.4, published without the role/relationships modeling
(verified via `.cargo_vcs_info.json` in the published crate, 2026-07-30). Return to a
crates.io `=` pin when 0.18.5+ publishes (see `docs/RISKS.md` #1).

## Prerequisites

- Rust (stable) with `cargo`.
- Node 22, `git`, `zip`, `unzip`.
- One of two sources for `app-resources/`:
  - none: `scripts/setup-from-pins.zsh` fetches the pinned upstream inputs (read-only
    clones) and registers only the tC4 client. This is what CI uses.
  - an assembled Pankosmia desktop-app build: set `PANKOSMIA_ASSEMBLED_LIB` to that
    build's `lib` directory (the one that holds `app_resources`, `templates`,
    `webfonts`, `clients`, `setup`) and use `scripts/setup.zsh`. This route carries
    the core clients too.

## Scripts

- `scripts/setup-from-pins.zsh` — run once, after `npm run build`. Clones
  `resource-core`, `webfonts-core` and `desktop-app-template` at the commits
  `scripts/package-desktop.zsh` pins (the script fails if the two files drift),
  assembles `app-resources/`, registers `dist/` as `/clients/uw-tc4`, patches
  isolation, writes `product/product.json`, and builds the server shim.
- `scripts/setup.zsh` — run once. Assembles `app-resources/` from
  `$PANKOSMIA_ASSEMBLED_LIB`, patches isolation (`repo_dir` → the rig working
  directory, never `$HOME`), writes `product/product.json` (0.17.0+ requires it;
  since 0.18.0 the server panics unless a client is registered at
  `/clients/<homepage>`), and builds the server shim (`server/`).
- `scripts/seed.zsh` — reset the environment to pristine. Recreates `state/work`
  from templates; no first-boot variance.
  Seeds two local projects: `sample_burrito` (the conformance sample) and
  `sample_burrito_large` (issue #95: Titus with 4000 saved edits, one journal segment
  each, built by `scripts/seed-large-project.mjs` from the reference modules; the
  slow-open journey J15 opens it and watches the progress indicator).
- `scripts/run.zsh` — start the server at `127.0.0.1:19998` (override:
  `TC4_RIG_PORT`).
- `scripts/stop.zsh` — stop the server.
- `scripts/cache-resource.zsh` — cache a Door43 resource locally for offline work,
  through the app's own fetch path. `seed.zsh` sideloads each resource on its own
  fixed list whose cache entry exists (see the loop in `seed.zsh`). The rig-gated
  HttpStore suite reads `en_ult`, so a rig that runs `npm run prove` needs at least:
  `zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ult v89 <sha from src/data/installedSuite.js>`.

## Windows

### Install MSYS2

Install MSYS2 from the [official installer](https://www.msys2.org/docs/installer/).
The default installation directory is `C:\msys64`. After installation, open
**MSYS2 MSYS** from the Windows Start menu. This is the MSYS2 shell; Git Bash,
PowerShell, WSL, and cmd do not provide `pacman`.

Update the MSYS2 installation:

```bash
pacman -Syu
```

If MSYS2 asks you to close the window, close it, open **MSYS2 MSYS** again, and run
the update command a second time. Then install the shell tools used by the rig:

```bash
pacman -S zsh zip unzip curl
```

`zsh` is a cross-platform shell. It runs in MSYS2 on Windows; it is not limited to
Linux. The first time you start zsh, it may show the `zsh-newuser-install` menu. Type
`0` and press Enter to create a blank `.zshrc` with the default settings.

### Start MSYS2 with the Windows tools

The rig needs Node 22, Git, and Rust stable with the MSVC toolchain. The required
Rust target is `stable-x86_64-pc-windows-msvc`. Close the MSYS2 window and start the
inherited-path shell from PowerShell:

```powershell
$env:MSYS2_PATH_TYPE = "inherit"
& "C:\msys64\msys2_shell.cmd" -defterm -here -no-start -msys -use-full-path -shell zsh
```

The command uses PowerShell syntax. Inside MSYS2 Bash or zsh, the equivalent syntax
is `export MSYS2_PATH_TYPE=inherit`. Do not type `export` at a `PS C:\...>` prompt.

Verify the tools from the new MSYS2 zsh window:

```bash
uname -s             # must start with MSYS_NT
zsh --version
node --version       # Node 22.x
npm --version
cargo --version
git --version
rustup show active-toolchain  # stable-x86_64-pc-windows-msvc
```

If `pacman` is not found, the window is not MSYS2. If `npm` or `node` is not found,
close the window and relaunch it with `-use-full-path`. From PowerShell,
`where.exe node` and `where.exe npm` show where the Windows installations are.
If the active Rust toolchain is not `stable-x86_64-pc-windows-msvc`, install the
MSVC toolchain with `rustup toolchain install stable-x86_64-pc-windows-msvc` and
select it before building.

You may run `npm run dev` from Git Bash, PowerShell, or MSYS2 when Node and npm are
available there. Run the rig scripts themselves from MSYS2 zsh.

Run `git config core.autocrlf false` before cloning this repository. If you already
cloned it with another setting, clone it again after this repository's line-ending rules
are present.

The full clean-clone sequence is:

```bash
git config --global core.autocrlf false
git clone https://github.com/unfoldingWord/translationCore4.git
cd translationCore4
npm ci
npm run build
zsh dev-env/scripts/setup-from-pins.zsh
zsh dev-env/scripts/seed.zsh
zsh dev-env/scripts/run.zsh &
/c/Windows/System32/curl.exe -s localhost:19998/api/version
npm run dev
zsh dev-env/scripts/stop.zsh
```

The version response must include `pkg_version` `0.18.5`. With the client running,
open `http://localhost:5199/` and use `+ New Bible` to create a project.

If `zsh` is not found, install MSYS2 and open its MSYS shell. Do not run these rig
scripts from PowerShell or cmd.

### Troubleshooting the local servers

Start the rig before the client. In the MSYS2 zsh window, run:

```bash
zsh dev-env/scripts/run.zsh > /tmp/tc4-rig.log 2>&1 &
/c/Windows/System32/curl.exe -s http://localhost:19998/api/version
```

The response must include `pkg_version` `0.18.5`. In another terminal, run
`npm run dev` and open `http://localhost:5199/`. If the browser is blank, confirm that
the Vite terminal is still running and that the rig responds on port 19998. `Ctrl+C`
stops the foreground command, so use it only when you intend to stop that terminal.

Stop the rig with:

```bash
zsh dev-env/scripts/stop.zsh
netstat.exe -ano | findstr.exe ":19998"
```

The last command should print nothing.

J12 (`e2e/j12-upgrade-resources.spec.ts`, issues #256/#257) needs a NEWER release of
the English helps than the seeded v89. The rig does not sideload it: the spec serves it
as the mocked Door43 (a Playwright route on `git.door43.org`), so the journey runs offline
and does not move when Door43 publishes again. Cache the exports once, through the app's
own fetch path (the sha is the commit the DCS tags API names for the tag):

```bash
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tn v90 e137f93c4de4d64281e36c84d57a68e405cb20ab
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tw v90 014524aebf4f997c123777e952856d24e3b246d2
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ta v90 be50fc8626b561c2fd36cfb98aee834b14a16a1c
```

Without the three `*-v90-unwrapped.zip` entries the J12 cases skip and say so.

The guided fix screen's proof (`e2e/guided-fix.spec.ts`, issue #9) also needs `en_tn` v88 —
a release the rig lacks and J12 never installs:

```bash
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tn v88 c3be6e4f2d279327249ef5b14bf5d5c8b7549e35
```

Smoke test:

```bash
curl -s localhost:19998/api/version
```

Expect `pkg_version 0.18.5`.

## What is not in this directory

`app-resources/`, `resources-cache/`, `state/`, `upstream/`, and `server/target/` are
assembled, disposable, gitignored, and not published. The `scripts/` and `server/`
sources are the durable part. `server/Rocket.toml` exists on purpose — read its header
comment before you change it (`docs/PLATFORM-NOTES.md` #26a).

## The rig in CI

`.github/workflows/rig.yml` (L-1b of #154) builds this rig on a GitHub runner with
`setup-from-pins.zsh`, seeds it, starts it, and runs `npm run prove` with `RIG_REPOS`
set, so the rig-gated suites execute. It runs on every pull request, on merges to
`main`, and on demand. Its manifest is uploaded as
`prove-manifest-rig`; the committed manifest stays the clean-clone one. The rig runs as
a process on the runner, not in a container: the recipe needs no isolation the runner
does not already give. [VERIFIED — `docs/evidence/rig-job-ci-2026-09-04.md`: run 33929372286 at commit 57fc8e8 on
ubuntu-24.04, 2026-09-04, both controls green, 2 min 36 s with a warm cargo cache]

## Rules

- ⛔ Never add a pankosmia remote, token, or upstream trigger to this rig or its CI.
- A behavior observed only on this rig is a rig finding, not a platform fact —
  read "Verifying a platform claim", the final section of `docs/PLATFORM-NOTES.md`,
  before you record one.
