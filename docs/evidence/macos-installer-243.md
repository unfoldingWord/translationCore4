# Mac installer — issue #243

Owner decision, 2026-09-10: ship an unsigned pkg with a self-contained app and
translationCore application/Dock icons. Signing and notarization remain #44.

## Local checks

Host: macOS 26.5.1 (25F80), arm64. Base: `f061e2b`. Version: 4.0.0-alpha.5.
Date: 2026-09-10. This is a local packaging finding, not a macOS 15 witness.

`npm run verify` passed: lint, typecheck, 997 tests passed / 31 skipped, two
desktop bootstrap tests, client build, and docs gate. The worktree can see the
sibling sample-burrito checkout, so its skip count differs from clean CI.

The icon compiled and round-tripped to ten iconset files. Bootstrap tests include
negative controls (missing packaged input), resource preservation on repeated
launch, retry after a failed debug seed, initial Git commit, and store isolation.

Packaging/post-install results and CI run links will be recorded here after the
final artifact is tested.

## Required clean macOS 15 witness

Pending. Download the CI production pkg in Safari on a clean macOS 15 machine,
open Installer, read the instructions, install, and open translationCore4 from
Applications or Launchpad. Confirm Home and the Finder/Dock icon. Count all
Gatekeeper/Open Anyway approvals across installation and first launch separately
from the administrator password. Record OS version, artifact ID/hash, commit,
date, and the observed count on #243 before closing it.

Direct executable launches, signature verification, and CI's command-line
installer do not prove the interactive Gatekeeper path or approval count.
