# Windows x64 desktop artifact — clean-machine witness (issue #181)

**Date:** 2026-09-08. **Machine:** the owner's Dell laptop, Windows 10 Pro
10.0.19045 (22H2), no developer checkout. **Artifacts:** two builds of
`tC4-4.0.0-alpha.4-windows-x64-unsigned.zip`, both from the `package-desktop`
workflow (#181, PR #226):

| Artifact | Run | Head | Size | sha256 |
|---|---|---|---|---|
| 10054337157 (`main`, 30-day retention) | 34221719711 | `cd92a0c` | 188,346,306 bytes | not recorded |
| 10056395396 (PR #229, 3-day retention) | 34227273789 | `8fbb62f` | 188,346,325 bytes | `20582ef6e8b4fb74235c7aab268e0d8e816900f318bcb01b1b7a0bfa1a8d0cba` (the API download, hashed 2026-09-08) |

## What happened

1. The `main` artifact (10054337157) unpacked and launched. Creating a project
   from the project dialog ended in the error dialog `could not read ingredient
   content: The system cannot find the path specified. (os error 3)` [witnessed
   by the owner]. Cause and fix: issue #228, PR #229. The client's absence
   discriminator read only the Unix not-found text; on Windows the same failed
   read carries a different text, so an expected-absent read on a fresh project
   reached the dialog.
2. The PR #229 artifact (10056395396, head `8fbb62f`, the #228 fix) unpacked
   once and launched without a developer checkout. The owner created the
   project `tst2` (language `tst`) with the book 2 Kings and reached the tC4
   dashboard: the Translate screen with 2 Kings 1, the source tabs `ULT`,
   `UST` and `Hebrew` (#207), the section cards `Draft section 1–2` and `Draft
   section 3–4` (#141), and the save indicator `Saved` [witnessed by the owner;
   the owner's words: "it's working fine now"]. Screenshot:
   `desktop-windows-witness-2026-09-08.jpg` (a photo of the laptop screen).
3. The second-launch check (a second `start-tc4.cmd` while the first copy runs:
   it must exit by itself or focus the first window, #4) was not reported in
   this run. CI proves it on every build (`#4 guard` in the `windows-x64` job);
   the witness of that step on a real machine stays open.

## What this proves, and what stays open

- PROVEN: the CI-built Windows artifact, downloaded and unpacked once, runs on
  a real Windows 10 machine without a developer checkout, creates a project,
  and opens the tC4 dashboard with the bundled English suite (#163) and the
  original-language pane (#207). Acceptance items 1 to 5 of #181 have CI
  evidence (`docs/PACKAGING.md`, "Windows x64 › Evidence"); item 6 is this
  record.
- FOUND AND FIXED on the way: #228 (the Windows not-found text). The `main`
  artifact before PR #229 shows the dialog; every later build does not.
- OPEN: the second-launch witness on a real machine (item 3 above), and the
  SmartScreen step of the install instructions (`docs/PACKAGING.md`, "Windows
  x64 › Install and launch"), which the owner did not report either way. Both
  are one line each for the next Windows run.
