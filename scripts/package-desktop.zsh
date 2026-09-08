#!/bin/zsh
# Build an UNSIGNED desktop artifact for tC4: macOS arm64 (#57), Linux x64 (#119),
# Windows x64 (#181).
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
#   Windows runs the script under MSYS2's zsh (packages zsh, zip, unzip, curl)
#   with the Windows node, cargo (MSVC) and git on the PATH; the smoke test
#   opens a real window on the runner's desktop (#181).
set -e

REPO=${0:a:h:h}
BUILD="$REPO/dist-desktop"
PACK="$BUILD/pack"
ARCH=$(uname -m | sed 's/x86_64/x64/')

# Build host (#119, #181). OS names the artifact; EL_OS names the Electronite
# asset. MSYS2 reports MSYS_NT-* (or MINGW64_NT-*) for a Windows host.
case "$(uname -s)" in
  Darwin)                 OS=macos;   EL_OS=darwin ;;
  Linux)                  OS=linux;   EL_OS=linux  ;;
  MSYS*|MINGW*|CYGWIN*)   OS=windows; EL_OS=win32  ;;
  *) echo "Unsupported build host '$(uname -s)' — macOS, Linux and Windows (MSYS2) only." >&2; exit 1 ;;
esac

# Portable helpers: the hosts differ on these tools.
sha256_of() {    # coreutils on Linux and MSYS2, BSD shasum on macOS
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sed_inplace() {  # BSD sed demands an empty backup suffix; GNU sed refuses one
  local expr=$1; shift
  if [ "$OS" = macos ]; then sed -i '' "$expr" "$@"; else sed -i "$expr" "$@"; fi
}
npath() {        # a path for the Windows node.exe: MSYS2 /d/a/x -> D:/a/x (#181)
  if [ "$OS" = windows ]; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
VERSION=$(node -p "require('$(npath "$REPO/package.json")').version")
# The smoke test's HTTP probe. On Windows, Windows' own curl.exe: the MSYS2 curl
# timed out (not refused) on every closed loopback port in CI run 34174403634.
CURL=curl
if [ "$OS" = windows ] && [ -x /c/Windows/System32/curl.exe ]; then CURL=/c/Windows/System32/curl.exe; fi
# The server binary and the home-directory variable as the platform names them.
if [ "$OS" = windows ]; then EXE=".exe"; SERVER_BIN="server.exe"; HOME_LABEL='%USERPROFILE%'
else                         EXE="";     SERVER_BIN="server.bin"; HOME_LABEL='$HOME'; fi

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
ELECTRONITE_SHA256_WINDOWS_X64="8146ca21fa090e12bca01a8af73d234d9a31d90f51da0da86bb0e1731c371b52"   # #181, measured 2026-09-07
TEMPLATE_REPO="https://github.com/pankosmia/desktop-app-template.git"
TEMPLATE_REV="4cb757601b9310b3fccd52f77a6ae2238ceec9f4"   # 2026-08-14
RESOURCE_CORE_REPO="https://github.com/pankosmia/resource-core.git"
RESOURCE_CORE_REV="54802be780af18ab02e426dd59014bc6adb158af"   # 2026-08-14
WEBFONTS_CORE_REPO="https://github.com/pankosmia/webfonts-core.git"
WEBFONTS_CORE_REV="eb52ccdad6806b5729ea8b45b1c59c793ffa32c3"   # 2026-08-14
PUPPETEER_CORE_VER="24.43.1"       # template package.json: ^24.43.1
PUPPETEER_BROWSERS_VER="2.13.1"    # template package.json: ^2.13.1

# Bundled English suite (#163, D70). Eight repos pinned from src/data/installedSuite.js.
# en_tw serves both translationWords and translationWordsLinks (D34).
BUNDLED_RESOURCES=(
  "en_ult:v89:84c73ba00fc8a95a9033f9efb14bb905a2a52ee4"
  "en_ust:v89:37ec223166bbd73fb55abc7840be8310c0fee7f2"
  "el-x-koine_ugnt:v0.34:fc95b2b8aad08bb65ab54628ab685413a1139e97"
  "hbo_uhb:v2.1.30:106a441a788d9465846cd427538ea80b8cec6770"
  "en_tn:v86:c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5"
  "en_tw:v87:eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd"
  "en_ta:v86:c7caddfb474efd713f36b35a3ffc927866c7b180"
  "en_tq:v89:97c0a13e3b84d46d0e643ba2e8e9f1c295547a58"
)

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
  windows-x64) ELECTRONITE_SHA256="$ELECTRONITE_SHA256_WINDOWS_X64" ;;
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
# macOS ships an app bundle; Linux and Windows ship a flat directory with an
# `electron` (`electron.exe`) binary. All unpack into $BUILD/electronite, and
# all put LICENSE and LICENSES.chromium.html at that root.
if [ "$OS" = macos ]; then EL_UNPACKED="$BUILD/electronite/Electron.app"
else                       EL_UNPACKED="$BUILD/electronite/electron$EXE"; fi
if [ ! -e "$EL_UNPACKED" ]; then
  mkdir -p "$BUILD/electronite"
  unzip -qq -o "$BUILD/$ELECTRONITE_ZIP" -d "$BUILD/electronite"
fi

echo "== fetching bundled English suite (8 repos, #163)"
for entry in "${BUNDLED_RESOURCES[@]}"; do
  repo="${entry%%:*}"
  rest="${entry#*:}"
  tag="${rest%%:*}"
  sha="${rest#*:}"
  zsh "$REPO/dev-env/scripts/cache-resource.zsh" "unfoldingWord/$repo" "$tag" "$sha"
  echo "SHA OK: unfoldingWord/$repo $tag ($sha)"
done

echo "== 4/7 assemble the app directory"
rm -rf "$PACK"
mkdir -p "$PACK/bin" "$PACK/lib/setup" "$PACK/lib/clients/uw-tc4" "$PACK/lib/product" "$PACK/resources"
for entry in "${BUNDLED_RESOURCES[@]}"; do
  repo="${entry%%:*}"
  rest="${entry#*:}"
  tag="${rest%%:*}"
  unwrapped="$REPO/dev-env/resources-cache/$repo-$tag-unwrapped.zip"
  target="$PACK/resources/unfoldingword--$repo"
  rm -rf "$target"
  mkdir -p "$target"
  unzip -qq -o "$unwrapped" -d "$target"
done

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
TEMPLATE_MAIN=$(node -p "require('$(npath "$PACK/electron/package.json")').main")
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
const p = '$(npath "$PACK/electron/package.json")';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.main = 'tc4-main.js';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"
fi

# The template's startup script spawns ./bin/server.bin, or ./bin/server.exe on
# win32 (electronStartup.js, WIN_SERVER_PATH).
cp "$REPO/dev-env/server/target/release/tc4_dev_server$EXE" "$PACK/bin/$SERVER_BIN"
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
  # node, not python: node is a build requirement on every host; python is not
  # on the MSYS2 shell's PATH (#181). Same check, same patch, same output.
  node -e '
const fs = require("fs");
const [p, leaf] = process.argv.slice(1);
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const dflt = "%%HOMEDIR%%/pankosmia_repos";
if (d.repo_dir !== dflt) {
  console.error(`user_settings template changed upstream: repo_dir is ${JSON.stringify(d.repo_dir)}, expected ${JSON.stringify(dflt)} — re-verify #70 isolation before building`);
  process.exit(1);
}
d.repo_dir = `%%HOMEDIR%%/${leaf}`;
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log(`repo_dir pinned to %%HOMEDIR%%/${leaf} (#70)`);
' "$(npath "$PACK/lib/templates/user_settings.json")" "$STORE_LEAF"
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
elif [ "$OS" = windows ]; then
# Windows (#181): a flat directory with electron.exe, no signature, no
# permission bits. Stage it under electronite/ like Linux.
mkdir -p "$APPDIR/electronite"
cp -R "$BUILD/electronite/." "$APPDIR/electronite/"
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
cp -R "$PACK/resources" "$APPDIR/resources"
cp "$PACK/Rocket.toml" "$APPDIR/Rocket.toml"

# The launcher differs per OS in three places only: its filename, how it
# finds its own directory, and how it invokes Electronite. The debug seeding
# step below is identical on macOS and Linux. Windows is a batch file with the
# same steps (#181), written by write_windows_launcher below.
write_windows_launcher() {  # $1 = store leaf, $2 = variant
  local leaf_win=${1//\//\\}
  # print -r, not echo: zsh's echo turns the "\t" of "\tc4-projects" into a tab.
  {
    print -r -- '@echo off'
    if [ "$2" = debug ]; then
      print -r -- 'rem Unsigned DEBUG artifact. Seeds the debug-only project store on first run'
      print -r -- 'rem (never the shared %USERPROFILE%\pankosmia_repos), then starts Electronite;'
      print -r -- 'rem the startup script spawns the bundled server itself.'
    else
      print -r -- 'rem Unsigned development artifact. Starts Electronite; the startup script'
      print -r -- 'rem spawns the bundled server itself.'
    fi
    print -r -- 'cd /d "%~dp0"'
    print -r -- "set \"STORE=%USERPROFILE%\\$leaf_win\""
    print -r -- 'if exist "resources\" ('
    print -r -- '  for /d %%R in ("resources\*") do ('
    print -r -- '    if not exist "%STORE%\_local_\_sideloaded_\%%~nxR\" ('
    print -r -- '      if not exist "%STORE%\_local_\_sideloaded_\" mkdir "%STORE%\_local_\_sideloaded_"'
    print -r -- '      xcopy /E /I /Q /Y "%%R" "%STORE%\_local_\_sideloaded_\%%~nxR" >nul'
    print -r -- '    )'
    print -r -- '  )'
    print -r -- ')'
    if [ "$2" = debug ]; then
      print -r -- 'set "SEED=%STORE%\_local_\_local_\sample_burrito"'
      print -r -- 'where git >nul 2>&1'
      print -r -- 'if not errorlevel 1 if not exist "%SEED%\" ('
      print -r -- '  if not exist "%STORE%\_local_\_local_\" mkdir "%STORE%\_local_\_local_"'
      print -r -- '  xcopy /E /I /Q /Y "debug-seeds\sample_burrito" "%SEED%" >nul'
      print -r -- '  rem Initial commit: the platform add-and-commit panics on a repo with'
      print -r -- '  rem zero commits (PLATFORM-NOTES #20).'
      print -r -- '  pushd "%SEED%"'
      print -r -- '  git init -q -b main . && git add -A && git -c user.email=debug@tc4.local -c user.name=tc4-debug commit -qm seed'
      print -r -- '  popd'
      print -r -- ')'
    fi
    print -r -- 'electronite\electron.exe electron'
  } > "$APPDIR/$LAUNCHER"
}
if [ "$OS" = windows ]; then
  LAUNCHER="start-tc4.cmd"
elif [ "$OS" = macos ]; then
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
fi
if [ "$OS" = windows ]; then
  write_windows_launcher "$STORE_LEAF" "$VARIANT"
elif [ "$VARIANT" = "debug" ]; then
  cat > "$APPDIR/$LAUNCHER" <<LAUNCH
$LAUNCH_SHEBANG
# Unsigned DEBUG artifact. Seeds the debug-only project store on first run
# (never the shared \$HOME/pankosmia_repos), then starts Electronite; the
# startup script spawns the bundled server itself.
$LAUNCH_CD
STORE="\$HOME/pankosmia/tc4-projects-debug"
if [ -d "./resources" ]; then
  for res in ./resources/*; do
    [ -d "\$res" ] || continue
    seg="\${res##*/}"
    dest="\$STORE/_local_/_sideloaded_/\$seg"
    if [ ! -d "\$dest" ]; then
      mkdir -p "\$STORE/_local_/_sideloaded_"
      cp -R "\$res" "\$dest"
    fi
  done
fi
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
STORE="\$HOME/pankosmia/tc4-projects"
if [ -d "./resources" ]; then
  for res in ./resources/*; do
    [ -d "\$res" ] || continue
    seg="\${res##*/}"
    dest="\$STORE/_local_/_sideloaded_/\$seg"
    if [ ! -d "\$dest" ]; then
      mkdir -p "\$STORE/_local_/_sideloaded_"
      cp -R "\$res" "\$dest"
    fi
  done
