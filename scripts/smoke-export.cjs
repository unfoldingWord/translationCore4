const {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} = require('@zip.js/zip.js/index-native.cjs');

function normalizedSafeEntryPath(filename) {
  if (typeof filename !== 'string' || filename.length === 0 || filename.includes('\0')) {
    throw new Error('ZIP contains an invalid entry name');
  }

  const zipPath = filename.replace(/\\/g, '/');
  if (zipPath.startsWith('/') || /^[a-z]:/i.test(zipPath)) {
    throw new Error(`ZIP contains an unsafe entry path: ${filename}`);
  }

  const segments = zipPath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isDirectoryTerminator = index === segments.length - 1 && segment === '';
    if (segment === '' && !isDirectoryTerminator) {
      throw new Error(`ZIP contains an ambiguous entry path: ${filename}`);
    }

    // Windows drops trailing dots and spaces from path components. Reject
    // dot/space-only components too, before counting files under a root.
    if (/^[. ]+$/.test(segment)) {
      throw new Error(`ZIP contains an unsafe entry path: ${filename}`);
    }
  }

  return zipPath;
}

async function verifyBurritoZip(zipBytes, rawMetadataBytes) {
  if (!(zipBytes instanceof Uint8Array) || zipBytes.length === 0) {
    throw new Error('ZIP response is empty');
  }

  if (!(rawMetadataBytes instanceof Uint8Array)) {
    throw new Error('Raw metadata response is not bytes');
  }

  const reader = new ZipReader(new Uint8ArrayReader(zipBytes), {
    checkCrc32: true,
    checkOverlappingEntry: true,
    strictness: 'strict',
  });

  try {
    let entries;
    try {
      entries = await reader.getEntries({
        filenameValidation: 'strict',
        strictness: 'strict',
      });
    } catch (error) {
      throw new Error(`ZIP response is malformed, truncated, or unsafe: ${error.message}`);
    }

    const paths = entries.map((entry) => normalizedSafeEntryPath(entry.filename));
    const metadataIndex = entries.findIndex((entry, index) => (
      paths[index] === 'metadata.json' && !entry.directory && !entry.symlink
    ));
    if (metadataIndex < 0) throw new Error('ZIP has no root metadata.json');

    const ingredientFiles = entries.filter((entry, index) => (
      paths[index].startsWith('ingredients/')
      && !paths[index].endsWith('/')
      && !entry.directory
      && !entry.symlink
    ));
    if (ingredientFiles.length === 0) {
      throw new Error(`ZIP has no files under root ingredients/ (entries: ${paths.slice(0, 8).join(', ') || 'none'})`);
    }

    let metadata;
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry.directory) continue;

        const options = {
          checkCrc32: true,
          checkOverlappingEntry: true,
          strictness: 'strict',
        };
        if (index === metadataIndex) {
          metadata = await entry.getData(new Uint8ArrayWriter(), options);
        } else {
          // Stream other entries through a sink. This checks their CRC without
          // retaining every uncompressed ingredient in memory at once.
          await entry.getData(new WritableStream({ write() {} }), options);
        }
      }
    } catch (error) {
      throw new Error(`ZIP response is malformed, truncated, or corrupt: ${error.message}`);
    }

    if (!Buffer.from(metadata).equals(Buffer.from(rawMetadataBytes))) {
      throw new Error('ZIP metadata.json does not match the raw metadata route byte-for-byte');
    }

    return { ingredientFiles: ingredientFiles.length, metadataBytes: metadata.length };
  } finally {
    await reader.close();
  }
}

module.exports = { verifyBurritoZip };
