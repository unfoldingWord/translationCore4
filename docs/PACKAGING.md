# Desktop packaging (#57)

This document records the build recipe for the unsigned desktop artifact.
Issue #44 extends this recipe. It must not replace it.

## What the pipeline does

`scripts/package-desktop.zsh` builds one unsigned macOS artifact.
`.github/workflows/package-desktop.yml` runs the script on every merge to
`main` and uploads the zip as a workflow artifact.

The recipe follows the Pankosmia
[desktop-app-template](https://github.com/pankosmia/desktop-app-template)
(MIT). The template is a read-only reference. Do not open issues or pull
requests there.

Steps, in order:

1. Build the tC4 client (`npm run build` → `dist/`).
2. Build the pinned server (`dev-env/server`, pankosmia-web 0.18.5, rev
   `99fd9be` — D27).
3. Clone read-only inputs: the desktop template (pinned rev), `resource-core`,
   and `webfonts-core`.
4. Assemble the app directory. The layout comes from the template:
   - `electron/` — the template's Electron startup files, with
     `puppeteer-core` and `@puppeteer/browsers` installed (the startup script
     imports them).
   - `bin/server.bin` — the pinned server binary.
   - `lib/` — `app_resources` (from `resource-core/runtime_resources`),
     `templates`, `webfonts`, `clients/uw-tc4` (the client build plus the
     three `rig/` registration files), `setup/`, and `product/product.json`
     with `"homepage": "uw-tc4"` (PLATFORM-NOTES #25).
   - `Rocket.toml` — upload limits (PLATFORM-NOTES #26a).
5. Stage the artifact: Electronite + app dir + license files +
   `THIRD-PARTY-NOTICES.md` + `BUILD-MANIFEST.json` (every input with its
   exact version, commit, and checksum — also echoed in the build log).
6. Smoke test **through the shipped entry point**: run `start-tc4.command`
   with a fresh `HOME` and no app-specific environment overrides. The app
   must self-spawn its bundled server (first free port from 19119) and serve
   `303` from `/` to `/clients/uw-tc4`, then `200` from the client page. The
   working directory must appear under the fresh `$HOME/pankosmia/tc4`.
7. Zip.

## The wrapper is Electronite [VERIFIED — desktop-app-template 4cb7576, 2026-08-14]

The desktop template does not use plain Electron. Its install scripts download
prebuilt **Electronite v37.1.0-graphite** binaries from
`github.com/unfoldingWord/electronite` releases, for all three OSes and both
architectures. This satisfies D20 (Graphite-enabled wrapper). Evidence:
`macos/install/makeAllInstallsElectronite.sh` lines 56–57 in the template.

Graphite font shaping in the packaged app is not proven yet. That proof is the
second acceptance item of #32.

## Pins

| Input | Pin | Where |
|---|---|---|
| pankosmia-web | 0.18.5, rev `99fd9be` | `dev-env/server/Cargo.toml` |
| Electronite | `v37.1.0-graphite`, zip sha256 verified (`a3dde44e…f59488` for darwin-arm64) | `scripts/package-desktop.zsh` |
| desktop-app-template | `4cb7576` | `scripts/package-desktop.zsh` |
| resource-core | `54802be780af18ab02e426dd59014bc6adb158af` | `scripts/package-desktop.zsh` |
| webfonts-core | `eb52ccdad6806b5729ea8b45b1c59c793ffa32c3` | `scripts/package-desktop.zsh` |
| puppeteer-core / @puppeteer/browsers | `24.43.1` / `2.13.1`, exact; lockfile ships in the artifact (`electron/package-lock.json`) | `scripts/package-desktop.zsh` |

Every artifact carries `BUILD-MANIFEST.json` at its root with the same data.

## Known limits (start of the pipeline, not the end)

- **One OS**: macOS arm64 only. #44 adds Linux, Windows, x64, and signing.
- **Minimal client set**: the artifact bundles only `uw-tc4`. The core
  Pankosmia clients (dashboard, content, workspace, content handlers) are not
  bundled. Reason: the template builds them from source at branch tiers
  (`main` tier pins pankosmia_web 0.16.20; `dev` tier 0.18.7), and no tier is
  proven compatible with our 0.18.5 rev pin. The server panics at boot on a
  `minServerVersion`/`maxServerVersion` mismatch (`bootstrap.rs` version
  check). Picking and proving a client set is issue
  [#71](https://github.com/unfoldingWord/translationCore4/issues/71).
- **Unsigned**: macOS Gatekeeper blocks the app on a clean machine.
  Right-click → Open, or `xattr -dr com.apple.quarantine`, is required.
  Signing is #44.
- **Archive structure diverges from the template**: the spike ships a plain
  folder (`Electron.app` + `electron/` + `bin/` + `lib/` + a
  `start-tc4.command` launcher). The template instead builds a single
  self-contained `<App>.app` bundle and wraps it in a `.pkg` installer
  (`macos/install/makeInstallElectronite.sh`: payload `APP_NAME.app`, a
  `Contents/MacOS` launcher script, `pkgbuild`). The divergence is deliberate
  for the spike — it keeps the recipe inspectable and avoids the installer
  toolchain before signing exists. #44 MUST converge on the template's
  app-bundle + installer structure.
- **Shared project store** (corrected 2026-08-14 — the earlier "demo seed
  data" claim was wrong, see the evidence record): a fresh HOME starts with
  NO projects. The default `user_settings.json` sets `repo_dir` to
  `$HOME/pankosmia_repos`, so the packaged app reads and writes a project
  store shared with every other Pankosmia desktop app on the machine. The
  pilot decision is issue
  [#70](https://github.com/unfoldingWord/translationCore4/issues/70).

## Evidence

Witnessed boots (rig and packaged artifact, with screenshots):
`docs/evidence/desktop-packaging-spike-2026-08-14.md`.
