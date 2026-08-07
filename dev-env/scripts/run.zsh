#!/bin/zsh
# Run the rig server (foreground). PORT via $TC4_RIG_PORT (default 19998).
set -e
DEV=${0:a:h:h}
export APP_RESOURCES_DIR="$DEV/app-resources/"
export ROCKET_PORT=${TC4_RIG_PORT:-19998}
export ROCKET_ADDRESS=127.0.0.1
# Upload limits come from $DEV/server/Rocket.toml (six limits at 128MiB), copied from
# desktop-app-template — the same file every real Pankosmia product ships. Rocket resolves
# Rocket.toml from the process CWD upward, so we MUST cd into the server dir before exec;
# without the cd the file is invisible and Rocket silently falls back to its defaults
# (file=1MiB, form=2MiB), which is the condition that produced the wrong claim in
# PLATFORM-NOTES #26a. Verified 2026-08-04: with the cd and no ROCKET_LIMITS env var, the
# server reports `limits: … file = 128MiB, form = 128MiB` at startup and reads a 7.2MB
# sb-zip in full.
[ -f "$DEV/server/Rocket.toml" ] || { print -u2 "FATAL: $DEV/server/Rocket.toml missing — uploads would silently cap at 1MiB"; exit 1 }
[ -d "$DEV/state/work" ] || "$DEV/scripts/seed.zsh"
cd "$DEV/server"
exec "./target/release/tc4_dev_server" "$DEV/state/work/"
