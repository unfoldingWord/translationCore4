// macos-preinstall.sh on app bundles in a temporary folder, and macos-pkg.sh's pkg (#1016): the
// installer finds a translationCore 4 that is not where the pkg installs, leaves the tC4 4.0
// beta and other apps alone, removes only the copies the pkg will not overwrite, and records the
// whole version. Only macOS has PlistBuddy and pkgbuild.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const macos = process.platform === 'darwin';
const ID = 'org.unfoldingword.translationcore4';

function app(dir, name, { id = ID, display = 'translationCore 4' } = {}) {
  const bundle = path.join(dir, name);
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  fs.copyFileSync('/usr/bin/true', path.join(bundle, 'Contents/MacOS/Electron'));
  fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleDisplayName</key><string>${display}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
  return bundle;
}

/** Runs shell text with the preinstall's functions defined and its install location set to `target`. */
function preinstall(target, text) {
  const done = spawnSync('/bin/bash', ['-c', `source "$1"; target="$2"; ${text}`, 'bash', path.join(here, 'macos-preinstall.sh'), target], { encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  return done.stdout.split('\n').filter(Boolean);
}

const temp = (t) => {
  // realpath: /var is a link to /private/var, and find prints what it was given.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the_installer_finds_a_translationcore_4_under_another_name_or_folder', { skip: !macos }, (t) => {
  const dir = temp(t);
  const installed = app(path.join(dir, 'Applications'), 'translationCore 4.app');
  const renamed = app(path.join(dir, 'Applications'), 'translationCore 4 2.app');
  const moved = app(path.join(dir, 'Desktop', 'old'), 'tC preview.app');
  app(path.join(dir, 'Applications'), 'translationCore4.app', { display: 'translationCore4' });
  app(path.join(dir, 'Applications'), 'translationCore.app', { id: 'com.electron.translationcore', display: 'translationCore' });
  // A bundle inside a bundle is part of that app, never a copy of its own.
  app(path.join(installed, 'Contents', 'Frameworks'), 'Helper.app');

  const found = preinstall(installed, `bundles_in "$3" "$3/none" | sort -u | keep_translationcore4`.replace(/\$3/g, dir));
  assert.deepEqual(found.sort(), [installed, renamed, moved].sort());
});

test('replacing_removes_every_other_copy_and_leaves_the_install_location_to_the_pkg', { skip: !macos }, (t) => {
  const dir = temp(t);
  const installed = app(path.join(dir, 'Applications'), 'translationCore 4.app');
  const renamed = app(path.join(dir, 'Applications'), 'translationCore 4 2.app');
  const beta = app(path.join(dir, 'Applications'), 'translationCore4.app', { display: 'translationCore4' });

  const left = preinstall(installed, `bundles_in "${dir}" | keep_translationcore4 | remove_others`);
  assert.deepEqual(left, []);
  assert.equal(fs.existsSync(renamed), false);
  assert.equal(fs.existsSync(installed), true);
  assert.equal(fs.existsSync(beta), true);
});

test('a_copy_that_cannot_be_removed_is_named', { skip: !macos || process.getuid() === 0 }, (t) => {
  const dir = temp(t);
  const locked = path.join(dir, 'locked');
  const stuck = app(locked, 'translationCore 4.app');
  fs.chmodSync(locked, 0o555);
  try {
    assert.deepEqual(preinstall(path.join(dir, 'Applications/translationCore 4.app'), `printf '%s\\n' "${stuck}" | remove_others`), [stuck]);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('the_pkg_runs_the_preinstall_and_records_the_whole_version', { skip: !macos }, (t) => {
  const dir = temp(t);
  const staged = app(dir, 'translationCore 4.app');
  const pkg = path.join(dir, 'out.pkg');
  const built = spawnSync('/bin/bash', [path.join(here, 'macos-pkg.sh'), staged, '4.1.0-preview2', pkg], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const expanded = path.join(dir, 'expanded');
  assert.equal(spawnSync('pkgutil', ['--expand', pkg, expanded]).status, 0);

  const info = fs.readFileSync(path.join(expanded, 'application.pkg/PackageInfo'), 'utf8');
  assert.match(info, /<pkg-info[^>]* version="4\.1\.0-preview2"/);
  assert.match(info, /<pkg-info[^>]* install-location="\/Applications"/);
  assert.match(info, /<pkg-info[^>]* relocatable="false"/);
  assert.match(info, /<preinstall file="\.\/preinstall"/);
  const script = path.join(expanded, 'application.pkg/Scripts/preinstall');
  assert.equal(fs.readFileSync(script, 'utf8'), fs.readFileSync(path.join(here, 'macos-preinstall.sh'), 'utf8'));
  assert.notEqual(fs.statSync(script).mode & 0o111, 0);
});
