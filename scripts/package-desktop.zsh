#!/bin/zsh
# Build an UNSIGNED desktop artifact for tC4: macOS arm64 (#57), Linux x64 (#119).
#
# The recipe follows the Pankosmia desktop-app-template (read-only reference,
# MIT license). The wrapper is Electronite v37.1.0-graphite, the Graphite-enabled
# Electron fork from unfoldingWord (D20). The artifact is minimal for now: it
# bundles ONLY the uw-tc4 client (#71), the pinned server (pankosmia-web 0.18.5,
# 99fd9be), and the runtime resources. See docs/PACKAGING.md.
#
# The smoke test launches the STAGED ARTIFACT THROUGH ITS OWN ENTRY POINT
# (the start-tc4 launcher -> Electronite -> electronStartup.js), with a fresh HOME
# and no app-specific environment overrides. The app must self-spawn its
# bundled server and serve the tC4 client (303 from /, 200 from
# /clients/uw-tc4) before the zip is written.
#
# Usage: zsh scripts/package-desktop.zsh [--debug]
#   (no flag)  production variant: isolated EMPTY project store.
#   --debug    debug/demo variant: separate debug-only store, seeded with the
#              conformance sample burrito on first launch, visibly marked
#              (app name + version suffix).
#
# Project-store isolation (#70, owner ruling 2026-08-14): the packaged app
# NEVER uses the platform default $HOME/pankosmia_repos (shared with every
# other Pankosmia desktop app). The shipped user_settings template pins
# repo_dir to a tC4-owned path, and the smoke test FAILS the build if the
# booted app resolves repo_dir to the shared store — both variants.
#
# Output: dist-desktop/tC4-<version>[-debug]-<os>-<arch>-unsigned.zip
#
# Requirements: node >= 20, npm, cargo, curl, unzip, git, and sha256sum or shasum.
#   Linux also needs zsh, the zip command, Electron's shared libraries, and a
#   display for the smoke test. CI runs the script under `xvfb-run -a` (#119).
set -e

REPO=${0:a:h:h}
BUILD="$REPO/dist-desktop"
PACK="$BUILD/pack"
ARCH=$(uname -m | sed 's/x86_64/x64/')
VERSION=$(node -p "require('$REPO/package.json').version")

# Build host (#119). OS names the artifact; EL_OS names the Electronite asset.
case "$(uname -s)" in
  Darwin) OS=macos; EL_OS=darwin ;;
  Linux)  OS=linux; EL_OS=linux  ;;
  *) echo "Unsupported build host '$(uname -s)' — macOS and Linux only." >&2; exit 1 ;;
esac

