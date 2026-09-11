#!/bin/zsh
# The Installer payload contains only the .app. README is also presented before
# installation, so pilots do not need to open an opaque pkg to find instructions.
set -e
BUNDLE=$1
VERSION=$2
OUTPUT=$3
REPO=${0:a:h:h}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/payload" "$WORK/instructions"
ditto "$BUNDLE" "$WORK/payload/translationCore4.app"
cp "$REPO/scripts/README-macos.txt" "$WORK/instructions/README.txt"
pkgbuild --analyze --root "$WORK/payload" "$WORK/components.plist"
# Always replace the app at the declared destination, not a moved debug/zip copy.
plutil -replace 0.BundleIsRelocatable -bool false "$WORK/components.plist"
plutil -replace 0.BundleIsVersionChecked -bool false "$WORK/components.plist"
plutil -replace 0.BundleOverwriteAction -string upgrade "$WORK/components.plist"
pkgbuild --root "$WORK/payload" --component-plist "$WORK/components.plist" \
  --identifier org.unfoldingword.translationcore4 --version "${VERSION%%-*}" \
  --install-location /Applications "$WORK/application.pkg"
productbuild --synthesize --package "$WORK/application.pkg" "$WORK/Distribution.xml"
node - "$WORK/Distribution.xml" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const xml = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, xml.replace('<installer-gui-script minSpecVersion="1">',
  '<installer-gui-script minSpecVersion="1">\n<title>translationCore4</title>\n<readme file="README.txt" mime-type="text/plain"/>\n<domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>'));
NODE
productbuild --distribution "$WORK/Distribution.xml" --resources "$WORK/instructions" \
  --package-path "$WORK" "$OUTPUT"
echo "installer: $OUTPUT"
