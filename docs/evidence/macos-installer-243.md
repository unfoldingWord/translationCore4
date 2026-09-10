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

The local unsigned pkg built successfully (173897170 bytes; SHA-256
`e6a3fb6cd738b604401e9df6a96b299352579fdde67cd04acdaf3322d3e0f401`).
`pkgutil --expand` confirmed the Installer README, an app-only payload targeting
`/Applications`, no relocation entries, and no installer scripts. `pkgutil
--check-signature` reported no package signature, as intended; `codesign --verify
--deep --strict` accepted the application bundle.

The local full smoke was interrupted by an existing tC4 app running from Downloads.
It held the singleton lock and its server answered the old build probe; the final
fresh-HOME check correctly failed. The recipe now rejects that precondition before
building. A negative-control run returned exit 1 with the running server's port;
the pilot process was left intact. Full artifact boot results come from CI below.

PR: [#251](https://github.com/unfoldingWord/translationCore4/pull/251).
Independent source reviews of `a39efca` against `f061e2b` on 2026-09-10:
Standards — 0 actionable findings; Spec — 0 actionable findings.
Final CI artifact results will be recorded after the run completes.

## Required clean macOS 15 witness

Pending. Download the CI production pkg in Safari on a clean macOS 15 machine,
open Installer, read the instructions, install, and open translationCore4 from
Applications or Launchpad. Confirm Home and the Finder/Dock icon. Count all
Gatekeeper/Open Anyway approvals across installation and first launch separately
from the administrator password. Record OS version, artifact ID/hash, commit,
date, and the observed count on #243 before closing it.

Direct executable launches, signature verification, and CI's command-line
installer do not prove the interactive Gatekeeper path or approval count.