fi
$LAUNCH_EXEC
LAUNCH
fi
chmod +x "$APPDIR/$LAUNCHER"

# Licenses. The startup files in electron/ are modified copies from the MIT
# desktop-app-template; Electronite ships its own LICENSE files in the zip.
cp "$REPO/LICENSE" "$APPDIR/LICENSE"
# #45: the post-install smoke test travels with the artifact, so a pilot on a clean
# machine can run it (zsh smoke-installed.zsh) with nothing but the folder and a
# shell. CI runs this shipped copy on a fresh runner (package-desktop.yml, smoke-*).
cp "$REPO/scripts/smoke-installed.zsh" "$APPDIR/smoke-installed.zsh"
chmod +x "$APPDIR/smoke-installed.zsh"
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
| pankosmia-web server (bin/$SERVER_BIN) | 0.18.5 (99fd9be) | MIT | github.com/pankosmia/pankosmia-web |
| resource-core (lib/app_resources, lib/templates) | $RESOURCE_CORE_REV | MIT | github.com/pankosmia/resource-core |
| webfonts-core (lib/webfonts; fonts carry their own licenses, mostly SIL OFL) | $WEBFONTS_CORE_REV | MIT (repo); per-font licenses inside | github.com/pankosmia/webfonts-core |
| puppeteer-core (electron/node_modules) | $PUPPETEER_CORE_VER | Apache-2.0 | github.com/puppeteer/puppeteer |
| @puppeteer/browsers (electron/node_modules) | $PUPPETEER_BROWSERS_VER | Apache-2.0 | github.com/puppeteer/puppeteer |
NOTICES
for entry in "${BUNDLED_RESOURCES[@]}"; do
  repo="${entry%%:*}"
  rest="${entry#*:}"
  tag="${rest%%:*}"
  echo "| unfoldingWord/$repo | $tag | CC BY-SA 4.0 | git.door43.org/unfoldingWord/$repo |" >> "$APPDIR/THIRD-PARTY-NOTICES.md"