# Portable helpers: the two hosts differ on these two tools.
sha256_of() {    # coreutils on Linux, BSD shasum on macOS
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sed_inplace() {  # BSD sed demands an empty backup suffix; GNU sed refuses one
  local expr=$1; shift
  if [ "$OS" = macos ]; then sed -i '' "$expr" "$@"; else sed -i "$expr" "$@"; fi
}

# Build variant (#70).
VARIANT=production
[ "$1" = "--debug" ] && VARIANT=debug
if [ "$VARIANT" = "debug" ]; then
  STORE_LEAF="pankosmia/tc4-projects-debug"   # separate debug-only store
else
  STORE_LEAF="pankosmia/tc4-projects"         # production store, starts empty
fi
# Resolved at runtime as $HOME/$STORE_LEAF. The store sits BESIDE the server
# working dir ($HOME/pankosmia/tc4), never inside it: pre-creating anything
# inside the working dir before first boot makes the server skip first-boot
# initialization and panic on the missing app_state.json (measured while
# building this — the debug seeder hit exactly that).

# Pins. Change them together with docs/PACKAGING.md.
ELECTRONITE_TAG="v37.1.0-graphite"
ELECTRONITE_SHA256_MACOS_ARM64="a3dde44e03a076bc778f952f7a7a5ed6d8e5037d46ea6c1ba2deb6a11df59488"
ELECTRONITE_SHA256_LINUX_X64="41218aa3cd79f3449cfc360384ad4ef6064fe871e4c40a38ae859f2ddd8f8540"
TEMPLATE_REPO="https://github.com/pankosmia/desktop-app-template.git"
TEMPLATE_REV="4cb757601b9310b3fccd52f77a6ae2238ceec9f4"   # 2026-08-14
RESOURCE_CORE_REPO="https://github.com/pankosmia/resource-core.git"
RESOURCE_CORE_REV="54802be780af18ab02e426dd59014bc6adb158af"   # 2026-08-14
WEBFONTS_CORE_REPO="https://github.com/pankosmia/webfonts-core.git"
WEBFONTS_CORE_REV="eb52ccdad6806b5729ea8b45b1c59c793ffa32c3"   # 2026-08-14
PUPPETEER_CORE_VER="24.43.1"       # template package.json: ^24.43.1
PUPPETEER_BROWSERS_VER="2.13.1"    # template package.json: ^2.13.1

APP_NAME="translationCore4"
if [ "$VARIANT" = "debug" ]; then
  # Ruling clause 3: a debug build must be visibly distinguishable.
  APP_NAME="translationCore4 DEBUG"
  VERSION="$VERSION-debug"
fi

# Pin one checksum per artifact platform. A new platform needs its checksum
# recorded above first.
case "$OS-$ARCH" in
  macos-arm64) ELECTRONITE_SHA256="$ELECTRONITE_SHA256_MACOS_ARM64" ;;
  linux-x64)   ELECTRONITE_SHA256="$ELECTRONITE_SHA256_LINUX_X64"   ;;
  *) echo "No recorded Electronite checksum for platform '$OS-$ARCH' — record one first." >&2
     exit 1 ;;
esac

echo "== 1/7 build the tC4 client"
cd "$REPO"
npm ci --no-audit --no-fund
npm run build

echo "== 2/7 build the pinned server (pankosmia-web 0.18.5, 99fd9be)"
cd "$REPO/dev-env/server"
cargo build --release

echo "== 3/7 fetch read-only build inputs (pinned)"
mkdir -p "$BUILD/upstream"
fetch_pinned() {  # $1 repo url, $2 dir, $3 rev
  if [ ! -d "$2/.git" ]; then
    git clone --quiet "$1" "$2"
  else
    git -C "$2" fetch --quiet origin
  fi
  git -C "$2" checkout --quiet "$3"
}
fetch_pinned "$TEMPLATE_REPO"      "$BUILD/upstream/desktop-app-template" "$TEMPLATE_REV"
fetch_pinned "$RESOURCE_CORE_REPO" "$BUILD/upstream/resource-core"        "$RESOURCE_CORE_REV"
fetch_pinned "$WEBFONTS_CORE_REPO" "$BUILD/upstream/webfonts-core"        "$WEBFONTS_CORE_REV"

ELECTRONITE_ZIP="electronite-$ELECTRONITE_TAG-$EL_OS-$ARCH.zip"
if [ ! -f "$BUILD/$ELECTRONITE_ZIP" ]; then
  echo "== downloading Electronite $ELECTRONITE_TAG $EL_OS-$ARCH"
  # --fail --retry: a silent truncation here reaches the checksum test below
  # as a mismatch, which reads like a bad pin. Fail at the download instead.
  curl -sL --fail --retry 5 --retry-all-errors -o "$BUILD/$ELECTRONITE_ZIP" \
    "https://github.com/unfoldingWord/electronite/releases/download/$ELECTRONITE_TAG/$ELECTRONITE_ZIP"
fi
ACTUAL_SHA=$(sha256_of "$BUILD/$ELECTRONITE_ZIP")
if [ "$ACTUAL_SHA" != "$ELECTRONITE_SHA256" ]; then
  echo "Electronite checksum mismatch: expected $ELECTRONITE_SHA256, got $ACTUAL_SHA" >&2
  exit 1
