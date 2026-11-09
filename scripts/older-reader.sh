#!/usr/bin/env bash
# The `format-older-reader` gate (docs/STORAGE.md §12.3 step 4, PLAN P10, #865): the build of
# the last frozen format version meets three folders the current build wrote.
#
#   scripts/older-reader.sh
#
# 1. The last `format-v*` tag names the frozen version and its commit. None yet: nothing is
#    frozen, the step passes and says so.
# 2. The published GitHub release whose tag points at that commit is the older reader. None yet:
#    the step passes and logs `frozen <version> at <commit>; no published release there yet`.
# 3. Its Linux build is downloaded (each asset checked against the digest the release lists),
#    unzipped as scripts/release/smoke-installed.sh installs it, and its BUILD-MANIFEST.json must
#    name the frozen commit and match every installed file.
# 4. The current build writes the three folders (`capsule reader-folders`), and
#    scripts/older-reader.mjs drives the old build over them through the API.
#
# CI runs this on Linux; on another system it stops after step 2 and says that CI covers it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo="${GITHUB_REPOSITORY:-unfoldingWord/translationCore4}"
work="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/format-older-reader"
rm -rf "$work"
mkdir -p "$work"

# The commit a tag ref points at, with an annotated tag peeled.
peel() {
  local type=$1 sha=$2
  if [ "$type" = tag ]; then gh api "repos/$repo/git/tags/$sha" --jq .object.sha; else printf '%s\n' "$sha"; fi
}

tag=$(gh api "repos/$repo/git/matching-refs/tags/format-v" --jq '.[].ref' | sed 's#^refs/tags/##' | sort -V | tail -n 1)
if [ -z "$tag" ]; then
  echo "format-older-reader: no format-v* tag: no format version is frozen yet; nothing to check"
  exit 0
fi
version=${tag#format-v}
read -r type sha < <(gh api "repos/$repo/git/ref/tags/$tag" --jq '"\(.object.type) \(.object.sha)"')
commit=$(peel "$type" "$sha")

# The release whose own tag points at the frozen commit; drafts are not published. Each lookup is
# an assignment, so a failed call stops the gate under `set -e`: "no published release" is said
# only when every call succeeded (#865 done-when 4).
release=
candidates=$(gh api --paginate "repos/$repo/releases" --jq '.[] | select(.draft == false) | .tag_name')
while read -r candidate; do
  [ -n "$candidate" ] || continue
  cref=$(gh api "repos/$repo/git/ref/tags/$candidate" --jq '"\(.object.type) \(.object.sha)"')
  ccommit=$(peel "${cref% *}" "${cref#* }")
  if [ "$ccommit" = "$commit" ]; then release=$candidate; break; fi
done <<< "$candidates"
if [ -z "$release" ]; then
  echo "frozen $version at $commit; no published release there yet"
  exit 0
fi
echo "format-older-reader: frozen $version at $commit; the older reader is release $release"
if [ "$(uname -s)" != Linux ]; then
  echo "format-older-reader: the older reader's Linux build runs only on Linux; CI's format-older-reader job drives it"
  exit 0
fi

# Download the Linux build and its manifest; each asset's bytes must be the ones the release lists.
dist="$work/dist"
mkdir -p "$dist"
gh release download "$release" -R "$repo" -D "$dist" -p 'translationCore4-*-linux-x64.zip' -p 'BUILD-MANIFEST-linux-x64.json'
gh api "repos/$repo/releases/tags/$release" --jq '.assets[] | select(.name | test("linux-x64")) | "\(.digest) \(.name)"' | while read -r digest name; do
  want=${digest#sha256:}
  got=$(sha256sum "$dist/$name" | cut -d ' ' -f 1)
  [ "$want" = "$got" ] || { echo "FAIL asset_matches_the_release_digest: $name is $got, the release lists $want"; exit 1; }
  echo "ok asset_matches_the_release_digest $name"
done

# Install as a translator does on Linux (smoke-installed.sh, linux-x64).
install="$work/apps"
mkdir -p "$install"
unzip -q "$dist"/translationCore4-*-linux-x64.zip -d "$install"
root="$install/translationCore 4"
resources="$root/resources"
manifest="$dist/BUILD-MANIFEST-linux-x64.json"
node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const [manifestPath, root, commit] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.commit !== commit) { console.log(`FAIL manifest_names_the_frozen_commit: the manifest says ${manifest.commit}, the tag says ${commit}`); process.exit(1); }
  console.log("ok manifest_names_the_frozen_commit");
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha !== file.sha256) { console.log(`FAIL installed_files_match_the_manifest: ${file.path} is ${sha}, the manifest says ${file.sha256}`); process.exit(1); }
  }
  console.log(`ok installed_files_match_the_manifest (${manifest.files.length} files)`);
' "$manifest" "$root" "$commit"

# The three folders the current build writes, then the old build over them.
folders="$work/projects"
cargo run --locked -q -p tc-corpus --example capsule -- reader-folders "$folders"
major=$(sed -n 's/^pub const FORMAT_MAJOR: u16 = \([0-9]*\);$/\1/p' "$here/../crates/tc-journal/src/format.rs")
node "$here/older-reader.mjs" --tc4 "$resources/tc4/tc4" --ui "$resources/tc4/ui" --bundle "$resources/tc4/bundle" \
  --projects "$folders" --commit "$commit" --major "$((major + 1))"
