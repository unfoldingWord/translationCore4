#!/usr/bin/env bash
# The macOS installer (card G3), ported from tC4 scripts/build-macos-pkg.zsh: an unsigned pkg
# whose payload is only the app, installed in /Applications, with the README shown first and
# macos-preinstall.sh run before the app is written.
#
#   scripts/release/macos-pkg.sh <staged "translationCore 4.app"> <version> <output .pkg>
set -euo pipefail
app=$1 version=$2 output=$3
repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/payload" "$work/instructions" "$work/scripts"
ditto "$app" "$work/payload/translationCore 4.app"
# Asks before it replaces a translationCore 4 already on the Mac, and removes one that is not
# at the install location (#1016).
cp "$repo/scripts/release/macos-preinstall.sh" "$work/scripts/preinstall"
chmod +x "$work/scripts/preinstall"
cp "$repo/scripts/release/README-macos.txt" "$work/instructions/README.txt"
pkgbuild --analyze --root "$work/payload" "$work/components.plist"
# Always replace the app where the pkg puts it, never a copy moved elsewhere.
plutil -replace 0.BundleIsRelocatable -bool false "$work/components.plist"
plutil -replace 0.BundleIsVersionChecked -bool false "$work/components.plist"
plutil -replace 0.BundleOverwriteAction -string upgrade "$work/components.plist"
# The whole version, so the receipt tells 4.1.0-preview from 4.1.0-preview2 (#1016).
pkgbuild --root "$work/payload" --component-plist "$work/components.plist" --scripts "$work/scripts" \
  --identifier org.unfoldingword.translationcore4 --version "$version" \
  --install-location /Applications "$work/application.pkg"
productbuild --synthesize --package "$work/application.pkg" "$work/Distribution.xml"
node - "$work/Distribution.xml" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const xml = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, xml.replace('<installer-gui-script minSpecVersion="1">',
  '<installer-gui-script minSpecVersion="1">\n<title>translationCore 4</title>\n<readme file="README.txt" mime-type="text/plain"/>\n<domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>'));
NODE
productbuild --distribution "$work/Distribution.xml" --resources "$work/instructions" \
  --package-path "$work" "$output"
echo "installer: $output"
