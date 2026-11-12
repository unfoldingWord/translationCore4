// macos-preinstall.sh on app bundles in a temporary folder, and macos-pkg.sh's pkg (#1016): the
// installer finds a translationCore 4 that is not where the pkg installs, leaves the tC4 4.0
// beta and other apps alone, asks before it replaces, removes only what the person agreed to and
// only after the install, and records the whole version. The person's answer is a stub: the real
// dialog needs a person at a screen. Only macOS has PlistBuddy and pkgbuild.
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

/**
 * Runs shell text with the installer script's functions defined, its install location set to
 * `target`, its consent file in `dir`, and a person at the screen whose answer is `answer`:
 * the status the dialog ends with, and what osascript prints.
 */
function installer(dir, target, text, { answer = 0, prints = '', env = {} } = {}) {
  const setup = `source "$1"; target="$2"; consent="$3/consent"; asked="$3/asked"; uid=501; person=someone
    as_person() { echo asked >> "$asked"; printf '%s' "$PRINTS"; return "$ANSWER"; }`;
  const done = spawnSync('/bin/bash', ['-c', `${setup}\n${text}`, 'bash', path.join(here, 'macos-preinstall.sh'), target, dir], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ANSWER: String(answer), PRINTS: prints, ...env },
  });
  return { status: done.status, lines: done.stdout.split('\n').filter(Boolean), stderr: done.stderr };
}
const asked = (dir) => fs.existsSync(path.join(dir, 'asked'));

const temp = (t) => {
  // realpath: /var is a link to /private/var, and find prints what it was given.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** The reported case: the app where the pkg installs, a copy under another name, and the beta. */
function mac(t) {
  const dir = temp(t);
  const apps = path.join(dir, 'Applications');
  return {
    dir,
    installed: app(apps, 'translationCore 4.app'),
    renamed: app(apps, 'translationCore 4 2.app'),
    beta: app(apps, 'translationCore4.app', { display: 'translationCore4' }),
  };
}
const CANCELLED = 'execution error: User canceled. (-128)';

test('the_installer_finds_a_translationcore_4_under_another_name_or_folder', { skip: !macos }, (t) => {
  const { dir, installed, renamed } = mac(t);
  const moved = app(path.join(dir, 'Desktop', 'old'), 'tC preview.app');
  app(path.join(dir, 'Applications'), 'translationCore.app', { id: 'com.electron.translationcore', display: 'translationCore' });
  // A bundle inside a bundle is part of that app, never a copy of its own.
  app(path.join(installed, 'Contents', 'Frameworks'), 'Helper.app');

  const found = installer(dir, installed, `bundles_in "${dir}" "${dir}/none" | sort -u | keep_translationcore4`);
  assert.deepEqual(found.lines.sort(), [installed, renamed, moved].sort());
});

test('what_spotlight_names_counts_only_in_applications_and_this_person_s_folders', { skip: !macos }, (t) => {
  const dir = temp(t);
  const names = ['/Applications/a.app', '/Users/me/Desktop/b.app', '/Users/me/.Trash/c.app', '/Users/me/Library/d.app',
    '/Users/other/Desktop/e.app', '/Volumes/Disk/f.app', '/private/tmp/g.app'];
  const kept = installer(dir, '/x', `printf '%s\\n' ${names.map((n) => `'${n}'`).join(' ')} | in_this_persons_folders /Users/me`);
  assert.deepEqual(kept.lines, ['/Applications/a.app', '/Users/me/Desktop/b.app']);
});

test('replace_removes_the_other_copy_only_after_the_install', { skip: !macos }, (t) => {
  const { dir, installed, renamed, beta } = mac(t);
  const copies = `${installed}\n${renamed}`;

  const before = installer(dir, installed, `before_install "${copies}"`);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(asked(dir), true);
  assert.equal(fs.existsSync(renamed), true, 'nothing is removed before the new app is written');

  const after = installer(dir, installed, 'after_install');
  assert.equal(after.status, 0, after.stderr);
  assert.equal(fs.existsSync(renamed), false);
  assert.equal(fs.existsSync(installed), true);
  assert.equal(fs.existsSync(beta), true);
  assert.equal(fs.existsSync(path.join(dir, 'consent')), false);
});

test('cancel_stops_the_install_and_removes_nothing', { skip: !macos }, (t) => {
  const { dir, installed, renamed } = mac(t);

  const before = installer(dir, installed, `before_install "${installed}\n${renamed}"`, { answer: 1, prints: CANCELLED });
  assert.equal(before.status, 1);
  // Installer runs no postinstall after a failed preinstall; were one to run, it removes nothing.
  installer(dir, installed, 'after_install');
  assert.equal(fs.existsSync(renamed), true);
  assert.equal(fs.existsSync(installed), true);
});

test('a_question_that_cannot_be_shown_installs_and_removes_nothing', { skip: !macos }, (t) => {
  const { dir, installed, renamed } = mac(t);

  const before = installer(dir, installed, `before_install "${installed}\n${renamed}"`, { answer: 1, prints: 'Could not find domain for user' });
  assert.equal(before.status, 0);
  installer(dir, installed, 'after_install');
  assert.equal(fs.existsSync(renamed), true);
});

test('an_install_from_a_terminal_asks_nobody_and_removes_nothing', { skip: !macos }, (t) => {
  const { dir, installed, renamed } = mac(t);

  const before = installer(dir, installed, `before_install "${installed}\n${renamed}"`, { env: { COMMAND_LINE_INSTALL: '1' } });
  assert.equal(before.status, 0);
  assert.equal(asked(dir), false);
  installer(dir, installed, 'after_install', { env: { COMMAND_LINE_INSTALL: '1' } });
  assert.equal(fs.existsSync(renamed), true);
});

test('a_mac_with_no_translationcore_4_is_asked_nothing', { skip: !macos }, (t) => {
  const dir = temp(t);
  const before = installer(dir, path.join(dir, 'Applications/translationCore 4.app'), 'before_install ""');
  assert.equal(before.status, 0);
  assert.equal(asked(dir), false);
});

test('a_copy_that_cannot_be_removed_is_named', { skip: !macos || process.getuid() === 0 }, (t) => {
  const dir = temp(t);
  const locked = path.join(dir, 'locked');
  const stuck = app(locked, 'translationCore 4.app');
  fs.chmodSync(locked, 0o555);
  try {
    const left = installer(dir, path.join(dir, 'Applications/translationCore 4.app'), `printf '%s\\n' "${stuck}" | remove_others`);
    assert.deepEqual(left.lines, [stuck]);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('the_pkg_runs_the_script_before_and_after_and_records_the_whole_version', { skip: !macos }, (t) => {
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
  for (const name of ['preinstall', 'postinstall']) {
    assert.match(info, new RegExp(`<${name} file="\\./${name}"`));
    const script = path.join(expanded, 'application.pkg/Scripts', name);
    assert.equal(fs.readFileSync(script, 'utf8'), fs.readFileSync(path.join(here, 'macos-preinstall.sh'), 'utf8'));
    assert.notEqual(fs.statSync(script).mode & 0o111, 0);
  }
});
