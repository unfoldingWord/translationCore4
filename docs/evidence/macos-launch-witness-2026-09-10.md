# macOS launch witness — issue #243, PR #251 (2026-09-10)

Owner's Mac, not the clean macOS 15 witness the issue requires. Host: macOS
26.5.1 (25F80), arm64, a developer machine that also held the earlier flat zip
and the June Pankosmia prototype (`pankosmia.translationcore-4` 1.0.0-rc2).

Artifact: run 34531768672, artifact 10174098642,
`tC4-4.0.0-alpha.5-macos-arm64-unsigned.pkg`, 175235973 bytes, SHA-256
`359f3158382a373b7ece2b2215ad9ac930416a3f33738fc3e217e9f0bf28767f` (matched).
Downloaded in Chrome, so the quarantine flag was real. PR #251 merged as
`4760df9`. Screenshots were taken every 4 s across the run; the poll log and
command outputs below are the record.

## Results

| Step | Result |
|---|---|
| Double-click the quarantined pkg in Finder | Gatekeeper block. Privacy & Security, Open Anyway, a second dialog, Run anyway: Installer never started. `/var/log/install.log` has no Installer entry. A scripted `open` of the same file fails with error -128 and no dialog. `spctl -a -t install` reports `rejected, source=no usable signature` (expected for an unsigned pkg). |
| Same pkg after `xattr -d com.apple.quarantine <pkg>` | Installer opened at once with the README page; admin password; "Install Succeeded" after 12.5 s (20:56:35 local). |
| First launch from Applications | Home at 20:57:22, no Gatekeeper prompt. |
| `codesign --verify --deep --strict` on the installed app; `--strict` on `Contents/MacOS/server.bin` | both valid; ad-hoc; identifier `org.unfoldingword.translationcore4` |
| Receipt (`pkgutil --pkg-info`) | `org.unfoldingword.translationcore4` 4.0.0, volume `/`, location Applications |
| Server | port 19119; `/` 303 to `/clients/uw-tc4`; client 200; `/api/version` reports `product_version` 4.0.0-alpha.5 |
| Second launch (#4) | one server, one Electron main process, no new port |
| Store seed (#163, #70) | ten resources under `~/pankosmia/tc4-projects/_local_/_sideloaded_/` |
| Icon | installed `Contents/Resources/electron.icns` hash equals `branding/icon.icns`; the Dock was auto-hidden in every capture, so the Dock render is not on film |

Approval count on this machine: after the quarantine clear, zero Gatekeeper
prompts across install and first launch (plus the admin password). With the
README as it stood (Open Anyway only), the install did not complete.

## Consequence

`scripts/README-macos.txt` now gives the `xattr -d com.apple.quarantine`
command for the pkg under INSTALL step 1. Whether macOS 15 behaves the same is
unverified; the clean macOS 15 witness stays required before #243 closes.
