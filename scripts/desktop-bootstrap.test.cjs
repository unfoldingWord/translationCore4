const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { appResourcesDir, bindPackagedResources, bootstrap, profileDirectory, shouldBindPackagedResources } = require('./desktop-bootstrap.cjs');

const repo = path.resolve(__dirname, '..');
const recipe = fs.readFileSync(path.join(__dirname, 'package-desktop.zsh'), 'utf8');
const smokeApi = fs.readFileSync(path.join(__dirname, 'smoke-api.cjs'), 'utf8');
const pinsSetup = fs.readFileSync(path.join(repo, 'dev-env', 'scripts', 'setup-from-pins.zsh'), 'utf8');
const assembledSetup = fs.readFileSync(path.join(repo, 'dev-env', 'scripts', 'setup.zsh'), 'utf8');
// Source the identifier and project data from the actual packaged inputs.
const resource = recipe.match(/"(unfoldingWord\/en_ult):/)[1].toLowerCase().replace('/', '--');
const imagePin = recipe.match(/"uW\/obs_images_360::([0-9a-f]{40})"/)[1];
const imageResource = `uw--obs_images_360--${imagePin.slice(0, 12)}`;
const sample = path.join(repo, 'conformance/sample-burrito');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-bootstrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { resourcesDir: path.join(dir, 'bundle resources'), home: path.join(dir, 'pilot home'), storeLeaf: 'pankosmia/tc4-projects', variant: 'production' };
}
function stage(options) {
  fs.cpSync(sample, path.join(options.resourcesDir, 'resources', resource), { recursive: true });
  fs.cpSync(sample, path.join(options.resourcesDir, 'resources', imageResource), { recursive: true });
}
function stageProduct(options, shortName = 'tc4') {
  const product = path.join(options.resourcesDir, 'lib', 'product');
  fs.mkdirSync(product, { recursive: true });
  fs.writeFileSync(path.join(product, 'product.json'), JSON.stringify({ short_name: shortName }) + '\n');
}

test('missing bundle fails the negative control; production then seeds once and preserves user changes', (t) => {
  const options = fixture(t);
  assert.throws(() => bootstrap(options), { code: 'ENOENT' });
  stage(options);
  bootstrap(options);
  const store = path.join(options.home, options.storeLeaf);
  const installed = path.join(store, '_local_', '_sideloaded_', resource, 'metadata.json');
  assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(sample, 'metadata.json')));
  fs.appendFileSync(installed, '\n');
  const changed = fs.readFileSync(installed);
  bootstrap(options);
  assert.deepEqual(fs.readFileSync(installed), changed);
  const imageInstalled = path.join(store, '_local_', '_sideloaded_', imageResource, 'metadata.json');
  assert.equal(fs.existsSync(imageInstalled), true);
  fs.appendFileSync(imageInstalled, '\n');
  const imageChanged = fs.readFileSync(imageInstalled);
  bootstrap(options);
  assert.deepEqual(fs.readFileSync(imageInstalled), imageChanged);
  assert.equal(fs.existsSync(path.join(store, '_local_', '_sideloaded_', 'uw--obs_images_360')), false);
  assert.deepEqual(fs.readdirSync(path.join(store, '_local_')), ['_sideloaded_']);
  assert.equal(fs.existsSync(path.join(options.home, 'pankosmia/tc4')), false);
});

test('debug seed failure can be retried; sample has a git commit and production stays separate', (t) => {
  const options = { ...fixture(t), storeLeaf: 'pankosmia/tc4-projects-debug', variant: 'debug' };
  stage(options);
  assert.throws(() => bootstrap(options), { code: 'ENOENT' });
  const seed = path.join(options.home, options.storeLeaf, '_local_', '_local_', 'sample_burrito');
  assert.equal(fs.existsSync(seed), false);
  assert.equal(fs.existsSync(`${seed}.tc4-installing`), false);
  fs.cpSync(sample, path.join(options.resourcesDir, 'debug-seeds/sample_burrito'), { recursive: true });
  bootstrap(options);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: seed, encoding: 'utf8' });
  bootstrap(options);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: seed, encoding: 'utf8' }), head);
  assert.equal(fs.existsSync(path.join(options.home, 'pankosmia/tc4-projects')), false);
});

