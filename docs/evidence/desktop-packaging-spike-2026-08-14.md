# Desktop packaging spike — witnessed boots (2026-08-14)

Evidence record for issues
[#57](https://github.com/unfoldingWord/translationCore4/issues/57),
[#32](https://github.com/unfoldingWord/translationCore4/issues/32) (first
acceptance item) and [#8](https://github.com/unfoldingWord/translationCore4/issues/8).
Machine: macOS arm64 (Darwin 25.5.0). Date: 2026-08-14.

## 1. The wrapper is Electronite [VERIFIED]

Source: `pankosmia/desktop-app-template` at `4cb7576` (2026-08-14, read-only
clone). The install scripts download prebuilt Electronite binaries:

- `macos/install/makeAllInstallsElectronite.sh:56-57` →
  `github.com/unfoldingWord/electronite/releases/download/v37.1.0-graphite/electronite-v37.1.0-graphite-darwin-{arm64,x64}.zip`
- `linux/install/makeAllInstallsElectronite.bsh:56-57` → linux arm64/x64
- `windows/install/makeAllInstallsElectronite.ps1:51` → win32 arm64 (and x64)

There is no Electron npm dependency. See PLATFORM-NOTES #32.

## 2. Witnessed boot — Electronite window on the dev rig (#8)

Procedure: assemble the template app layout (`electron/`, `bin/server.bin`,
`lib/`, `Rocket.toml`); run the rig server (pankosmia-web 0.18.5, 99fd9be,
port 19998, `product.json homepage=uw-tc4`); launch the Electronite binary
with `START_SERVER=false ROCKET_PORT=19998`.

Result: the window loaded `http://127.0.0.1:19998/clients/uw-tc4`. Page title:
`translationCore 4`. The page shows "Your Bibles" with the seeded project
(`Equipo Ejemplo — Tito y Jonás`, Jonah 2%, Titus 11%). A book chip on the
landing surface opens the project — one click. CDP reported
`Chrome/138.0.7204.35` (Electronite v37.1.0-graphite).

Screenshot: `desktop-boot-rig-electronite-2026-08-14.png` (captured through
the window's own CDP endpoint).

## 3. Witnessed boot — the packaged artifact through its own entry point

Procedure (the script's step 6/7 does the same on every build): stage the
artifact; run its shipped `start-tc4.command` (→ Electronite →
`electronStartup.js`) with a **fresh, empty `HOME`** and **no app-specific
environment overrides**. The app must self-spawn its bundled server.

Results (2026-08-14, run log `== 6/7`):

- The app self-spawned the server on port 19119 (electronStartup's own
  free-port scan).
- `GET /` → `303` to `/clients/uw-tc4`; `GET /clients/uw-tc4` → `200`.
- The working directory was created inside the fresh HOME at
  `$HOME/pankosmia/tc4` — nothing was written to the real home.
- Visual witness (same launch path, plus only a `--remote-debugging-port`
  debug flag for the screenshot): the window rendered `/clients/uw-tc4` with
  "Your Bibles — No projects yet. Select New Bible to start." Screenshot:
  `desktop-boot-entrypoint-fresh-home-2026-08-14.png`.

**Scope of this proof, stated plainly:** this is a fresh-`HOME` simulation on
the development machine. It proves the shipped entry point self-starts the
server and lands on the tC4 client with zero configuration. It does NOT prove
the install experience on a genuinely clean machine or account — Gatekeeper
handling of the unsigned artifact, and any dependence on tools present on a
developer machine, are unmeasured. **#57's "installs on a clean machine"
criterion therefore remains OPEN.**

### Correction (same day): the "demo seed projects" claim was wrong

An earlier version of this record claimed a fresh working directory is
"seeded with demo projects from `resource-core/templates`". That was a
misreading of a non-isolated run. The projects seen in
`desktop-boot-artifact-electronite-2026-08-14.png` (`POC Verify Bible`,
`Ben tst`, `test_fr`, ULT) were the developer's own pre-existing repos: the
default `templates/user_settings.json` sets `repo_dir` to
`%%HOMEDIR%%/pankosmia_repos`, and that run inherited the real `$HOME`. A
truly fresh `HOME` shows "No projects yet" (screenshot above), and its
`pankosmia_repos` starts empty. The real finding for the pilot decision
(issue #70): **the packaged app reads and writes `$HOME/pankosmia_repos`, a
directory shared with every other Pankosmia desktop app on the machine.**

## 4. Minimal client set boots [VERIFIED]

A server (0.18.5) with ONLY `uw-tc4` in `app_setup.json` and
`homepage=uw-tc4` boots without a panic and lands on the client. This is the
basis for the minimal CI artifact (see `docs/PACKAGING.md`, known limits).
