#!/usr/bin/env bash
# On a fresh runner (card G3): install the platform's installer as a translator would, start
# the installed app, run the server smoke test on the installed files, uninstall, and check the
# app data and projects are still there (tC4 #43, #44, #45). Then install again over the kept
# folders, as a translator going back to an earlier version would, and meet the smoke project as
# it was and as an older version meets a newer one's (#46).
#
#   scripts/release/smoke-installed.sh <platform> <dist dir> [<previous release's dist dir>]
#
# Until a release before this one exists, the reinstall uses this build's installer.
#
# TC4_UPGRADE_FROM names a folder that holds the installer of the release before this one. With
# it, on Windows and macOS, that release is installed and started first and this build is
# installed over it, with no uninstall between (#1016).
set -euo pipefail
platform=$1 dist=$2 previous=${3:-$2}
here=$(cd "$(dirname "$0")" && pwd)
np() { if command -v cygpath > /dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
mkdir -p smoke-logs
manifest="$dist/BUILD-MANIFEST-$platform.json"

case "$platform" in
  linux-x64)
    install="$HOME/apps"
    install() { mkdir -p "$install"; unzip -q "$1"/translationCore4-*-linux-x64.zip -d "$install"; }
    root="$install/translationCore 4"
    resources="$root/resources"
    start=(xvfb-run -a node "$here/app-starts.mjs" --exe "$root/translationCore4")
    appdata="$HOME/.config/translationCore4/app-data"
    uninstall() { rm -rf "$root"; }
    ;;
  windows-x64)
    # Git Bash would turn /VERYSILENT into a path, and the installer would wait on its wizard.
    install() { MSYS2_ARG_CONV_EXCL='*' "$(ls "$1"/translationCore4-*-windows-x64*.exe)" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER "/LOG=$(np "$PWD/smoke-logs/install-$2.log")"; }
    root="$(cygpath -u "$LOCALAPPDATA")/Programs/translationCore 4"
    resources="$root/resources"
    start=(node "$(np "$here/app-starts.mjs")" --exe "$(np "$root/electron.exe")")
    appdata="$(cygpath -u "$APPDATA")/translationCore4/app-data"
    uninstall() { MSYS2_ARG_CONV_EXCL='*' "$root/unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART; # Inno's uninstaller runs a copy of itself and removes the folder last.
      for _ in $(seq 60); do [ -e "$root" ] || break; sleep 1; done; }
    ;;
  macos-arm64)
    install() { sudo installer -pkg "$(ls "$1"/translationCore4-*-macos-arm64*.pkg)" -target /; }
    root="/Applications/translationCore 4.app"
    resources="$root/Contents/Resources"
    start=(node "$here/app-starts.mjs" --exe "$root/Contents/MacOS/Electron")
    appdata="$HOME/Library/Application Support/translationCore4/app-data"
    uninstall() { sudo rm -rf "$root"; }
    ;;
  *) echo "smoke-installed.sh: no platform $platform" >&2; exit 2 ;;
esac

