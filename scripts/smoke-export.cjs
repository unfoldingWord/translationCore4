const { unzipSync } = require('fflate');

function verifyBurritoZip(zipBytes, rawMetadataBytes) {
  if (!(zipBytes instanceof Uint8Array) || zipBytes.length === 0) {
    throw new Error('ZIP response is empty');
  }

  let files;
  try {
    files = unzipSync(zipBytes);
  } catch (error) {
    throw new Error(`ZIP response is malformed or truncated: ${error.message}`);
  }

  const metadata = files['metadata.json'];
  if (!metadata) throw new Error('ZIP has no root metadata.json');

  const ingredientFiles = Object.keys(files).filter((name) => {
    // The Windows server can serialize native path separators into its ZIP
    // entries. Treat either separator as a ZIP path boundary when checking
    // the root; do not extract or rewrite the archive.
    const zipPath = name.replace(/\\/g, '/');
    return zipPath.startsWith('ingredients/') && !zipPath.endsWith('/');
  });
  if (ingredientFiles.length === 0) {
    throw new Error(`ZIP has no files under root ingredients/ (entries: ${Object.keys(files).slice(0, 8).join(', ') || 'none'})`);
  }

  if (!(rawMetadataBytes instanceof Uint8Array)
    || !Buffer.from(metadata).equals(Buffer.from(rawMetadataBytes))) {
    throw new Error('ZIP metadata.json does not match the raw metadata route byte-for-byte');
  }

  return { ingredientFiles: ingredientFiles.length, metadataBytes: metadata.length };
}

module.exports = { verifyBurritoZip };
