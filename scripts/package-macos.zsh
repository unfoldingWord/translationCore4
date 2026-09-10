#!/bin/zsh
# Bundle the already-staged payload. Invoked by package-desktop.zsh before smoke.
set -e
APPDIR=$1
APP_NAME=$2
VERSION=$3
VARIANT=$4
STORE_LEAF=$5
REPO=${0:a:h:h}
BUNDLE="$APPDIR/$APP_NAME.app"
RESOURCES="$BUNDLE/Contents/Resources"

mv "$APPDIR/Electron.app" "$BUNDLE"
mv "$APPDIR/electron" "$RESOURCES/app"
mv "$APPDIR/bin/server.bin" "$BUNDLE/Contents/MacOS/server.bin"
zsh "$REPO/scripts/check-macos-server.zsh" "$BUNDLE/Contents/MacOS/server.bin"
rmdir "$APPDIR/bin"
for item in lib resources Rocket.toml LICENSE licenses THIRD-PARTY-NOTICES.md BUILD-MANIFEST.json smoke-installed.zsh; do
  mv "$APPDIR/$item" "$RESOURCES/$item"
done
if [ "$VARIANT" = debug ]; then mv "$APPDIR/debug-seeds" "$RESOURCES/debug-seeds"; fi
cp "$REPO/scripts/README-macos.txt" "$APPDIR/README.txt"
cp "$REPO/scripts/README-macos.txt" "$RESOURCES/README.txt"
cp "$REPO/scripts/mac-bootstrap.cjs" "$RESOURCES/app/tc4-bootstrap.cjs"
cp "$REPO/branding/icon.icns" "$RESOURCES/electron.icns"

# Carry the native libraries' license texts from the exact Cargo inputs used by
# this build, rather than maintaining a second set of versioned copies.
HOST_TARGET=$(rustc -vV | sed -n 's/^host: //p')
cargo metadata --manifest-path "$REPO/dev-env/server/Cargo.toml" --locked --offline \
  --format-version 1 --filter-platform "$HOST_TARGET" > "$REPO/dist-desktop/cargo-metadata.json"
node - "$REPO/dist-desktop/cargo-metadata.json" "$RESOURCES" <<'NODE'
const fs = require('fs');
const path = require('path');
const [metadataFile, resources] = process.argv.slice(2);
const { packages } = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
for (const [name, files, license] of [
  ['libgit2-sys', ['libgit2/COPYING', 'libgit2/deps/pcre/COPYING', 'libgit2/deps/llhttp/LICENSE-MIT'], 'GPL-2.0 with linking exception; bundled dependency notices'],
  ['libssh2-sys', ['libssh2/COPYING'], 'BSD-3-Clause'],
  ['openssl-src', ['openssl/LICENSE.txt'], 'Apache-2.0'],
]) {
  const pkg = packages.find((entry) => entry.name === name);
  if (!pkg) throw new Error(`Missing vendored native library: ${name}`);
  const contents = files.map((file) => fs.readFileSync(path.join(path.dirname(pkg.manifest_path), file), 'utf8')).join('\n\n');
  fs.writeFileSync(path.join(resources, 'licenses', `LICENSE.${name}`), contents);
  fs.appendFileSync(path.join(resources, 'THIRD-PARTY-NOTICES.md'),
    `| ${name} (statically linked native library) | ${pkg.version} | ${license} | ${pkg.repository} |\n`);
}
NODE

# Keep the pinned template's resource cwd; change only its Mac executable path.
# A pin change must fail loudly rather than silently shipping a broken launcher.
node - "$RESOURCES/app" "$STORE_LEAF" "$VARIANT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [appDir, storeLeaf, variant] = process.argv.slice(2);
const startup = path.join(appDir, 'electronStartup.js');
const source = fs.readFileSync(startup, 'utf8');
const original = "const MAC_SERVER_PATH = './bin/server.bin';";
if (source.split(original).length !== 2) throw new Error('Template Mac server path changed; re-verify #243');
fs.writeFileSync(startup, source.replace(original, "const MAC_SERVER_PATH = '../MacOS/server.bin';"));
fs.writeFileSync(path.join(appDir, 'tc4-bootstrap.json'), JSON.stringify({ storeLeaf, variant }));
NODE

PLIST="$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
IDENTIFIER=org.unfoldingword.translationcore4
if [ "$VARIANT" = debug ]; then IDENTIFIER="$IDENTIFIER.debug"; fi
plutil -replace CFBundleIdentifier -string "$IDENTIFIER" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "${VERSION%%-*}" "$PLIST"
plutil -replace CFBundleIconFile -string electron "$PLIST"
# The inherited release's seal is invalid (#57). Sign the nested code first,
# then the completed app, and verify before and after execution.
codesign --force --sign - "$BUNDLE/Contents/MacOS/server.bin"
codesign --force --deep --sign - "$BUNDLE"
codesign --verify --strict "$BUNDLE/Contents/MacOS/server.bin"
codesign --verify --deep --strict "$BUNDLE"
