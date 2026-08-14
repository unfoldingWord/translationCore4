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

## 3. Witnessed boot — the packaged artifact

Procedure: run `scripts/package-desktop.zsh` (exit 0). Unzip
`tC4-4.0.0-alpha.2-macos-arm64-unsigned.zip` (141 MB zip, 372 MB unpacked)
into a fresh directory. Start the bundled `bin/server.bin` with an isolated
working directory. Launch the bundled Electronite.

Results:

- Script smoke test: `GET /` → `303` to `/clients/uw-tc4`; `GET
  /clients/uw-tc4` → `200`.
- The artifact's window loaded `/clients/uw-tc4` and rendered the project
  list. Screenshot: `desktop-boot-artifact-electronite-2026-08-14.png`.
- Surprise, recorded per #57: a fresh working directory is seeded with demo
  projects from `resource-core/templates` (`POC Verify Bible`, `Ben tst`,
  `test_fr`, `unfoldingWord® Literal Text`, 66 books). A pilot build must
  decide whether to keep, replace, or strip these seeds.

Isolation note: both boots used an explicit working directory and
`START_SERVER=false` + an already-running bundled server, to keep `$HOME`
clean. The shipped launcher starts the server itself; the server then creates
its default working directory. The full launcher path on a clean machine is
the remaining #57 acceptance step (with Gatekeeper handling, since the
artifact is unsigned).

## 4. Minimal client set boots [VERIFIED]

A server (0.18.5) with ONLY `uw-tc4` in `app_setup.json` and
`homepage=uw-tc4` boots without a panic and lands on the client. This is the
basis for the minimal CI artifact (see `docs/PACKAGING.md`, known limits).
