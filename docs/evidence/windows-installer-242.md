# Windows installer proof (#242)

[VERIFIED — CI run 34534202718, implementation `ba4ac1e`, 2026-09-10] The installer builds from the staged Windows x64
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

[VERIFIED — Windows Server 2025, implementation `ba4ac1ebe171d03599012a7966e10dfc8d941224`, 2026-09-10]
[Packaging run 34534202718](https://github.com/unfoldingWord/translationCore4/actions/runs/34534202718)
passed all nine build/smoke jobs. Windows build job `103061882071` compiled the
MSVC server, passed the staged launch/singleton/store guards, and compiled the
installer with Inno Setup 6.7.1. Windows installed smoke job `103065954522`
passed on a separate fresh runner. Verification and rig CI also passed.

Installer:

- artifact [10175187792](https://github.com/unfoldingWord/translationCore4/actions/runs/34534202718/artifacts/10175187792),
  `tC4-4.0.0-alpha.5-windows-x64-unsigned.exe`, 129,074,420 bytes;
- SHA-256 `c8396f9f71d5db8fbad8da539621d14be8bf3eafc11c25f68328c6c94dffd67a`;
- portable zip artifact `10175186513`, 193,807,896 bytes.

The job installed to `C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke`
and checked both Start menu and desktop shortcuts. With development tools
removed from PATH, the installed app ran under fresh profile
`D:\a\_temp\tC4 Pilot Profile`. The test read bundled English source, created
a project, wrote TIT 1:1, stopped and restarted the app, and read the verse
back. It then reinstalled, repeated the smoke, uninstalled, and checked the
first project's file hash was unchanged and both shortcuts/executable removed.

Excerpt from the job log (the full transcript is uploaded as
`smoke-installed-windows-x64` on the run):

```text
ok installed Start menu and desktop shortcuts
ok singleton: second launch exited, first remains
ok client: root 303, tC4 client 200
ok store: D:\a\_temp\tC4 Pilot Profile\pankosmia\tc4-projects
ok write verse: TIT 1:1 = "tC4 smoke verse 1789077881373"
ok read back: TIT 1:1 still "tC4 smoke verse 1789077881373" after the restart
ok reinstall/uninstall preserved user project; app and shortcuts removed
```

The production bootstrap also passed locally with PATH pointing to a
nonexistent directory, including its missing-bundle negative control. Both
independent source reviews (Standards and Spec, `78686ed...364d9fd`) reported
zero actionable findings. The subsequent icon correction applies the same
tC4 mark to the template's running-window favicon; native build and smoke
include that correction. The repository graph was refreshed with `graft build`.

## Manual Windows 11 witness — partial (2026-09-11)

The owner installed build `7ebedc6` on a Windows 11 machine and the
installation worked — recorded in `windows-11-witness-2026-09-11.md`. That
record is partial: it holds the OS and the commit only. The observations
below are still not witnessed. Use the exact CI installer and record:

- machine, Windows version/build, date, artifact ID, SHA-256 and source commit;
- browser used for the download, every security prompt and chosen action;
- installation without development tools, Start menu launch to Home, and
  tC4 icons in Start, desktop (if selected) and the running taskbar;
- bundled English resource availability, second launch focusing the first,
  shipped smoke result, and uninstall preserving existing projects.

Do not equate a Windows Server 2025 runner with a clean Windows 11 desktop.
The existing Windows 10 zip witness predates this installer. SmartScreen and
organizational policy can change the warnings; no universal count is claimed.
