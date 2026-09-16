#!/bin/zsh
# Cache one pinned resource for the rig seed, through the app's own fetch/unwrap/
# re-zip code (dev-env/scripts/cache-resource.ts). Read-only against DCS.
#
#   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tn v66 [expectedSha]
set -e
source "${0:a:h}/lib.zsh"
DEV=${0:a:h:h}
APP=${0:a:h:h:h}   # the repository root (dev-env/ lives inside it)
BUILD="$DEV/state/cache-resource.mjs"
mkdir -p "$DEV/state" "$DEV/resources-cache"
"$APP/node_modules/.bin/esbuild" "$(npath "$DEV/scripts/cache-resource.ts")" \
  --bundle --platform=node --format=esm --log-level=warning --outfile="$(npath "$BUILD")"
node "$(npath "$BUILD")" "$@"
