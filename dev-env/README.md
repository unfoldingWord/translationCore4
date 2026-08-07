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
- An assembled Pankosmia desktop-app build. The rig assembles its `app-resources/`
  from one — set `PANKOSMIA_ASSEMBLED_LIB` to that build's `lib` directory (the one
  that holds `app_resources`, `templates`, `webfonts`, `clients`, `setup`).
- Node 22 (for `scripts/cache-resource.ts`).

## Scripts

- `scripts/setup.zsh` — run once. Assembles `app-resources/` from
  `$PANKOSMIA_ASSEMBLED_LIB`, patches isolation (`repo_dir` → the rig working
  directory, never `$HOME`), writes `product/product.json` (0.17.0+ requires it;
  since 0.18.0 the server panics unless a client is registered at
  `/clients/<homepage>`), and builds the server shim (`server/`).
- `scripts/seed.zsh` — reset the environment to pristine. Recreates `state/work`
  from templates; no first-boot variance.
- `scripts/run.zsh` — start the server at `127.0.0.1:19998` (override:
  `TC4_RIG_PORT`).
- `scripts/stop.zsh` — stop the server.
- `scripts/cache-resource.zsh` — cache a Door43 resource locally for offline work.

Smoke test:

```bash
curl -s localhost:19998/api/version
```

Expect `pkg_version 0.18.5`.

## What is not in this directory

`app-resources/`, `resources-cache/`, `state/`, and `server/target/` are assembled,
disposable, and not published. The `scripts/` and `server/` sources are the durable
part. `server/Rocket.toml` exists on purpose — read its header comment before you
change it (`docs/PLATFORM-NOTES.md` #26a).

A devcontainer for this rig is a tracked follow-up (see the issue list).

## Rules

- ⛔ Never add a pankosmia remote, token, or upstream trigger to this rig or its CI.
- A behavior observed only on this rig is a rig finding, not a platform fact —
  read "Verifying a platform claim", the final section of `docs/PLATFORM-NOTES.md`,
  before you record one.
