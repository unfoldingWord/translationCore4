#!/bin/zsh
# Build an UNSIGNED macOS desktop artifact for tC4 (#57).
#
# The recipe follows the Pankosmia desktop-app-template (read-only reference,
# MIT license). The wrapper is Electronite v37.1.0-graphite, the Graphite-enabled
# Electron fork from unfoldingWord (D20). The artifact is minimal for now: it
# bundles ONLY the uw-tc4 client (#71), the pinned server (pankosmia-web 0.18.5,
# 99fd9be), and the runtime resources. See docs/PACKAGING.md.
#
# The smoke test launches the STAGED ARTIFACT THROUGH ITS OWN ENTRY POINT
# (start-tc4.command -> Electronite -> electronStartup.js), with a fresh HOME
# and no app-specific environment overrides. The app must self-spawn its
# bundled server and serve the tC4 client (303 from /, 200 from
# /clients/uw-tc4) before the zip is written.
#
# Usage: zsh scripts/package-desktop.zsh
# Output: dist-desktop/tC4-<version>-macos-<arch>-unsigned.zip
#
# Requirements: node >= 20, npm, cargo, curl, unzip, git, shasum.
set -e

REPO=${0:a:h:h}
BUILD="$REPO/dist-desktop"
PACK="$BUILD/pack"
ARCH=$(uname -m | sed 's/x86_64/x64/')
VERSION=$(node -p "require('$REPO/package.json').version")

# Pins. Change them together with docs/PACKAGING.md.
ELECTRONITE_TAG="v37.1.0-graphite"
ELECTRONITE_SHA256_ARM64="a3dde44e03a076bc778f952f7a7a5ed6d8e5037d46ea6c1ba2deb6a11df59488"
TEMPLATE_REPO="https://github.com/pankosmia/desktop-app-template.git"
TEMPLATE_REV="4cb757601b9310b3fccd52f77a6ae2238ceec9f4"   # 2026-08-14
RESOURCE_CORE_REPO="https://github.com/pankosmia/resource-core.git"
RESOURCE_CORE_REV="54802be780af18ab02e426dd59014bc6adb158af"   # 2026-08-14
WEBFONTS_CORE_REPO="https://github.com/pankosmia/webfonts-core.git"
WEBFONTS_CORE_REV="eb52ccdad6806b5729ea8b45b1c59c793ffa32c3"   # 2026-08-14
PUPPETEER_CORE_VER="24.43.1"       # template package.json: ^24.43.1
PUPPETEER_BROWSERS_VER="2.13.1"    # template package.json: ^2.13.1

APP_NAME="translationCore4"

# Pin one checksum per artifact arch. Only arm64 is recorded so far; a new
# arch needs its checksum recorded here first.
case "$ARCH" in
  arm64) ELECTRONITE_SHA256="$ELECTRONITE_SHA256_ARM64" ;;
  *) echo "No recorded Electronite checksum for arch '$ARCH' — record one first." >&2
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

ELECTRONITE_ZIP="electronite-$ELECTRONITE_TAG-darwin-$ARCH.zip"
if [ ! -f "$BUILD/$ELECTRONITE_ZIP" ]; then
  echo "== downloading Electronite $ELECTRONITE_TAG darwin-$ARCH"
  curl -sL -o "$BUILD/$ELECTRONITE_ZIP" \
    "https://github.com/unfoldingWord/electronite/releases/download/$ELECTRONITE_TAG/$ELECTRONITE_ZIP"
