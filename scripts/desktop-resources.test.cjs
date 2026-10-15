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
// #740: which ingredient files a launch opens. `validateTree` reads through
// `fs.readFileSync`, the one `fs` object this test shares with the module.
function ingredientReads(run) {
  const real = fs.readFileSync;
  const reads = [];
  fs.readFileSync = (file, ...rest) => {
    if (typeof file === 'string' && file.split(path.sep).includes('ingredients')) reads.push(file);
    return real(file, ...rest);
  };
  try { run(); } finally { fs.readFileSync = real; }
  return reads;
}
function writeSettings(f, doc) {
  fs.mkdirSync(path.dirname(f.settings), { recursive: true });
  fs.writeFileSync(f.settings, JSON.stringify(doc));
}

// #740 failure inventory before archive installation: a wrong archive hash,
// unsafe or missing entries, wrong identity, incomplete writes, interrupted
// publication and failed settings writes must never certify a partial release.
// Source and destination ingredients must not be opened individually on a
// fresh archive install; a repeat start must not read the archive payload.
function archiveBundle(f) {
  const { zipSync } = require('fflate');
  const entries = Object.fromEntries(Object.entries(files(f.source)).map(([name, value]) => [name, Buffer.from(value, 'base64')]));
  const archive = path.basename(f.source) + '.zip';
  const bytes = zipSync(entries, { level: 0 });
  const file = path.join(f.options.resourcesDir, 'resources', archive);
  fs.writeFileSync(file, bytes);
  const manifest = settingsDocument(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'));
  manifest.bundled_resources[0].archive = archive;
  manifest.bundled_resources[0].zip_sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify(manifest));
  fs.rmSync(f.source, { recursive: true });
  return { file, entries, bytes };
}
function settingsDocument(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

test('#740: an archive installs verified bytes once, without ingredient reads or recursive copies', async (t) => {
  const f = fixture(t);
  const ingredient = path.join(f.source, 'ingredients/TIT.tsv');
  const correct = fs.readFileSync(ingredient);
  fs.appendFileSync(ingredient, 'damaged');
  assert.throws(() => bootstrap(f.options), /size|checksum/); // real-fixture negative control
  fs.writeFileSync(ingredient, correct);
  const bundle = archiveBundle(f);
  const read = fs.readFileSync, copy = fs.cpSync;
  let archives = 0;
  fs.readFileSync = (file, ...args) => {
    if (file === bundle.file) archives++;
    if (typeof file === 'string' && file.split(path.sep).includes('ingredients')) throw Error('ingredient reopened');
    return read(file, ...args);
  };
  fs.cpSync = () => { throw Error('recursive resource copy'); };
  try { await bootstrap(f.options); }
  finally { fs.readFileSync = read; fs.cpSync = copy; }
  assert.equal(archives, 1);
  for (const [name, bytes] of Object.entries(bundle.entries)) assert.deepEqual(fs.readFileSync(path.join(f.destination, name)), Buffer.from(bytes));
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  fs.readFileSync = (file, ...args) => {
    if (file === bundle.file) throw Error('archive payload reopened on repeat start');
    return read(file, ...args);
  };
  try { await bootstrap(f.options); }
  finally { fs.readFileSync = read; }
});

for (const damage of ['archive hash', 'ingredient checksum', 'missing ingredient', 'unsafe entry', 'wrong revision']) {
  test(`#740: ${damage} cannot publish an archive or a success receipt`, async (t) => {
    const f = fixture(t);
    const bundle = archiveBundle(f);
    const { zipSync } = require('fflate');
    if (damage === 'archive hash') fs.appendFileSync(bundle.file, 'damage');
    else {
      if (damage === 'ingredient checksum') bundle.entries['ingredients/TIT.tsv'][0] ^= 1;
      if (damage === 'missing ingredient') delete bundle.entries['ingredients/TIT.tsv'];
      if (damage === 'unsafe entry') bundle.entries['../escape'] = Buffer.from('escape');
      if (damage === 'wrong revision') {
        const meta = JSON.parse(bundle.entries['metadata.json']);
        Object.values(meta.identification.primary.dcs)[0].revision = 'wrong';
        bundle.entries['metadata.json'] = Buffer.from(JSON.stringify(meta));
      }
      const bytes = zipSync(bundle.entries, { level: 0 });
      fs.writeFileSync(bundle.file, bytes);
      const manifestFile = path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json');
      const manifest = settingsDocument(manifestFile);
      manifest.bundled_resources[0].zip_sha256 = createHash('sha256').update(bytes).digest('hex');
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    }
    await assert.rejects(bootstrap(f.options), /checksum|Incomplete|Invalid|revision/);
    assert.deepEqual(files(f.local), {});
    assert.equal(fs.existsSync(f.settings), false);
  });
}

test('#740: archive write and settings failures drain writes, clean staging and recover', async (t) => {
  const f = fixture(t);
  archiveBundle(f);
  writeSettings(f, { independent: 'keep', installedResources: {} });
  const write = fs.promises.writeFile;
  fs.promises.writeFile = async (file, ...args) => {
    if (file.endsWith('TIT.tsv')) throw Error('disk full');
    return write.call(fs.promises, file, ...args);
  };
  try { await assert.rejects(bootstrap(f.options), /disk full/); }
  finally { fs.promises.writeFile = write; }
  assert.deepEqual(files(f.local), {});
  assert.deepEqual(settingsAt(f), { independent: 'keep', installedResources: {} });
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === f.settings) throw Error('settings unavailable');
    return rename(source, destination);
  };
  try { await assert.rejects(bootstrap(f.options), /settings unavailable/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(f.destination), true);
  assert.deepEqual(settingsAt(f), { independent: 'keep', installedResources: {} });
  await bootstrap(f.options);
  assert.equal(settingsAt(f).independent, 'keep');
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  assert.ok(settingsAt(f).verifiedResources[f.key]);
});

