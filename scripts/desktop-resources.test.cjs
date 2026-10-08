// Failure inventory before implementation (#528): missing/invalid bundle;
// old canonical folder blocks new revision; wrong/missing record; partial copy;
// process killed before rename or after rename; record write fails; same revision
// duplicated; legacy bytes changed; unrelated settings lost; checksum mismatch.
// Real identities and payloads come from the checked-in DCS export fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { bootstrap } = require('./desktop-bootstrap.cjs');

const root = path.resolve(__dirname, '..');
function exportFixture(version, destination) {
  const source = path.join(root, 'test/fixtures/resources', `en_tn@${version}`);
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'metadata.json')));
  // Reduce the real export to the one included ingredient, retaining its exact
  // identity, checksum and bytes. This is a bounded fixture, not a made-up SHA.
  metadata.ingredients = { 'ingredients/TIT.tsv': metadata.ingredients['ingredients/TIT.tsv'] };
  metadata.type.flavorType.currentScope = { TIT: [] };
  fs.mkdirSync(path.join(destination, 'ingredients'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify(metadata));
  fs.copyFileSync(path.join(source, 'TIT.tsv'), path.join(destination, 'ingredients/TIT.tsv'));
  const [identity, revision] = Object.entries(metadata.identification.primary.dcs)[0];
  return { repoPath: `git.door43.org/${identity}`, sha: revision.revision, version, flavor: 'parascriptural/x-bcvnotes' };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-resource-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { resourcesDir: path.join(dir, 'bundle'), home: path.join(dir, 'home'), storeLeaf: 'pankosmia/tc4-projects', variant: 'production' };
  const source = path.join(options.resourcesDir, 'resources/unfoldingword--en_tn');
  const pin = exportFixture('v91', source);
  fs.writeFileSync(path.join(options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [pin] }));
  fs.mkdirSync(path.join(options.resourcesDir, 'lib/product'), { recursive: true });
  fs.writeFileSync(path.join(options.resourcesDir, 'lib/product/product.json'), JSON.stringify({ short_name: 'tc4' }));
  fs.mkdirSync(path.join(options.resourcesDir, 'lib/templates'), { recursive: true });
  fs.mkdirSync(path.join(options.resourcesDir, 'lib/setup'), { recursive: true });
  fs.writeFileSync(path.join(options.resourcesDir, 'lib/setup/local_setup.json'), JSON.stringify({ local_pankosmia_path: './lib/clients' }));
  fs.writeFileSync(path.join(options.resourcesDir, 'lib/templates/user_settings.json'), JSON.stringify({ repo_dir: '%%HOMEDIR%%/pankosmia/tc4-projects', app_resources_dir: '%%APPRESOURCESDIR%%' }));
  fs.writeFileSync(path.join(options.resourcesDir, 'lib/templates/app_state.json'), JSON.stringify({ current_project: null }));
  const store = path.join(options.home, options.storeLeaf);
  const local = path.join(store, '_local_/_sideloaded_');
  const key = `_local_/_sideloaded_/unfoldingword--en_tn--${pin.sha}`;
  const settings = path.join(options.home, 'pankosmia/tc4/client_settings/uw-tc4.json');
  return { options, source, pin, store, local, key, destination: path.join(store, key), settings };
}
function files(dir) {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((p) => fs.statSync(path.join(dir, p)).isFile()).sort().map((p) => [p, fs.readFileSync(path.join(dir, p)).toString('base64')]));
}
function settingsAt(f) { return JSON.parse(fs.readFileSync(f.settings, 'utf8')); }
function writeSettings(f, doc) {
  fs.mkdirSync(path.dirname(f.settings), { recursive: true });
  fs.writeFileSync(f.settings, JSON.stringify(doc));
}