test('the installer recipe carries the complete English OBS set and sha-only default image pack', async () => {
  const { EN_HELPS, EN_OBS_IMAGES } = await import('../src/data/installedSuite.js');
  // Negative control: a plausible but unpinned image entry is absent.
  assert.equal(recipe.includes('uW/obs_images_360::0000000000000000000000000000000000000000'), false);
  for (const slot of ['obs', 'obs-tn', 'obs-twl']) {
    const pin = EN_HELPS[slot];
    const ownerRepo = pin.repoPath.replace('git.door43.org/', '');
    assert.equal(recipe.includes(`"${ownerRepo}:${pin.version}:${pin.sha}"`), true, slot);
  }
  const imageOwnerRepo = EN_OBS_IMAGES.repoPath.replace('git.door43.org/', '');
  assert.equal(recipe.includes(`"${imageOwnerRepo}::${EN_OBS_IMAGES.sha}"`), true);
});

test('packaged binding overrides a poisoned parent and repairs only the saved resource selector', (t) => {
  const options = fixture(t);
  const previousResourceDir = process.env.APP_RESOURCES_DIR;
  t.after(() => {
    if (previousResourceDir === undefined) delete process.env.APP_RESOURCES_DIR;
    else process.env.APP_RESOURCES_DIR = previousResourceDir;
  });
  stageProduct(options);
  const profile = profileDirectory(options);
  fs.mkdirSync(profile, { recursive: true });
  const settingsFile = path.join(profile, 'user_settings.json');
  const original = {
    app_resources_dir: 'C:\\old-install\\lib\\',
    repo_dir: path.join(options.home, options.storeLeaf),
    languages: ['en'],
    future_setting: { keep: true },
  };
  fs.writeFileSync(settingsFile, JSON.stringify(original, null, 2) + '\n');
  process.env.APP_RESOURCES_DIR = 'C:\\old-install\\lib\\';
  const before = fs.readFileSync(settingsFile);
  const result = bindPackagedResources(options);
  const selected = appResourcesDir(options.resourcesDir);
  assert.equal(process.env.APP_RESOURCES_DIR, selected);
  assert.equal(result.repaired, true);
  const repaired = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(repaired.app_resources_dir, selected);
  assert.equal(repaired.repo_dir, original.repo_dir);
  assert.deepEqual(repaired.languages, original.languages);
  assert.deepEqual(repaired.future_setting, original.future_setting);
  assert.notDeepEqual(fs.readFileSync(settingsFile), before);

  const stable = fs.readFileSync(settingsFile);
  const mtime = fs.statSync(settingsFile).mtimeMs;
  const second = bindPackagedResources(options);
  assert.equal(second.repaired, false);
  assert.deepEqual(fs.readFileSync(settingsFile), stable);
  assert.equal(fs.statSync(settingsFile).mtimeMs, mtime);
});

test('resource binding is deterministic for absent, relative, and absolute parent selectors and for a relocated profile', (t) => {
  const options = fixture(t);
  const previousResourceDir = process.env.APP_RESOURCES_DIR;
  t.after(() => {
    if (previousResourceDir === undefined) delete process.env.APP_RESOURCES_DIR;
    else process.env.APP_RESOURCES_DIR = previousResourceDir;
  });
  stageProduct(options);
  const profile = profileDirectory(options);
  fs.mkdirSync(profile, { recursive: true });
  const settingsFile = path.join(profile, 'user_settings.json');
  const base = {
    repo_dir: path.join(options.home, options.storeLeaf),
    project: { id: 'keep-me' },
    last_open: 'sample',
  };
  for (const poisoned of [undefined, 'relative/old-install/lib/', 'C:\\old-install\\lib\\']) {
    if (poisoned === undefined) delete process.env.APP_RESOURCES_DIR;
    else process.env.APP_RESOURCES_DIR = poisoned;
    fs.writeFileSync(settingsFile, JSON.stringify({ ...base, app_resources_dir: poisoned ?? null }) + '\n');
    const first = bindPackagedResources(options);
    const selected = appResourcesDir(options.resourcesDir);
    assert.equal(process.env.APP_RESOURCES_DIR, selected);
    assert.equal(first.repaired, true);
    const repaired = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(repaired.app_resources_dir, selected);
    assert.deepEqual(repaired.project, base.project);
    const stable = fs.readFileSync(settingsFile);
    assert.equal(bindPackagedResources(options).repaired, false);
    assert.deepEqual(fs.readFileSync(settingsFile), stable);
  }
  // A second installation/profile under spaces must resolve to its own lib and
  // never inherit the selector from the first location.
  const relocated = fixture(t);
  stageProduct(relocated);
  const relocatedProfile = profileDirectory(relocated);
  fs.mkdirSync(relocatedProfile, { recursive: true });
  fs.writeFileSync(path.join(relocatedProfile, 'user_settings.json'), JSON.stringify({ ...base, app_resources_dir: 'old' }) + '\n');
  bindPackagedResources(relocated);
  assert.equal(JSON.parse(fs.readFileSync(path.join(relocatedProfile, 'user_settings.json'), 'utf8')).app_resources_dir, appResourcesDir(relocated.resourcesDir));
});

