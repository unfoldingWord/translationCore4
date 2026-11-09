#!/usr/bin/env bash
# Signs the staged macOS app and writes its manifest, in the one order that leaves both valid
# (#969): the seal covers the manifest, so the manifest cannot cover the seal.
#
#   scripts/release/seal-macos.sh <app bundle> --platform <p> --electronite <tag> --electronite-sha256 <hex>
#
# 1. Ad-hoc sign every nested bundle and the app (Apple silicon runs no unsigned code; H4: not
#    notarized, as tC4 4.0 rc.2). Code the deep sign does not reach, such as tc4 under Resources,
#    is signed by the caller first.
# 2. Write BUILD-MANIFEST.json into Contents/Resources. It records every file as it will ship,
#    except the two step 3 rewrites: the app's main executable, whose signature holds the hash
#    of the resource seal, and the seal itself, which holds the hash of the manifest. The
#    manifest names them under `unrecorded`.
# 3. Re-sign the app alone (no --deep: the nested bundles' signatures, which the manifest
#    records, stay as they are), which seals the manifest in.
# 4. Verify the seal and the manifest against the finished bundle. Nothing may write into the
#    bundle after this: a later write is what broke every bundle shipped before #969.
set -euo pipefail
app=$1
shift
here=$(cd "$(dirname "$0")" && pwd)
exe=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")

codesign --force --deep --sign - "$app"
node "$here/manifest.mjs" --root "$app" --into "$app/Contents/Resources" \
  --unrecorded "Contents/MacOS/$exe" --unrecorded Contents/_CodeSignature/CodeResources "$@"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
node "$here/manifest.mjs" --check "$app/Contents/Resources/BUILD-MANIFEST.json" --root "$app"
echo "sealed $app"
