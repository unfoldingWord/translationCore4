# The offline run and the post-install smoke test for v4.0.0-alpha.7 (2026-09-22)

**Question:** does the alpha.7 artifact satisfy the tag rule of epic #59: built by CI for
every platform the pipeline covers, post-install smoke test passed on each on a clean
machine, one offline run passed on one of them?

**Artifacts:** package-desktop run 35671067386, the push-event run on `main` at
`95238c3aec074bc82174f1773e486bd04dd4a4c6` (the merge of PR #357, the last Increment 7
change). Jobs `package-preflight`, `linux-x64`, `macos-arm64 (production)`, `macos-arm64
(debug)`, `windows-x64`, `smoke-linux-x64`, `smoke-macos-arm64 (production)`,
`smoke-macos-arm64 (fallback)`, `smoke-macos-arm64 (debug)`, `smoke-windows-x64`: all
success. Sizes from the run's artifact listing (`gh api
.../actions/runs/35671067386/artifacts`), 2026-09-22. Hashes measured on the API downloads
(`gh api .../actions/artifacts/<id>/zip`, `shasum -a 256`), 2026-09-22; each download's
byte count equals the listing. `file` reports the two zips and the Linux zip as Zip archive
data, the pkg as a xar archive, the exe as a PE32 executable. The three zips pass `unzip -t`.

| Artifact | Id | Bytes | SHA-256 |
|---|---|---|---|
| `tC4-4.0.0-alpha.7-linux-x64-unsigned.zip` | 10671230886 | 223955557 | `043e5a1e8e5bfc3e6483eea42cda37fe17b7f6a8e76097784569dc3bd7e6cd1a` |
| `tC4-4.0.0-alpha.7-macos-arm64-unsigned.pkg` | 10671910574 | 213636234 | `4747c152f8a5a18cbcc3351f6d39b9c52da9dfc26b935c6530772ecb1944c62c` |
| `tC4-4.0.0-alpha.7-macos-arm64-unsigned.zip` | 10671291064 | 221926764 | `235b0aee9e59de12b959522f5d0e694ed4a48c7d0a7ff1b5eacc3df500fd7adc` |
| `tC4-4.0.0-alpha.7-windows-x64-unsigned.exe` | 10671671208 | 162889153 | `fd13d83d84a0b9efe7544a5cd921f66a67cbfb5c993b77e9cf27c865af075a34` |
| `tC4-4.0.0-alpha.7-windows-x64-unsigned.zip` | 10671376348 | 232181903 | `11ddc439a49039e939419de7e706bc584eff6250f74d58ea30b3c5e2468e2f55` |

The debug zip `tC4-4.0.0-alpha.7-debug-macos-arm64-unsigned.zip` (10670976313, 222483961
bytes) is a CI artifact only; it is not a release asset.

**What each artifact carries.** `BUILD-MANIFEST.json` in the Linux zip and in the Windows
zip names client commit `95238c3aec074bc82174f1773e486bd04dd4a4c6`, version `4.0.0-alpha.7`,
and fifteen bundled repos, `en_obs` v9, `en_obs-tn` v13, `en_obs-twl` v3, `en_obs-tq` v10
and the picture pack `uW/obs_images_360` (`7146d5b5`) among them (#288). The OBS template
`lib/templates/content_templates/text_stories/metadata.json` carries `localizedNames` in
the Linux zip and in the Windows zip (`unzip -p ... | grep -c localizedNames` prints `1`
for both): the Windows gap of the 2026-09-19 build (#344) is closed by PR #346. The Windows
zip holds one `product.json` (#326, #334).

## Post-install smoke test (#45)

**Method:** `smoke-installed.zsh` (`smoke-installed.ps1` on Windows), shipped in the
artifact, run by the `smoke-*` CI jobs on a fresh runner under a fresh `HOME`
(`USERPROFILE` on Windows). Each run starts the app twice, and since PR #354 launches it
under a poisoned `APP_RESOURCES_DIR` and a contaminated profile to prove the resource
binding (#347, #348; `packaged-resource-binding-2026-09-21.md`). Since #288 the smoke
decodes the picture of story 1, frame 1 with the network gate off. The Windows job installs
the `.exe`, runs the smoke twice (install, then reinstall), checks the shortcuts, and
uninstalls.

**Result:** every smoke job ends in `SMOKE OK`. Every host, on both starts, prints
`ok OBS image: story 1/frame 1 decoded 640x360 from local bundled resource with net
disabled; no CDN request` and `ok version: /api/version matches this package
(4.0.0-alpha.7, <built_utc>)`.

- Linux CI (artifact `smoke-installed-linux-x64`, 10670966445): `SMOKE OK: /home/runner/work/translationCore4/translationCore4/install/translationCore4 under HOME=/home/runner/work/_temp/smoke-home, store /home/runner/work/_temp/smoke-home/pankosmia/tc4-projects`. Both starts: `pkg_version 0.18.5`, electron alive. Built `2026-09-22T00:15:49Z`.
- macOS CI, production pkg (artifact `smoke-installed-macos-production`, 10672060046): `SMOKE OK: /Applications/translationCore4.app/Contents/Resources under HOME=/Users/runner/work/_temp/smoke-home, store /Users/runner/work/_temp/smoke-home/pankosmia/tc4-projects`. Built `2026-09-22T00:16:16Z`.
- macOS CI, zip fallback (artifact `smoke-installed-macos-fallback`, 10672025081): `SMOKE OK: .../install/translationCore4/translationCore4.app/Contents/Resources under HOME=/Users/runner/work/_temp/smoke-home, ...`.
- macOS CI, debug zip (artifact `smoke-installed-macos-debug`, 10671995040): `SMOKE OK: .../translationCore4 DEBUG.app/Contents/Resources ...`; `/api/version` `4.0.0-alpha.7-debug`.
- Windows CI, installer (artifact `smoke-installed-windows-x64`, 10671740842): `SMOKE OK: C:\Users\runneradmin\AppData\Local\Programs\tC4 Installed Smoke under USERPROFILE=D:\a\_temp\tC4 Pilot Profile; store D:\a\_temp\tC4 Pilot Profile\pankosmia\tc4-projects` twice (install and reinstall). `ok version: /api/version matches lib/product/product.json (4.0.0-alpha.7, 09/22/2026 00:17:43)` on each start. Built `2026-09-22T00:17:43Z`.

**#206:** the launcher logs `tc4-smoke-first.log` and `tc4-smoke-second.log` of the Linux
job and of the three macOS jobs each carry one `Server Failed to stop - process ID kill
failed` line, eight lines in the run. Each stop completed: the script's own checks confirm
the processes exited and port 19119 stopped answering. The Windows logs carry none. #206
stays open (Increment 9).

## Offline run (#43)

**Method:** the procedure in `docs/PACKAGING.md`, "The offline run", including step 9b.
Debian GNU/Linux 13 (trixie) x86_64 (Grok Bot box). Linux artifact above, unpacked under
`/workspace/tc4-a7-358/app/translationCore4`. Network off by `unshare -rn` with
`ip link set lo up` around `./start-tc4.sh` (loopback only). Isolation check: from outside
the namespace, `curl http://127.0.0.1:19119/` answered nothing (`000`); inside the
namespace, `curl https://example.com` failed to resolve. Fresh
`HOME=/workspace/tc4-a7-358/home-offline`. Served client `index-sM7ONWt_.js`, sha256
`1b0d245e924da712ace121907df1612f7135831180604b998f0a3d6ec357311c`, matching disk;
`/api/version` `4.0.0-alpha.7` / `2026-09-22T00:15:49Z` matching `lib/product/product.json`.
Run and reported by Tessa (end-user QA), 2026-09-21 America/Los_Angeles (2026-09-22 UTC).
Screenshots under the QA box at `/workspace/tc4-a7-358/qa/screenshots/`.

