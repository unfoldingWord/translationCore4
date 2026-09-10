# Windows installer proof (#242)

[PROPOSED — 2026-09-10] The installer builds from the staged Windows x64
payload and uses Inno Setup with a per-user destination, a Start menu entry,
an optional desktop shortcut, and a standard uninstaller. The executable,
shortcuts and installer use the existing tC4 mark.

The Windows change is based on Mac installer PR #251 at `78686ed`, reusing
its atomic first-run resource copy under the single-instance lock. The
Windows batch launcher remains in the portable zip; installed shortcuts
launch Electron directly. Production bootstrap needs no external Git.

[VERIFIED — local macOS 26.5.1 arm64, 2026-09-10, implementation `bc521be`]
`npm run verify` passed: 68 test files passed, 1 skipped; 997 tests passed,
31 skipped; 2 desktop bootstrap tests passed; lint, typecheck, build and docs
gate passed. The bootstrap tests exercise missing-bundle rejection, first
copy, preservation of user changes, interrupted debug initialization retry,
and separate production/debug stores. This is not a Windows launch witness.

## Automated Windows evidence

[PROPOSED] The `smoke-windows-x64` job installs the uploaded `.exe` on a
fresh Windows Server 2025 runner, checks shortcut targets, and runs the shipped
PowerShell smoke against installed binaries under a fresh profile. The smoke
uses Electron's Node mode for the shared API steps: bundled source, project
create, verse write, restart, readback and deletion. CI additionally retains
one smoke project and checks its bytes across reinstall and uninstall.

Native build/run/artifact identifiers and results will be recorded after CI.

## Manual Windows 11 witness — pending

Use the exact CI installer and record:

- machine, Windows version/build, date, artifact ID, SHA-256 and source commit;
- browser used for the download, every security prompt and chosen action;
- installation without development tools, Start menu launch to Home, and
  tC4 icons in Start, desktop (if selected) and the running taskbar;
- bundled English resource availability, second launch focusing the first,
  shipped smoke result, and uninstall preserving existing projects.

Do not equate a Windows Server 2025 runner with a clean Windows 11 desktop.
The existing Windows 10 zip witness predates this installer. SmartScreen and
organizational policy can change the warnings; no universal count is claimed.
