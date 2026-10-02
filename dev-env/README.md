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
  `zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ult v91 <sha from src/data/installedSuite.js>`.
  For the OBS Translate journey, cache the exact gateway set and the installer
  picture pack as well; `seed.zsh` installs them at their identity-qualified
  paths when those cache entries exist. Without the picture pack every story
  frame renders text only and the story screen states which pack it looked for
  (`test/obsImages.integration.test.ts` skips and names the same command):
  `zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs v9 d39a1dc7a7557ac54e4a8fecc3462147fe7eec3b`,
  `zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs-tn v13 e86138ea13f619f09f7a6dcaa60592716d407fe4`,
  `zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs-twl v3 44ebc9fafe8101665f985007d566f5036a2be85b`, and
  `zsh dev-env/scripts/cache-resource.zsh uW/obs_images_360 "" 7146d5b504f6b63b9e11f7dc0b18c594d0ae179d`.

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
are present. The setup scripts (`setup-from-pins.zsh`, and the same recipe in
`scripts/package-desktop.zsh`) enforce LF inside the upstream clones they make
(`resource-core`, `desktop-app-template`, `webfonts-core`), so those templates stay
LF even when the machine's global git setting converts line endings — a CRLF story
template makes creating stories fail (#306). If a rig was assembled before that fix,
remove `dev-env/upstream/` and `dev-env/app-resources/` and run the setup script again.

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
open `http://localhost:5199/`, select `+ Add a project`, then `New Bible` to create a project.

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
the English helps than the seeded v91. Door43 has none, so the spec serves the seeded v91
exports under a made-up tag (`v92`) with a made-up commit, as the mocked Door43 (a Playwright
route on `git.door43.org`). The journey runs offline and does not move when Door43 publishes
again. It needs no cache entry beyond the seeded ones.

The guided fix screen's proof (`e2e/guided-fix.spec.ts`, issue #9) needs two releases the
rig lacks: `en_tn` v88 (the fetch case) and `en_tw` v90 (the re-pin and sideload cases).
Cache them once, through the app's own fetch path (the sha is the commit the DCS tags API
names for the tag):

```bash
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tn v88 c3be6e4f2d279327249ef5b14bf5d5c8b7549e35
zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tw v90 014524aebf4f997c123777e952856d24e3b246d2
```

Without them the guided fix cases skip and say so.

Smoke test:

```bash
curl -s localhost:19998/api/version
```

Expect `pkg_version 0.18.5`.

## Journeys from a clean clone

