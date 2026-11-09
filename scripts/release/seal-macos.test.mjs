// seal-macos.sh on a small app bundle shaped like Electron's (a nested helper app), with the real
// manifest.mjs: the sealed app passes codesign and its manifest is the record of its files
// (#969, INV-FINAL-MACOS-SEAL, INV-FINAL-MANIFEST-ACCURATE). Only macOS has codesign.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mismatches } from './manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const macos = process.platform === 'darwin';
const plist = (exe, id) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${exe}</string><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`;

/** An app bundle with a main executable, a resource and a nested helper app, as Electron.app has. */
function bundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-macos-'));
  const app = path.join(dir, 'Audit.app');
  const helper = path.join(app, 'Contents', 'Frameworks', 'Helper.app');
  for (const sub of ['Contents/MacOS', 'Contents/Resources']) {
    fs.mkdirSync(path.join(app, sub), { recursive: true });
    fs.mkdirSync(path.join(helper, sub), { recursive: true });
  }
  fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents/MacOS/Audit'));
  fs.copyFileSync('/usr/bin/true', path.join(helper, 'Contents/MacOS/Helper'));
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), plist('Audit', 'org.test.audit'));
  fs.writeFileSync(path.join(helper, 'Contents/Info.plist'), plist('Helper', 'org.test.helper'));
  fs.writeFileSync(path.join(app, 'Contents/Resources/x.txt'), 'a resource\n');
  return app;
}

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, TC4_BUILD_COMMIT: 'c'.repeat(40) } });
const seal = (app) => run('bash', [path.join(here, 'seal-macos.sh'), app, '--platform', 'macos-arm64', '--electronite', 'v0-test', '--electronite-sha256', '0'.repeat(64)]);
const verify = (app) => run('codesign', ['--verify', '--deep', '--strict', app]);
const check = (app) => run('node', [path.join(here, 'manifest.mjs'), '--check', path.join(app, 'Contents/Resources/BUILD-MANIFEST.json'), '--root', app]);
const readManifest = (app) => JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/BUILD-MANIFEST.json'), 'utf8'));

test('the_sealed_app_passes_codesign_with_its_manifest_inside', { skip: !macos && 'codesign is macOS only' }, () => {
  const app = bundle();
  const sealed = seal(app);
  assert.equal(sealed.status, 0, sealed.stderr);
  const verified = verify(app);
  assert.equal(verified.status, 0, `codesign --verify --deep --strict: ${verified.stderr}`);
  assert.ok(fs.existsSync(path.join(app, 'Contents/Resources/BUILD-MANIFEST.json')));
});

test('the_manifest_records_the_sealed_files_and_names_the_two_it_cannot', { skip: !macos && 'codesign is macOS only' }, () => {
  const app = bundle();
  assert.equal(seal(app).status, 0);
  const manifest = readManifest(app);
  assert.deepEqual(manifest.unrecorded, ['Contents/MacOS/Audit', 'Contents/_CodeSignature/CodeResources']);
  assert.deepEqual(mismatches(manifest, app), []);
  const paths = manifest.files.map((file) => file.path);
  for (const signed of ['Contents/Frameworks/Helper.app/Contents/MacOS/Helper', 'Contents/Frameworks/Helper.app/Contents/_CodeSignature/CodeResources']) {
    assert.ok(paths.includes(signed), `${signed} is recorded as signed`);
  }
  assert.ok(paths.includes('Contents/Resources/x.txt'));
  assert.ok(!paths.includes('Contents/MacOS/Audit'));
  assert.equal(check(app).status, 0);
});

test('a_write_after_the_seal_fails_both_checks', { skip: !macos && 'codesign is macOS only' }, () => {
  const app = bundle();
  assert.equal(seal(app).status, 0);
  fs.appendFileSync(path.join(app, 'Contents/Resources/x.txt'), 'changed\n');
  assert.notEqual(verify(app).status, 0, 'a changed resource breaks the seal');
  assert.match(check(app).stderr, /Contents\/Resources\/x\.txt: recorded 11 bytes/);

  const added = bundle();
  assert.equal(seal(added).status, 0);
  fs.writeFileSync(path.join(added, 'Contents/Resources/late.txt'), 'added after the seal\n');
  assert.notEqual(verify(added).status, 0, 'an added resource breaks the seal');
  assert.match(check(added).stderr, /Contents\/Resources\/late\.txt: not in the manifest/);
});

test('the_check_names_every_way_a_manifest_is_not_the_record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-check-'));
  fs.writeFileSync(path.join(root, 'tc4.exe'), 'tc4');
  const manifest = {
    unrecorded: [],
    files: [{ path: 'tc4.exe', size: 3, sha256: crypto.createHash('sha256').update('tc4').digest('hex') }],
  };
  assert.deepEqual(mismatches(manifest, root), []);
  // Inno Setup's uninstaller sits beside the installed files; the smoke test names it.
  fs.writeFileSync(path.join(root, 'unins000.exe'), 'uninstaller');
  assert.deepEqual(mismatches(manifest, root), ['unins000.exe: not in the manifest']);
  assert.deepEqual(mismatches(manifest, root, ['unins000.exe', 'unins000.dat']), []);
  fs.writeFileSync(path.join(root, 'tc4.exe'), 'tc4!');
  assert.match(mismatches(manifest, root, ['unins000.exe'])[0], /^tc4\.exe: recorded 3 bytes [0-9a-f]{64}, found 4 bytes/);
  fs.rmSync(path.join(root, 'tc4.exe'));
  assert.deepEqual(mismatches({ unrecorded: ['seal'], files: manifest.files }, root, ['unins000.exe']), [
    'tc4.exe: recorded, missing',
    'seal: unrecorded, missing',
  ]);
});
