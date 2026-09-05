#!/bin/zsh
# Reset the rig to a pristine, deterministic state. Safe to run any time.
# Performs the working-dir initialization itself (template substitution), so
# every boot sees an identical, fully-specified state — no first-boot variance.
set -e
DEV=${0:a:h:h}; ROOT=${0:a:h:h:h}
WORK="$DEV/state/work"
rm -rf "$DEV/state"; mkdir -p "$WORK/repos/_local_/_local_" "$WORK/temp" "$WORK/blobs"
python3 - "$DEV" "$WORK" <<'PY'
import sys, pathlib
dev, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
res = dev / 'app-resources'
def sub(name):
    s = (res / 'templates' / name).read_text()
    return (s.replace('%%WORKINGDIR%%', str(work))
             .replace('%%APPRESOURCESDIR%%', str(res) + '/')
             .replace('%%PANKOSMIADIR%%', str(res / 'clients'))
             .replace('%%HOMEDIR%%', str(work)))
(work / 'user_settings.json').write_text(sub('user_settings.json'))
(work / 'app_state.json').write_text(sub('app_state.json'))
print('working dir initialized from templates (repo_dir isolated under', work / 'repos', ')')
PY
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
node "$ROOT/scripts/seed-large-project.mjs" "$WORK/repos/_local_/_local_/sample_burrito_large" --edits 4000
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
         es-419_tn:v66 es-419_tw:v37 es-419_ta:v4; do
  N="${R%%:*}"; V="${R##*:}"
  Z="$DEV/resources-cache/$N-$V-unwrapped.zip"
  if [ -f "$Z" ] && [ ! -d "$WORK/repos/_local_/_sideloaded_/$N" ]; then
    mkdir -p "$WORK/repos/_local_/_sideloaded_/$N"
    unzip -q "$Z" -d "$WORK/repos/_local_/_sideloaded_/$N"
    echo "sideloaded: $N ($V)"
  fi
done
echo "seeded: $WORK"
