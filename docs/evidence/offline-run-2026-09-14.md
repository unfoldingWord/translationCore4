# The offline run and the post-install smoke test for v4.0.0-alpha.6 (2026-09-14)

**Question:** does the alpha.6 artifact satisfy the tag rule of epic #59: built by CI for
every platform the pipeline covers, post-install smoke test passed on each on a clean
machine, one offline run passed on one of them?

**Artifacts:** package-desktop run 34858629549, the push-event run on `main` at
`7227cb8` (the merge of PR #282, the version bump). Jobs `linux-x64`, `macos-arm64
(production)`, `macos-arm64 (debug)`, `windows-x64`, `smoke-linux-x64`, `smoke-macos-arm64
(production)`, `smoke-macos-arm64 (fallback)`, `smoke-macos-arm64 (debug)`,
`smoke-windows-x64`: all success. Sizes from the run's artifact listing (`gh api
.../actions/runs/34858629549/artifacts`), 2026-09-14. Hashes measured on the API downloads
(`gh api .../actions/artifacts/<id>/zip`, `shasum -a 256`), 2026-09-14; each download's
byte count equals the listing. The three zips pass `unzip -t`.

| Artifact | Id | Bytes | SHA-256 |
|---|---|---|---|
| `tC4-4.0.0-alpha.6-linux-x64-unsigned.zip` | 10354730245 | 185755448 | `fe789471f090f1f3923d07a3f41496cce33454be8daead5ec66d38f8f390f336` |
| `tC4-4.0.0-alpha.6-macos-arm64-unsigned.pkg` | 10354720508 | 175409136 | `87196a8012d38da1e6901f1c8d68edc9d1aa9ded31368abd27380bc856de7592` |
| `tC4-4.0.0-alpha.6-macos-arm64-unsigned.zip` | 10354905272 | 183566708 | `a961dfe1d9c9ab61dea72d3c53c8b3dd709491e40610294c08d75c32e715be55` |
| `tC4-4.0.0-alpha.6-windows-x64-unsigned.exe` | 10354591238 | 129190817 | `d8d2bc6ffa8f7a23d38f370c2f0d7a422af7192c885e30f0658b308e511a7f01` |
| `tC4-4.0.0-alpha.6-windows-x64-unsigned.zip` | 10354970673 | 193985425 | `26cce6ec9d8139263c8695a1c7ad9b4bcfb304804f71b4f723e1eba17d580da6` |

The debug zip `tC4-4.0.0-alpha.6-debug-macos-arm64-unsigned.zip` (10354480585, 184107228
bytes) is a CI artifact only; it is not a release asset.

## Post-install smoke test (#45)

**Method:** `smoke-installed.zsh`, shipped in the artifact, run by the `smoke-*` CI jobs
on a fresh runner under a fresh `HOME` (`USERPROFILE` on Windows). The Windows job installs
the `.exe`, runs the smoke twice (install, then reinstall), checks the shortcuts, and
uninstalls.

**Result:** every smoke job ends in `SMOKE OK`.

- Linux CI (artifact `smoke-installed-linux-x64`, 10354775261): `SMOKE OK: .../install/translationCore4 under HOME=/home/runner/work/_temp/smoke-home`. Both starts: `pkg_version 0.18.5`, electron alive. The log carries one `Server Failed to stop - process ID kill failed` line after a `Server stopped.` line (#206, open).
- macOS CI, production pkg (artifact `smoke-installed-macos-production`, 10354495935): `SMOKE OK: /Applications/translationCore4.app/Contents/Resources under HOME=/Users/runner/work/_temp/smoke-home`. Two `Failed to stop` lines (#206).
- macOS CI, zip fallback (artifact `smoke-installed-macos-fallback`, 10354465931): `SMOKE OK: .../install/translationCore4/translationCore4.app/Contents/Resources`. Two `Failed to stop` lines (#206).
- Windows CI, installer (artifact `smoke-installed-windows-x64`, 10354567020): `SMOKE OK: C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke under USERPROFILE=D:\a\_temp\tC4 Pilot Profile` twice (install and reinstall); uninstall log written.

### The macOS run on real hardware (2026-09-14)

**Method:** the same shipped `smoke-installed.zsh`, run on the project owner's Mac, not a
CI runner. Machine: macOS 26.5.1 (build 25F80), arm64. The zip asset above was unpacked
once, `xattr -dr com.apple.quarantine` was applied as `README.txt` instructs, and the
script ran against the bundle with `TC4_SMOKE_HOME` set to a fresh directory, so the
machine's own store at `~/pankosmia/tc4-projects` was not touched (one entry before the
run, the same one entry after).

**Result:** `SMOKE OK`, exit 0, 36.99 s wall clock. Every step printed `ok`:

```
ok artifact: ... (Electron and Electron are executable)
ok precondition: no tC4 server on 19119-19139 before the launch
ok first start: server on port 19119 (pid 5426), pkg_version 0.18.5, electron pid 4812 alive
ok root: 303 http://127.0.0.1:19119/clients/uw-tc4
ok client: /clients/uw-tc4 200
ok store: repo_dir .../pankosmia/tc4-projects (the production build's tC4-owned store; not pankosmia_repos)
ok source: en_ult TIT 1:1 = "\zaln-s |x-strong="G39720" ... \w Paul|...\w*\zaln-e\*,"
ok create: _local_/_local_/smoke_1789400408 listed by /git/list-local-repos
ok write verse: TIT 1:1 = "tC4 smoke verse 1789400408"
ok store write: TIT 1:1 on disk at .../smoke_1789400408/ingredients/TIT.usfm is the written verse
ok first stop: electron and server exited (pids 4812 5426), port 19119 no longer answers
ok second start: server on port 19119 (pid 5556), pkg_version 0.18.5, electron pid 5510 alive
ok restart: a new server process (pid 5426 before, 5556 after)
ok read back: TIT 1:1 still "tC4 smoke verse 1789400408" after the restart
ok delete: _local_/_local_/smoke_1789400408 removed
ok second stop: electron and server exited (pids 5510 5556), port 19119 no longer answers
ok bundle signatures remain valid after smoke
SMOKE OK
```

The bundle is ad-hoc signed (`codesign -dv`: `flags=0x2(adhoc)`,
`Identifier=org.unfoldingword.translationcore4`), and the signature is still valid after
the run.

**#206 on real hardware:** the launcher logs carry the same pair of lines the CI macOS
logs carry — `Server stopped.` followed by `Server Failed to stop - process ID kill
failed.`, once per stop. Both stops completed: the script's own checks confirm the
processes exited and port 19119 stopped answering. This is the first record of #206 on a
real Mac rather than a CI runner; the defect is cosmetic in both.

**Limits of this run:** it is the zip fallback path, not the `.pkg` installer, and not a
clean machine — this Mac has a developer checkout and a real tC4 store. It proves the
artifact runs on current macOS hardware; it does not replace the CI clean-runner result
above, and it is not the offline run.

## Offline run (#43)

**Method:** the procedure in `docs/PACKAGING.md`, "The offline run". Debian 13 x86_64, the
Linux artifact above (10354730245, sha256 `fe789471…f336`), network off by `unshare -rn`
with loopback only around `./start-tc4.sh`. Isolation check: from outside the namespace,
`:19119` answered `000`, so the app's server was reachable only inside the namespace. Run
and reported by the project owner, 2026-09-14.

**Result:** PASS under the tag rule. Every step reached its expected result or named its
open issue.

| Step | Result |
|---|---|
| 1 Start the app | PASS |
| 2 New Bible, blank book | PASS |
| 3 Understand | PASS |
| 4 Translate | PASS |
| 5 Draft verse 1, `Saved` | PASS |
| 6 Check, Translation Notes, one item `Mark valid` | PASS |
| 7 Align, one word into a card | PASS |
| 8 Leave and reopen; draft, decision, alignment persist | PASS |
| 9 Export | SKIP, #19 not built |
| 10 Quit, network on | PASS |

No screen named a missing resource on the source panes, the Translation Notes card, or
Align. Fonts ship locally (#3, closed 2026-09-06).

**Limits:** one platform ran offline (Linux). macOS and Windows were not run offline. The
network-off check was the namespace's isolation from outside, not a page load attempted
from inside.

## Clean-machine Windows witness (2026-09-15) — a prerequisite found

**Machine:** Windows 11 Home 10.0.26200 x64, a fresh profile with no prior Visual C++
runtimes. **Artifact:** the Windows zip above (10354970673). Run and reported by the
project owner, 2026-09-15.

**First result: the backend does not start.** Electron showed "The backend could not be
started" with a timeout on port 19119. `bin\server.exe` exited `0xC0000135`
(`STATUS_DLL_NOT_FOUND`), and Windows reported `VCRUNTIME140.dll` was not found. That DLL
comes from the Microsoft Visual C++ Redistributable (VS 2015 to 2022, x64), which a stock
Windows image does not carry. Filed as #284.

**Second result, after installing `vc_redist.x64`:** the same artifact boots. The shipped
`smoke-installed.ps1` ends in `SMOKE OK: C:\Users\tc-win-test\tc4-a6\app\translationCore4
under USERPROFILE=C:\Users\tc-win-test\tc4-a6\home-smoke7; store
C:\Users\tc-win-test\tc4-a6\home-smoke7\pankosmia\tc4-projects`, and `/api/version`
reports `product_version` `4.0.0-alpha.6`.

**Why the CI Windows job did not catch it:** the `windows-2025` runner image carries the
redistributable already, so `server.exe` finds its DLL there. The CI smoke result above is
correct and is not evidence about a machine without the runtime.

**Scope of the prerequisite:** the `.exe` installer has the same dependency as the zip.
`scripts/tc4.iss` has no `[Run]` step for `vc_redist` and neither payload carries
`VCRUNTIME140.dll` [VERIFIED — `scripts/tc4.iss` read and the zip listing searched for
`vcruntime`/`msvcp`/`api-ms-win-crt`, 2026-09-15]. Both Windows paths need the
redistributable on a machine that does not already have it. #284 carries the fix.

[VERIFIED — run 34858629549 on `main` 7227cb8; artifact listing and smoke logs read
2026-09-14; offline run PENDING]
