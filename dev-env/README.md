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
- Node 22, `python3`, `git`, `zip`, `unzip`.
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
