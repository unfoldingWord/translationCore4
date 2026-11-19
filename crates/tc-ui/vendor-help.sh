#!/usr/bin/env bash
# Build translationCore-Suite-website (https://translationcore.com) at one commit, with Node and
# Astro, and copy the help it builds into crates/tc-ui/help, byte for byte, in English and in
# each language below; then write the list of what was copied to crates/tc-ui/help-pages.txt
# (APP-DESIGN AD29, #1031, #1036). `cargo test -p tc-ui` checks every file under help/ against
# that list (tests/help_pages.rs). build-app.sh copies help/ beside the UI, where `tc4 serve`
# serves `/help/*`.
#
#   crates/tc-ui/vendor-help.sh [REV]
#
# REV defaults to the commit this build pins: the merge of the site's localized help (#1036).
# Since that commit the site holds the help pages as sources (`src/tc-help/`, `src/i18n/`), so
# the pages exist only in its build: `npm ci`, which installs what the site's package-lock.json
# pins, then `npm run build`. It needs the network, git, and a Node the site accepts (its
# package.json `engines`); tests never run it.
#
# What is copied, and where:
#   dist/tc-help/            help/           English, and the images and assets every language shows
#   dist/<lang>/tc-help/     help/<lang>/    one folder per language in LANGS
#   dist/assets/…            help/site/assets/…   the site's own files that a copied page loads:
#                                            its help style sheet and script, and the Noto fonts
#                                            (OFL-1.1) of the scripts LANGS need
# `/assets/js/locale.js`, which sends a reader to the computer's language, is not copied:
# tc-server takes its tag out of each page as it serves it, with the site's language menu.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REPO=https://github.com/unfoldingWord/translationCore-Suite-website.git
REV="${1:-835fb965a322bc3800b61e95f4d2518010f3dd5a}"
# The help languages an app language shows (`help` in crates/tc-ui/src/i18n.rs LOCALES);
# tests/help_pages.rs fails when the folders copied here are not the ones LOCALES names. The
# site builds more: add one here when the app gains its interface language.
LANGS="es fr hi pt id ru vi ar"
NOT_COPIED=/assets/js/locale.js
OUT="$HERE/help"
LIST="$HERE/help-pages.txt"

# Inside the target folder, so nothing is left in /tmp and a full disk fails the run.
TMP="$ROOT/target/vendor-help"
rm -rf "$TMP"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
git -C "$TMP" config core.autocrlf false
git -C "$TMP" remote add origin "$REPO"
git -C "$TMP" fetch -q --depth 1 origin "$REV"
git -C "$TMP" checkout -q FETCH_HEAD
HEAD="$(git -C "$TMP" rev-parse HEAD)"
if [ "$HEAD" != "$REV" ]; then
  echo "fetched $HEAD, not $REV" >&2
  exit 1
fi

(cd "$TMP" && npm ci --no-audit --no-fund && npm run build) >&2
DIST="$TMP/dist"
for lang in "" $LANGS; do
  if [ ! -f "$DIST/$lang/tc-help/index.html" ]; then
    echo "$REPO $REV builds no /$lang/tc-help/index.html" >&2
    exit 1
  fi
done

rm -rf "$OUT"
cp -R "$DIST/tc-help" "$OUT"
for lang in $LANGS; do
  if [ -e "$OUT/$lang" ]; then
    echo "the English help already holds $lang" >&2
    exit 1
  fi
  cp -R "$DIST/$lang/tc-help" "$OUT/$lang"
done

# One site file, named as a page names it (`/assets/…`), into help/site/.
site_file() {
  if [ ! -f "$DIST$1" ]; then
    echo "a help page loads $1, which the site did not build" >&2
    exit 1
  fi
  mkdir -p "$OUT/site$(dirname "$1")"
  cp "$DIST$1" "$OUT/site$1"
}
# The site files the copied pages load, and the font files those style sheets load.
find "$OUT" -name '*.html' -print0 | { xargs -0 grep -ohE '(href|src)="/assets/[^"?#]+' || true; } |
  sed 's/^[a-z]*="//' | LC_ALL=C sort -u | while read -r file; do
  [ "$file" = "$NOT_COPIED" ] || site_file "$file"
done
# A build with no font pack names no font file.
find "$OUT/site" -name '*.css' -print0 | { xargs -0 grep -ohE 'url\(/assets/[^)?#]+' || true; } |
  sed 's/^url(//' | LC_ALL=C sort -u | while read -r file; do
  site_file "$file"
done

{
  echo "# translationcore.com's help in crates/tc-ui/help, as translationCore-Suite-website builds it"
  echo "# at one commit, copied byte for byte by vendor-help.sh (AD29). Each line: the git blob id of"
  echo "# a file's bytes (\`git hash-object\`), then its path below help/. The site holds the pages as"
  echo "# sources, so the ids are those of its build: \`npm ci && npm run build\` at the commit"
  echo "# (Node $(node --version) wrote this list)."
  echo "repository $REPO"
  echo "commit $REV"
  echo "# Licence (APP-DESIGN Q-19): CC BY-SA 4.0, as the owner decided on 2026-11-13 (#1031)."
  echo "# The repository holds no licence file at this commit. The fonts under site/assets/fonts/"
  echo "# are Noto Sans Arabic and Noto Sans Devanagari (OFL-1.1), from the @fontsource packages the"
  echo "# site's package-lock.json pins; THIRD-PARTY-NOTICES.txt carries their licence."
  (cd "$OUT" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | while read -r path; do
    echo "$(git hash-object "$path") $path"
  done)
} > "$LIST"
echo "copied $(grep -c '^[0-9a-f]\{40\} ' "$LIST") help files from the build of $REPO $REV"
