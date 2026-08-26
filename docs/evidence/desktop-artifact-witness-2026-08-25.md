# Desktop CI artifact — real-machine witness (issue #57)

**Date:** 2026-08-25. **Artifact:** `tc4-desktop-macos-arm64-unsigned` from the
`package-desktop` run on the merge of pull request 97 (`main` at 97016a8,
141,731,505-byte zip). **Machine:** the owner's Mac (Apple Silicon, macOS 15) —
a real machine, but the development machine, not a clean one.

## What happened

1. The owner downloaded the artifact through the browser (real quarantine) and
   double-clicked `start-tc4.command`. macOS refused with **"Electron" is
   damaged and can't be opened. You should move it to the Trash.** macOS offers
   no "Open Anyway" for the damaged verdict.
2. Root cause [VERIFIED — measured the same day]: the pristine upstream
   Electronite v37.1.0-graphite release bundle FAILS signature verification
   (`codesign --verify --deep --strict`: "code has no resources but signature
   indicates they must be present"). The packaging changed nothing; a
   quarantined download of an invalid-signature bundle gets the damaged
   verdict. Recorded as issue #99; the build now re-seals the bundle
   (`scripts/package-desktop.zsh`, this change set).
3. With quarantine cleared (`xattr -dr com.apple.quarantine …`), the same
   double-click **launched the app into the tC4 client** [witnessed by the
   owner]. The CI-built artifact is functional on a machine other than the CI
   runner.

## What this proves, and what stays open

- PROVEN: the CI artifact, as downloaded, runs and opens into the tC4 client
  on a real machine once Gatekeeper is out of the way. The store-isolation
  guarantees (#70) are enforced separately by the build's own smoke guard,
  which fails the build when the booted app's `repo_dir` is wrong.
- OPEN until the re-sealed artifact ships: the no-terminal install path. The
  expected flow after this change set merges: download → double-click →
  "unidentified developer" → System Settings → Privacy & Security →
  "Open Anyway" → the app opens. Re-test that on the next `main` artifact,
  ideally on a machine that never had the repo or its tools.
- The full fix for a clean install experience (no dialogs at all) is signing
  and notarization — issue #44.
