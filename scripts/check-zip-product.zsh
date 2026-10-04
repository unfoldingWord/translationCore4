#!/bin/zsh
# ZIP GUARD (#336): prove the artifact zip carries exactly the product.json the
# version guard smoke-checked — the same class as the BUILD-MANIFEST.json hash
# checks: assert what the artifact holds, do not trust the recipe that wrote it.
#
# Three facts, each fatal on its own:
#   1. the zip holds exactly ONE */lib/product/product.json entry, at the
#      platform's expected path (macOS stages lib/ inside the app bundle);
#   2. that entry's bytes equal the staged $PACK/lib/product/product.json the
#      version guard compared against /api/version;
#   3. the entry's datetime equals built_utc in the zip's own
#      BUILD-MANIFEST.json — the recipe writes both from one $DATETIME, so a
#      disagreement means the zip holds files from two builds.
#
# Invoked by package-desktop.zsh after step 7 writes the zip, and standalone by
# the negative controls against doctored copies:
#   zsh scripts/check-zip-product.zsh <zip> <os> <app-name> <staged-product.json>
# Requires unzip, grep and node — all already required by the recipe. The byte
# comparison is node's (Buffer.equals): the Windows CI runner's MSYS2 install
# is zsh/zip/unzip/curl only, so cmp would be a new tool requirement there.
set -e

ZIP=$1
OS=$2
APP_NAME=$3
STAGED=$4
if [ -z "$ZIP" ] || [ -z "$OS" ] || [ -z "$APP_NAME" ] || [ -z "$STAGED" ]; then
  echo "usage: check-zip-product.zsh <zip> <os> <app-name> <staged-product.json>" >&2
  exit 2
fi
[ -f "$ZIP" ]    || { echo "ZIP GUARD FAILED: no such zip: $ZIP" >&2; exit 1; }
[ -f "$STAGED" ] || { echo "ZIP GUARD FAILED: no staged product.json: $STAGED" >&2; exit 1; }

npath() {        # a path for the Windows node.exe: MSYS2 /d/a/x -> D:/a/x (#181)
  if [ "$OS" = windows ]; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# package-macos.zsh moves lib/ and BUILD-MANIFEST.json inside the app bundle;
# Linux and Windows keep them at the artifact root.
if [ "$OS" = macos ]; then
  WANT="$APP_NAME/$APP_NAME.app/Contents/Resources/lib/product/product.json"
  MANIFEST_ENTRY="$APP_NAME/$APP_NAME.app/Contents/Resources/BUILD-MANIFEST.json"
else
  WANT="$APP_NAME/lib/product/product.json"
  MANIFEST_ENTRY="$APP_NAME/BUILD-MANIFEST.json"
fi

# 1 — exactly one product.json, at the expected path.
ENTRIES=$(unzip -Z1 "$ZIP" | grep '/lib/product/product\.json$' || true)
if [ -z "$ENTRIES" ]; then
  echo "ZIP GUARD FAILED: no */lib/product/product.json entry in $ZIP (expected $WANT)" >&2
  exit 1
fi
COUNT=$(printf '%s\n' "$ENTRIES" | wc -l | tr -d '[:space:]')
if [ "$COUNT" != 1 ]; then
  echo "ZIP GUARD FAILED: $COUNT product.json entries in $ZIP, expected exactly one:" >&2
  printf '%s\n' "$ENTRIES" | sed 's/^/  /' >&2
  exit 1
fi
if [ "$ENTRIES" != "$WANT" ]; then
  echo "ZIP GUARD FAILED: product.json at $ENTRIES, expected $WANT" >&2
  exit 1
fi

# 2 — the entry's bytes equal the staged file; 3 — the entry's datetime equals
# the zip manifest's built_utc. Extract to files (a shell variable would strip
# the trailing newline the recipe writes) and compare bytes in node.
TMP_GUARD=$(mktemp -d)
trap 'rm -rf "$TMP_GUARD"' EXIT
unzip -p "$ZIP" "$WANT" > "$TMP_GUARD/product.json"
unzip -p "$ZIP" "$MANIFEST_ENTRY" > "$TMP_GUARD/manifest.json" 2>/dev/null || {
  echo "ZIP GUARD FAILED: no $MANIFEST_ENTRY in $ZIP" >&2
  exit 1
}
node -e '
const fs = require("fs");
const [stagedPath, zipProductPath, zipManifestPath] = process.argv.slice(1);
const stagedBytes = fs.readFileSync(stagedPath);
const zipBytes = fs.readFileSync(zipProductPath);
const stagedText = stagedBytes.toString("utf8");
const zipText = zipBytes.toString("utf8");

// 2 — bytes. On a difference, name the differing JSON fields with both
// values; if the JSON is equal the difference is byte-level only
// (whitespace/ordering), so show both raw texts.
if (!zipBytes.equals(stagedBytes)) {
  let zip, staged;
  try { zip = JSON.parse(zipText); staged = JSON.parse(stagedText); } catch (e) {
    console.error("ZIP GUARD FAILED: product.json differs and is not comparable as JSON: " + e.message);
    console.error("  zip:    " + JSON.stringify(zipText));
    console.error("  staged: " + JSON.stringify(stagedText));
    process.exit(1);
  }
  const fields = [...new Set([...Object.keys(staged), ...Object.keys(zip)])];
  let named = false;
  for (const f of fields) {
    if (JSON.stringify(zip[f]) !== JSON.stringify(staged[f])) {
      console.error(`ZIP GUARD FAILED: product.json field "${f}": zip=${JSON.stringify(zip[f])} != staged=${JSON.stringify(staged[f])}`);
      named = true;
    }
  }
  if (!named) {
    console.error("ZIP GUARD FAILED: product.json bytes differ from staged (same JSON values — whitespace or key order):");
    console.error("  zip:    " + JSON.stringify(zipText));
    console.error("  staged: " + JSON.stringify(stagedText));
  }
  process.exit(1);
}

// 3 — one build.
const product = JSON.parse(zipText);
const manifest = JSON.parse(fs.readFileSync(zipManifestPath, "utf8"));
if (product.datetime !== manifest.built_utc) {
  console.error(`ZIP GUARD FAILED: product.json datetime=${JSON.stringify(product.datetime)} != BUILD-MANIFEST.json built_utc=${JSON.stringify(manifest.built_utc)} — the zip holds files from two builds`);
  process.exit(1);
}
console.log("zip guard: artifact product.json matches staged (" + product.version + ", " + product.datetime + ")");
' "$(npath "$STAGED")" "$(npath "$TMP_GUARD/product.json")" "$(npath "$TMP_GUARD/manifest.json")" || exit 1
