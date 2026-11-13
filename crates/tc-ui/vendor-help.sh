#!/usr/bin/env bash
# Copy the help pages (translationCore-Suite-website's `public/tc-help/`, the help of
# https://translationcore.com/tc-help/) into crates/tc-ui/help, byte for byte, from one commit of
# that repository, and write the list of what was copied to crates/tc-ui/help-pages.txt
# (APP-DESIGN AD29, #1031). `cargo test -p tc-ui` checks every file under help/ against that list
# (tests/help_pages.rs). build-app.sh copies help/ beside the UI, where `tc4 serve` serves
# `/help/*`.
#
#   crates/tc-ui/vendor-help.sh [REV]
#
# REV defaults to the commit this build pins: the merge of the site's 4.1 help refresh (#1031).
# The fetch is tC4's: sparse and shallow, only the blobs of `public/tc-help/` at REV (about
# 21 MB). It needs the network; tests never run it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REPO=https://github.com/unfoldingWord/translationCore-Suite-website.git
REV="${1:-c8ec5fea9ef3119dc8bac280d310fdca11ed0a1a}"
SRC=public/tc-help
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
git -C "$TMP" sparse-checkout set --no-cone "/$SRC/"
git -C "$TMP" fetch -q --depth 1 --filter=blob:none origin "$REV"
git -C "$TMP" checkout -q FETCH_HEAD
HEAD="$(git -C "$TMP" rev-parse HEAD)"
if [ "$HEAD" != "$REV" ]; then
  echo "fetched $HEAD, not $REV" >&2
  exit 1
fi
if [ ! -f "$TMP/$SRC/index.html" ]; then
  echo "$REPO $REV has no $SRC/index.html" >&2
  exit 1
fi

rm -rf "$OUT"
cp -a "$TMP/$SRC" "$OUT"
{
  echo "# translationCore-Suite-website's help pages in crates/tc-ui/help, copied byte for byte by"
  echo "# vendor-help.sh (AD29). Each line: the file's git blob id there, then its path below $SRC/."
  echo "repository $REPO"
  echo "commit $REV"
  echo "# Licence (APP-DESIGN Q-19): CC BY-SA 4.0, as the owner decided on 2026-11-13 (#1031)."
  echo "# The repository holds no licence file at this commit."
  git -C "$TMP" ls-tree -r HEAD "$SRC" | while read -r _mode type blob path; do
    [ "$type" = blob ] || continue
    echo "$blob ${path#$SRC/}"
  done
} > "$LIST"
echo "copied $(grep -c '^[0-9a-f]\{40\} ' "$LIST") help files from $REPO $REV"