test('#740: archive packaging reuses an installed DCS export against its own inventory and preserves older releases', async (t) => {
  const f = fixture(t);
  const legacyKey = '_local_/_sideloaded_/en_tn';
  const legacy = path.join(f.store, legacyKey);
  fs.cpSync(f.source, legacy, { recursive: true });
  const ingredient = path.join(legacy, 'ingredients/TIT.tsv');
  fs.appendFileSync(ingredient, '\n');
  const bytes = fs.readFileSync(ingredient);
  const metadataFile = path.join(legacy, 'metadata.json');
  const meta = settingsDocument(metadataFile);
  meta.ingredients['ingredients/TIT.tsv'].size = bytes.length;
  meta.ingredients['ingredients/TIT.tsv'].checksum.md5 = createHash('md5').update(bytes).digest('hex');
  fs.writeFileSync(metadataFile, JSON.stringify(meta));
  const oldKey = '_local_/_sideloaded_/en_tn-v86';
  const old = path.join(f.store, oldKey);
  const oldPin = exportFixture('v86', old);
  const before = files(f.local);
  writeSettings(f, { installedResources: { [oldKey]: oldPin }, independent: true });
  const bundle = archiveBundle(f);
  const read = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    if (file === bundle.file) throw Error('archive read despite a complete existing export');
    return read(file, ...args);
  };
  try { await bootstrap(f.options); await bootstrap(f.options); }
  finally { fs.readFileSync = read; }
  assert.deepEqual(files(f.local), before);
  assert.deepEqual(settingsAt(f).installedResources, { [oldKey]: oldPin, [legacyKey]: f.pin });
  assert.equal(settingsAt(f).independent, true);
});

