// Failure inventory: preparation must paint before work, report progress,
// refuse a failed worker, cancel before starting the server, and survive an
// immediate relaunch with abandoned staging. Exercise the bundled worker,
// not a mock implementation of resource installation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { zipSync } = require('fflate');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-worker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const electron = path.join(dir, 'electron');
  execFileSync(process.execPath, [path.join(__dirname, 'build-desktop-bootstrap.cjs'), electron]);
  const resourcesDir = path.join(dir, 'bundle');
  const input = path.join(__dirname, '../test/fixtures/resources/en_tn@v91');
  const meta = JSON.parse(fs.readFileSync(path.join(input, 'metadata.json')));
  meta.ingredients = { 'ingredients/TIT.tsv': meta.ingredients['ingredients/TIT.tsv'] };
  const [repo, identity] = Object.entries(meta.identification.primary.dcs)[0];
  const archive = zipSync({ 'metadata.json': Buffer.from(JSON.stringify(meta)), 'ingredients/TIT.tsv': fs.readFileSync(path.join(input, 'TIT.tsv')) });
  fs.mkdirSync(path.join(resourcesDir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'resources/tn.zip'), archive);
  fs.writeFileSync(path.join(resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: [{ repoPath: `git.door43.org/${repo}`, sha: identity.revision, version: 'v91', archive: 'tn.zip', zip_sha256: createHash('sha256').update(archive).digest('hex') }] }));
  for (const [name, value] of Object.entries({ 'product/product.json': { short_name: 'tc4' }, 'setup/local_setup.json': { local_pankosmia_path: './lib/clients' }, 'templates/user_settings.json': {}, 'templates/app_state.json': {} })) {
    const file = path.join(resourcesDir, 'lib', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  return { prepareDesktop: require(path.join(electron, 'tc4-prepare.cjs')).prepareDesktop,
    options: { resourcesDir, home: path.join(dir, 'home'), storeLeaf: 'pankosmia/tc4-projects', variant: 'production' } };
}

function launch(f, cancelOnProgress = false) {
  const events = [];
  const windows = [];
  const app = new EventEmitter();
  app.whenReady = async () => {};
  let complete, reject;
  const result = new Promise((resolve, fail) => { complete = resolve; reject = fail; });
  app.quit = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', event);
    if (event.prevented) return;
    for (const window of windows) window.emit('close', event);
    if (!event.prevented) { events.push('quit'); complete('quit'); }
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) { super(); windows.push(this); this.options = options; this.webContents = { executeJavaScript: async (source) => {
      events.push(source);
      if (cancelOnProgress && source.includes('Preparing resources:')) this.emit('close', { preventDefault() {} });
    } }; }
    async loadFile(file) { assert.match(fs.readFileSync(file, 'utf8'), /Preparing translationCore4/); events.push('painted'); }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; events.push('destroy'); }
  }
  f.prepareDesktop({ app, BrowserWindow }, f.options, () => {
    events.push('server');
    const next = new BrowserWindow({});
    app.emit('browser-window-created', {}, next);
    next.emit('ready-to-show');
    complete('started');
  }, reject);
  return { events, app, result };
}

test('#740: bundled worker fails closed, then prepares off the event loop and hands off its window', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const archive = path.join(f.options.resourcesDir, 'resources/tn.zip');
  const bytes = fs.readFileSync(archive);
  fs.appendFileSync(archive, 'damage');
  const failed = launch(f);
  await assert.rejects(failed.result, /checksum/);
  assert.equal(failed.events.includes('server'), false);
  fs.writeFileSync(archive, bytes);
  const good = launch(f);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(good.events[0], 'painted');
  assert.equal(good.events.includes('server'), false);
  assert.equal(await good.result, 'started');
  assert.ok(good.events.some((event) => event.includes('Preparing resources:')));
  assert.deepEqual(good.events.slice(-2), ['server', 'destroy']);
});

test('#740: Close terminates preparation before quitting and immediate relaunch succeeds', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const cancelled = launch(f, true);
  assert.equal(await cancelled.result, 'quit');
  assert.equal(cancelled.events.includes('server'), false);
  const retry = launch(f);
  assert.equal(await retry.result, 'started');
});