test('malformed packaged profile settings fail explicitly and remain untouched', (t) => {
  const options = fixture(t);
  const previousResourceDir = process.env.APP_RESOURCES_DIR;
  t.after(() => {
    if (previousResourceDir === undefined) delete process.env.APP_RESOURCES_DIR;
    else process.env.APP_RESOURCES_DIR = previousResourceDir;
  });
  stageProduct(options);
  const profile = profileDirectory(options);
  fs.mkdirSync(profile, { recursive: true });
  const settingsFile = path.join(profile, 'user_settings.json');
  const malformed = Buffer.from('{"app_resources_dir":');
  fs.writeFileSync(settingsFile, malformed);
  assert.throws(() => bindPackagedResources(options), /profile settings are malformed/);
  assert.deepEqual(fs.readFileSync(settingsFile), malformed);
  assert.equal(fs.existsSync(`${settingsFile}.tc4-writing-${process.pid}`), false);
});

test('the generated packaged entry point binds before upstream startup and preserves external-server mode', () => {
  assert.match(recipe, /shouldBindPackagedResources\(process\.env\.START_SERVER\)/);
  assert.match(recipe, /bootstrap\.bindPackagedResources\(options\)/);
  assert.match(recipe, /require\('\.\/electronStartup\.js'\)/);
  assert.match(recipe, /if \(process\.platform === 'darwin' \|\| process\.platform === 'win32'\)/);
  assert.match(recipe, /APP_RESOURCES_DIR=\"\$POISON_ROOT\/lib\//);
  assert.match(recipe, /run_api_smoke obs-create/);
  assert.match(recipe, /run_api_smoke obs-template-probe/);
  assert.match(recipe, /run_real_client_smoke/);
  assert.match(recipe, /build-smoke-journal\.cjs/);
  assert.match(recipe, /run_api_smoke obs-readback/);
});

test('external-server mode is the one explicit selector/profile escape hatch', () => {
  assert.equal(shouldBindPackagedResources(undefined), true);
  assert.equal(shouldBindPackagedResources('true'), true);
  assert.equal(shouldBindPackagedResources('false'), false);
});

test('external-server mode leaves the caller override and saved profile untouched', (t) => {
  const options = fixture(t);
  stageProduct(options);
  const profile = profileDirectory(options);
  fs.mkdirSync(profile, { recursive: true });
  const settingsFile = path.join(profile, 'user_settings.json');
  const original = { app_resources_dir: 'relative/external/lib/', repo_dir: 'external-store', preference: 'keep' };
  fs.writeFileSync(settingsFile, JSON.stringify(original) + '\n');
  const previousResourceDir = process.env.APP_RESOURCES_DIR;
  process.env.APP_RESOURCES_DIR = original.app_resources_dir;
  t.after(() => {
    if (previousResourceDir === undefined) delete process.env.APP_RESOURCES_DIR;
    else process.env.APP_RESOURCES_DIR = previousResourceDir;
  });
  if (shouldBindPackagedResources('false')) bindPackagedResources(options);
  assert.equal(process.env.APP_RESOURCES_DIR, original.app_resources_dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), original);
});

test('every template assembly route invokes the shared OBS validator', () => {
  for (const source of [pinsSetup, assembledSetup, recipe]) {
    assert.match(source, /fix-obs-template\.mjs/);
  }
});

test('OBS smoke reads the platform template before writing and checks all byte surfaces', () => {
  assert.match(smokeApi, /const source = Buffer\.from\(await getBytes\(storyRoute\(project, number\)\)\)/);
  assert.match(smokeApi, /source\.includes\(0x0d\)/);
  assert.match(smokeApi, /OBS template probe/);
  assert.match(smokeApi, /git.*show/);
  assert.match(smokeApi, /HTTP\/package bytes/);
});
