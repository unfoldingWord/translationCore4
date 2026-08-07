// Build a rig cache entry for one pinned resource, using THE APP'S OWN fetch,
// unwrap and re-zip code — so a seeded resource is byte-identical to what a
// real install produces. Never a hand-rolled copy of that logic.
//
//   zsh dev-env/scripts/cache-resource.zsh Es-419_gl/es-419_tn v66 [expectedSha]
//
// Writes `dev-env/resources-cache/<repo>-<tag>-unwrapped.zip` and records the
// export's own declared revision in `helps-provenance.json`. When an expected
// SHA is given, a mismatch ABORTS — the pin path is (repoPath, tag, SHA), and
// an unverified download is not installable evidence (D23b / OPEN-QUESTIONS #24).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sbZipUrl, unwrapExport, rezip } from '../../translationCore4/src/data/resourceFetch';

const [ownerRepo, tag, expectedSha] = process.argv.slice(2);
if (!ownerRepo || !tag) {
  console.error('usage: cache-resource <owner>/<repo> <tag> [expectedSha]');
  process.exit(2);
}

const repoPath = `git.door43.org/${ownerRepo}`;
const repo = ownerRepo.split('/').pop() as string;
const cacheDir = join(import.meta.dirname, '..', 'resources-cache');
const out = join(cacheDir, `${repo}-${tag}-unwrapped.zip`);
const provenanceFile = join(cacheDir, 'helps-provenance.json');

const url = sbZipUrl({ repoPath, version: tag, flavor: '' });
console.log(`GET ${url}`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`  HTTP ${response.status} — nothing cached`);
  process.exit(1);
}
const downloaded = new Uint8Array(await response.arrayBuffer());
console.log(`  ${downloaded.length} bytes`);

const { files, revision } = unwrapExport(downloaded);
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
  version: tag,
  revision,
  zip: `${repo}-${tag}-unwrapped.zip`,
  bytes: bytes.length,
};
writeFileSync(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`  provenance recorded for ${repo}`);