for (const phase of ['before-publish', 'after-publish']) {
  test(`#740: interrupted archive ${phase} recovers`, async (t) => {
    const f = fixture(t);
    archiveBundle(f);
    const script = `const fs = require('node:fs'); const rename = fs.renameSync; fs.renameSync = (src, dest) => {
      if (dest === ${JSON.stringify(f.destination)} && ${JSON.stringify(phase)} === 'before-publish') process.exit(77);
      rename(src, dest);
      if (dest === ${JSON.stringify(f.destination)} && ${JSON.stringify(phase)} === 'after-publish') process.exit(77);
    }; require(${JSON.stringify(path.join(__dirname, 'desktop-bootstrap.cjs'))}).bootstrap(${JSON.stringify(f.options)}).catch(e => { console.error(e); process.exit(1); });`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr);
    assert.equal(fs.existsSync(f.settings), false);
    await bootstrap(f.options);
    assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
    assert.deepEqual(fs.readdirSync(f.local), [path.basename(f.destination)]);
  });
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

test('#740: compact lexicons preserve all source bytes and attribution, and leave expanded developer installs alone', async (t) => {
  const f = await archiveFixture(t);
  const sourceFiles = Object.fromEntries(Object.entries(files(f.source)).filter(([name]) => name !== '.tc4-bundled-identity.json').map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]));
  const { installableFiles } = await import('../src/data/resourceArchive.mjs');
  await assert.rejects(installableFiles(f.pin, sourceFiles, 'wrong revision'), /revision/);
  const compact = await installableFiles(f.pin, sourceFiles, f.pin.sha);
  const { unzipSync } = require('fflate');
  const restored = unzipSync(compact['ingredients/source.zip']);
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(sourceFiles).sort());
  for (const [name, bytes] of Object.entries(sourceFiles)) assert.deepEqual(Buffer.from(restored[name]), bytes);
  const meta = JSON.parse(Buffer.from(compact['metadata.json']));
  assert.deepEqual(meta.copyright, JSON.parse(sourceFiles['metadata.json']).copyright);
  assert.equal(meta.ingredients['ingredients/source.zip'].size, compact['ingredients/source.zip'].length);
  // Old expanded data is retained without opening even a single payload.
  fs.mkdirSync(f.local, { recursive: true });
  fs.cpSync(f.source, f.destination, { recursive: true });
  const before = files(f.destination);
  writeSettings(f, { installedResources: { [f.key]: f.pin }, projectSetting: 'preserved' });
  fs.rmSync(f.source, { recursive: true });
  fs.mkdirSync(f.source);
  for (const [name, bytes] of Object.entries(compact)) {
    fs.mkdirSync(path.dirname(path.join(f.source, name)), { recursive: true });
    fs.writeFileSync(path.join(f.source, name), bytes);
  }
  const manifestFile = path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json');
  const manifest = settingsDocument(manifestFile);
  manifest.bundled_resources[0].archive_receipt_sha256 = createHash('sha256').update(compact['.tc4-bundled-identity.json']).digest('hex');
  manifest.bundled_resources[0].storage = 'lexicon-archive-v1';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  archiveBundle(f);
  const read = fs.promises.readFile;
  fs.promises.readFile = (file, ...args) => {
    if (file.startsWith(f.destination + path.sep)) throw Error('expanded legacy payload reopened');
    return read.call(fs.promises, file, ...args);
  };
  try { await bootstrap(f.options); await bootstrap(f.options); }
  finally { fs.promises.readFile = read; }
  assert.deepEqual(files(f.destination), before);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  const compactKey = f.key + '--compact-v1';
  assert.deepEqual(settingsAt(f).installedResources[compactKey], f.pin);
  assert.equal(settingsAt(f).projectSetting, 'preserved');
  assert.ok(settingsAt(f).verifiedResources[compactKey]);
  assert.equal(settingsAt(f).verifiedResources[f.key], undefined);
  assert.equal(Object.keys(files(path.join(f.store, compactKey))).length, 3);
});

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

