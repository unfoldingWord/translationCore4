# Electronite v44.9.3-graphite: the shell on Windows (2026-11-09)

Issue #937 moves the shell from Electronite v37.1.0-graphite (Electron 37.1.0, Chromium 138) to
v44.9.3-graphite (Electron 44.9.3). This file records what was run on a developer's Windows
machine before the pull request; the release workflow and the merge queue run the rest.

- Base: main 9cfb7b5f, with the #937 changes
- Machine: Windows 11 Pro, Intel Core i5-12600KF (a developer's desktop, not the reference laptop)
- Electronite: `electronite-v44.9.3-graphite-win32-x64.zip` from the unfoldingWord/electronite
  release, sha256 `4a9b1e2161a1e197e08aa518b11419a96e864de36a4970dc53de861a559f69f4`, matching
  the release's digest; its `version` file says 44.9.3, and `LICENSE` is at the archive root,
  where `scripts/release/stage.sh` takes it for the third-party notices

## The shell's end-to-end tests

`shell/e2e`, with `cargo build -p tc4 --features test-hooks,fixture-backend`, both
`build-app.sh` outputs and the `en_obs-tn` bundle, as `shell/README.md` gives them:
14 tests, 14 pass, 0 skipped (`electronite-upgrade-2026-11-09/shell-e2e-windows.tap`).

One test needed a change to read the menu: Electron 44 fills a role item's `accelerator` with
its default key (`zoomIn` reports `CommandOrControl+Plus`), and
`windows_window_has_no_native_bar_and_keeps_zoom_and_reload` listed `accelerator || role`, so
it no longer saw `zoomin`. It now lists both. The zoom items, their keys and what they do are
unchanged; the same test still runs each one and checks the zoom level.

## Graphite

`graphite_shapes_awami_nastaliq_in_the_shell` at 32 px: width 302.9, ascent 61, descent 13.2,
the same values Electronite 37.1.0 measured on Windows (`shell/graphite.cjs`). The limits are
unchanged.

## The breaking changes from Electron 38 to 44

Read from Electron's `docs/breaking-changes.md` against what the shell uses. Only one reaches a
translator: since 43.0 an open or save dialog without a `defaultPath` starts in Downloads, and
the system no longer remembers the last folder. `chooseFolder` and `chooseFile` (exchange save
and receive) now pass the folder the last one ended in, kept in `shell-profile/last-folder.txt`
across restarts. `printPdf` already passed a `defaultPath` and is unchanged. Electron 44 needs
macOS 13, which `docs/RELEASE.md` already names. Not checked here: the window controls' place on
Linux, which since 43.0 follows the desktop's own title bar layout.

## Not run here

- Linux and macOS end-to-end tests and Graphite: the shell workflow's jobs in the merge queue.
- The installers for the three systems and their smoke tests: the release workflow, which a
  push that touches `shell/` or `scripts/release/` runs on the branch.
- The macOS "damaged" check (#99) and one journey on each installed app: they need the release
  artifacts and a Mac.
