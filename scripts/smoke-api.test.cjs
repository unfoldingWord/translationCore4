const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');

const sample = path.resolve(__dirname, '..', 'conformance', 'sample-burrito');
const metadata = fs.readFileSync(path.join(sample, 'metadata.json'));
const ingredient = fs.readFileSync(path.join(sample, 'ingredients', 'TIT.usfm'));
const zip = zipSync({
  'metadata.json': new Uint8Array(metadata),
  'ingredients/TIT.usfm': new Uint8Array(ingredient),
});
const proveSource = fs.readFileSync(path.join(__dirname, 'prove.mjs'), 'utf8');
const sampleRepo = proveSource.match(/const SAMPLE = '([^']+)';/)?.[1];
assert.ok(sampleRepo, 'scripts/prove.mjs must declare its seeded sample project');

async function runExportSmoke(zipStatus, smokeApi = path.join(__dirname, 'smoke-api.cjs'), cwd = process.cwd(), zipBytes = zip) {
  const zipRoute = `/api/burrito/zipped/${sampleRepo}`;
  const metadataRoute = `/api/burrito/metadata/raw/${sampleRepo}`;
  const server = http.createServer((request, response) => {
    if (request.url === zipRoute) {
      response.writeHead(zipStatus, { 'content-type': 'application/zip' });
      response.end(zipBytes);
    } else if (request.url === metadataRoute) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(metadata);
    } else {
      response.writeHead(404);
      response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        smokeApi,
        `http://127.0.0.1:${address.port}`,
        sampleRepo,
        'sample_burrito',
        'unused-marker',
        'export',
        path.join(__dirname, '..', 'tmp-smoke-api-test'),
      ], { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
    return result;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function exportLines(stdout) {
  return stdout.split(/\r?\n/).filter((line) => /^(ok|FAIL) export:/.test(line));
}

test('export smoke rejects HTTP 206 even when the ZIP is valid', async () => {
  const result = await runExportSmoke(206);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /expected HTTP 200, got 206/);
  assert.match(result.stdout, /^FAIL export:/m);
  assert.equal(exportLines(result.stdout).length, 1);
});

test('export smoke prints one physical failure line for a ZIP entry containing a newline', async () => {
  const invalidName = `\u00e9\n${path.basename(path.join(sample, 'ingredients', 'TIT.usfm'))}`;
  const noIngredientZip = zipSync({
    'metadata.json': new Uint8Array(metadata),
    [invalidName]: new Uint8Array(ingredient),
  });
  const result = await runExportSmoke(200, path.join(__dirname, 'smoke-api.cjs'), process.cwd(), noIngredientZip);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /^FAIL export:/);
  assert.equal(result.stdout.trimEnd().split(/\r?\n/).length, 1);
});

test('bundled export smoke runs without checkout dependencies', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-smoke-api-'));
  const bundledSmoke = path.join(temporaryDirectory, 'smoke-api.cjs');
  const builtSmoke = path.join(__dirname, `.smoke-api-validation-${process.pid}.cjs`);
  assert.equal(fs.existsSync(builtSmoke), false, 'temporary bundled smoke path is unused');
  try {
    execFileSync(process.execPath, [
      path.join(__dirname, 'build-smoke-api.cjs'),
      builtSmoke,
    ], { cwd: path.resolve(__dirname, '..') });
    fs.copyFileSync(builtSmoke, bundledSmoke);

    const result = await runExportSmoke(200, bundledSmoke, temporaryDirectory);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^ok export:/m);
    assert.equal(exportLines(result.stdout).length, 1);
  } finally {
    if (fs.existsSync(builtSmoke)) fs.unlinkSync(builtSmoke);
    if (fs.existsSync(bundledSmoke)) fs.unlinkSync(bundledSmoke);
    fs.rmdirSync(temporaryDirectory);
  }
});