fi
echo "Electronite sha256 OK: $ACTUAL_SHA"
# macOS ships an app bundle; Linux ships a flat directory with an `electron`
# binary. Both unpack into $BUILD/electronite, and both put LICENSE and
# LICENSES.chromium.html at that root.
if [ "$OS" = macos ]; then EL_UNPACKED="$BUILD/electronite/Electron.app"
else                       EL_UNPACKED="$BUILD/electronite/electron"; fi
if [ ! -e "$EL_UNPACKED" ]; then
  mkdir -p "$BUILD/electronite"
  unzip -qq -o "$BUILD/$ELECTRONITE_ZIP" -d "$BUILD/electronite"
fi

echo "== 4/7 assemble the app directory"
rm -rf "$PACK"
mkdir -p "$PACK/bin" "$PACK/lib/setup" "$PACK/lib/clients/uw-tc4" "$PACK/lib/product"

T="$BUILD/upstream/desktop-app-template"
cp -R "$T/buildResources/electron" "$PACK/electron"
cp "$T/globalBuildResources/favicon.png" "$PACK/electron/"
sed_inplace "s/\${APP_NAME}/$APP_NAME/g; s/\${APP_VERSION}/$VERSION/g" \
  "$PACK/electron/electronStartup.js" "$PACK/electron/package.json"
# Runtime deps of electronStartup.js (template package.json dependencies),
# pinned exactly; the lockfile ships inside the artifact.
cd "$PACK/electron"
npm install --no-audit --no-fund --save-exact \
  "puppeteer-core@$PUPPETEER_CORE_VER" "@puppeteer/browsers@$PUPPETEER_BROWSERS_VER"

# #4 single instance (D39). The template launcher carries NO
# requestSingleInstanceLock (verified on the shipped artifact, 2026-08-25),
# and a second launch actively creates the D39 hazard: the free-port scan
# just moves to the next port and spawns a SECOND server over the same
# project store. A tiny tC4-owned main wrapper acquires Electron's singleton
# lock BEFORE the template startup loads, so a refused second launch exits
# without a window or a server, and the first window is focused instead.
# The patch refuses to run if the template's entry point changed shape
# (same discipline as the #70 repo_dir patch).
TEMPLATE_MAIN=$(node -p "require('$PACK/electron/package.json').main")
[ "$TEMPLATE_MAIN" = "electronStartup.js" ] || {
  echo "FATAL: template electron main is '$TEMPLATE_MAIN' (expected electronStartup.js) — re-verify the #4 single-instance wrapper before building" >&2
  exit 1
}
if [ -n "$TC4_TEST_NO_SINGLE_INSTANCE" ]; then
  # TEST-ONLY (the #70 guard-self-test pattern): skip the wrapper so the #4
  # smoke guard's FAILURE path can be exercised. A build with this set MUST
  # fail at the guard.
  echo "TEST-ONLY: TC4_TEST_NO_SINGLE_INSTANCE set — skipping the #4 wrapper; the smoke guard MUST fail"
else
cat > "$PACK/electron/tc4-main.js" <<'MAIN_EOF'
// tC4 single-instance guard (#4, D39). This file is tC4's own, not the
// template's. It MUST run before electronStartup.js: the template's free-port
// scan would otherwise let a second launch start a second server over the
// same project store — the exact overlap D39 rules out. tC3 enforced the
// same rule at the Electron layer.
const { app, BrowserWindow } = require('electron');
if (!app.requestSingleInstanceLock()) {
  app.quit(); // second copy: no window, no server, exit
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  require('./electronStartup.js');
}
MAIN_EOF
node -e "
const fs = require('fs');
const p = '$PACK/electron/package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.main = 'tc4-main.js';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"
fi

cp "$REPO/dev-env/server/target/release/tc4_dev_server" "$PACK/bin/server.bin"
cp "$REPO/dev-env/server/Rocket.toml" "$PACK/Rocket.toml"

