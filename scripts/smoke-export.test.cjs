const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { verifyBurritoZip } = require('./smoke-export.cjs');

const sample = path.resolve(__dirname, '..', 'conformance', 'sample-burrito');
const metadata = fs.readFileSync(path.join(sample, 'metadata.json'));
const ingredient = fs.readFileSync(path.join(sample, 'ingredients', 'TIT.usfm'));
const zipEntries = (extra = {}) => ({
  'metadata.json': new Uint8Array(metadata),
  'ingredients/TIT.usfm': new Uint8Array(ingredient),
  ...extra,
});
const validZip = zipSync(zipEntries());

function corruptEntryCrc(zipBytes, filename) {
  const corrupt = Buffer.from(zipBytes);
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const eocd = corrupt.lastIndexOf(eocdSignature);
  assert.notEqual(eocd, -1, 'sample ZIP has an end-of-central-directory record');
  const count = corrupt.readUInt16LE(eocd + 10);
  let central = corrupt.readUInt32LE(eocd + 16);
  let changed = false;

  for (let index = 0; index < count; index += 1) {
    assert.deepEqual(corrupt.subarray(central, central + 4), centralSignature);
    const nameLength = corrupt.readUInt16LE(central + 28);
    const nameStart = central + 46;
    const name = corrupt.toString('utf8', nameStart, nameStart + nameLength);
    if (name === filename) {
      const local = corrupt.readUInt32LE(central + 42);
      // Keep the local and central headers consistent while making the stored
      // checksum disagree with the sample-derived entry bytes.
      corrupt.writeUInt32LE((corrupt.readUInt32LE(local + 14) ^ 1) >>> 0, local + 14);
      corrupt.writeUInt32LE((corrupt.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
      changed = true;
      break;
    }
    central = nameStart + nameLength
      + corrupt.readUInt16LE(central + 30)
      + corrupt.readUInt16LE(central + 32);
  }

  assert.equal(changed, true, `sample ZIP has entry ${filename}`);
  return corrupt;
}

function duplicateMetadataName(zipBytes) {
  const duplicate = Buffer.from(zipBytes);
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const eocd = duplicate.lastIndexOf(eocdSignature);
  assert.notEqual(eocd, -1, 'sample ZIP has an end-of-central-directory record');
  const count = duplicate.readUInt16LE(eocd + 10);
  let central = duplicate.readUInt32LE(eocd + 16);
  let changed = false;

  for (let index = 0; index < count; index += 1) {
    assert.deepEqual(duplicate.subarray(central, central + 4), centralSignature);
    const nameLength = duplicate.readUInt16LE(central + 28);
    const nameStart = central + 46;
    const name = duplicate.toString('utf8', nameStart, nameStart + nameLength);
    if (name === 'manifest.json') {
      const replacement = Buffer.from('metadata.json');
      assert.equal(replacement.length, nameLength);
      const local = duplicate.readUInt32LE(central + 42);
      const localNameLength = duplicate.readUInt16LE(local + 26);
      assert.equal(localNameLength, replacement.length);
      replacement.copy(duplicate, nameStart);
      replacement.copy(duplicate, local + 30);
      changed = true;
    }
    central = nameStart + nameLength
      + duplicate.readUInt16LE(central + 30)
      + duplicate.readUInt16LE(central + 32);
  }

  assert.equal(changed, true, 'sample-derived ZIP has the same-length alternate metadata name');
  return duplicate;
}

test('installed export accepts the sample Burrito ZIP and exact metadata bytes', async () => {
  assert.deepEqual(await verifyBurritoZip(validZip, metadata), {
    ingredientFiles: 1,
    metadataBytes: metadata.length,
  });
});

test('installed export recognizes backslash separators in ZIP entry names', async () => {
  const windowsNameZip = zipSync({
    'metadata.json': new Uint8Array(metadata),
    'ingredients\\TIT.usfm': new Uint8Array(ingredient),
  });
  assert.deepEqual(await verifyBurritoZip(windowsNameZip, metadata), {
    ingredientFiles: 1,
    metadataBytes: metadata.length,
  });
});

test('installed export rejects an invalid ZIP negative control', async () => {
  await assert.rejects(
    verifyBurritoZip(Buffer.from('not a ZIP'), metadata),
    /malformed, truncated, or unsafe/,
  );
});

test('installed export rejects a truncated ZIP', async () => {
  await assert.rejects(
    verifyBurritoZip(validZip.subarray(0, validZip.length - 8), metadata),
    /malformed, truncated, or unsafe/,
  );
});

test('installed export checks CRCs for metadata and unused ingredients', async () => {
  for (const filename of ['metadata.json', 'ingredients/TIT.usfm']) {
    await assert.rejects(
      verifyBurritoZip(corruptEntryCrc(validZip, filename), metadata),
      /malformed, truncated, or corrupt/,
      `reject corrupted ${filename}`,
    );
  }
});

test('installed export rejects duplicate entry names', async () => {
  const withAlternateMetadata = zipSync(zipEntries({ 'manifest.json': new Uint8Array(metadata) }));
  await assert.rejects(
    verifyBurritoZip(duplicateMetadataName(withAlternateMetadata), metadata),
    /duplicate|ambiguous|malformed/i,
  );
});

test('installed export rejects unsafe paths and does not count them as ingredients', async () => {
  const traversalZip = zipSync({
    'metadata.json': new Uint8Array(metadata),
    'ingredients/../outside.usfm': new Uint8Array(ingredient),
  });
  const windowsTraversalZip = zipSync({
    'metadata.json': new Uint8Array(metadata),
    'ingredients/.. /outside.usfm': new Uint8Array(ingredient),
  });

  await assert.rejects(verifyBurritoZip(traversalZip, metadata), /unsafe|malformed/i);
  await assert.rejects(verifyBurritoZip(windowsTraversalZip, metadata), /unsafe entry path/);
});

test('installed export requires a root metadata file and a regular ingredient file', async () => {
  const nestedMetadata = zipSync({
    'nested/metadata.json': new Uint8Array(metadata),
    'ingredients/TIT.usfm': new Uint8Array(ingredient),
  });
  const directoryOnly = zipSync({
    'metadata.json': new Uint8Array(metadata),
    'ingredients/': new Uint8Array(0),
  });
  const symlinkOnly = zipSync({
    'metadata.json': new Uint8Array(metadata),
    'ingredients/TIT.usfm': [new Uint8Array(ingredient), { os: 3, attrs: 0o120777 << 16 }],
  });
  const noMetadata = zipSync({ 'ingredients/TIT.usfm': new Uint8Array(ingredient) });
  const noIngredient = zipSync({ 'metadata.json': new Uint8Array(metadata) });

  await assert.rejects(verifyBurritoZip(nestedMetadata, metadata), /root metadata\.json/);
  await assert.rejects(verifyBurritoZip(directoryOnly, metadata), /files under root ingredients\//);
  await assert.rejects(verifyBurritoZip(symlinkOnly, metadata), /files under root ingredients\//);
  await assert.rejects(verifyBurritoZip(noMetadata, metadata), /root metadata\.json/);
  await assert.rejects(verifyBurritoZip(noIngredient, metadata), /files under root ingredients\//);
});

test('installed export rejects metadata that differs from the raw metadata route', async () => {
  const changedMetadata = Buffer.from(metadata);
  changedMetadata[0] ^= 1;
  await assert.rejects(
    verifyBurritoZip(validZip, changedMetadata),
    /byte-for-byte/,
  );
});
