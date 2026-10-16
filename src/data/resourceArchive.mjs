// The compact lexicon representation shared by the build cache and in-app
// downloads (#740). The original metadata and every source file live inside
// source.zip, byte for byte; the outer Burrito truthfully inventories that
// archive. It is still a regular zipped-Burrito import on the pinned server.
import { zipSync } from 'fflate';

export const LEXICON_STORAGE = 'lexicon-archive-v1';
export const ARCHIVE_RECEIPT = '.tc4-bundled-identity.json';

const encode = (value) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const sha256 = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** Called only after the fetcher's independent revision check. A mismatched
 * commit must never be turned into a receipt claiming the requested pin. */
export async function installableFiles(pin, files, revision) {
  const meta = JSON.parse(new TextDecoder().decode(files['metadata.json']));
  if (meta.type?.flavorType?.flavor?.name !== 'x-lexicon') return files;
  if (!pin.sha || pin.sha !== revision)
    throw new Error('Lexicon archive revision does not match pin');
  const source = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const archive = zipSync(source, { level: 6, mtime: new Date(1980, 0, 1) });
  const archiveRecord = {
    size: archive.length,
    checksum: { sha256: await sha256(archive) },
    mimeType: 'application/zip',
  };
  const metadata = encode({ ...meta, ingredients: { 'ingredients/source.zip': archiveRecord } });
  const stored = { 'metadata.json': metadata, 'ingredients/source.zip': archive };
  const tree = {};
  for (const [name, bytes] of Object.entries(stored))
    tree[name] = { size: bytes.length, checksum: { sha256: await sha256(bytes) } };
  stored[ARCHIVE_RECEIPT] = encode({
    storage: LEXICON_STORAGE,
    repoPath: pin.repoPath,
    sha: pin.sha,
    files: tree,
  });
  return stored;
}
