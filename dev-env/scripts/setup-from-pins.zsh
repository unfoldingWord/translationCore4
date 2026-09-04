#!/bin/zsh
# One-time setup WITHOUT an assembled desktop-app build: assemble app-resources from
# the pinned upstream inputs, register the uw-tc4 client from dist/, build the server.
# This is the route for a clean clone and for the CI rig job
# (.github/workflows/rig.yml, L-1b of #154). setup.zsh stays the route when you have
# an assembled build (it carries the core clients; this route registers uw-tc4 only).
#
# The inputs and the pins are the ones scripts/package-desktop.zsh ships (the same
# recipe boots the desktop artifact). The guard below fails when the two files drift.
# Change a pin in both files, with docs/PACKAGING.md.
#
# ⛔ Read-only clones. Never a pankosmia remote on this repository, never a token.
#
# Usage: npm run build && zsh dev-env/scripts/setup-from-pins.zsh
# Then: zsh dev-env/scripts/seed.zsh && zsh dev-env/scripts/run.zsh
set -e
DEV=${0:a:h:h}; ROOT=${0:a:h:h:h}
IN="$DEV/upstream"   # disposable clones, gitignored

TEMPLATE_REPO="https://github.com/pankosmia/desktop-app-template.git"
TEMPLATE_REV="4cb757601b9310b3fccd52f77a6ae2238ceec9f4"   # 2026-08-14
RESOURCE_CORE_REPO="https://github.com/pankosmia/resource-core.git"
RESOURCE_CORE_REV="54802be780af18ab02e426dd59014bc6adb158af"   # 2026-08-14
WEBFONTS_CORE_REPO="https://github.com/pankosmia/webfonts-core.git"
WEBFONTS_CORE_REV="eb52ccdad6806b5729ea8b45b1c59c793ffa32c3"   # 2026-08-14

# Pin drift guard: the packaging script is the pin of record.
for v in TEMPLATE_REV RESOURCE_CORE_REV WEBFONTS_CORE_REV; do
  packaged=$(grep -E "^$v=" "$ROOT/scripts/package-desktop.zsh" | sed -E 's/^[A-Z_]+="([^"]+)".*/\1/')
  if [ "$packaged" != "${(P)v}" ]; then
    echo "pin drift: $v is ${(P)v} here and '$packaged' in scripts/package-desktop.zsh. Change both." >&2
    exit 1
  fi
done

[ -d "$ROOT/dist" ] || { echo "no dist/ — run npm run build first" >&2; exit 1 }

echo "== 1/4 fetch the pinned inputs (read-only)"
mkdir -p "$IN"
fetch_pinned() {  # $1 repo url, $2 dir, $3 rev
  if [ ! -d "$2/.git" ]; then git clone --quiet "$1" "$2"; else git -C "$2" fetch --quiet origin; fi
  git -C "$2" checkout --quiet "$3"
}
fetch_pinned "$TEMPLATE_REPO"      "$IN/desktop-app-template" "$TEMPLATE_REV"
fetch_pinned "$RESOURCE_CORE_REPO" "$IN/resource-core"        "$RESOURCE_CORE_REV"
fetch_pinned "$WEBFONTS_CORE_REPO" "$IN/webfonts-core"        "$WEBFONTS_CORE_REV"

echo "== 2/4 assemble app-resources"
RES="$DEV/app-resources"
rm -rf "$RES"
mkdir -p "$RES/setup" "$RES/product" "$RES/clients/uw-tc4" "$RES/webfonts" "$RES/app_resources"
cp -R "$IN/resource-core/runtime_resources/." "$RES/app_resources/"
cp -R "$IN/resource-core/templates" "$RES/templates"
cp -R "$IN/webfonts-core/." "$RES/webfonts/"
rm -rf "$RES/webfonts/.git"
# app_resources/product: resource-core does not ship it; the template does. Without
# i18n-overrides.json the server warns at boot (same step as package-desktop.zsh).
mkdir -p "$RES/app_resources/product"
cp -R "$IN/desktop-app-template/globalBuildResources/product_resources/." "$RES/app_resources/product/" 2>/dev/null || true
cp "$IN/desktop-app-template/globalBuildResources/i18n-overrides.json" "$RES/app_resources/product/"

echo "== 3/4 register the uw-tc4 client, isolate the store, name the product"
cp -R "$ROOT/dist" "$RES/clients/uw-tc4/build"
cp "$ROOT/rig/pankosmia_metadata.json" "$ROOT/rig/package.json" "$ROOT/rig/storage_id.json" "$RES/clients/uw-tc4/"
# Same isolation patch as setup.zsh: repo_dir lives INSIDE the rig working dir, never $HOME.
python3 - "$DEV" <<'PY'
import json, sys, pathlib
dev = pathlib.Path(sys.argv[1])
res = dev / 'app-resources'
us = res / 'templates' / 'user_settings.json'
s = us.read_text()
default = '%%HOMEDIR%%/pankosmia_repos'
if default not in s:
    raise SystemExit(f"user_settings template changed upstream: {default!r} not found; re-verify the isolation patch")
us.write_text(s.replace(default, '%%WORKINGDIR%%/repos'))
(res / 'setup' / 'local_setup.json').write_text(json.dumps({"local_pankosmia_path": str(res / 'clients')}))
(res / 'setup' / 'app_setup.json').write_text(json.dumps({"clients": [{"path": "%%PANKOSMIADIR%%/uw-tc4"}]}, indent=4) + '\n')
print('patched: repo_dir -> %%WORKINGDIR%%/repos ; clients -> uw-tc4 only')
PY
# homepage=uw-tc4 is safe here: the client was registered above (PLATFORM-NOTES #25:
# register FIRST, or the 0.18.x server panics at boot).
print -r -- '{ "short_name": "tc4rig", "name": "tC4 dev rig", "version": "0.1.0", "datetime": "2026-07-18T00:00:00Z", "homepage": "uw-tc4" }' > "$RES/product/product.json"

echo "== 4/4 build the pinned server (pankosmia-web 0.18.5, 99fd9be)"
cd "$DEV/server" && cargo build --release
echo "setup complete: $RES"