test('commit archive receipt and full payload hashes reject a changed unlisted lexicon ingredient at install, and again once the verification record is gone (#740)', async (t) => {
  const f = await archiveFixture(t);
  const receipt = path.join(f.source, '.tc4-bundled-identity.json');
  fs.appendFileSync(receipt, '\n');
  assert.throws(() => bootstrap(f.options), /receipt|manifest/);
  fs.writeFileSync(receipt, fs.readFileSync(receipt, 'utf8').trim());
  bootstrap(f.options);
  fs.appendFileSync(path.join(f.destination, 'ingredients/content/1.json'), '\n');
  // #740: the installed copy was verified when it was published, and the
  // record says so; a later launch does not open its payload again, so a
  // change made to the installed copy after that is not seen at start.
  bootstrap(f.options);
  const settings = settingsAt(f);
  delete settings.verifiedResources;
  writeSettings(f, settings);
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

// #640 failure inventory: a DCS export's TWL rows follow en_twl master at fetch
// time, so two builds of one pin can ship different ingredient bytes. An
// installed copy that agrees with its own inventory is reused unchanged; one
// that disagrees with its own inventory (line 211 test) still stops startup.
test('#640: an installed export that drifted from the bundle but matches its own inventory is reused without writes', (t) => {
  const f = fixture(t);
  fs.cpSync(f.source, f.destination, { recursive: true });
  // The older build's copy: one more TWL row, and an inventory that agrees with it.
  const tsv = path.join(f.destination, 'ingredients/TIT.tsv');
  fs.appendFileSync(tsv, 'TIT 3:16\tdrift\t\tdrift\t1\t./payload/kt/drift.md\tdrift\n');
  const bytes = fs.readFileSync(tsv);
  const metadataFile = path.join(f.destination, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  metadata.ingredients['ingredients/TIT.tsv'].size = bytes.length;
  metadata.ingredients['ingredients/TIT.tsv'].checksum.md5 = createHash('md5').update(bytes).digest('hex');
  fs.writeFileSync(metadataFile, JSON.stringify(metadata));
  const before = files(f.destination);
  assert.notDeepEqual(before, files(f.source), 'the installed copy must differ from the bundle');
  bootstrap(f.options);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
  assert.deepEqual(files(f.destination), before, 'the installed copy keeps its bytes');
  assert.deepEqual(fs.readdirSync(f.local), [path.basename(f.destination)], 'one folder per repository and SHA');
  const homeBefore = files(f.options.home);
  const mtime = fs.statSync(f.settings).mtimeMs;
  bootstrap(f.options);
  assert.deepEqual(files(f.options.home), homeBefore, 'the second launch writes nothing');
  assert.equal(fs.statSync(f.settings).mtimeMs, mtime);
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

// #644 (D96 ruling 5): the install ignores, and never strips, the TWL TSVs an
// `en_tw` export carries and the articles an `en_twl` export carries. Both
// bundled folders land byte-for-byte, metadata.json included.
function twFixture(repo, version, destination, slice) {
  const source = path.join(root, 'test/fixtures/resources', `${repo}@${version}`);
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'metadata.json')));
  metadata.ingredients = Object.fromEntries(Object.entries(slice).map(([ipath]) => [`ingredients/${ipath}`, metadata.ingredients[`ingredients/${ipath}`]]));
  metadata.type.flavorType.currentScope = { TIT: [] };
  fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify(metadata));
  for (const [ipath, file] of Object.entries(slice)) {
    fs.mkdirSync(path.dirname(path.join(destination, 'ingredients', ipath)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(destination, 'ingredients', ipath));
  }
  const [identity, revision] = Object.entries(metadata.identification.primary.dcs)[0];
  return { repoPath: `git.door43.org/${identity}`, sha: revision.revision, version, flavor: 'parascriptural/x-bcvarticles' };
}

test('bundled en_tw (with its TSVs) and en_twl install unchanged: files and metadata.json match the bundle (#644)', (t) => {
  const f = fixture(t);
  fs.rmSync(f.source, { recursive: true });
  const tw = path.join(f.options.resourcesDir, 'resources/unfoldingword--en_tw');
  const twl = path.join(f.options.resourcesDir, 'resources/unfoldingword--en_twl');
  fs.mkdirSync(tw, { recursive: true });
  fs.mkdirSync(twl, { recursive: true });
  const twPin = twFixture('en_tw', 'v87', tw, { 'TIT.tsv': 'TIT.tsv', 'payload/kt/god.md': 'payload-kt-god.md' });
  const twlPin = twFixture('en_twl', 'v86', twl, { 'TIT.tsv': 'TIT.tsv' });
  assert.notEqual(files(tw)['ingredients/TIT.tsv'], files(twl)['ingredients/TIT.tsv'], 'the two TSVs differ');
  fs.writeFileSync(path.join(f.options.resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [twPin, twlPin] }));
  bootstrap(f.options);
  const twKey = `_local_/_sideloaded_/unfoldingword--en_tw--${twPin.sha}`;
  const twlKey = `_local_/_sideloaded_/unfoldingword--en_twl--${twlPin.sha}`;
  assert.deepEqual(settingsAt(f).installedResources[twKey], twPin);
  assert.deepEqual(settingsAt(f).installedResources[twlKey], twlPin);
  const installed = (key) => { const all = files(path.join(f.store, key)); delete all['.tc4-bundled-identity.json']; return all; };
  assert.deepEqual(installed(twKey), files(tw)); // the tw export's TIT.tsv is still there
  assert.deepEqual(installed(twlKey), files(twl));
});

// #740 failure inventory, written before the code: every launch opens every
// ingredient of the bundle and of the installed copy (35,823 opens, about 8
// minutes on a Windows laptop with Defender on); the verification record names
// another inventory than the copy now declares; the record has the wrong
// shape; the install record is lost but the verification record is not; a
// damaged bundle must still fail before a copy is published; a legacy folder
// reused at its own path gets its record under its own key; the record write
// fails; the second launch writes nothing (#528); a change made to the
// installed copy after its verification is not seen (the trade-off, in the
// archive test above).
test('#740: a published copy is verified once; the next launch opens no ingredient of the copy or of the bundle', (t) => {
  const f = fixture(t);
  const first = ingredientReads(() => bootstrap(f.options));
  assert.ok(first.some((file) => file.startsWith(f.source)), 'the bundle is verified before the copy');
  assert.ok(first.some((file) => file.includes('.tc4-resource-installing')), 'the copy is verified before it is published');
  const record = settingsAt(f).verifiedResources[f.key];
  assert.match(record.tree, /^[0-9a-f]{64}$/);
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin, 'the install record keeps its shape');
  const before = files(f.options.home);
  assert.deepEqual(ingredientReads(() => bootstrap(f.options)), [], 'no ingredient is opened');
  assert.deepEqual(files(f.options.home), before, 'the second launch writes nothing');
});

