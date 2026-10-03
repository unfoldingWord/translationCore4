// A Gitea commit archive can have no DCS identity in its Burrito metadata.
// Preserve the fetcher's verified archive-comment identity at package time,
// together with hashes of EVERY extracted file (lexicon payloads are not all
// declared as metadata ingredients). The manifest binds the receipt's hash.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const RECEIPT = '.tc4-bundled-identity.json';

function writeArchiveReceipt(directory, repoPath, sha, archive, provenanceFile) {
  const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'))[repoPath.split('/').pop()];
  if (!provenance || provenance.version !== null || provenance.revision !== sha || provenance.zip !== path.basename(archive) || provenance.bytes !== fs.statSync(archive).size) {
    throw new Error(`Commit archive provenance does not match ${repoPath} at ${sha}`);
  }
  const files = {};
  for (const name of fs.readdirSync(directory, { recursive: true }).sort()) {
    if (name === RECEIPT || !fs.statSync(path.join(directory, name)).isFile()) continue;
    const bytes = fs.readFileSync(path.join(directory, name));
    files[name.split(path.sep).join('/')] = { size: bytes.length, checksum: { sha256: createHash('sha256').update(bytes).digest('hex') } };
  }
  if (!files['metadata.json']) throw new Error(`Archive has no metadata: ${directory}`);
  const receipt = `${JSON.stringify({ repoPath, sha, files })}\n`;
  fs.writeFileSync(path.join(directory, RECEIPT), receipt);
  return createHash('sha256').update(receipt).digest('hex');
}

if (require.main === module) console.log(writeArchiveReceipt(...process.argv.slice(2)));
module.exports = { writeArchiveReceipt };
