#!/bin/zsh
# Cache one pinned resource for the rig seed, through the app's own fetch/unwrap/
# re-zip code (dev-env/scripts/cache-resource.ts). Read-only against DCS.
#
#   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tn v66 [expectedSha]
set -e
DEV=${0:a:h:h}; ROOT=${0:a:h:h:h}
APP="$ROOT/translationCore4"
BUILD="$DEV/state/cache-resource.mjs"
mkdir -p "$DEV/state"
"$APP/node_modules/.bin/esbuild" "$DEV/scripts/cache-resource.ts" \
  --bundle --platform=node --format=esm --log-level=warning --outfile="$BUILD"
node "$BUILD" "$@"
