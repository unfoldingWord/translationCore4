#!/bin/zsh
# Register the built tC4 client with the dev rig and make it the landing client
# (OPEN-QUESTIONS #4 closure path; PLATFORM-NOTES #25: register FIRST, flip homepage
# SECOND, or the 0.18.x server panics at boot).
#
# Usage: npm run build && zsh scripts/rig-install.zsh
# Then restart the rig (dev-env/scripts/run.zsh). seed.zsh does NOT need to re-run
# for the client itself, but the merged i18n is write-once (bootstrap.rs): this
# script deletes state/work/i18n.json so the next boot regenerates it with our
# client's strings.
set -e
REPO=${0:a:h:h}
DEV="$REPO/../dev-env"
NAME=uw-tc4
DEST="$DEV/app-resources/clients/$NAME"

[ -d "$REPO/dist" ] || { echo "no dist/ — run npm run build first" >&2; exit 1 }

mkdir -p "$DEST"
rm -rf "$DEST/build"
cp -R "$REPO/dist" "$DEST/build"
cp "$REPO/rig/pankosmia_metadata.json" "$DEST/pankosmia_metadata.json"
cp "$REPO/rig/package.json" "$DEST/package.json"
cp "$REPO/rig/storage_id.json" "$DEST/storage_id.json"  # enables /api/client-settings/uw-tc4

python3 - "$DEV" "$NAME" <<'PY'
import json, sys, pathlib
dev, name = pathlib.Path(sys.argv[1]), sys.argv[2]
# 1. app_setup.json: add the client entry once
setup_p = dev / 'app-resources' / 'setup' / 'app_setup.json'
setup = json.loads(setup_p.read_text())
entry = {"path": f"%%PANKOSMIADIR%%/{name}"}
if entry not in setup['clients']:
    setup['clients'].append(entry)
    setup_p.write_text(json.dumps(setup, indent=4) + '\n')
    print(f'app_setup.json: added {name}')
else:
    print(f'app_setup.json: {name} already registered')
# 2. product.json: landing client = uw-tc4 (register-then-flip order holds:
#    the build/ dir was copied above, so boot will find the client)
prod_p = dev / 'app-resources' / 'product' / 'product.json'
prod = json.loads(prod_p.read_text())
if prod.get('homepage') != name:
    prod['homepage'] = name
    prod_p.write_text(json.dumps(prod, indent=4) + '\n')
    print(f'product.json: homepage -> {name}')
# 3. i18n.json is write-once — remove so next boot merges our client strings
i18n = dev / 'state' / 'work' / 'i18n.json'
if i18n.exists():
    i18n.unlink()
    print('state/work/i18n.json removed (regenerates at next boot)')
PY
echo "installed $NAME into the rig — restart dev-env/scripts/run.zsh"
