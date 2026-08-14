# Product-isolated project store — smoke proofs (2026-08-14)

Evidence record for issue
[#70](https://github.com/unfoldingWord/translationCore4/issues/70)
(owner ruling 2026-08-14, queued as D49). Machine: macOS arm64
(Darwin 25.5.0). All runs: `scripts/package-desktop.zsh` entry-point smoke
test — fresh `HOME`, no app-specific environment overrides, app self-spawns
its bundled server.

## 1. Production build: isolated path, starts empty (exit 0)

```
repo_dir pinned to %%HOMEDIR%%/pankosmia/tc4-projects (#70)
self-spawned server found on port 19119
root: 303 http://127.0.0.1:19119/clients/uw-tc4; /clients/uw-tc4: 200
resolved repo_dir: <fresh HOME>/pankosmia/tc4-projects
production store is empty on first boot (isolated at <fresh HOME>/pankosmia/tc4-projects)
artifact: tC4-4.0.0-alpha.2-macos-arm64-unsigned.zip
```

## 2. Guard proven by test, not by reading (exit 1, no artifact)

`TC4_TEST_FORCE_SHARED_STORE=1` (test-only knob) skips the isolation patch,
so the booted app resolves the platform default:

```
!!! TC4_TEST_FORCE_SHARED_STORE=1: leaving the platform default repo_dir (guard self-test)
resolved repo_dir: <fresh HOME>/pankosmia_repos
#70 GUARD FAILED: resolved repo_dir is the shared pankosmia_repos store — release-blocking (owner ruling 2026-08-14)
```

The build exits 1 before the zip step. The guard reads the BOOTED app's
resolved `user_settings.json`, not the build inputs.

## 3. Debug build: separate seeded store, visibly marked (exit 0)

```
repo_dir pinned to %%HOMEDIR%%/pankosmia/tc4-projects-debug (#70)
self-spawned server found on port 19119
root: 303 http://127.0.0.1:19119/clients/uw-tc4; /clients/uw-tc4: 200
resolved repo_dir: <fresh HOME>/pankosmia/tc4-projects-debug
debug store seeded at <fresh HOME>/pankosmia/tc4-projects-debug (separate from production store)
artifact: tC4-4.0.0-alpha.2-debug-macos-arm64-unsigned.zip
```

The debug launcher seeds the conformance sample burrito
(`_local_/_local_/sample_burrito`, git-initialized with one commit —
PLATFORM-NOTES #20) into the debug-only store on first run. Marking: app
name `translationCore4 DEBUG`, version `4.0.0-alpha.2-debug`, artifact name
suffix `-debug`, and the same values in `BUILD-MANIFEST.json`
(`"variant": "debug"`).

## Defect found and fixed during implementation

The first debug design put the store INSIDE the server working dir
(`$HOME/pankosmia/tc4/projects-debug`). The launcher's pre-boot seeding then
created the working dir before the server's first boot, the server skipped
first-boot initialization, and it panicked on the missing `app_state.json`
(`bootstrap.rs:125`, measured). The stores therefore sit BESIDE the working
dir: `$HOME/pankosmia/tc4-projects` and `$HOME/pankosmia/tc4-projects-debug`.

## Interpretation choices (flagged for the owner)

- The ruling's example path was `$HOME/pankosmia/tc4/projects`. The shipped
  path is `$HOME/pankosmia/tc4-projects` for the reason above. Both are
  tC4-owned; the isolation property is identical.
- "Visibly marked (window title or version suffix)": implemented as version
  suffix + app/product name. The in-page window title is set by the client
  and is unchanged by packaging.
- Debug seeding needs `git` on the machine (initial commit, PLATFORM-NOTES
  #20); the launcher skips seeding silently when `git` is absent.