**Result:** PASS under the tag rule. Every step reached its expected result or named its
open issue.

| Step | Result |
|---|---|
| 1 Start the app | PASS, Home (“Your Bibles”), Electron, no error banner |
| 2 New Bible, blank Titus, `Create Bible →` | PASS, “Offline Alpha7 Bible” (`es`); Titus opens in Translate |
| 3 Understand | PASS, English helps show for chapter 1 |
| 4 Translate | PASS, source pane shows ULT/UST text |
| 5 Draft verse 1, `Saved` | PASS (`Offline alpha7 verse one.`) |
| 6 Check, Translation Notes, one item `Mark valid` | PASS, `1 of 157 resolved`; no Unavailable offline |
| 7 Align, one word into a card | PASS, word `Offline` into the Paul (Παῦλος) card; Greek present |
| 8 Leave and reopen; draft, decision, alignment persist | PASS, all three still there after Switch project and reopen |
| 9 Export | SKIP, #19 not built |
| 9b New OBS → draft frame 1 → Understand → Check | PASS, “Offline Alpha7 OBS” (`es`); story 1 gateway text and frame-1 picture from bundled `en_obs` + picture pack with network off; frame drafted (`Offline alpha7 OBS frame one.`); Understand notes and word links; TN `1 of 91 resolved` |
| 10 Quit, network on | PASS, clean window close (Electron gone); isolation was process-level so host network was never disabled |

No screen named a missing resource on the source panes, the Translation Notes card, Align,
or the OBS gateway/picture path. OBS Understand briefly showed story-title helps until
frame 1 content was selected; then frame notes and word links appeared (same observation
as earlier alpha.7 Linux OBS QA; not treated as FAIL).

**Limits:** one platform ran offline (Linux). macOS and Windows were not run offline. Local
`smoke-installed.zsh` under a fresh HOME was started before the offline session; CI
`smoke-linux-x64` on this artifact already ends in `SMOKE OK`. Host `ping 1.1.1.1` was not
available (`ping: not found`); namespace isolation was checked via failed outbound curl and
host inability to reach the namespaced server port.

## Clean-clone counts

`docs/evidence/manifest.json` on `main` (push-event CI run of `b835c41`): vitest all
passed, none failed (the passed and skipped counts are not written in a document, D77 and
D78; read them from the `prove-manifest` artifact of `ci` run 35671067435 on the release
commit, success); format conformance 48/48; journal suite 350/350; normative rules 91/91. The four OBS journeys
J20, J21, J22 and J25 ran green on a local rig (PRs #320, #322, #323, #345); they do not
run in CI.

[VERIFIED — run 35671067386 on `main` 95238c3; artifact listing, downloads and smoke logs
read 2026-09-22; offline run (steps 1–10 + 9b) reported by Tessa, 2026-09-21 PT]