# #1016: a translator who has the release before this one installs this build over it. One
# translationCore 4 is there afterwards, and what the older one wrote is still there.
copies() {
  case "$platform" in
    macos-arm64)
      find /Applications "$HOME/Applications" "$HOME/Desktop" "$HOME/Downloads" -maxdepth 3 -name '*.app' -prune -print 2> /dev/null | while IFS= read -r app; do
        [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2> /dev/null)" = org.unfoldingword.translationcore4 ] || continue
        [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$app/Contents/Info.plist" 2> /dev/null)" = "translationCore 4" ] || continue
        printf '%s\n' "$app"
      done || true ;; # find fails on a folder this Mac does not have
    windows-x64)
      # The install folders, and the entries Settings, Apps lists.
      ls -d "$(cygpath -u "$LOCALAPPDATA")/Programs/translationCore 4"* 2> /dev/null || true
      MSYS2_ARG_CONV_EXCL='*' reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' /s /v DisplayName 2> /dev/null | grep 'translationCore 4' || true ;;
  esac
}
upgrade_from=${TC4_UPGRADE_FROM:-}
if [ -n "$upgrade_from" ]; then
  [ "$platform" != linux-x64 ] || { echo "smoke-installed.sh: Linux is unzipped by hand; there is no install over" >&2; exit 2; }
  install "$upgrade_from" previous
  "${start[@]}" --app-data "$(np "$appdata")" 2>&1 | tee smoke-logs/previous-starts.txt
  older=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).commit)' "$(np "$(find "$root" -name BUILD-MANIFEST.json | head -1)")")
  [ -d "$HOME/translationCore4/projects" ] || { echo "FAIL the_older_build_made_its_projects_folder"; exit 1; }
  find "$appdata" "$HOME/translationCore4" -type f ! -name shell.log | sort > smoke-logs/previous-files.txt
  [ -s smoke-logs/previous-files.txt ] || { echo "FAIL the_older_build_wrote_app_data: $appdata is empty"; exit 1; }
  # The reported case: the older app also sits under another name, where the pkg does not write.
  [ "$platform" != macos-arm64 ] || sudo ditto "$root" "/Applications/translationCore 4 older.app"
  echo "ok the_previous_release_installs_and_starts: $older"
fi
install "$dist" first
if [ "$platform" = macos-arm64 ]; then
  # #1016: Finder and the receipt name the app's version, as the installer's file name does.
  version=$(basename "$(ls "$dist"/translationCore4-*-macos-arm64*.pkg)" | sed 's/^translationCore4-\(.*\)-macos-arm64.*$/\1/')
  shown=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$root/Contents/Info.plist")
  receipt=$(pkgutil --pkg-info org.unfoldingword.translationcore4 | sed -n 's/^version: //p')
  [ "$shown" = "$version" ] && [ "$receipt" = "$version" ] || { echo "FAIL the_installed_app_and_receipt_show_the_app_s_version: $version, but the app shows $shown and the receipt $receipt"; exit 1; }
  echo "ok the_installed_app_and_receipt_show_the_app_s_version: $version"
fi
if [ -n "$upgrade_from" ]; then
  copies | tee smoke-logs/copies.txt
  case "$platform" in macos-arm64) want=1 ;; windows-x64) want=2 ;; esac
  [ "$(grep -c . smoke-logs/copies.txt)" = "$want" ] || { echo "FAIL installing_over_leaves_one_translationcore_4"; exit 1; }
  echo "ok installing_over_leaves_one_translationcore_4"
  while IFS= read -r file; do
    [ -f "$file" ] || { echo "FAIL installing_over_keeps_app_data_and_projects: $file is gone"; exit 1; }
  done < smoke-logs/previous-files.txt
  echo "ok installing_over_keeps_app_data_and_projects"
  newer=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).commit)' "$(np "$manifest")")
  [ "$older" != "$newer" ] || { echo "FAIL the_previous_release_is_an_older_build: both are $older"; exit 1; }
fi

# #871: the translationCore mark, not Electron's, wherever the system shows the app's icon.
repo=$(cd "$here/../.." && pwd)
icon_is() { cmp -s "$1" "$repo/branding/$2" || { echo "FAIL the_app_icon_is_translationcore_s: $1 is not branding/$2"; exit 1; }; }
case "$platform" in
  linux-x64) icon_is "$resources/app/branding/icon-1024.png" icon-1024.png ;;
  windows-x64)
    icon_is "$root/icon.ico" icon.ico
    icon_is "$resources/app/branding/icon.ico" icon.ico
    # rcedit stores each of the .ico's images as an exe resource, byte for byte.
    node -e '
      const fs = require("fs");
      const [ico, exe] = process.argv.slice(1).map((f) => fs.readFileSync(f));
      for (let i = 0; i < ico.readUInt16LE(4); i++) {
        const at = 6 + 16 * i;
        const image = ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8));
        if (exe.indexOf(image) < 0) { console.log("FAIL the_app_icon_is_translationcore_s: electron.exe lacks image " + i); process.exit(1); }
      }
    ' "$(np "$repo/branding/icon.ico")" "$(np "$root/electron.exe")"
    ;;
  macos-arm64) icon_is "$resources/electron.icns" icon.icns ;;
