// First-run assets for the Mac app and Windows shortcuts. Called under the singleton
// lock, before the server initializes its own working directory (#243, #70).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

module.exports = { bootstrap };
