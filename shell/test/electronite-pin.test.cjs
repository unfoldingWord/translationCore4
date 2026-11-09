'use strict';

// One Electronite for every build and test (#937): the workflows, the staging script and the
// documents that name the pin all name the same tag, and the Windows archive is checked against
// the same sha256 wherever it is checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const PINNED = [
  '.github/workflows/release.yml',
  '.github/workflows/shell.yml',
  'scripts/release/stage.sh',
  'docs/contracts/SHELL.md',
  'docs/RELEASE.md',
  'shell/README.md',
];
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

test('electronite_pin_is_one_tag', () => {
  const tags = new Map();
  for (const file of PINNED) {
    const found = read(file).match(/v\d+\.\d+\.\d+-graphite/g) || [];
    assert.ok(found.length > 0, `${file} names no Electronite tag`);
    for (const tag of found) tags.set(tag, [...(tags.get(tag) || []), file]);
  }
  const named = [...tags].map(([tag, files]) => `${tag} in ${[...new Set(files)].join(', ')}`);
  assert.equal(tags.size, 1, `every pin names one Electronite tag; found ${named.join('; ')}`);
});

test('electronite_windows_sha256_is_one_value', () => {
  const sums = {
    'scripts/release/stage.sh': read('scripts/release/stage.sh').match(/windows-x64\) want=([0-9a-f]{64})/),
    '.github/workflows/release.yml': read('.github/workflows/release.yml').match(/--electronite-sha256 ([0-9a-f]{64})/),
    '.github/workflows/shell.yml': read('.github/workflows/shell.yml').match(/\$sum -ne '([0-9a-f]{64})'/),
  };
  for (const [file, match] of Object.entries(sums)) assert.ok(match, `${file} checks no Windows Electronite sha256`);
  const values = Object.entries(sums).map(([file, match]) => `${match[1]} in ${file}`);
  assert.equal(new Set(Object.values(sums).map((m) => m[1])).size, 1, `one Windows sha256; found ${values.join('; ')}`);
});