// Additional failure inventory (CI): Gitea commit archives have no metadata
// DCS revision; metadata omits lexicon payload files; a missing/wrong receipt
// or a changed unlisted payload must never certify a revision. Provenance
// comes from the real pinned archive and its build-time verified commit.
async function archiveFixture(t) {
  const f = fixture(t);
  const { INSTALLED_SUITE } = await import('../src/data/installedSuite.js');
  fs.rmSync(f.source, { recursive: true });
  f.pin = { ...INSTALLED_SUITE.resources.lexicon.nt };
  f.source = path.join(f.options.resourcesDir, 'resources/uw--en_ugl');
  fs.mkdirSync(path.join(f.source, 'ingredients/content'), { recursive: true });
  const input = path.join(root, 'test/fixtures/resources/en_ugl@d9d29e2d5892');
  fs.copyFileSync(path.join(input, 'metadata.json'), path.join(f.source, 'metadata.json'));
  fs.copyFileSync(path.join(input, 'README.md'), path.join(f.source, 'ingredients/README.md'));
  fs.copyFileSync(path.join(input, '1.json'), path.join(f.source, 'ingredients/content/1.json'));
  const tree = Object.fromEntries(fs.readdirSync(f.source, { recursive: true }).filter((name) => fs.statSync(path.join(f.source, name)).isFile()).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(f.source, name));
    return [name.split(path.sep).join('/'), { size: bytes.length, checksum: { sha256: createHash('sha256').update(bytes).digest('hex') } }];
  }));
  const receipt = JSON.stringify({ repoPath: f.pin.repoPath, sha: f.pin.sha, files: tree });
  fs.writeFileSync(path.join(f.source, '.tc4-bundled-identity.json'), receipt);
  const manifestPin = { ...f.pin, version: null, archive_receipt_sha256: createHash('sha256').update(receipt).digest('hex') };
  fs.writeFileSync(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [manifestPin] }));
  f.key = `_local_/_sideloaded_/uw--en_ugl--${f.pin.sha}`;
  f.destination = path.join(f.store, f.key);
  return f;
}

test('real commit archive without DCS metadata installs from a verified receipt, records no invented version, and reuses a recorded legacy copy', async (t) => {
  const f = await archiveFixture(t);
  const receiptFile = path.join(f.source, '.tc4-bundled-identity.json');
  const receipt = fs.readFileSync(receiptFile);
  fs.unlinkSync(receiptFile);
  assert.throws(() => bootstrap(f.options), /receipt|manifest|ENOENT/); // negative control
  fs.writeFileSync(receiptFile, receipt);
  bootstrap(f.options);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  assert.equal(fs.existsSync(path.join(f.destination, 'ingredients/content/1.json')), true);
  const legacy = path.join(f.local, 'uw--en_ugl');
  fs.renameSync(f.destination, legacy);
  fs.unlinkSync(path.join(legacy, '.tc4-bundled-identity.json'));
  writeSettings(f, { installedResources: { '_local_/_sideloaded_/uw--en_ugl': f.pin }, keep: true });
  bootstrap(f.options);
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.existsSync(path.join(legacy, '.tc4-bundled-identity.json')), false, 'legacy bytes must not be changed');
  assert.equal(settingsAt(f).keep, true);
});

test('commit archive receipt and full payload hashes reject a changed unlisted lexicon ingredient', async (t) => {
  const f = await archiveFixture(t);
  const receipt = path.join(f.source, '.tc4-bundled-identity.json');
  fs.appendFileSync(receipt, '\n');
  assert.throws(() => bootstrap(f.options), /receipt|manifest/);
  fs.writeFileSync(receipt, fs.readFileSync(receipt, 'utf8').trim());
  bootstrap(f.options);
  fs.appendFileSync(path.join(f.destination, 'ingredients/content/1.json'), '\n');
  assert.throws(() => bootstrap(f.options), /size|checksum/);
});

test('upgrade preserves older pinned and unpinned releases and records the new exact revision', (t) => {
  const f = fixture(t);
  const legacy = path.join(f.local, 'unfoldingword--en_tn');
  const old = exportFixture('v86', legacy);
  const before = files(legacy);
  // Presence of a pin must not alter installation policy. The project is only
  // read later by the app; the launcher must leave its bytes alone.
  const project = path.join(f.store, '_local_/_local_/upgrade-project/ingredients/checking');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'resources.json'), JSON.stringify({ resources: { notes: old } }));
  const projectsBefore = files(path.dirname(project));
  writeSettings(f, { otherSetting: true, installedResources: { '_local_/_sideloaded_/unfoldingword--en_tn': old } });
  bootstrap(f.options);
  assert.equal(fs.existsSync(f.destination), true, 'new project must find bundled v91 beside old v86');
  assert.deepEqual(files(legacy), before);
  assert.deepEqual(files(path.dirname(project)), projectsBefore);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  assert.equal(settingsAt(f).otherSetting, true);
  fs.rmSync(path.dirname(path.dirname(project)), { recursive: true });
  bootstrap(f.options);
  assert.deepEqual(files(legacy), before, 'unpinned old release stays unchanged too');
});

