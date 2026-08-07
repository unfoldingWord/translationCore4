#!/bin/zsh
# One-time: build the pinned server + assemble app-resources from an existing
# desktop-app build. Set PANKOSMIA_ASSEMBLED_LIB to the `lib` directory of an
# assembled Pankosmia desktop-app build (the directory that holds app_resources,
# templates, webfonts, clients, setup).
set -e
DEV=${0:a:h:h}
SRC_LIB=${PANKOSMIA_ASSEMBLED_LIB:?set PANKOSMIA_ASSEMBLED_LIB to an assembled desktop-app lib directory}
[ -d "$SRC_LIB" ] || { echo "No assembled lib at $SRC_LIB (set PANKOSMIA_ASSEMBLED_LIB)"; exit 1; }
echo "== assembling app-resources from $SRC_LIB"
rm -rf "$DEV/app-resources"; mkdir -p "$DEV/app-resources"
for d in app_resources templates webfonts clients setup; do cp -R "$SRC_LIB/$d" "$DEV/app-resources/$d"; done
# isolation: repo_dir lives INSIDE the rig working dir, never $HOME
python3 - "$DEV" <<'PY'
import json,sys,re,pathlib
dev=pathlib.Path(sys.argv[1])
us=dev/'app-resources/templates/user_settings.json'
s=us.read_text().replace('%%HOMEDIR%%/pankosmia_repos','%%WORKINGDIR%%/repos')
us.write_text(s)
ls=dev/'app-resources/setup/local_setup.json'
ls.write_text(json.dumps({"local_pankosmia_path":str(dev/'app-resources/clients')}))
print("patched: repo_dir -> %%WORKINGDIR%%/repos ; local_pankosmia_path ->", dev/'app-resources/clients')
PY
# 0.17.0+ requires product/product.json (new since 0.16.x).
# `homepage` is REQUIRED in practice since 0.18.0 ("No more main"): the server no longer
# hardcodes /clients/main, it panics unless a client is registered at /clients/<homepage>,
# and the default is "dashboard". The bundled core-client-dashboard declares
# `"homepage": "/clients/main"`, so the rig must say `main` — not `dashboard`.
# tC4 is the landing client since Increment 1 (OPEN-QUESTIONS #4): homepage=uw-tc4.
# translationCore4/scripts/rig-install.zsh must have registered the client (build/
# copied under app-resources/clients/uw-tc4) BEFORE the server boots with this
# value, or the 0.18.x server panics (PLATFORM-NOTES #25). If you need the dashboard
# rig without the tC4 client, set homepage back to "main" by hand.
mkdir -p "$DEV/app-resources/product"
if [ -d "$DEV/app-resources/clients/uw-tc4/build" ]; then HP=uw-tc4; else HP=main; fi
print -r -- '{ "short_name": "tc4rig", "name": "tC4 dev rig", "version": "0.1.0", "datetime": "2026-07-18T00:00:00Z", "homepage": "'$HP'" }' > "$DEV/app-resources/product/product.json"
echo "== building pinned server (pankosmia_web 0.18.5 git-rev pin, D27 update)"
cd "$DEV/server" && cargo build --release
echo "setup complete"
