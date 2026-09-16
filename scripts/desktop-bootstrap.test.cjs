const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { bootstrap } = require('./desktop-bootstrap.cjs');

const repo = path.resolve(__dirname, '..');
const recipe = fs.readFileSync(path.join(__dirname, 'package-desktop.zsh'), 'utf8');
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