# lib: runtime resources per the template's app_config.env asset map.
cp -R "$BUILD/upstream/resource-core/runtime_resources" "$PACK/lib/app_resources"
cp -R "$BUILD/upstream/resource-core/templates" "$PACK/lib/templates"

# #70 store isolation: pin repo_dir to the tC4-owned store. The server
# substitutes %%WORKINGDIR%% at first boot (customize_and_copy_template_file).
# TC4_TEST_FORCE_SHARED_STORE=1 skips the patch — TEST-ONLY, used to prove
# the smoke-test guard actually fails a build that resolves to the shared
# store. Never set it for a real build; the guard will (and must) fail.
if [ "${TC4_TEST_FORCE_SHARED_STORE:-0}" != "1" ]; then
  python3 - "$PACK/lib/templates/user_settings.json" "$STORE_LEAF" <<'PY'
import json, sys
p, leaf = sys.argv[1], sys.argv[2]
d = json.load(open(p))
default = "%%HOMEDIR%%/pankosmia_repos"
if d.get("repo_dir") != default:
    raise SystemExit(f"user_settings template changed upstream: repo_dir is {d.get('repo_dir')!r}, expected {default!r} — re-verify #70 isolation before building")
d["repo_dir"] = f"%%HOMEDIR%%/{leaf}"
json.dump(d, open(p, "w"), indent=2)
print(f"repo_dir pinned to %%HOMEDIR%%/{leaf} (#70)")
PY
else
  echo "!!! TC4_TEST_FORCE_SHARED_STORE=1: leaving the platform default repo_dir (guard self-test)"
fi
mkdir -p "$PACK/lib/webfonts"
cp -R "$BUILD/upstream/webfonts-core/." "$PACK/lib/webfonts/"
rm -rf "$PACK/lib/webfonts/.git"

# app_resources/product holds product-level resources (walk-thrus, i18n
# overrides). resource-core does not ship it; the template's
# globalBuildResources does. Without i18n-overrides.json the server warns at
# boot.
mkdir -p "$PACK/lib/app_resources/product"
cp -R "$T/globalBuildResources/product_resources/." "$PACK/lib/app_resources/product/" 2>/dev/null || true
cp "$T/globalBuildResources/i18n-overrides.json" "$PACK/lib/app_resources/product/"

# lib: the tC4 client, registered at /clients/uw-tc4 (PLATFORM-NOTES #25).
cp -R "$REPO/dist" "$PACK/lib/clients/uw-tc4/build"
cp "$REPO/rig/pankosmia_metadata.json" "$PACK/lib/clients/uw-tc4/"
cp "$REPO/rig/package.json" "$PACK/lib/clients/uw-tc4/"
cp "$REPO/rig/storage_id.json" "$PACK/lib/clients/uw-tc4/"

# lib: setup + product. Paths are relative to the server cwd (template pattern).
print -r -- '{ "clients": [ { "path": "%%PANKOSMIADIR%%/uw-tc4" } ] }' \
  > "$PACK/lib/setup/app_setup.json"
print -r -- '{"local_pankosmia_path":"./lib/clients"}' \
  > "$PACK/lib/setup/local_setup.json"
DATETIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
print -r -- '{ "short_name": "tc4", "name": "'$APP_NAME'", "version": "'$VERSION'", "datetime": "'$DATETIME'", "homepage": "uw-tc4" }' \
  > "$PACK/lib/product/product.json"

