// Build a rig cache entry for one pinned resource, using THE APP'S OWN fetch,
// unwrap and re-zip code — so a seeded resource is byte-identical to what a
// real install produces. Never a hand-rolled copy of that logic.
//
//   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tn v66 [expectedSha]
//   zsh dev-env/scripts/cache-resource.zsh uW/en_ugl "" <sha>        (sha-only pin, #218)
//
// Writes `dev-env/resources-cache/<repo>-<label>-unwrapped.zip` (label = the tag,
// or the first 12 sha characters of a sha-only pin) and records the export's
// own declared revision in `helps-provenance.json`. When an expected SHA is
// given, a mismatch ABORTS — the pin path is (repoPath, tag, SHA), and an
// unverified download is not installable evidence (D23b / OPEN-QUESTIONS #24).
// A sha-only pin is fetched as the Gitea commit archive and verified against
// the archive comment (D71); the SHA is then required, not optional.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { downloadPin, rezip } from '../../src/data/resourceFetch';

const [ownerRepo, tagArg, expectedSha] = process.argv.slice(2);
const tag = tagArg || undefined;
if (!ownerRepo || (!tag && !expectedSha)) {
  console.error('usage: cache-resource <owner>/<repo> <tag> [expectedSha]   (tag may be "" when expectedSha is given)');
  process.exit(2);
}

const repoPath = `git.door43.org/${ownerRepo}`;
const repo = ownerRepo.split('/').pop() as string;
const label = tag ?? (expectedSha as string).slice(0, 12);
const cacheDir = join(import.meta.dirname, '..', 'resources-cache');
const out = join(cacheDir, `${repo}-${label}-unwrapped.zip`);
const provenanceFile = join(cacheDir, 'helps-provenance.json');

const downloaded = await downloadPin({ repoPath, version: tag, sha: expectedSha, flavor: '' }).catch((error: Error) => {
  console.error(`  ${error.message} — nothing cached`);
  process.exit(1);
});
console.log(`GET ${downloaded.url}`);
console.log(`  ${downloaded.bytes} bytes`);
const { files, revision } = downloaded;
console.log(`  unwrapped: ${Object.keys(files).length} files; revision ${revision}`);
if (expectedSha && revision !== expectedSha) {
  console.error(`  SHA MISMATCH: export declares ${revision}, expected ${expectedSha} — aborting`);
  process.exit(1);
}

const bytes = rezip(files);
writeFileSync(out, bytes);
console.log(`  wrote ${out} (${bytes.length} bytes)`);

const provenance = existsSync(provenanceFile)
  ? (JSON.parse(readFileSync(provenanceFile, 'utf8')) as Record<string, unknown>)
  : {};
provenance[repo] = {
  version: tag ?? null,
  revision,
  zip: `${repo}-${label}-unwrapped.zip`,
  bytes: bytes.length,
};
writeFileSync(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`  provenance recorded for ${repo}`);
