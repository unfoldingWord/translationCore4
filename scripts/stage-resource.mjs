// Stage one verified cache entry as one installer file (#740). No expanded
// resource tree is ever written to the application payload.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { installableFiles, ARCHIVE_RECEIPT, LEXICON_STORAGE } from '../src/data/resourceArchive.mjs';

export async function stageResource(archive, repoPath, sha, destination, provenanceFile) {
  const bytes = fs.readFileSync(archive);
  const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'))[repoPath.split('/').pop()];
  if (!provenance || provenance.revision !== sha || provenance.zip !== path.basename(archive) || provenance.bytes !== bytes.length) throw new Error(`Cache provenance does not match ${repoPath} at ${sha}`);
  let files = unzipSync(bytes);
  // A freshly fetched cache already has the compact representation. Existing
  // developer caches can be compacted once here from their verified inventory.
  const existing = files[ARCHIVE_RECEIPT] && JSON.parse(new TextDecoder().decode(files[ARCHIVE_RECEIPT]));
  if (existing?.storage !== LEXICON_STORAGE) files = await installableFiles({ repoPath, sha }, files, provenance.revision);
  const compact = !!files[ARCHIVE_RECEIPT];
  if (compact) {
    const receipt = JSON.parse(new TextDecoder().decode(files[ARCHIVE_RECEIPT]));
    if (receipt.repoPath !== repoPath || receipt.sha !== sha || receipt.storage !== LEXICON_STORAGE) throw new Error('Compact cache identity does not match pin');
  } else if (provenance.version === null) {
    // Other authored commit archives (e.g. OBS images) need the complete-tree
    // receipt too: their upstream ingredient inventory can be incomplete.
    const tree = {};
    for (const [name, value] of Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (!name.endsWith('/')) tree[name] = { size: value.length, checksum: { sha256: createHash('sha256').update(value).digest('hex') } };
    }
    files[ARCHIVE_RECEIPT] = new TextEncoder().encode(`${JSON.stringify({ repoPath, sha, files: tree })}\n`);
  }
  const output = zipSync(files, { level: 0, mtime: new Date(1980, 0, 1) });
  fs.writeFileSync(destination, output);
  return {
    repoPath, version: provenance.version, sha,
    archive: path.basename(destination),
    zip_sha256: createHash('sha256').update(output).digest('hex'),
    ...(files[ARCHIVE_RECEIPT] ? { archive_receipt_sha256: createHash('sha256').update(files[ARCHIVE_RECEIPT]).digest('hex') } : {}),
    ...(compact ? { storage: LEXICON_STORAGE } : {}),
  };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await stageResource(...process.argv.slice(2))));