echo "== 5/7 stage the artifact (Electronite + app dir + licenses + manifest)"
STAGE="$BUILD/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/$APP_NAME/licenses"
APPDIR="$STAGE/$APP_NAME"
if [ "$OS" = macos ]; then
cp -R "$BUILD/electronite/Electron.app" "$APPDIR/Electron.app"
# Re-seal the wrapper with a VALID ad-hoc signature (#57, measured 2026-08-25).
# The upstream Electronite release ships an app bundle whose signature FAILS
# verification ("code has no resources but signature indicates they must be
# present" — codesign --verify, pristine v37.1.0-graphite zip). A quarantined
# download therefore gets Gatekeeper's "damaged — move to Trash" verdict, with
# NO "Open Anyway" escape. A forced ad-hoc re-sign produces a bundle that
# VERIFIES, so Gatekeeper downgrades to the ordinary unidentified-developer
# flow (System Settings -> Privacy & Security -> Open Anyway). Real signing +
# notarization is #44's job; this step only makes the unsigned artifact
# openable at all. The guard below fails the build if the seal did not take.
codesign --force --deep --sign - "$APPDIR/Electron.app"
codesign --verify --deep --strict "$APPDIR/Electron.app" \
  || { echo "FATAL: Electron.app does not verify after the ad-hoc re-seal (#57)"; exit 1 }
else
# Linux (#119): the release is a flat directory, not an app bundle, and it
# carries no signature to re-seal. Stage it under electronite/ so it never
# collides with the template's electron/ startup directory.
mkdir -p "$APPDIR/electronite"
cp -R "$BUILD/electronite/." "$APPDIR/electronite/"
chmod +x "$APPDIR/electronite/electron" "$APPDIR/electronite/chrome_crashpad_handler"
# chrome-sandbox must be mode 4755 owned by root. A zip cannot carry a setuid
# bit, so the launcher below detects that and falls back to --no-sandbox.
fi
cp -R "$PACK/electron" "$APPDIR/electron"
cp -R "$PACK/bin" "$APPDIR/bin"
cp -R "$PACK/lib" "$APPDIR/lib"
cp "$PACK/Rocket.toml" "$APPDIR/Rocket.toml"

# The launcher differs per OS in three places only: its filename, how it
# finds its own directory, and how it invokes Electronite. The debug seeding
# step below is identical on both.
if [ "$OS" = macos ]; then
  LAUNCHER="start-tc4.command"
  LAUNCH_SHEBANG="#!/bin/zsh"
  LAUNCH_CD='cd "${0:a:h}"'
  LAUNCH_EXEC='exec ./Electron.app/Contents/MacOS/Electron ./electron'
else
  LAUNCHER="start-tc4.sh"
  LAUNCH_SHEBANG="#!/bin/sh"
  LAUNCH_CD='cd "$(dirname "$(readlink -f "$0")")"'
  # An unpacked zip cannot keep chrome-sandbox setuid root, and Electron
  # refuses to start with a sandbox helper it cannot trust. Use the sandbox
  # when the unpacked copy has it; otherwise say why we are dropping it.
  LAUNCH_EXEC='SANDBOX=./electronite/chrome-sandbox
if [ -u "$SANDBOX" ] && [ "$(stat -c %u "$SANDBOX" 2>/dev/null)" = "0" ]; then
  exec ./electronite/electron ./electron
else
  echo "note: chrome-sandbox is not setuid root in this unpacked copy; starting with --no-sandbox." >&2
  echo "      to enable it: sudo chown root:root $SANDBOX && sudo chmod 4755 $SANDBOX" >&2
  exec ./electronite/electron --no-sandbox ./electron
fi'
fi

if [ "$VARIANT" = "debug" ]; then
  # Ruling clauses 2/3 (#70): curated test projects go into the SEPARATE
  # debug-only store, seeded by the debug launcher on first run. Production
  # ships neither the seeds nor this launcher.
  mkdir -p "$APPDIR/debug-seeds"
  cp -R "$REPO/conformance/sample-burrito" "$APPDIR/debug-seeds/sample_burrito"
  cat > "$APPDIR/$LAUNCHER" <<LAUNCH
