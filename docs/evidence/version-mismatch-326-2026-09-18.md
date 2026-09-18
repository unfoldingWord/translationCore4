# Version mismatch #326 — artifact inventory, 2026-09-18

Issue: on the Windows QA PC, a v4.0.0-alpha.7 unpack reported
`product_version` `4.0.0-alpha.6`, `product_date_time` `2026-09-14T14:57:56Z`
from `GET /api/version`, while its `lib/product/product.json` said
`4.0.0-alpha.7`, `2026-09-18T15:22:25Z`.

## Artifact inventory (this record)

Date: 2026-09-18. Method: downloaded Actions run `35361699629` artifact
`tC4-4.0.0-alpha.7-windows-x64-unsigned.zip` (id `10555436147`, 232031456
bytes) through the API and listed its entries with Python `zipfile`
(`C:\Users\ADMINI~1\AppData\Local\Temp\opencode\inspect-a7.py`, scratch copy,
not retained in the repository).

- Total entries: 22300.
- Files ending in `product.json`: exactly one —
  `translationCore4/lib/product/product.json`, content
  `{ "short_name": "tc4", "name": "translationCore4", "version":
  "4.0.0-alpha.7", "datetime": "2026-09-18T15:22:25Z", "homepage": "uw-tc4" }`.
  No `lib/app_resources/product/product.json` shadow copy exists in the zip.
- `translationCore4/BUILD-MANIFEST.json`: `built_utc` `2026-09-18T15:22:25Z`;
  `pankosmia_web_server` `0.18.5`, rev
  `99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a`, `bin_sha256`
  `669f29798704cc411d90f7a95518bb03a7e102b3eea32b6a9c9a302d81724959`.
- `translationCore4/bin/server.exe` sha256 from the zip:
  `669f29798704cc411d90f7a95518bb03a7e102b3eea32b6a9c9a302d81724959`
  — matches the manifest.

## Mechanism (source read, same date)

- `GET /api/version` returns `state.product.version` / `state.product.date_time`
  [VERIFIED — pankosmia-web 0.18.5 (`99fd9be`, 2026-07-30),
  `src/endpoints/version.rs:47-56`], loaded once at boot from `product.json`
  into `ProductSpec` (`src/utils/launch.rs:288-294`).
- The boot path is `binary_parent_dir/lib/app_resources/product/product.json`
  (two levels above `bin/server.exe`), else
  `$APP_RESOURCES_DIR/product/product.json`
  [VERIFIED — pankosmia-web 0.18.5 (`99fd9be`),
  `src/lib.rs:36-68`]. The recipe never writes the primary path (only
  `lib/product/product.json`, `scripts/package-desktop.zsh:370-372`, unchanged
  since the #57 spike), so a fresh unpack always resolves to the stamped file.
- The reported version therefore never comes from the binary: a stale
  `server.exe` cannot produce a stale version string. The cached-cargo
  (stale-binary) hypothesis is refused by this reading and by the manifest
  hash match above.

## Verdict

The artifact is clean: one `product.json` (alpha.7), server hash as
manifested. A fresh unpack launched through its own entry point must report
alpha.7, as the Linux artifact of the same run did. The Sep-14 answer came
from machine state on the QA PC — the answering process was not serving the
fresh a7 tree. Known candidates, in order: a leftover a6 server still
listening on port 19119 (the launcher scans 19119–19139 and skips an
answering port, while the manual probe went to hardcoded 19119), or a
stray `APP_RESOURCES_DIR` in the process environment (the template default
is `./lib/`, `electronStartup.js:50` at template rev `4cb7576`).
Retest discriminators are on issue #326.

## Guard added (same change set)

The acceptance criterion was unguarded: no smoke compared the live version
to the staged file. The build-time smoke (`scripts/package-desktop.zsh`),
the Windows post-install proof (`scripts/smoke-installed.ps1`) and the
macOS/Linux post-install proof (`scripts/smoke-installed.zsh`) now fail
when `product_version`/`product_date_time` differ from the artifact's own
`lib/product/product.json`. `docs/PACKAGING.md` ("Smoke tests", "What it
proves") records the new proof on both columns.

## Limits

- This record does not name which machine-state candidate fired: the QA box
  was not re-measured in this session. The retest on #326 carries that step.
- The new guards run in CI on the next `package-desktop` run, not in this
  session (this Windows box has no zsh/MSYS2 build chain; the guard logic
  was exercised against fixtures with a positive and a negative control —
  see the pull request description).