The Playwright journeys (`npm run journeys`) use this repository only: its `dev-env/`
rig, its `conformance/sample-burrito` project, and the cache in
`dev-env/resources-cache/`. Do the steps below in order. On Windows, do them in the
MSYS2 zsh window of the [Windows](#windows) section.

1. Install the packages, build the client, and get the Playwright browser:

   ```bash
   npm ci
   npm run build
   npx playwright install chromium
   ```

2. Assemble the rig. This builds the server; the first build takes several minutes:

   ```bash
   zsh dev-env/scripts/setup-from-pins.zsh
   ```

3. Cache the 22 resources that the journeys need. Each command downloads one pinned
   release from Door43 through the app's own fetch path, and fails if the commit is not
   the one given. `seed.zsh` sideloads the first 20 and writes an install record
   (decision D57) for each of them except the English OBS rows and the picture pack,
   which seed without a record — 15 records in all. The last two are releases the rig
   lacks, which the guided fix serves as a mocked Door43:

   ```bash
   # The English suite at the shipped pins (src/data/installedSuite.js, #504), the Greek
   # New Testament, and the Spanish package (seeded).
   # The Spanish Bibles and OBS set make the second gateway package complete: without
   # them the J13 gateway-change cases fail after the confirm (issue #471 found the
   # gap — seed.zsh names them, but this list did not).
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ult v91 35d215957f3203fd2e2fac5702ce14902d417f9d
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ust v91 85f274a74245cb418f85266e1a5b524bc3e91e9c
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tn v91 e586762e330f482a60c52aedd1c7b3a2f155df8a
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tw v91 ff5b3852c27c3a0d01b109e482eb26047dcd20e2
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_ta v91 ce9a1bb9431317ca888e8c1f9620caa7f5fe45fd
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tq v91 8be02772584ff5a5fea893a392b4f019e3efcc77
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/el-x-koine_ugnt v0.34 fc95b2b8aad08bb65ab54628ab685413a1139e97
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tn v66 22f3d0c61e2ab4701cb869547de9c3c43da07208
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tw v37 7586f4ff1f0483ea40a4a68e5e1f33158e08c208
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_ta v4 26606b578c37cc2c0ee09bb7b9a291860ff59444
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_glt v42 3f9bf7e8806f2e310601d723eb201334fe3be1ab
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_gst v40 608e2294aa56938592ef592b0fc391d6d6178b2f
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_obs v2 4a239590d543df59f77d5ee624d475a7488b5fc3
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_obs-tn v2 eaa18de94dcb7df1406cc5b20deb87053c0478ca
   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_obs-twl v2 eb5ecd974b19a123e1fe3ee9da21c89c2555d18d
   # The Open Bible Stories resources and the picture pack (seeded, no install record)
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs v9 d39a1dc7a7557ac54e4a8fecc3462147fe7eec3b
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs-tn v13 e86138ea13f619f09f7a6dcaa60592716d407fe4
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs-twl v3 44ebc9fafe8101665f985007d566f5036a2be85b
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_obs-tq v10 01b92fe8793d62cff3a2221f5174c768cbad3dc1
   zsh dev-env/scripts/cache-resource.zsh uW/obs_images_360 "" 7146d5b504f6b63b9e11f7dc0b18c594d0ae179d
   # The releases that the guided fix serves (not seeded)
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tn v88 c3be6e4f2d279327249ef5b14bf5d5c8b7549e35
   zsh dev-env/scripts/cache-resource.zsh unfoldingWord/en_tw v90 014524aebf4f997c123777e952856d24e3b246d2
   ```

   The cache is gitignored. Do this step once; the entries stay when the rig reseeds.

4. Run the journeys:

   ```bash
   npm run journeys
   ```

   Global setup reseeds the rig with `seed.zsh`, and Playwright starts the rig with
   `run.zsh` and the client with `npm run dev`, when they are not already running. It
   starts each script through zsh. On Windows it uses `C:\msys64\usr\bin\zsh.exe`; set
   `TC4_ZSH` if MSYS2 is in another directory.

   To run one journey, give its tag, for example `npm run journeys -- --grep "@J1( |$)"`.

## Run the journeys in two worktrees at the same time

Each checkout has its own rig state (`dev-env/state/`). A port lane gives each checkout
its own ports too (#524). Two variables name the lane:

| Variable | Default | Used by |
|---|---|---|
| `TC4_RIG_PORT` | `19998` | `run.zsh`, the vite `/api` proxy, the journeys, `npm run prove`, and the rig-gated `npm test` suites |
| `TC4_VITE_PORT` | `5199` | `npm run dev` and the journeys |

With no variable set, nothing changes. When you set one or both variables, Playwright
starts its own rig and its own vite on the lane ports, and stops them at the end. If a
lane port is already in use, the run stops with an error. It does not use a server
from another checkout.

1. In the second worktree, link the rig parts from the first checkout. These links are
   not tracked. Do not stage them:

   ```bash
   ln -s <first checkout>/dev-env/app-resources dev-env/app-resources
   ln -s <first checkout>/dev-env/resources-cache dev-env/resources-cache
   ln -s <first checkout>/dev-env/server/target dev-env/server/target
   ```

2. Seed the rig of the second worktree one time. The rig cannot start without a seeded
   working directory, and Playwright starts the rig before global setup seeds it:

   ```bash
   zsh dev-env/scripts/seed.zsh
   ```

3. Run the journeys on ports that no other checkout uses:

   ```bash
   TC4_RIG_PORT=19999 TC4_VITE_PORT=5299 npm run journeys
   ```

Each lane uses one Playwright worker, as the default lane does.

`stop.zsh` stops every rig on this computer, in all lanes.

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