$LAUNCH_SHEBANG
# Unsigned DEBUG artifact. Seeds the debug-only project store on first run
# (never the shared \$HOME/pankosmia_repos), then starts Electronite; the
# startup script spawns the bundled server itself.
$LAUNCH_CD
STORE="\$HOME/pankosmia/tc4-projects-debug"
SEED="\$STORE/_local_/_local_/sample_burrito"
if [ ! -d "\$SEED" ] && command -v git >/dev/null; then
  mkdir -p "\$STORE/_local_/_local_"
  cp -R ./debug-seeds/sample_burrito "\$SEED"
  # Initial commit: the platform's add-and-commit panics on a repo with
  # zero commits (PLATFORM-NOTES #20).
  (cd "\$SEED" && git init -q -b main . && git add -A \\
    && git -c user.email=debug@tc4.local -c user.name=tc4-debug commit -qm seed)
fi
$LAUNCH_EXEC
LAUNCH
else
  cat > "$APPDIR/$LAUNCHER" <<LAUNCH
$LAUNCH_SHEBANG
# Unsigned development artifact. Starts Electronite; the startup script
# spawns the bundled server itself.
$LAUNCH_CD
$LAUNCH_EXEC
LAUNCH
fi
chmod +x "$APPDIR/$LAUNCHER"

# Licenses. The startup files in electron/ are modified copies from the MIT
# desktop-app-template; Electronite ships its own LICENSE files in the zip.
cp "$REPO/LICENSE" "$APPDIR/LICENSE"
cp "$T/LICENSE" "$APPDIR/licenses/LICENSE.desktop-app-template"
cp "$BUILD/electronite/LICENSE" "$APPDIR/licenses/LICENSE.electronite"
cp "$BUILD/electronite/LICENSES.chromium.html" "$APPDIR/licenses/LICENSES.chromium.html"
cp "$BUILD/upstream/resource-core/LICENSE" "$APPDIR/licenses/LICENSE.resource-core"
cp "$BUILD/upstream/webfonts-core/LICENSE" "$APPDIR/licenses/LICENSE.webfonts-core"
cat > "$APPDIR/THIRD-PARTY-NOTICES.md" <<NOTICES
# Third-party notices

translationCore4 is (C) unfoldingWord, GPL-2.0-or-later (see LICENSE).
This build bundles the components below. Full texts are in licenses/.

| Component | Version / rev | License | Source |
|---|---|---|---|
| Electronite (Graphite-enabled Electron) | $ELECTRONITE_TAG | MIT (+ Chromium notices) | github.com/unfoldingWord/electronite |
| desktop-app-template startup files (electron/, modified) | $TEMPLATE_REV | MIT | github.com/pankosmia/desktop-app-template |
| pankosmia-web server (bin/server.bin) | 0.18.5 (99fd9be) | MIT | github.com/pankosmia/pankosmia-web |
| resource-core (lib/app_resources, lib/templates) | $RESOURCE_CORE_REV | MIT | github.com/pankosmia/resource-core |
| webfonts-core (lib/webfonts; fonts carry their own licenses, mostly SIL OFL) | $WEBFONTS_CORE_REV | MIT (repo); per-font licenses inside | github.com/pankosmia/webfonts-core |
| puppeteer-core (electron/node_modules) | $PUPPETEER_CORE_VER | Apache-2.0 | github.com/puppeteer/puppeteer |
| @puppeteer/browsers (electron/node_modules) | $PUPPETEER_BROWSERS_VER | Apache-2.0 | github.com/puppeteer/puppeteer |

