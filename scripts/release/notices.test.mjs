// notices.mjs on the real Cargo.lock and a small bundled store; cargo runs offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundledInstalls, lockedCrates, missing, notices } from './notices.mjs';
import { UGL, smallBundle } from './notices-fixture.mjs';

process.env.CARGO_NET_OFFLINE = 'true';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const given = smallBundle();
const text = notices(given);
const crates = lockedCrates(fs.readFileSync(path.join(repo, 'Cargo.lock'), 'utf8'));
const installs = bundledInstalls(given.bundle);

/** `text` without the block whose heading line is `heading`. */
function without(heading) {
  const at = text.indexOf(`\n${heading}\n`);
  assert.notEqual(at, -1, heading);
  const end = text.indexOf('\n=====', at + 1);
  return text.slice(0, at) + text.slice(end);
}

test('every_crate_in_cargo_lock_has_a_notice', () => {
  assert.ok(crates.length > 100, `${crates.length} crates`);
  assert.deepEqual(missing(text, crates, []), []);
  const [name, version] = crates[crates.length >> 1];
  assert.deepEqual(missing(without(`Crate ${name} ${version}`), crates, []), [`crate ${name} ${version}`]);
});

test('every_bundled_resource_has_an_attribution', () => {
  assert.deepEqual(missing(text, [], installs), []);
  assert.match(text, /Title: Translation Notes\nCreator: unfoldingWord .*\nRights: © unfoldingWord 2026, CC BY-SA 4\.0\nSource: https:\/\/git\.door43\.org\/unfoldingWord\/en_tn release v91, commit e{40}\n/);
  assert.match(text, /Title: Greek Lexicon\n[^]*?Changes: repackaged/);
  assert.deepEqual(missing(without(`Resource ${UGL.repoPath} @ ${UGL.sha}`), [], installs), [`resource ${UGL.repoPath} @ ${UGL.sha}`]);
});

test('the notices hold the licences of the app, its notices, Electronite and the fonts', () => {
  for (const heading of ['translationCore 4 (tc-rst)', 'tc-door43 NOTICE', 'tc-align NOTICE', 'Font licence OFL-CharisSIL.txt', 'Font licence OFL-AwamiNastaliq.txt', 'Font licence OFL-NotoSansDevanagari.txt']) {
    assert.ok(text.includes(`\n${heading}\n`), heading);
  }
  assert.ok(text.includes('Copyright (c) Electron contributors'));
});