esac
echo "ok the_app_icon_is_translationcore_s"

# The installed files are the ones the build recorded.
node -e '
  const [m, r] = process.argv.slice(1);
  const want = JSON.parse(require("fs").readFileSync(m, "utf8"));
  const got = JSON.parse(require("fs").readFileSync(r, "utf8"));
  if (want.commit !== got.commit || want.files.length !== got.files.length) { console.log("FAIL installed_manifest_is_the_build_s"); process.exit(1); }
  console.log("ok installed_manifest_is_the_build_s");
' "$(np "$manifest")" "$(np "$(dirname "$(find "$root" -name BUILD-MANIFEST.json | head -1)")/BUILD-MANIFEST.json")"
# INV-FINAL-MANIFEST-ACCURATE (#969): every installed file is the one the manifest records. Inno
# Setup's uninstaller is the only file beside them the manifest does not name.
extra=()
[ "$platform" != windows-x64 ] || extra=(--extra unins000.exe --extra unins000.dat --extra unins000.msg)
node "$(np "$here/manifest.mjs")" --check "$(np "$manifest")" --root "$(np "$root")" ${extra[@]+"${extra[@]}"} \
  || { echo "FAIL installed_files_are_the_manifest_s"; exit 1; }
echo "ok installed_files_are_the_manifest_s"
# INV-FINAL-MACOS-SEAL (#969): the installed bundle's ad-hoc seal is still valid, so the signature
# the build verified is the one the translator gets.
if [ "$platform" = macos-arm64 ]; then
  codesign --verify --deep --strict "$root" || { echo "FAIL installed_app_seal_is_valid"; exit 1; }
  echo "ok installed_app_seal_is_valid"
fi

"${start[@]}" --app-data "$(np "$appdata")" 2>&1 | tee smoke-logs/app-starts.txt
exe=tc4; [ "$platform" = windows-x64 ] && exe=tc4.exe
node "$(np "$here/smoke.mjs")" --tc4 "$(np "$resources/tc4/$exe")" --ui "$(np "$resources/tc4/ui")" \
  --bundle "$(np "$resources/tc4/bundle")" --manifest "$(np "$manifest")" 2>&1 | tee smoke-logs/smoke.txt
cp "$appdata/shell.log" smoke-logs/ 2> /dev/null || true

uninstall
[ ! -e "$root" ] || { echo "FAIL uninstall_removes_the_app: $root is still there, holding:"; find "$root" | head -20; exit 1; }
echo "ok uninstall_removes_the_app"
[ -f "$appdata/app.lock" ] || [ -d "$appdata/resources" ] || { echo "FAIL uninstall_keeps_app_data: $appdata is gone"; exit 1; }
echo "ok uninstall_keeps_app_data"
[ -d "$HOME/translationCore4/projects" ] || { echo "FAIL uninstall_keeps_the_projects_folder"; exit 1; }
echo "ok uninstall_keeps_the_projects_folder"
made=$(sed -n 's/^projects folder: //p' smoke-logs/smoke.txt | tr -d '\r')
[ -n "$made" ] && [ -n "$(ls -A "$(cygpath -u "$made" 2> /dev/null || printf '%s' "$made")")" ] || { echo "FAIL uninstall_keeps_the_smoke_project: $made"; exit 1; }
echo "ok uninstall_keeps_the_smoke_project"

# #46: back to an earlier version over the kept folders.
install "$previous" again
echo "ok a_reinstall_over_the_kept_folders_installs"
node "$(np "$here/smoke.mjs")" --tc4 "$(np "$resources/tc4/$exe")" --ui "$(np "$resources/tc4/ui")" \
  --bundle "$(np "$resources/tc4/bundle")" --reopen "$made" 2>&1 | tee smoke-logs/reopen.txt
