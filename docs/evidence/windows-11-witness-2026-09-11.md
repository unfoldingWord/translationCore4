# Windows 11 installer witness — partial (issue #242)

**Date recorded:** 2026-09-11. **Reported by:** the project owner.
**OS:** Windows 11. **Commit:** `7ebedc6` (head of `i242-windows-installer`,
PR #253). **Result:** the pilot installed and ran.

## What the owner attests

The owner installed the Windows pilot on a Windows 11 machine from build
`7ebedc6` and the installation worked.

## What is not recorded

The owner did not keep the details at the machine. This record therefore has
no:

- machine identity, Windows build number, or the time of the run;
- artifact identity or SHA-256 of the installed file;
- browser used for the download, or the security prompts and the actions taken;
- icon appearance in Start, on the desktop, or in the taskbar;
- shipped smoke result, second-launch focus, or uninstall behaviour.

For that reason this witness is **partial**. It confirms that a clean Windows 11
machine installs and opens the application. It does not close the full
observation list in `windows-installer-242.md`.

## The build this commit produced

Commit `7ebedc6` built in `package-desktop` run
[34549583921](https://github.com/unfoldingWord/translationCore4/actions/runs/34549583921).
The Windows installer artifact of that run is
[`tC4-4.0.0-alpha.5-windows-x64-unsigned.exe`](https://github.com/unfoldingWord/translationCore4/actions/runs/34549583921/artifacts/10180449687),
129,076,415 bytes.
The run is derived from the commit, not confirmed by the witness: the owner did
not record which downloaded file was used.

The issue comment that first recorded this report is
[#242 comment 5641128535](https://github.com/unfoldingWord/translationCore4/issues/242#issuecomment-5641128535).

Signing stays #44. The installer is unsigned, and no fixed SmartScreen warning
count is claimed.
