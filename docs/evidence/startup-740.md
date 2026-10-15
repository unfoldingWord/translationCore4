# First-launch resource preparation (#740)

[decided 2026-10-15 — owner, issues #740 and #751] Ship resource archives,
verify their entries in memory, write each destination file once, and retain
compact lexicons in the user store. The installer and persistent-store location
stay unchanged. Existing developer/tester installs keep their data and pins;
expanded lexicons get independently verified compact siblings.

## Local evidence, 2026-10-15

[VERIFIED — working implementation on `codex/740-archive-startup`, based on
PR #742 `11437da` merged with main `c897aca`; macOS arm64, Node 22.14.0]
The production `stageResource` function was run against all sixteen real cached
resource pins from `scripts/package-desktop.zsh`. The resulting manifest and
archives were passed to the production bootstrap with a temporary profile.
The tagged cache provenance was reconstructed only after its metadata matched
the independently pinned repo and SHA; sha-only archives used their existing
verified build-cache provenance. No production profile was used.

| Resource payload | Files |
|---|---:|
| Original expanded source files | 17,872 |
| Resource files presented to the installer | 16 archives |
| Files published into the new persistent store | 3,792 |

The staged archives totalled 319,677,762 bytes. Compact lexicons retain all
source file bytes inside `ingredients/source.zip`; the outer metadata and
identity receipt describe the stored representation. This is a filesystem
operation reduction, not a large download-size reduction.

| Preparation only | Archive reads | Ingredient reads | Ingredient writes | Time |
|---|---:|---:|---:|---:|
| Empty profile | 16 | 0 | 3,739 | 2,794.7 ms |
| Repeat | 0 | 0 | 0 | 41.0 ms |
| Existing compact resources, verification ledger removed | 0 | 3,739 | 0 | 863.1 ms |

These are local timings with warm build inputs, not Windows predictions. The
baseline probe on PR #742 took 7,687.3 ms on this Mac, with 35,644 ingredient
reads and sixteen recursive copies. The new path does no recursive resource
copy and verifies entries before writing them. Existing DCS exports are checked
against their own inventories with bounded asynchronous reads, preserving the
same-revision TWL drift policy from #640.

[VERIFIED — staged Electronite 37.1.0-graphite app, pinned server 0.18.15
`a83725b`, pinned template `4cb7576`, macOS arm64, 2026-10-15]
Launching the actual staged app through Playwright's Electron adapter with an
empty temporary home reached a visible, enabled `Add a project` button in
5,143.0 ms. Clicking it displayed the New Bible choice. Closing the app released
its owned server's port 19119. Native Close during the preparation window also
exited the app; relaunch using that same temporary home reached usable Home in
6,411.2 ms and released its server port on close. The debugger/automation launch
is included in these timings; these are not installed Windows shortcut timings.

The final staged app reached usable Home in 2,185.7 ms on repeat launch. An
upgrade witness was prepared with the old PR #742 bootstrap, all sixteen
expanded resources, and no verification ledger. The new app reached usable
Home in 2,517.5 ms. Both runs opened the New Bible choice and released their
owned server port on close. After upgrade, all 17,875 old installed files were
byte-identical, the extra preference survived, and the old expanded lexicons
had no new verification records. The compact siblings were recorded separately.

`npm run verify` passed with `RIG_REPOS` pointing to the running test rig's
actual `dev-env/state/work/repos` directory. The full macOS `--zip` packaging
recipe passed its API, singleton, isolation, restart and journal-lifecycle smoke
checks and produced an unsigned arm64 artifact. Windows and Linux were not run.

[VERIFIED — local rig, pankosmia-web 0.18.15 `a83725b`, 2026-10-15]
A compact Greek lexicon was imported through the existing
`POST /burrito/zipped/<repo>` endpoint into a new temporary sideloaded path.
The metadata retained the archive inventory. The existing
`GET /burrito/ingredient/bytes/<repo>?ipath=source.zip` returned the nested
archive byte-for-byte; it contained all 5,410 source entries. The probe copy
was deleted afterward. The binary endpoint takes a path relative to the
resource's `ingredients/` directory; the text `raw` endpoint is unsuitable for
ZIP bytes. A future #703 reader can use the existing binary endpoint.

Automated checks exercise corrupt archive hashes, damaged/missing entries,
unsafe paths, incorrect revisions, failed writes, settings publication failure,
process interruption before and after resource publication, retry, old releases,
same-revision inventory drift, compact source-byte preservation, runtime download
format, worker failure, cancellation and window handoff.

## Reproduce and complete the release gate

```sh
npm run verify
zsh scripts/package-desktop.zsh --zip
```

`scripts/desktop-prepare.test.cjs` builds and runs the packaged worker without
checkout dependencies. The package recipe launches the real staged application,
checks singleton behavior and persistent-store isolation, and exercises its
Bible/OBS APIs and real journal lifecycle. Those checks do not establish a usable
Home timing on an installed Windows machine.

Still required: a signed installed Windows build, Defender enabled, measured on
the reporter's hardware from shortcut click to visible, usable Home. Record
empty-profile and first-after-upgrade results separately; each must be under
60 seconds. Then test repeat launch, Close during preparation, immediate
relaunch, owned-server port release, and resource upgrade/recovery on Windows
and Linux. Keep existing project data when preparing an upgrade witness. Do not
mark the issue complete from the preparation benchmark or the Mac witness.
