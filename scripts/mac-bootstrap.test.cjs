const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { bootstrap } = require('./mac-bootstrap.cjs');

const repo = path.resolve(__dirname, '..');
const recipe = fs.readFileSync(path.join(__dirname, 'package-desktop.zsh'), 'utf8');
// Source the identifier and project data from the actual packaged inputs.
const resource = recipe.match(/"(unfoldingWord\/en_ult):/)[1].toLowerCase().replace('/', '--');
const sample = path.join(repo, 'conformance/sample-burrito');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-bootstrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { resourcesDir: path.join(dir, 'bundle resources'), home: path.join(dir, 'pilot home'), storeLeaf: 'pankosmia/tc4-projects', variant: 'production' };
}
function stage(options) {
  fs.cpSync(sample, path.join(options.resourcesDir, 'resources', resource), { recursive: true });
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
