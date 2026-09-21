// Packaged startup support. The resource binding runs under the singleton lock,
// before the server initializes its own working directory (#243, #70, #348).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function withTrailingSeparator(value) {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function appResourcesDir(resourcesDir) {
  return withTrailingSeparator(path.resolve(resourcesDir, 'lib'));
}

function productShortName(resourcesDir) {
  const productFile = path.join(resourcesDir, 'lib', 'product', 'product.json');
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
  } catch (error) {
    throw new Error(`could not read packaged product identity at ${productFile}: ${error.message}`);
  }
  if (!product || typeof product.short_name !== 'string' || !/^[a-z0-9-]+$/i.test(product.short_name)) {
    throw new Error(`packaged product identity has no valid short_name at ${productFile}`);
  }
  return product.short_name;
}

function profileDirectory({ resourcesDir, home, profileLeaf }) {
  const leaf = profileLeaf || path.join('pankosmia', productShortName(resourcesDir));
  return path.join(home, leaf);
}

// An explicit external-server launch owns its selector/profile. Packaged
// binding is only for the server this entry point starts itself.
function shouldBindPackagedResources(startServer = process.env.START_SERVER) {
  return startServer !== 'false';
}

function writeJsonAtomically(file, value) {
  const temporary = `${file}.tc4-writing-${process.pid}-${Date.now()}`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Bind the bundled server to this installation's resources and repair the
 * saved selector for an existing tC4 profile. This must run before
 * electronStartup.js captures process.env.APP_RESOURCES_DIR.
 */
function bindPackagedResources({ resourcesDir, home, profileLeaf }) {
  const selected = appResourcesDir(resourcesDir);
  process.env.APP_RESOURCES_DIR = selected;

  const settingsFile = path.join(profileDirectory({ resourcesDir, home, profileLeaf }), 'user_settings.json');
  if (!fs.existsSync(settingsFile)) return { appResourcesDir: selected, settingsFile, repaired: false };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (error) {
    throw new Error(`tC4 profile settings are malformed at ${settingsFile}: ${error.message}`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`tC4 profile settings are not an object at ${settingsFile}`);
  }
  if (settings.app_resources_dir === selected) {
    return { appResourcesDir: selected, settingsFile, repaired: false };
  }
  settings.app_resources_dir = selected;
  writeJsonAtomically(settingsFile, settings);
  return { appResourcesDir: selected, settingsFile, repaired: true };
}

function copyIfMissing(source, destination, prepare = () => {}) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // A failed/interrupted copy must not masquerade as an installed resource on
  // the next launch. Publish only the completed directory.
  const staging = `${destination}.tc4-installing`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
    prepare(staging);
    fs.renameSync(staging, destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function bootstrap({ resourcesDir, home, storeLeaf, variant }) {
  const store = path.join(home, storeLeaf);
  const bundled = path.join(resourcesDir, 'resources');
  for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    copyIfMissing(path.join(bundled, entry.name), path.join(store, '_local_', '_sideloaded_', entry.name));
  }
  if (variant === 'debug') {
    const destination = path.join(store, '_local_', '_local_', 'sample_burrito');
    copyIfMissing(path.join(resourcesDir, 'debug-seeds', 'sample_burrito'), destination, (cwd) => {
      // Same initial commit as the existing debug launcher (#70).
      const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
      git('init', '-q', '-b', 'main', '.');
      git('add', '-A');
      git('-c', 'user.email=debug@tc4.local', '-c', 'user.name=tc4-debug', 'commit', '-qm', 'seed');
    });
  }
}

module.exports = { appResourcesDir, bindPackagedResources, bootstrap, profileDirectory, shouldBindPackagedResources };
