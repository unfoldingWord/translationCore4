const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { appResourcesDir, bindPackagedResources, bootstrap, profileDirectory, shouldBindPackagedResources } = require('./desktop-bootstrap.cjs');

const repo = path.resolve(__dirname, '..');
const recipe = fs.readFileSync(path.join(__dirname, 'package-desktop.zsh'), 'utf8');
const desktopMain = fs.readFileSync(path.join(__dirname, 'desktop-main.cjs'), 'utf8');
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
// `userData` and `encryption` (#366): the fake `safeStorage` — a reversible
// transform behind a marker, never the clear text — and the directory the
// token file lives in, so a second start can read what the first kept.
function runDesktopMain({ platform = 'linux', lock = true, startServer, bindError = false, printError = false, userData = os.tmpdir(), encryption = true } = {}) {
  const events = [];
  const handlers = {};
  const windows = [];
  const window = {
    isMinimized: () => true,
    restore: () => events.push('restore'),
    focus: () => events.push('focus'),
  };
  const app = {
    setAppUserModelId: () => events.push('setAppUserModelId'),
    requestSingleInstanceLock: () => {
      events.push('lock');
      return lock;
    },
    quit: () => events.push('quit'),
    on: (event, handler) => {
      events.push('on:' + event);
      handlers[event] = handler;
    },
    exit: (code) => events.push('exit:' + code),
    commandLine: { appendSwitch: (name) => events.push('switch:' + name) },
    getPath: (name) => {
      if (name !== 'userData') throw new Error('unexpected path ' + name);
      return userData;
    },
  };
  const safeStorage = {
    isEncryptionAvailable: () => encryption,
    encryptString: (text) => Buffer.concat([Buffer.from('v10'), Buffer.from(Buffer.from(text, 'utf8').map((b) => b ^ 0x5a))]),
    decryptString: (bytes) => {
      if (bytes.subarray(0, 3).toString() !== 'v10') throw new Error('not this keychain\'s bytes');
      return Buffer.from(bytes.subarray(3).map((b) => b ^ 0x5a)).toString('utf8');
    },
  };
  // The hidden print window of the PDF bridge (#20): it records what it was
  // given, and fails the print when the case asks it to.
  class BrowserWindow {
    static getAllWindows() {
      return [window];
    }
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        printToPDF: async (printOptions) => {
          this.printOptions = printOptions;
          if (printError) throw new Error('print failed');
          return Buffer.from('%PDF-1.4');
        },
      };
      windows.push(this);
    }
    async loadFile(file) {
      this.file = file;
      this.html = fs.readFileSync(file, 'utf8');
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const electron = {
    app,
    BrowserWindow,
    ipcMain: {
      handle: (channel, handler) => {
        events.push('handle:' + channel);
        handlers[channel] = handler;
      },
    },
    dialog: { showErrorBox: () => events.push('errorBox') },
    shell: { openExternal: (url) => events.push('openExternal:' + url) },
    safeStorage,
  };
  const bootstrapModule = {
    shouldBindPackagedResources: (value) => {
      events.push('shouldBind:' + (value ?? 'undefined'));
      return value !== 'false';
    },
    bindPackagedResources: () => {
      events.push('bind');
      if (bindError) throw new Error('bind failed');
    },
    bootstrap: () => events.push('bootstrap'),
  };
  const fakeRequire = (request) => {
    if (request === 'electron') return electron;
    if (request === './tc4-bootstrap.cjs') return bootstrapModule;
    if (request === './tc4-bootstrap.json') return { storeLeaf: 'pankosmia/tc4-projects', variant: 'production' };
    if (request === './electronStartup.js') {
      events.push('upstream');
      return {};
    }
    if (request === 'path') return require('node:path');
    if (request === 'os') return { homedir: () => 'C:\\pilot home', tmpdir: () => os.tmpdir() };
    return require(request);
  };
  const context = {
    __dirname: 'C:\\bundle\\electron',
    process: { env: startServer === undefined ? {} : { START_SERVER: startServer }, platform },
    require: fakeRequire,
  };
  vm.runInNewContext(desktopMain, context, { filename: 'desktop-main.cjs' });
  return { events, handlers, windows };
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

test('the packaged entry point is valid, ordered, and preserves its launch contracts', () => {
  // Negative control first: a brace drift in the source must be rejected before
  // the positive wrapper is accepted.
  assert.throws(() => new vm.Script(desktopMain + '\n}'), SyntaxError);
  assert.doesNotThrow(() => new vm.Script(desktopMain));

  const linux = runDesktopMain();
  assert.deepEqual(linux.events, ['lock', 'switch:disable-dev-shm-usage', 'handle:export:pdf', 'handle:token:keep', 'handle:token:read', 'handle:token:forget', 'on:browser-window-created', 'on:second-instance', 'shouldBind:undefined', 'bind', 'upstream']);
  const mac = runDesktopMain({ platform: 'darwin' });
  assert.deepEqual(mac.events, ['lock', 'handle:export:pdf', 'handle:token:keep', 'handle:token:read', 'handle:token:forget', 'on:browser-window-created', 'on:second-instance', 'shouldBind:undefined', 'bind', 'bootstrap', 'upstream']);
  const windows = runDesktopMain({ platform: 'win32' });
  assert.deepEqual(windows.events, ['setAppUserModelId', 'lock', 'handle:export:pdf', 'handle:token:keep', 'handle:token:read', 'handle:token:forget', 'on:browser-window-created', 'on:second-instance', 'shouldBind:undefined', 'bind', 'bootstrap', 'upstream']);
  const external = runDesktopMain({ startServer: 'false' });
  assert.deepEqual(external.events, ['lock', 'switch:disable-dev-shm-usage', 'handle:export:pdf', 'handle:token:keep', 'handle:token:read', 'handle:token:forget', 'on:browser-window-created', 'on:second-instance', 'shouldBind:false', 'upstream']);
  const second = runDesktopMain({ lock: false });
  assert.deepEqual(second.events, ['lock', 'quit']);
  const failed = runDesktopMain({ bindError: true });
  assert.deepEqual(failed.events, ['lock', 'switch:disable-dev-shm-usage', 'handle:export:pdf', 'handle:token:keep', 'handle:token:read', 'handle:token:forget', 'on:browser-window-created', 'on:second-instance', 'shouldBind:undefined', 'bind', 'errorBox', 'exit:1']);

  linux.handlers['second-instance']();
  assert.deepEqual(linux.events.slice(-2), ['restore', 'focus']);
  assert.match(desktopMain, /shouldBindPackagedResources\(process\.env\.START_SERVER\)/);
  assert.match(recipe, /desktop-main\.cjs/);
  assert.match(recipe, /node --check/);
  assert.match(recipe, /APP_RESOURCES_DIR=\"\$POISON_ROOT\/lib\//);
  assert.match(recipe, /run_api_smoke obs-create/);
  assert.match(recipe, /run_api_smoke obs-template-probe/);
  assert.match(recipe, /run_real_client_smoke/);
  assert.match(recipe, /production store contains residual _local_\/_local_ project data/);
  assert.match(recipe, /production store _local_ holds unexpected entries/);
  assert.match(recipe, /ELECTRON_RUN_AS_NODE=1 "\$ELECTRON_NODE" "\$\(cygpath -m "\$SMOKE_API"\)"/);
  assert.match(recipe, /ELECTRON_RUN_AS_NODE=1 "\$ELECTRON_NODE" "\$\(cygpath -m "\$SMOKE_JOURNAL"\)"/);
  assert.match(recipe, /build-smoke-journal\.cjs/);
  assert.match(recipe, /run_api_smoke obs-readback/);
});

test('the PDF bridge prints the document in a hidden window and always removes the window and the temporary file', async () => {
  const html = '<!doctype html><html><body>Titus</body></html>';
  const ok = runDesktopMain();
  const bytes = await ok.handlers['export:pdf']({}, html);
  assert.equal(bytes.toString(), '%PDF-1.4');
  const [win] = ok.windows;
  assert.deepEqual(JSON.parse(JSON.stringify(win.options)), { show: false, webPreferences: { javascript: false, sandbox: true } });
  assert.equal(win.html, html); // loaded from a file, not a data: URL
  assert.deepEqual(JSON.parse(JSON.stringify(win.printOptions)), { preferCSSPageSize: true }); // the document's @page sets the paper
  assert.equal(win.destroyed, true);
  assert.equal(fs.existsSync(win.file), false);

  const failed = runDesktopMain({ printError: true });
  await assert.rejects(failed.handlers['export:pdf']({}, html), /print failed/);
  assert.equal(failed.windows[0].destroyed, true);
  assert.equal(fs.existsSync(path.dirname(failed.windows[0].file)), false);

  // The recipe installs tC4's preload over the template's, and the preload
  // exposes the close guard unchanged beside the bridge.
  const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  assert.match(recipe, /cp "\$REPO\/scripts\/preload\.cjs" "\$PACK\/electron\/preload\.js"/);
  assert.match(preload, /setCanClose: \(canClose\) => ipcRenderer\.send\('setCanClose', canClose\)/);
  assert.match(preload, /printPdf: \(html\) => ipcRenderer\.invoke\('export:pdf', html\)/);
});

// A fake session and download item (#382): the item finishes with the result
// the case gives it; the page records what the main process sent it.
function fakeDownload({ savePath, suggested, destroyed = false }) {
  const sent = [];
  const listeners = {};
  const session = { on: (event, listener) => (listeners[event] = [...(listeners[event] || []), listener]) };
  const page = { isDestroyed: () => destroyed, send: (channel, payload) => sent.push([channel, JSON.parse(JSON.stringify(payload))]) }; // IPC copies the payload
  const start = (state) => {
    let done;
    const item = { once: (event, listener) => event === 'done' && (done = listener), getSavePath: () => savePath, getFilename: () => suggested };
    for (const listener of listeners['will-download'] || []) listener({}, item, page);
    done?.({}, state);
  };
  return { session, sent, listeners, start };
}

test('the download report sends each download\'s file name and result to the page that started it', () => {
  const main = runDesktopMain();
  const win = (session) => main.handlers['browser-window-created']({}, { webContents: { session, setWindowOpenHandler: () => {} } });

  // Negative control: before any window exists, no session is watched.
  const idle = fakeDownload({ savePath: '/home/pilot/TIT-2026-09-26.pdf', suggested: 'TIT-2026-09-26.pdf' });
  idle.start('completed');
  assert.deepEqual(idle.sent, []);

  // The person saves under a new name: the report names the saved file.
  win(idle.session);
  win(idle.session); // the hidden PDF window shares the session: one listener, one report
  assert.equal(idle.listeners['will-download'].length, 1);
  idle.start('completed');
  assert.deepEqual(idle.sent, [['download:done', { filename: 'TIT-2026-09-26.pdf', state: 'completed' }]]);

  const renamed = fakeDownload({ savePath: '/home/pilot/Titus for review.pdf', suggested: 'TIT-2026-09-26.pdf' });
  win(renamed.session);
  renamed.start('completed');
  assert.deepEqual(renamed.sent, [['download:done', { filename: 'Titus for review.pdf', state: 'completed' }]]);

  // Cancelled and interrupted: no save path, so the suggested name.
  for (const state of ['cancelled', 'interrupted']) {
    const download = fakeDownload({ savePath: '', suggested: 'TIT-2026-09-26.usfm' });
    win(download.session);
    download.start(state);
    assert.deepEqual(download.sent, [['download:done', { filename: 'TIT-2026-09-26.usfm', state }]]);
  }

  // A page that closed before the download finished receives nothing.
  const closed = fakeDownload({ savePath: '', suggested: 'TIT.zip', destroyed: true });
  win(closed.session);
  closed.start('cancelled');
  assert.deepEqual(closed.sent, []);

  // The preload exposes the report as one listener, and no general IPC.
  const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  assert.match(preload, /ipcRenderer\.on\('download:done', relay\)/);
  assert.match(preload, /return \(\) => ipcRenderer\.removeListener\('download:done', relay\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.(on|send|invoke)\((?!'(download:done|setCanClose|export:pdf|token:keep|token:read|token:forget)')/);
});

// #366 (D85): the Door43 token in the operating-system keychain through
// `safeStorage`. The ways this can fail, written before the code: the clear
// token or the password reaches the disk; a second start cannot read the
// kept token; no keychain (Linux without a keyring) writes clear text or
// stays silent; forget leaves the file; bytes another keychain wrote are
// kept and answered as a token; the bridge exposes more than the three calls.
test('the keychain keeps the token as ciphertext only, a new start reads it back, forget removes it, and no keychain writes nothing and says so', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-keychain-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const password = 'the pass-word';
  const file = path.join(userData, 'door43-token');
  // IPC copies the answer, and the vm context's objects have their own prototypes.
  const answer = async (promise) => JSON.parse(JSON.stringify(await promise));

  // Negative control: nothing kept yet, so a start reads no token.
  const first = runDesktopMain({ userData });
  assert.deepEqual(await answer(first.handlers['token:read']({})), { token: null });
  assert.deepEqual(await answer(first.handlers['token:keep']({}, '')), { kept: false, reason: 'no token was given' });
  assert.equal(fs.existsSync(file), false);

  // 1. Kept: the file holds the ciphertext, not the token, not the password.
  assert.deepEqual(await answer(first.handlers['token:keep']({}, token)), { kept: true });
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.includes(token), false);
  assert.equal(bytes.includes(password), false);
  assert.equal(bytes.subarray(0, 3).toString(), 'v10');
  assert.deepEqual(fs.readdirSync(userData), ['door43-token']); // no temporary file left
  // A new main-process start reads it back.
  const second = runDesktopMain({ userData });
  assert.deepEqual(await answer(second.handlers['token:read']({})), { token });

  // 3. No keychain: nothing is written, and the answer says so; a kept file is
  //    not decryptable either, so it is not answered as a token.
  const plain = runDesktopMain({ userData, encryption: false });
  const before = fs.readFileSync(file);
  const refused = await answer(plain.handlers['token:keep']({}, 'another-token'));
  assert.equal(refused.kept, false);
  assert.match(refused.reason, /no keychain/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(await answer(plain.handlers['token:read']({})), { token: null, reason: refused.reason });
  assert.equal(filesUnder(userData).some((f) => fs.readFileSync(f).includes('another-token')), false);

  // 4. Forget removes the file; a later read finds nothing; forget again is fine.
  assert.deepEqual(await answer(second.handlers['token:forget']({})), { forgotten: true });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(await answer(second.handlers['token:read']({})), { token: null });
  assert.deepEqual(await answer(second.handlers['token:forget']({})), { forgotten: true });

  // Bytes this keychain cannot open (another account's, or damaged) are removed, not answered.
  fs.writeFileSync(file, Buffer.from('not-ciphertext'));
  const damaged = await answer(second.handlers['token:read']({}));
  assert.equal(damaged.token, null);
  assert.match(damaged.reason, /could not be read/);
  assert.equal(fs.existsSync(file), false);

  // The preload exposes exactly the three calls, each to its own channel.
  const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  assert.match(preload, /keep: \(token\) => ipcRenderer\.invoke\('token:keep', token\)/);
  assert.match(preload, /read: \(\) => ipcRenderer\.invoke\('token:read'\)/);
  assert.match(preload, /forget: \(\) => ipcRenderer\.invoke\('token:forget'\)/);
});

/** Every file under `dir`, recursively. */
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

// #362: a link with target=_blank ("Open on Door43") opens in the system
// browser; the app never opens a second window for it, and never for a
// non-web address.
test('a window-open request goes to the system browser for a web address, and is denied either way', () => {
  const main = runDesktopMain();
  let handler;
  main.handlers['browser-window-created']({}, { webContents: { session: { on: () => {} }, setWindowOpenHandler: (h) => (handler = h) } });
  assert.equal(handler({ url: 'https://qa.door43.org/facilitator/tit' }).action, 'deny');
  assert.equal(handler({ url: 'file:///etc/passwd' }).action, 'deny');
  assert.deepEqual(main.events.filter((e) => e.startsWith('openExternal:')), ['openExternal:https://qa.door43.org/facilitator/tit']);
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