fi
ACTUAL_SHA=$(shasum -a 256 "$BUILD/$ELECTRONITE_ZIP" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$ELECTRONITE_SHA256" ]; then
  echo "Electronite checksum mismatch: expected $ELECTRONITE_SHA256, got $ACTUAL_SHA" >&2
  exit 1
fi
echo "Electronite sha256 OK: $ACTUAL_SHA"
if [ ! -d "$BUILD/electronite/Electron.app" ]; then
  mkdir -p "$BUILD/electronite"
  unzip -qq -o "$BUILD/$ELECTRONITE_ZIP" -d "$BUILD/electronite"
fi

echo "== 4/7 assemble the app directory"
rm -rf "$PACK"
mkdir -p "$PACK/bin" "$PACK/lib/setup" "$PACK/lib/clients/uw-tc4" "$PACK/lib/product"

T="$BUILD/upstream/desktop-app-template"
cp -R "$T/buildResources/electron" "$PACK/electron"
cp "$T/globalBuildResources/favicon.png" "$PACK/electron/"
sed -i '' "s/\${APP_NAME}/$APP_NAME/g; s/\${APP_VERSION}/$VERSION/g" \
  "$PACK/electron/electronStartup.js" "$PACK/electron/package.json"
# Runtime deps of electronStartup.js (template package.json dependencies),
# pinned exactly; the lockfile ships inside the artifact.
cd "$PACK/electron"
npm install --no-audit --no-fund --save-exact \
  "puppeteer-core@$PUPPETEER_CORE_VER" "@puppeteer/browsers@$PUPPETEER_BROWSERS_VER"

cp "$REPO/dev-env/server/target/release/tc4_dev_server" "$PACK/bin/server.bin"
cp "$REPO/dev-env/server/Rocket.toml" "$PACK/Rocket.toml"

# lib: runtime resources per the template's app_config.env asset map.
cp -R "$BUILD/upstream/resource-core/runtime_resources" "$PACK/lib/app_resources"
cp -R "$BUILD/upstream/resource-core/templates" "$PACK/lib/templates"
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
cp -R "$BUILD/electronite/Electron.app" "$APPDIR/Electron.app"
cp -R "$PACK/electron" "$APPDIR/electron"
cp -R "$PACK/bin" "$APPDIR/bin"
cp -R "$PACK/lib" "$APPDIR/lib"
cp "$PACK/Rocket.toml" "$APPDIR/Rocket.toml"
cat > "$APPDIR/start-tc4.command" <<'LAUNCH'
#!/bin/zsh
# Unsigned development artifact. Starts Electronite; the startup script
# spawns the bundled server itself.
cd "${0:a:h}"
exec ./Electron.app/Contents/MacOS/Electron ./electron
LAUNCH
chmod +x "$APPDIR/start-tc4.command"

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
SERVER_SHA=$(shasum -a 256 "$APPDIR/bin/server.bin" | awk '{print $1}')
cat > "$APPDIR/BUILD-MANIFEST.json" <<MANIFEST
{
  "artifact": "tC4-$VERSION-macos-$ARCH-unsigned",
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
HOME="$SMOKE_HOME" "$APPDIR/start-tc4.command" > "$BUILD/smoke-entrypoint.log" 2>&1 &
SMOKE_PID=$!
cleanup_smoke() {
  pkill -f "$APPDIR/Electron.app" 2>/dev/null || true
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
cleanup_smoke
trap - EXIT
[[ "$ROOT" == 303* && "$ROOT" == *"/clients/uw-tc4" && "$CLIENT" == "200" ]] || {
  echo "SMOKE TEST FAILED" >&2; exit 1; }
# Prove the working dir was created inside the fresh HOME, not the real one.
[ -d "$SMOKE_HOME/pankosmia/tc4" ] && echo "working dir created at \$HOME/pankosmia/tc4 (isolated)"

echo "== 7/7 zip the artifact"
ZIP="$BUILD/tC4-$VERSION-macos-$ARCH-unsigned.zip"
rm -f "$ZIP"
cd "$STAGE"
ditto -c -k --keepParent "$APP_NAME" "$ZIP"
echo "artifact: $ZIP"
echo "inputs: electronite $ELECTRONITE_TAG ($ELECTRONITE_SHA256); template $TEMPLATE_REV;"
echo "        resource-core $RESOURCE_CORE_REV; webfonts-core $WEBFONTS_CORE_REV;"
echo "        puppeteer-core $PUPPETEER_CORE_VER; @puppeteer/browsers $PUPPETEER_BROWSERS_VER"
