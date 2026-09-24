#!/bin/zsh
# Reset the rig to a pristine, deterministic state. Safe to run any time.
# Performs the working-dir initialization itself (template substitution), so
# every boot sees an identical, fully-specified state — no first-boot variance.
set -e
source "${0:a:h}/lib.zsh"
DEV=${0:a:h:h}; ROOT=${0:a:h:h:h}
WORK="$DEV/state/work"
rm -rf "$DEV/state"; mkdir -p "$WORK/repos/_local_/_local_" "$WORK/temp" "$WORK/blobs"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const [dev, work, resNative, clientsNative] = process.argv.slice(1);
const res = path.join(dev, "app-resources");
const appResources = resNative.endsWith("/") ? resNative : `${resNative}/`;
const substitute = (name) => fs.readFileSync(path.join(res, "templates", name), "utf8")
  .replaceAll("%%WORKINGDIR%%", work)
  .replaceAll("%%APPRESOURCESDIR%%", appResources)
  .replaceAll("%%PANKOSMIADIR%%", clientsNative)
  .replaceAll("%%HOMEDIR%%", work);
fs.writeFileSync(path.join(work, "user_settings.json"), substitute("user_settings.json"));
fs.writeFileSync(path.join(work, "app_state.json"), substitute("app_state.json"));
console.log("working dir initialized from templates (repo_dir isolated under", path.join(work, "repos"), ")");
' "$(npath "$DEV")" "$(npath "$WORK")" "$(npath "$DEV/app-resources")" "$(npath "$DEV/app-resources/clients")"
# seed the conforming sample project (regenerate if absent)
if [ ! -d "$ROOT/conformance/sample-burrito" ]; then (cd "$ROOT/conformance" && npm run generate); fi
cp -R "$ROOT/conformance/sample-burrito" "$WORK/repos/_local_/_local_/sample_burrito"
if [ ! -d "$WORK/repos/_local_/_local_/sample_burrito/.git" ]; then
  (cd "$WORK/repos/_local_/_local_/sample_burrito" && git init -q -b main . && git add -A && git -c user.email=rig@local -c user.name=rig commit -qm seed)
fi
# Issue #95: the LARGE fixture — Titus with 4000 saved edits, one journal segment
# each, built offline from the reference modules and converged by construction, so
# a project open reads thousands of segments and the slow-open journey can watch
# the progress indicator. Deterministic (same bytes every seed).
node "$(npath "$ROOT/scripts/seed-large-project.mjs")" "$(npath "$WORK/repos/_local_/_local_/sample_burrito_large")" --edits 4000
# A SECOND gateway-language suite (es-419_gl) rides along, so the two-language-set
# path (D17/D30 ladder, D23a gateway change, D36 carry-over) is exercisable on the
# rig. es-419_tn v66 covers 3JN/JON/RUT/TIT — TIT and JON are the rig's books, so a
# real primary rung exists. Build a cache entry with dev-env/scripts/cache-resource.zsh.
# Sideload cached burritos (v89 sb-zips, unwrapped form): the source texts
# en_ult/en_ust, plus the helps en_tn/en_tw/en_ta that a checking session needs
# (Increment 2 — J3/J4 journeys pin these, so the seed must supply them).
# Replicates POST /burrito/zipped exactly: plain unzip, no git init (verified against
# post_zipped_repo.rs at 0.18.5). The helps cache was produced by the app's own
# verified fetch — provenance (release tag + commit revision per resource) is in
# resources-cache/helps-provenance.json. If a cache entry is absent the rig still
# seeds, just without that resource.
# en_tq rides with the English package: D64/#110 made `translationQuestions` a
# §5.3 slot and the shipped English package pins it, so a rig without it cannot
# exercise the Understand screen's Questions tab.
for R in en_ult:v89 en_ust:v89 en_tn:v89 en_tw:v89 en_ta:v89 en_tq:v89 el-x-koine_ugnt:v0.34 \
         es-419_tn:v66 es-419_tw:v37 es-419_ta:v4 \
         en_obs:v9 en_obs-tn:v13 en_obs-twl:v3 en_obs-tq:v10; do
  N="${R%%:*}"; V="${R##*:}"
  Z="$DEV/resources-cache/$N-$V-unwrapped.zip"
  if [ -f "$Z" ] && [ ! -d "$WORK/repos/_local_/_sideloaded_/$N" ]; then
    mkdir -p "$WORK/repos/_local_/_sideloaded_/$N"
    unzip -q "$Z" -d "$WORK/repos/_local_/_sideloaded_/$N"
    echo "sideloaded: $N ($V)"
  fi
done
# The default OBS picture pack is installer data rather than a language-set
# pin. Keep its identity-qualified path in the rig, matching the desktop
# bootstrap, so story images exercise the same exact-SHA resolution as a
# packaged install (#288/D75). The cache is optional just like the rows above.
OBS_IMAGES_SHA=7146d5b504f6b63b9e11f7dc0b18c594d0ae179d
OBS_IMAGES_LABEL=${OBS_IMAGES_SHA[1,12]}
OBS_IMAGES_Z="$DEV/resources-cache/obs_images_360-$OBS_IMAGES_LABEL-unwrapped.zip"
OBS_IMAGES_DEST="$WORK/repos/_local_/_sideloaded_/uw--obs_images_360--$OBS_IMAGES_LABEL"
if [ -f "$OBS_IMAGES_Z" ] && [ ! -d "$OBS_IMAGES_DEST" ]; then
  mkdir -p "$OBS_IMAGES_DEST"
  unzip -q "$OBS_IMAGES_Z" -d "$OBS_IMAGES_DEST"
  echo "sideloaded: uW/obs_images_360 ($OBS_IMAGES_LABEL)"
fi
# D57: the install records of the sideloaded tags — a sideloaded resource's metadata
# holds only its commit sha, and the release tag exists only in this record (#396).
node "$(npath "$DEV/scripts/write-install-records.mjs")" "$(npath "$WORK")"
echo "seeded: $WORK"
