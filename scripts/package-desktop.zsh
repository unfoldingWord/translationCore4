#!/bin/zsh
# Build an UNSIGNED macOS desktop artifact for tC4 (#57).
#
# The recipe follows the Pankosmia desktop-app-template (read-only reference,
# MIT license). The wrapper is Electronite v37.1.0-graphite, the Graphite-enabled
# Electron fork from unfoldingWord (D20). The artifact is minimal for now: it
# bundles ONLY the uw-tc4 client, the pinned server (pankosmia-web 0.18.5,
# 99fd9be), and the runtime resources. Core Pankosmia clients are NOT bundled
# yet (see docs/PACKAGING.md).
#
# Proof of the recipe: witnessed boot on macOS arm64, 2026-08-14. The Electronite
# window opened http://127.0.0.1:<port>/clients/uw-tc4 and rendered the tC4
# project list. A server boot with only uw-tc4 registered returned
# 303 / -> /clients/uw-tc4 and 200 on the client page.
#
# Usage: zsh scripts/package-desktop.zsh
# Output: dist-desktop/tC4-<version>-macos-<arch>-unsigned.zip
#
# Requirements: node >= 20, npm, cargo, curl, unzip, git.
set -e

REPO=${0:a:h:h}
BUILD="$REPO/dist-desktop"
PACK="$BUILD/pack"
ARCH=$(uname -m | sed 's/x86_64/x64/')
VERSION=$(node -p "require('$REPO/package.json').version")

# Pins. Change them together with docs/PACKAGING.md.
ELECTRONITE_TAG="v37.1.0-graphite"
TEMPLATE_REPO="https://github.com/pankosmia/desktop-app-template.git"
TEMPLATE_REV="4cb757601b9310b3fccd52f77a6ae2238ceec9f4"   # 2026-08-14
RESOURCE_CORE_REPO="https://github.com/pankosmia/resource-core.git"
WEBFONTS_CORE_REPO="https://github.com/pankosmia/webfonts-core.git"

APP_NAME="translationCore4"

echo "== 1/6 build the tC4 client"
cd "$REPO"
npm ci --no-audit --no-fund
npm run build

echo "== 2/6 build the pinned server (pankosmia-web 0.18.5, 99fd9be)"
cd "$REPO/dev-env/server"
cargo build --release

echo "== 3/6 fetch read-only build inputs"
mkdir -p "$BUILD/upstream"
[ -d "$BUILD/upstream/desktop-app-template" ] || \
  git clone --quiet "$TEMPLATE_REPO" "$BUILD/upstream/desktop-app-template"
git -C "$BUILD/upstream/desktop-app-template" checkout --quiet "$TEMPLATE_REV"
[ -d "$BUILD/upstream/resource-core" ] || \
  git clone --quiet --depth 1 "$RESOURCE_CORE_REPO" "$BUILD/upstream/resource-core"
[ -d "$BUILD/upstream/webfonts-core" ] || \
  git clone --quiet --depth 1 "$WEBFONTS_CORE_REPO" "$BUILD/upstream/webfonts-core"
RESOURCE_CORE_REV=$(git -C "$BUILD/upstream/resource-core" rev-parse --short HEAD)
WEBFONTS_CORE_REV=$(git -C "$BUILD/upstream/webfonts-core" rev-parse --short HEAD)
echo "resource-core @ $RESOURCE_CORE_REV; webfonts-core @ $WEBFONTS_CORE_REV"

ELECTRONITE_ZIP="electronite-$ELECTRONITE_TAG-darwin-$ARCH.zip"
if [ ! -d "$BUILD/electronite/Electron.app" ]; then
  echo "== downloading Electronite $ELECTRONITE_TAG darwin-$ARCH"
  curl -sL -o "$BUILD/$ELECTRONITE_ZIP" \
    "https://github.com/unfoldingWord/electronite/releases/download/$ELECTRONITE_TAG/$ELECTRONITE_ZIP"
  mkdir -p "$BUILD/electronite"
  unzip -qq -o "$BUILD/$ELECTRONITE_ZIP" -d "$BUILD/electronite"
fi

echo "== 4/6 assemble the app directory"
rm -rf "$PACK"
mkdir -p "$PACK/bin" "$PACK/lib/setup" "$PACK/lib/clients/uw-tc4" "$PACK/lib/product"

T="$BUILD/upstream/desktop-app-template"
cp -R "$T/buildResources/electron" "$PACK/electron"
cp "$T/globalBuildResources/favicon.png" "$PACK/electron/"
sed -i '' "s/\${APP_NAME}/$APP_NAME/g; s/\${APP_VERSION}/$VERSION/g" \
  "$PACK/electron/electronStartup.js" "$PACK/electron/package.json"
# Runtime deps of electronStartup.js (template package.json dependencies).
cd "$PACK/electron"
npm install --no-audit --no-fund --no-package-lock puppeteer-core@24 @puppeteer/browsers

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

echo "== 5/6 smoke test: server boots and lands on the tC4 client"
SMOKE_PORT=19996
cd "$PACK"
APP_RESOURCES_DIR="$PACK/lib/" ROCKET_PORT=$SMOKE_PORT ROCKET_ADDRESS=127.0.0.1 \
  ./bin/server.bin "$BUILD/smoke-work/" &
SMOKE_PID=$!
trap "kill $SMOKE_PID 2>/dev/null || true" EXIT
sleep 5
ROOT=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "localhost:$SMOKE_PORT/")
CLIENT=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$SMOKE_PORT/clients/uw-tc4")
kill $SMOKE_PID 2>/dev/null || true
echo "root: $ROOT; /clients/uw-tc4: $CLIENT"
[[ "$ROOT" == 303* && "$ROOT" == *"/clients/uw-tc4" && "$CLIENT" == "200" ]] || {
  echo "SMOKE TEST FAILED" >&2; exit 1; }

echo "== 6/6 bundle Electronite + app dir into the artifact"
STAGE="$BUILD/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/$APP_NAME"
cp -R "$BUILD/electronite/Electron.app" "$STAGE/$APP_NAME/Electron.app"
cp -R "$PACK/electron" "$STAGE/$APP_NAME/electron"
cp -R "$PACK/bin" "$STAGE/$APP_NAME/bin"
cp -R "$PACK/lib" "$STAGE/$APP_NAME/lib"
cp "$PACK/Rocket.toml" "$STAGE/$APP_NAME/Rocket.toml"
cat > "$STAGE/$APP_NAME/start-tc4.command" <<'LAUNCH'
#!/bin/zsh
# Unsigned development artifact. Starts the bundled server, then Electronite.
cd "${0:a:h}"
exec ./Electron.app/Contents/MacOS/Electron ./electron
LAUNCH
chmod +x "$STAGE/$APP_NAME/start-tc4.command"

ZIP="$BUILD/tC4-$VERSION-macos-$ARCH-unsigned.zip"
rm -f "$ZIP"
cd "$STAGE"
ditto -c -k --keepParent "$APP_NAME" "$ZIP"
echo "artifact: $ZIP"
echo "inputs: electronite $ELECTRONITE_TAG; template $TEMPLATE_REV;"
echo "        resource-core $RESOURCE_CORE_REV; webfonts-core $WEBFONTS_CORE_REV"