done
cat >> "$APPDIR/THIRD-PARTY-NOTICES.md" <<NOTICES

npm dependency license texts remain in electron/node_modules/*/LICENSE.
NOTICES

# Input manifest: every component with its exact version/commit/checksum.
SERVER_SHA=$(sha256_of "$APPDIR/bin/$SERVER_BIN")
BUNDLED_MANIFEST_ENTRIES=""
for entry in "${BUNDLED_RESOURCES[@]}"; do
  repo="${entry%%:*}"
  rest="${entry#*:}"
  tag="${rest%%:*}"
  sha="${rest#*:}"
  zip_sha=$(sha256_of "$REPO/dev-env/resources-cache/$repo-$tag-unwrapped.zip")
  line="    { \"repoPath\": \"git.door43.org/unfoldingWord/$repo\", \"version\": \"$tag\", \"sha\": \"$sha\", \"zip_sha256\": \"$zip_sha\" }"
  if [ -n "$BUNDLED_MANIFEST_ENTRIES" ]; then
    BUNDLED_MANIFEST_ENTRIES="$BUNDLED_MANIFEST_ENTRIES,
$line"
  else
    BUNDLED_MANIFEST_ENTRIES="$line"
  fi
done

cat > "$APPDIR/BUILD-MANIFEST.json" <<MANIFEST
{
  "artifact": "tC4-$VERSION-$OS-$ARCH-unsigned",
  "variant": "$VARIANT",
  "project_store": "$HOME_LABEL/$STORE_LEAF (#70 — never $HOME_LABEL/pankosmia_repos)",
  "built_utc": "$DATETIME",
  "bundled_resources": [
$BUNDLED_MANIFEST_ENTRIES
  ],
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
# Windows (#181): the server resolves its home through the `home` crate, which
# reads USERPROFILE first (pankosmia-web utils/paths.rs), so the fresh profile
# is passed as USERPROFILE in Windows form. The launcher is a batch file: cmd
# runs it, with MSYS2's argument conversion off so the path stays as given.
# Windows: the fresh profile is passed as USERPROFILE (the server's `home`
# crate reads it first). Two things must come with it, measured in CI runs
# 34176032154-34178970511 (#181): Windows expands its shell folders from
# %USERPROFILE% (AppData\Local, AppData\Roaming), and Chromium dies with
# EXCEPTION_BREAKPOINT before its logging starts when they do not exist, so
# the smoke home gets them and APPDATA/LOCALAPPDATA name them (Electron's
# userData, and with it the #4 singleton lock, then live under the smoke
# home too); and the MSYS2 profile exports TMP=/tmp and TEMP=/tmp (POSIX
# form) to every native child, so the launch gets a Windows-form temp dir.
win_env() {  # the environment of a native Windows launch from this shell
  mkdir -p "$SMOKE_HOME/tmp" "$SMOKE_HOME/AppData/Local" "$SMOKE_HOME/AppData/Roaming"
  local whome wtmp; whome="$(cygpath -w "$SMOKE_HOME")"; wtmp="$(cygpath -w "$SMOKE_HOME/tmp")"
  print -r -- "USERPROFILE=$whome HOME=$SMOKE_HOME APPDATA=$whome\\AppData\\Roaming LOCALAPPDATA=$whome\\AppData\\Local TEMP=$wtmp TMP=$wtmp MSYS2_ARG_CONV_EXCL=* ELECTRON_ENABLE_STACK_DUMPING=1"
}
launch_entry_point() {  # $1 = log file; sets LAUNCH_PID
  if [ "$OS" = windows ]; then
    # ELECTRON_ENABLE_LOGGING=file: a Windows GUI process prints nothing to the
    # redirect; the main process logs to ${1%.log}-electron.log instead.
    env $(win_env) ELECTRON_ENABLE_LOGGING=file ELECTRON_LOG_FILE="$(cygpath -w "${1%.log}-electron.log")" \
      ELECTRON_ENABLE_STACK_DUMPING=1 \
      cmd /c "$(cygpath -w "$APPDIR/$LAUNCHER")" > "$1" 2>&1 &
  else
    HOME="$SMOKE_HOME" "$APPDIR/$LAUNCHER" > "$1" 2>&1 &
  fi
  LAUNCH_PID=$!
}
if [ "$OS" = windows ]; then
  # Does the wrapper run at all on this host? --version exits at once; node
  # mode proves the binary loads without a window. Both print exit codes.
  echo "electron.exe --version: $(env $(win_env) "$APPDIR/electronite/electron.exe" --version 2>&1 | tr -d '\r' | head -2 | tr '\n' ' '; echo "(exit ${pipestatus[1]})")"
  echo "electron.exe node mode: $(env $(win_env) ELECTRON_RUN_AS_NODE=1 "$APPDIR/electronite/electron.exe" -p 'process.versions.electron' 2>&1 | tr -d '\r' | head -2 | tr '\n' ' '; echo "(exit ${pipestatus[1]})")"
fi
launch_entry_point "$BUILD/smoke-entrypoint.log"
SMOKE_PID=$LAUNCH_PID
cleanup_smoke() {
  if [ "$OS" = macos ]; then pkill -f "$APPDIR/Electron.app" 2>/dev/null || true
  elif [ "$OS" = windows ]; then
    # Stop only the processes that run from the staged folder (the same path
    # filter as the pkill -f branches): electron.exe and the server it spawned,
    # matched by executable path, never by name alone (Codex review round 1).
    local appwin; appwin="$(cygpath -w "$APPDIR")"
    MSYS2_ARG_CONV_EXCL='*' powershell -NoProfile -Command \
      "Get-Process electron,server -ErrorAction SilentlyContinue | Where-Object { \$_.Path -and \$_.Path.StartsWith('$appwin', [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force" \
      >/dev/null 2>&1 || true
  else                       pkill -f "$APPDIR/electronite/electron" 2>/dev/null || true; fi
  kill $SMOKE_PID 2>/dev/null || true
}
trap cleanup_smoke EXIT

# Windows (#181): what the runner can tell when the boot goes wrong. Printed on
# a failed wait, and the probe timing once before it: a closed loopback port
# must answer "refused" in milliseconds, not time out.
smoke_diagnostics() {
  [ "$OS" = windows ] || return 0
  echo "-- diagnostics (windows) --"
  echo "probe of a closed port: $("$CURL" -s --max-time 2 -o /dev/null -w 'http %{http_code}, %{time_total}s' "http://127.0.0.1:19999/api/version" 2>&1; echo " exit $?")"
  echo "processes:"; MSYS2_ARG_CONV_EXCL='*' tasklist 2>/dev/null | grep -i -E "electron|server\.exe|cmd\.exe" || echo "  (no electron/server/cmd)"
  echo "listeners 191xx:"; MSYS2_ARG_CONV_EXCL='*' netstat -ano -p tcp 2>/dev/null | grep -E ":191[0-9][0-9] " || echo "  (none)"
  echo "smoke home:"; find "$SMOKE_HOME" -maxdepth 3 2>/dev/null | head -20
  for f in "$BUILD"/smoke-*.log; do echo "-- $f --"; cat -v "$f" | tail -40; done
}
[ "$OS" = windows ] && echo "probe of a closed port before the wait: $("$CURL" -s --max-time 2 -o /dev/null -w 'http %{http_code}, %{time_total}s' "http://127.0.0.1:19999/api/version" 2>&1; echo " exit $?")"

# The ports worth probing. macOS and Linux refuse a closed port at once, so
# every scan port is cheap. On this Windows runner a closed loopback port
# times out (2.6 s, run 34176032154), so netstat names the listeners first.
scan_ports() {
  if [ "$OS" = windows ]; then
    MSYS2_ARG_CONV_EXCL='*' netstat -ano -p tcp 2>/dev/null | grep LISTENING | grep -oE ':191(19|[23][0-9]) ' | tr -d ': ' | sort -u | tr '\n' ' '
  else
    echo {19119..19139}
  fi
}

# Find the self-chosen port (electronStartup starts at 19119).
SMOKE_PORT=""
for i in {1..40}; do
  for p in $(scan_ports); do
    if "$CURL" -s --max-time 1 "http://127.0.0.1:$p/api/version" | grep -q '"product_short_name":"tc4"'; then
      SMOKE_PORT=$p; break
    fi
  done
  [ -n "$SMOKE_PORT" ] && break
  sleep 1
done
[ -n "$SMOKE_PORT" ] || { echo "SMOKE TEST FAILED: self-spawned server not found on 19119-19139" >&2
  tail -20 "$BUILD/smoke-entrypoint.log" >&2; smoke_diagnostics >&2; exit 1; }
echo "self-spawned server found on port $SMOKE_PORT"

ROOT=$("$CURL" -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:$SMOKE_PORT/")
CLIENT=$("$CURL" -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/clients/uw-tc4")
echo "root: $ROOT; /clients/uw-tc4: $CLIENT"

# #4 GUARD (D39): a second launch must NOT become a second running copy.
# With the first instance still up, launch the entry point AGAIN (same HOME —
# the singleton lock keys on the app's userData under this HOME). The second
# process must exit BY ITSELF, no second tc4 server may appear on any scan
# port, and the first server must still answer. Without the tc4-main.js
# wrapper this fails: the template's port scan starts a second server over
# the same project store.
launch_entry_point "$BUILD/smoke-second-instance.log"
SECOND_PID=$LAUNCH_PID
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
for p in $(scan_ports); do
  [ "$p" = "$SMOKE_PORT" ] && continue
  "$CURL" -s --max-time 1 "http://127.0.0.1:$p/api/version" | grep -q '"product_short_name":"tc4"' && SECOND_SERVERS=$((SECOND_SERVERS+1))
done
[ "$SECOND_SERVERS" = "0" ] || {
  echo "#4 GUARD FAILED: a second tc4 server appeared on another port — the second launch spawned a server" >&2
  exit 1
}
"$CURL" -s --max-time 2 "http://127.0.0.1:$SMOKE_PORT/api/version" | grep -q '"product_short_name":"tc4"' || {
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
RESOLVED_REPO_DIR=$(node -p "require('$(npath "$US")').repo_dir")
print -r -- "resolved repo_dir: $RESOLVED_REPO_DIR"   # print -r: a Windows path holds \t and \a
case "$RESOLVED_REPO_DIR" in
  *pankosmia_repos*)
    echo "#70 GUARD FAILED: resolved repo_dir is the shared pankosmia_repos store — release-blocking (owner ruling 2026-08-14)" >&2
    exit 1 ;;
esac
EXPECTED_REPO_DIR="$SMOKE_HOME/$STORE_LEAF"
if [ "$OS" = windows ]; then
  # The server writes the profile in Windows form (C:\Users\...\smoke-home,
  # then the template's forward slashes). Compare and use the MSYS2 form; the
  # file system is case-insensitive, so compare lower-case.
  RESOLVED_REPO_DIR=$(cygpath -u "$RESOLVED_REPO_DIR")
  [ "${RESOLVED_REPO_DIR:l}" = "${EXPECTED_REPO_DIR:l}" ] || {
    echo "#70 GUARD FAILED: repo_dir '$RESOLVED_REPO_DIR' is not the expected isolated store '$EXPECTED_REPO_DIR'" >&2
    exit 1; }
  RESOLVED_REPO_DIR="$EXPECTED_REPO_DIR"
else
  [ "$RESOLVED_REPO_DIR" = "$EXPECTED_REPO_DIR" ] || {
    echo "#70 GUARD FAILED: repo_dir '$RESOLVED_REPO_DIR' is not the expected isolated store '$EXPECTED_REPO_DIR'" >&2
    exit 1; }
fi
if [ "$VARIANT" = "debug" ]; then
  [ -f "$RESOLVED_REPO_DIR/_local_/_local_/sample_burrito/metadata.json" ] || {
    echo "#70 GUARD FAILED: debug store missing the seeded sample burrito" >&2; exit 1; }
  echo "debug store seeded at $RESOLVED_REPO_DIR (separate from production store)"
else
  if [ -e "$RESOLVED_REPO_DIR/_local_/_local_" ]; then
    echo "#70 GUARD FAILED: production store contains _local_/_local_ entry" >&2
    ls -R "$RESOLVED_REPO_DIR" >&2; exit 1
  fi
  top_entries=($(ls -A "$RESOLVED_REPO_DIR" 2>/dev/null))
  if [ "${#top_entries[@]}" -ne 1 ] || [ "${top_entries[1]}" != "_local_" ]; then
    echo "#70 GUARD FAILED: production store top-level holds entries other than _local_: ${top_entries[*]}" >&2
    ls -R "$RESOLVED_REPO_DIR" >&2; exit 1
  fi
  local_entries=($(ls -A "$RESOLVED_REPO_DIR/_local_" 2>/dev/null))
  if [ "${#local_entries[@]}" -ne 1 ] || [ "${local_entries[1]}" != "_sideloaded_" ]; then
    echo "#70 GUARD FAILED: production store _local_ holds entries other than _sideloaded_: ${local_entries[*]}" >&2
    ls -R "$RESOLVED_REPO_DIR" >&2; exit 1
  fi
  sideloaded_entries=($(ls -A "$RESOLVED_REPO_DIR/_local_/_sideloaded_" 2>/dev/null | sort))
  expected_segments=()
  for entry in "${BUNDLED_RESOURCES[@]}"; do
    repo="${entry%%:*}"
    expected_segments+=("unfoldingword--$repo")
  done
  expected_segments=($(printf '%s\n' "${expected_segments[@]}" | sort))
  if [ "${sideloaded_entries[*]}" != "${expected_segments[*]}" ]; then
    echo "#70 GUARD FAILED: production store seeded segments mismatch" >&2
    echo "  expected: ${expected_segments[*]}" >&2
    echo "  got:      ${sideloaded_entries[*]}" >&2
    exit 1
  fi
  for seg in "${expected_segments[@]}"; do
    if [ ! -f "$RESOLVED_REPO_DIR/_local_/_sideloaded_/$seg/metadata.json" ]; then
      echo "#70 GUARD FAILED: production store missing metadata.json in $seg" >&2
      exit 1
    fi
  done
  echo "production store holds only _local_/_sideloaded_/ with seeded English suite on first boot (isolated at $RESOLVED_REPO_DIR)"
fi

echo "== 7/7 zip the artifact"
ZIP="$BUILD/tC4-$VERSION-$OS-$ARCH-unsigned.zip"
rm -f "$ZIP"
cd "$STAGE"
if [ "$OS" = macos ]; then
  ditto -c -k --keepParent "$APP_NAME" "$ZIP"
else
  # -y stores symlinks as symlinks; zip keeps the executable bits the
  # launcher and the Electronite binaries need. Windows (#181) uses the same
  # zip (MSYS2 package); permission bits do not apply there.
  zip -qry "$ZIP" "$APP_NAME"
fi
echo "artifact: $ZIP"
echo "inputs: electronite $ELECTRONITE_TAG ($ELECTRONITE_SHA256); template $TEMPLATE_REV;"
echo "        resource-core $RESOURCE_CORE_REV; webfonts-core $WEBFONTS_CORE_REV;"
echo "        puppeteer-core $PUPPETEER_CORE_VER; @puppeteer/browsers $PUPPETEER_BROWSERS_VER"
