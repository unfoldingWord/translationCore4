# The offline run and the post-install smoke test for v4.0.0-alpha.4 (2026-09-06)

**Question:** does the alpha.4 artifact satisfy the tag rule of epic #59: built by CI for
every platform the pipeline covers, post-install smoke test passed on each on a clean
machine, one offline run passed on one of them?

**Artifacts:** package-desktop run 34058863316, the push-event run on `main` at
`736fdd0` (the merge of PR #204, the version bump). Jobs `macos-arm64`, `linux-x64`,
`smoke-linux-x64`, `smoke-macos-arm64`: all success. Sizes and hashes measured on the
downloaded files (`gh api .../actions/artifacts/<id>/zip`, `shasum -a 256`), 2026-09-06.

| Artifact | Id | Bytes | SHA-256 |
|---|---|---|---|
| `tC4-4.0.0-alpha.4-linux-x64-unsigned.zip` | 9996833809 | 149480723 | `df5b8be1202e6d987a37e5db89fb01492dca3342a832ec26da5020e8a1b2101d` |
| `tC4-4.0.0-alpha.4-macos-arm64-unsigned.zip` | 9996877373 | 142563719 | `4dbfa3eb0c8aec697731e3b545025f9a4914b09c8b4be08ec624baf12bb662cc` |

## Post-install smoke test (#45)

**Method:** `smoke-installed.zsh`, shipped in the artifact, run by the `smoke-*` CI jobs on
a fresh runner under a fresh `HOME`, and once by hand on a clean Debian 13 machine.
The script starts the installed app, creates a project through the app's HTTP surface,
writes one verse, stops, restarts, reads the verse back, deletes the project.

**Result:** all three runs end in `SMOKE OK`.

- Linux CI (artifact 9996857881): 15 `ok` lines, `SMOKE OK`. Server pkg_version 0.18.5,
  store `pankosmia/tc4-projects` under the fresh `HOME`.
- macOS CI (artifact 9996891720): 15 `ok` lines, `SMOKE OK`. The first stop needed
  SIGKILL for the Electron process, and the shell log says `Server Failed to stop - process
  ID kill failed` twice. The script confirmed that the port no longer answered, so the
  check passed. Not a tag-rule failure. Noted for the packaging epic (#59).
- Local Debian 13 x86_64, clean `HOME`: `SMOKE OK` (reported in issue #201,
  https://github.com/unfoldingWord/translationCore4/issues/201).

## Offline run (#43)

**Method:** the procedure in `docs/PACKAGING.md`, "The offline run". Debian 13 x86_64, the
Linux artifact above, unpacked once. Network off by `unshare -rn` (a network namespace
with loopback only). No English package preloaded (step 3 of "Before you start" skipped),
so the run tests the clean-install case. Run and reported by a second tester on the
project team, 2026-09-06 (issue #201).

**Result:** PASS under the tag rule. Every step reached its expected result or named its
open issue, and the named issues are the three known ones.

| Step | Result |
|---|---|
| 1 Start the app | PASS |
| 2 New Bible, blank Titus, `Create Bible →` | PASS, Titus opens in Translate |
| 3 Understand | expected #163: source text and helps not on this computer |
| 4 Translate | expected #163: source pane not on this computer; verses show |
| 5 Draft verse 1, `Saved` | PASS |
| 6 Check, Translation Notes | expected #163: English package not shipped |
| 7 Align | expected #163: Greek text not shipped |
| 8 Leave and reopen; draft persists | PASS |
| 9 Export | SKIP, #19 not built |
| 10 Quit, network on | done |

Fonts: system defaults on screen with the network off (#3).

**Limits:** one platform ran offline (Linux). macOS was smoke-tested in CI only, not run
offline. Windows has no artifact (#181). The offline run was on a clean install without
the English package, so steps 3, 4, 6 and 7 tested the #163 message, not source text.

[VERIFIED — run 34058863316 on `main` 736fdd0; artifacts and smoke logs read 2026-09-06;
offline run reported in issue #201, 2026-09-06]
