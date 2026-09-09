# The offline run and the post-install smoke test for v4.0.0-alpha.5 (2026-09-09)

**Question:** does the alpha.5 artifact satisfy the tag rule of epic #59: built by CI for
every platform the pipeline covers, post-install smoke test passed on each on a clean
machine, one offline run passed on one of them?

**Artifacts:** package-desktop run 34293254911, the push-event run on `main` at
`1c8b376` (the merge of PR #233, the version bump). Jobs `linux-x64`, `macos-arm64`,
`windows-x64`, `smoke-linux-x64`, `smoke-macos-arm64`: all success. Sizes from the run's
artifact listing (`gh api .../actions/runs/34293254911/artifacts`), 2026-09-09. Hashes
measured on the API downloads (`gh api .../actions/artifacts/<id>/zip`, `shasum -a 256`),
2026-09-09; the Linux hash equals the one the tester measured on their own download.

| Artifact | Id | Bytes | SHA-256 |
|---|---|---|---|
| `tC4-4.0.0-alpha.5-linux-x64-unsigned.zip` | 10082201368 | 185618183 | `eeee0701d14309579cc94198d0f54aded5324e5b2f196307888252376eb3433d` |
| `tC4-4.0.0-alpha.5-macos-arm64-unsigned.zip` | 10082301082 | 178591591 | `94347cf5cb1daa83c6e0a0f4129346f244ffa1a77a82c224968aee4a83ba5e2f` |
| `tC4-4.0.0-alpha.5-windows-x64-unsigned.zip` | 10082254332 | 193731891 | `9f14b58a0a3b4c7799ee0258f76bb563ef556cf880f80acc611e32a1cd3b213b` |

## Post-install smoke test (#45)

**Method:** `smoke-installed.zsh`, shipped in the artifact, run by the `smoke-*` CI jobs on
a fresh runner under a fresh `HOME`, and once by hand on the Linux box below before the
offline session.

**Result:** all three runs end in `SMOKE OK`.

- Linux CI (artifact 10082234806): `SMOKE OK`.
- macOS CI (artifact 10082326436): `SMOKE OK`. Both stops completed without SIGKILL and the
  port was released. The shell log still carries one `Server Failed to stop - process ID
  kill failed` line after each `Server stopped.` line (#206, open, Increment 8).
- Local Debian 13 x86_64: `SMOKE OK` (reported by the tester, 2026-09-09).
- Windows: no CI smoke job. The clean-machine witness on Windows 10 Pro is
  `desktop-windows-witness-2026-09-08.md` (an alpha.4 artifact with the #228 fix).

## Offline run (#43)

**Method:** the procedure in `docs/PACKAGING.md`, "The offline run". Debian 13 x86_64, the
Linux artifact above, unpacked once under `/workspace/tc4-a5/`. Network off by
`unshare -rn` with `ip link set lo up` around `./start-tc4.sh` (a network namespace with
loopback only). Isolation check: from outside the namespace, `curl http://127.0.0.1:19119/`
answered nothing (`000`), so the app's server was reachable only inside the namespace.
`ping` is not installed on the box, so the procedure's `ping 1.1.1.1` check was not run;
the namespace has no interface but loopback, which is what `unshare -rn` creates. The
English suite and the two lexicons are in the artifact (#163, #218), so this run tests the
shipped-content case. Run and reported by the project owner, 2026-09-09.

**Result:** PASS under the tag rule. Every step reached its expected result or named its
open issue.

| Step | Result |
|---|---|
| 1 Start the app | PASS |
| 2 New Bible, blank Titus, `Create Bible →` | PASS, Titus opens in Translate |
| 3 Understand | PASS, helps show for chapter 1 |
| 4 Translate | PASS, source pane shows ULT/UST text |
| 5 Draft verse 1, `Saved` | PASS |
| 6 Check, Translation Notes, one item `Mark valid` | PASS, 1 resolved |
| 7 Align, one word into a card | PASS, one word into the Paul card; Greek text present |
| 8 Leave and reopen; draft, decision, alignment persist | PASS, all three still there after quit and relaunch |
| 9 Export | SKIP, #19 not built |
| 10 Quit, network on | PASS, full quit, clean relaunch |

No screen named a missing resource on the source panes, the Translation Notes card, or
Align. Fonts: shipped locally (#3, closed 2026-09-06); no font observation recorded. One
UX defect seen and already open: the helps panel's Comments tab is clipped at the default
width (#225).

**Limits:** one platform ran offline (Linux). macOS and Windows were not run offline; the
#206 second-start check is macOS-only and was not run. The network-off check was the
namespace's isolation from outside, not a page load attempted from inside.

[VERIFIED — run 34293254911 on `main` 1c8b376; artifact listing and smoke logs read
2026-09-09; offline run reported by the project owner, 2026-09-09]