test('fresh store publishes once; current legacy and versioned folders are reused without writes', (t) => {
  const f = fixture(t);
  bootstrap(f.options);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  assert.equal(fs.existsSync(path.join(path.dirname(path.dirname(f.settings)), 'app_state.json')), true, 'fresh profile must be complete before the platform sees it');
  const before = files(f.options.home);
  const mtime = fs.statSync(f.settings).mtimeMs;
  bootstrap(f.options);
  assert.deepEqual(files(f.options.home), before);
  assert.equal(fs.statSync(f.settings).mtimeMs, mtime);
  const legacy = path.join(f.local, 'en_tn');
  fs.renameSync(f.destination, legacy);
  writeSettings(f, { independent: 'keep', installedResources: {} });
  bootstrap(f.options);
  assert.equal(fs.existsSync(f.destination), false);
  assert.deepEqual(settingsAt(f).installedResources['_local_/_sideloaded_/en_tn'], f.pin);
  assert.equal(settingsAt(f).independent, 'keep');
  assert.deepEqual(files(legacy), files(f.source));
});

test('failed copy leaves no discoverable partial resource and retry succeeds', (t) => {
  const f = fixture(t);
  const original = fs.cpSync;
  fs.cpSync = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, 'metadata.json'), path.join(dest, 'metadata.json'));
    throw new Error('copy interrupted');
  };
  try { assert.throws(() => bootstrap(f.options), /copy interrupted/); }
  finally { fs.cpSync = original; }
  assert.equal(fs.existsSync(f.destination), false);
  assert.deepEqual(files(f.local), {});
  bootstrap(f.options);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
});

for (const phase of ['before-publish', 'after-publish']) {
  test(`process interruption ${phase} recovers without duplicate or partial install`, (t) => {
    const f = fixture(t);
    const script = `const fs = require('node:fs'); const rename = fs.renameSync; fs.renameSync = (src, dest) => {
      if (dest === ${JSON.stringify(f.destination)} && ${JSON.stringify(phase)} === 'before-publish') process.exit(77);
      rename(src, dest);
      if (dest === ${JSON.stringify(f.destination)} && ${JSON.stringify(phase)} === 'after-publish') process.exit(77);
    }; require(${JSON.stringify(path.join(__dirname, 'desktop-bootstrap.cjs'))}).bootstrap(${JSON.stringify(f.options)});`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr);
    if (phase === 'before-publish') assert.deepEqual(files(f.local), {});
    else assert.deepEqual(files(f.destination), files(f.source));
    bootstrap(f.options);
    assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
    assert.deepEqual(fs.readdirSync(f.local), [path.basename(f.destination)]);
  });
}

test('failed record write repairs the already published folder on retry and preserves other settings', (t) => {
  const f = fixture(t);
  writeSettings(f, { otherSetting: false, installedResources: {} });
  const rename = fs.renameSync;
  fs.renameSync = (src, dest) => {
    if (dest === f.settings) throw new Error('settings unavailable');
    return rename(src, dest);
  };
  try { assert.throws(() => bootstrap(f.options), /settings unavailable/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(files(f.destination), files(f.source));
  bootstrap(f.options);
  assert.equal(settingsAt(f).otherSetting, false);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
});

test('incomplete or conflicting exact destination cannot be accepted or silently overwritten', (t) => {
  const f = fixture(t);
  fs.cpSync(f.source, f.destination, { recursive: true });
  fs.unlinkSync(path.join(f.destination, 'ingredients/TIT.tsv'));
  assert.throws(() => bootstrap(f.options), /incomplete|missing|ENOENT/);
  assert.equal(fs.existsSync(f.settings), false);
  fs.copyFileSync(path.join(f.source, 'ingredients/TIT.tsv'), path.join(f.destination, 'ingredients/TIT.tsv'));
  fs.appendFileSync(path.join(f.destination, 'ingredients/TIT.tsv'), 'corrupted');
  assert.throws(() => bootstrap(f.options), /checksum|size|incomplete/);
  assert.equal(fs.existsSync(f.settings), false);
});

test('manifest mismatch and malformed settings fail without losing existing records', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [{ ...f.pin, sha: exportFixture('v86', path.join(f.store, 'old')).sha }] }));
  assert.throws(() => bootstrap(f.options), /revision|identity|manifest/);
  assert.equal(fs.existsSync(f.destination), false);
  fs.writeFileSync(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [f.pin] }));
  writeSettings(f, { installedResources: {} });
  fs.writeFileSync(f.settings, '{');
  assert.throws(() => bootstrap(f.options), /JSON|settings/);
  assert.equal(fs.readFileSync(f.settings, 'utf8'), '{');
});

module.exports = { exportFixture };
