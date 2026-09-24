const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { verifyBurritoZip } = require('./smoke-export.cjs');

const sample = path.resolve(__dirname, '..', 'conformance', 'sample-burrito');
const metadata = fs.readFileSync(path.join(sample, 'metadata.json'));
const ingredient = fs.readFileSync(path.join(sample, 'ingredients', 'TIT.usfm'));
const validZip = zipSync({
  'metadata.json': new Uint8Array(metadata),
  'ingredients/TIT.usfm': new Uint8Array(ingredient),
});

test('installed export accepts the sample Burrito ZIP and exact metadata bytes', () => {
  assert.deepEqual(verifyBurritoZip(validZip, metadata), {
    ingredientFiles: 1,
    metadataBytes: metadata.length,
  });
});

test('installed export rejects an invalid ZIP negative control', () => {
  assert.throws(
    () => verifyBurritoZip(Buffer.from('not a ZIP'), metadata),
    /malformed or truncated/,
  );
});

test('installed export rejects a truncated ZIP', () => {
  assert.throws(
    () => verifyBurritoZip(validZip.subarray(0, validZip.length - 8), metadata),
    /malformed or truncated/,
  );
});

test('installed export requires root metadata and at least one ingredient file', () => {
  const noMetadata = zipSync({ 'ingredients/TIT.usfm': new Uint8Array(ingredient) });
  const noIngredient = zipSync({ 'metadata.json': new Uint8Array(metadata) });
  assert.throws(() => verifyBurritoZip(noMetadata, metadata), /root metadata\.json/);
  assert.throws(() => verifyBurritoZip(noIngredient, metadata), /files under root ingredients\//);
});

test('installed export rejects metadata that differs from the raw metadata route', () => {
  const changedMetadata = Buffer.from(metadata);
  changedMetadata[0] ^= 1;
  assert.throws(
    () => verifyBurritoZip(validZip, changedMetadata),
    /byte-for-byte/,
  );
});