test('#740: a verification record for another inventory makes the launch verify the copy again against its own inventory, and never opens the bundle', (t) => {
  const f = fixture(t);
  bootstrap(f.options);
  // The copy's own inventory changes (the #640 shape: one more row, and an inventory that agrees with it).
  const tsv = path.join(f.destination, 'ingredients/TIT.tsv');
  fs.appendFileSync(tsv, 'TIT 3:16\tdrift\t\tdrift\t1\t./payload/kt/drift.md\tdrift\n');
  const bytes = fs.readFileSync(tsv);
  const metadataFile = path.join(f.destination, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  metadata.ingredients['ingredients/TIT.tsv'].size = bytes.length;
  metadata.ingredients['ingredients/TIT.tsv'].checksum.md5 = createHash('md5').update(bytes).digest('hex');
  fs.writeFileSync(metadataFile, JSON.stringify(metadata));
  const stale = settingsAt(f).verifiedResources[f.key].tree;
  const reads = ingredientReads(() => bootstrap(f.options));
  assert.ok(reads.includes(tsv), 'the copy is verified again');
  assert.ok(reads.every((file) => !file.startsWith(f.source)), 'the bundle is not opened: no copy is made');
  assert.notEqual(settingsAt(f).verifiedResources[f.key].tree, stale, 'the record names the new inventory');
  assert.deepEqual(ingredientReads(() => bootstrap(f.options)), []);
  // Negative control: an inventory that disagrees with the copy still stops the start.
  metadata.ingredients['ingredients/TIT.tsv'].size = bytes.length + 1;
  fs.writeFileSync(metadataFile, JSON.stringify(metadata));
  assert.throws(() => bootstrap(f.options), /size/);
});

test('#740: a verification record of the wrong shape is not a verification: the copy is verified again and the record is written', (t) => {
  const f = fixture(t);
  bootstrap(f.options);
  for (const wrong of ['verified', ['verified'], { [f.key]: 'yes' }, { [f.key]: { tree: 42 } }, { [f.key]: { at: '2026-10-15T00:00:00.000Z' } }]) {
    const settings = settingsAt(f);
    settings.verifiedResources = wrong;
    writeSettings(f, settings);
    const reads = ingredientReads(() => bootstrap(f.options));
    assert.ok(reads.some((file) => file.startsWith(f.destination)), `verified again: ${JSON.stringify(wrong)}`);
    assert.match(settingsAt(f).verifiedResources[f.key].tree, /^[0-9a-f]{64}$/);
    assert.deepEqual(ingredientReads(() => bootstrap(f.options)), []);
  }
});

test('#740: a damaged bundle still fails before a copy is published; a lost install record is written again from the verified copy', (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.source, 'ingredients/TIT.tsv'), 'damaged');
  assert.throws(() => bootstrap(f.options), /checksum|size/);
  assert.deepEqual(files(f.local), {});
  assert.equal(fs.existsSync(f.settings), false);
  fs.copyFileSync(path.join(root, 'test/fixtures/resources/en_tn@v91/TIT.tsv'), path.join(f.source, 'ingredients/TIT.tsv'));
  bootstrap(f.options);
  const settings = settingsAt(f);
  settings.installedResources = {};
  writeSettings(f, settings);
  assert.deepEqual(ingredientReads(() => bootstrap(f.options)), [], 'the verified copy is trusted');
  assert.deepEqual(settingsAt(f).installedResources[f.key], f.pin);
});

test('#740: a legacy folder reused at its own path is verified once under its own key; a failed record write verifies again on retry', (t) => {
  const f = fixture(t);
  bootstrap(f.options);
  const legacy = path.join(f.local, 'en_tn');
  fs.renameSync(f.destination, legacy);
  writeSettings(f, { independent: 'keep', installedResources: {} });
  const rename = fs.renameSync;
  fs.renameSync = (src, dest) => {
    if (dest === f.settings) throw new Error('settings unavailable');
    return rename(src, dest);
  };
  try { assert.throws(() => bootstrap(f.options), /settings unavailable/); }
  finally { fs.renameSync = rename; }
  const reads = ingredientReads(() => bootstrap(f.options));
  assert.ok(reads.some((file) => file.startsWith(legacy)), 'no record survived the failed write, so the copy is verified again');
  assert.deepEqual(settingsAt(f).installedResources['_local_/_sideloaded_/en_tn'], f.pin);
  assert.match(settingsAt(f).verifiedResources['_local_/_sideloaded_/en_tn'].tree, /^[0-9a-f]{64}$/);
  assert.equal(settingsAt(f).independent, 'keep');
  assert.deepEqual(ingredientReads(() => bootstrap(f.options)), []);
});

module.exports = { exportFixture };