npm dependency license texts remain in electron/node_modules/*/LICENSE.
NOTICES

# Input manifest: every component with its exact version/commit/checksum.
SERVER_SHA=$(sha256_of "$APPDIR/bin/server.bin")
cat > "$APPDIR/BUILD-MANIFEST.json" <<MANIFEST
{
  "artifact": "tC4-$VERSION-$OS-$ARCH-unsigned",
  "variant": "$VARIANT",
  "project_store": "\$HOME/$STORE_LEAF (#70 — never \$HOME/pankosmia_repos)",
  "built_utc": "$DATETIME",
  "inputs": {
    "uw-tc4_client": { "version": "$VERSION", "commit": "$(git -C $REPO rev-parse HEAD)" },
    "pankosmia_web_server": { "version": "0.18.5", "rev": "99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a", "bin_sha256": "$SERVER_SHA" },
    "electronite": { "tag": "$ELECTRONITE_TAG", "zip_sha256": "$ELECTRONITE_SHA256" },
    "desktop_app_template": { "rev": "$TEMPLATE_REV" },
    "resource_core": { "rev": "$RESOURCE_CORE_REV" },
    "webfonts_core": { "rev": "$WEBFONTS_CORE_REV" },
    "puppeteer_core": { "version": "$PUPPETEER_CORE_VER" },
    "puppeteer_browsers": { "version": "$PUPPETEER_BROWSERS_VER" }
  }
}
MANIFEST
echo "-- BUILD-MANIFEST.json --"
cat "$APPDIR/BUILD-MANIFEST.json"

echo "== 6/7 smoke test: launch the artifact through its own entry point"
# Fresh HOME so the app's self-created working dir (~/pankosmia/tc4) is
# isolated. No app-specific environment overrides: the entry point must
# self-spawn the server (electronStartup.js picks the first free port from
# 19119) and land on the tC4 client.
SMOKE_HOME="$BUILD/smoke-home"
rm -rf "$SMOKE_HOME"
mkdir -p "$SMOKE_HOME"
HOME="$SMOKE_HOME" "$APPDIR/$LAUNCHER" > "$BUILD/smoke-entrypoint.log" 2>&1 &
SMOKE_PID=$!
cleanup_smoke() {
  if [ "$OS" = macos ]; then pkill -f "$APPDIR/Electron.app" 2>/dev/null || true
  else                       pkill -f "$APPDIR/electronite/electron" 2>/dev/null || true; fi
  kill $SMOKE_PID 2>/dev/null || true
}
trap cleanup_smoke EXIT

# Find the self-chosen port (electronStartup starts at 19119).
SMOKE_PORT=""
for i in {1..40}; do
  for p in {19119..19139}; do
    if curl -s --max-time 1 "http://127.0.0.1:$p/api/version" | grep -q '"product_short_name":"tc4"'; then
      SMOKE_PORT=$p; break
    fi
  done
  [ -n "$SMOKE_PORT" ] && break
  sleep 1
done
[ -n "$SMOKE_PORT" ] || { echo "SMOKE TEST FAILED: self-spawned server not found on 19119-19139" >&2
  tail -20 "$BUILD/smoke-entrypoint.log" >&2; exit 1; }
echo "self-spawned server found on port $SMOKE_PORT"

ROOT=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$SMOKE_PORT/")
CLIENT=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/clients/uw-tc4")
echo "root: $ROOT; /clients/uw-tc4: $CLIENT"

# #4 GUARD (D39): a second launch must NOT become a second running copy.
# With the first instance still up, launch the entry point AGAIN (same HOME —
# the singleton lock keys on the app's userData under this HOME). The second
# process must exit BY ITSELF, no second tc4 server may appear on any scan
# port, and the first server must still answer. Without the tc4-main.js
# wrapper this fails: the template's port scan starts a second server over
# the same project store.
HOME="$SMOKE_HOME" "$APPDIR/$LAUNCHER" > "$BUILD/smoke-second-instance.log" 2>&1 &
SECOND_PID=$!
SECOND_DEAD=""
for i in {1..30}; do
  kill -0 $SECOND_PID 2>/dev/null || { SECOND_DEAD=1; break }
  sleep 1
done
[ -n "$SECOND_DEAD" ] || {
  echo "#4 GUARD FAILED: the second instance is still running after 30s" >&2
  tail -20 "$BUILD/smoke-second-instance.log" >&2
  kill $SECOND_PID 2>/dev/null
  exit 1
}
SECOND_SERVERS=0
for p in {19119..19139}; do
  [ "$p" = "$SMOKE_PORT" ] && continue
  curl -s --max-time 1 "http://127.0.0.1:$p/api/version" | grep -q '"product_short_name":"tc4"' && SECOND_SERVERS=$((SECOND_SERVERS+1))
done
[ "$SECOND_SERVERS" = "0" ] || {
  echo "#4 GUARD FAILED: a second tc4 server appeared on another port — the second launch spawned a server" >&2
  exit 1
}
curl -s --max-time 2 "http://127.0.0.1:$SMOKE_PORT/api/version" | grep -q '"product_short_name":"tc4"' || {
  echo "#4 GUARD FAILED: the FIRST server stopped answering after the second launch" >&2
  exit 1
}
echo "#4 guard: second launch exited by itself; one server only (port $SMOKE_PORT)"
cleanup_smoke
trap - EXIT
[[ "$ROOT" == 303* && "$ROOT" == *"/clients/uw-tc4" && "$CLIENT" == "200" ]] || {
  echo "SMOKE TEST FAILED" >&2; exit 1; }
# Prove the working dir was created inside the fresh HOME, not the real one.
[ -d "$SMOKE_HOME/pankosmia/tc4" ] && echo "working dir created at \$HOME/pankosmia/tc4 (isolated)"

# #70 GUARD (release-blocking, both variants): the RESOLVED repo_dir of the
# booted app must never be the shared pankosmia_repos store.
US="$SMOKE_HOME/pankosmia/tc4/user_settings.json"
[ -f "$US" ] || { echo "#70 GUARD FAILED: no user_settings.json at $US" >&2; exit 1; }
RESOLVED_REPO_DIR=$(node -p "require('$US').repo_dir")
echo "resolved repo_dir: $RESOLVED_REPO_DIR"
case "$RESOLVED_REPO_DIR" in
  *pankosmia_repos*)
    echo "#70 GUARD FAILED: resolved repo_dir is the shared pankosmia_repos store — release-blocking (owner ruling 2026-08-14)" >&2
    exit 1 ;;
esac
EXPECTED_REPO_DIR="$SMOKE_HOME/$STORE_LEAF"
[ "$RESOLVED_REPO_DIR" = "$EXPECTED_REPO_DIR" ] || {
  echo "#70 GUARD FAILED: repo_dir '$RESOLVED_REPO_DIR' is not the expected isolated store '$EXPECTED_REPO_DIR'" >&2
  exit 1; }
if [ "$VARIANT" = "debug" ]; then
  [ -f "$RESOLVED_REPO_DIR/_local_/_local_/sample_burrito/metadata.json" ] || {
    echo "#70 GUARD FAILED: debug store missing the seeded sample burrito" >&2; exit 1; }
  echo "debug store seeded at $RESOLVED_REPO_DIR (separate from production store)"
else
  if [ -n "$(ls -A "$RESOLVED_REPO_DIR" 2>/dev/null)" ]; then
    echo "#70 GUARD FAILED: production store is not empty on first boot" >&2
    ls -R "$RESOLVED_REPO_DIR" >&2; exit 1
  fi
  echo "production store is empty on first boot (isolated at $RESOLVED_REPO_DIR)"
fi

echo "== 7/7 zip the artifact"
ZIP="$BUILD/tC4-$VERSION-$OS-$ARCH-unsigned.zip"
rm -f "$ZIP"
cd "$STAGE"
if [ "$OS" = macos ]; then
  ditto -c -k --keepParent "$APP_NAME" "$ZIP"
else
  # -y stores symlinks as symlinks; zip keeps the executable bits the
  # launcher and the Electronite binaries need.
  zip -qry "$ZIP" "$APP_NAME"
fi
echo "artifact: $ZIP"
echo "inputs: electronite $ELECTRONITE_TAG ($ELECTRONITE_SHA256); template $TEMPLATE_REV;"
echo "        resource-core $RESOURCE_CORE_REV; webfonts-core $WEBFONTS_CORE_REV;"
echo "        puppeteer-core $PUPPETEER_CORE_VER; @puppeteer/browsers $PUPPETEER_BROWSERS_VER"
