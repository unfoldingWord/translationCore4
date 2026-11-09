// The format-older-reader gate passes before the old build runs only in its two documented states,
// and only after the lookups that justify them succeeded (#865 done-when 4): a failed GitHub call
// is a red run, never "no published release there yet". A stub `gh` stands in for the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'older-reader.sh');
// FAIL names the call that fails with a 503; TAGS=0 means no format-v* tag; PEEL is the commit
// the release's tag peels to (the frozen commit is aaaa).
const GH = `#!/usr/bin/env bash
fail() { [ "$FAIL" = "$1" ] && { echo "HTTP 503" >&2; exit 1; }; return 0; }
case "$*" in
  *matching-refs/tags/format-v*) fail tags; [ "$TAGS" = 0 ] || echo refs/tags/format-v1.0 ;;
  *git/ref/tags/format-v1.0*) fail ref; echo "commit aaaa" ;;
  *--paginate*) fail list; echo v4.1.0-preview2 ;;
  *git/ref/tags/v4.1.0-preview2*) fail candidate; echo "tag tttt" ;;
  *git/tags/tttt*) fail peel; echo "$PEEL" ;;
  *) echo "stub gh: $*" >&2; exit 3 ;;
esac
`;

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'older-reader-test-'));
  try {
    writeFileSync(join(dir, 'gh'), GH, { mode: 0o755 });
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, FAIL: '', TAGS: '1', PEEL: 'aaaa', ...env },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no format-v* tag passes with its log line', () => {
  const r = run({ TAGS: '0' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no format version is frozen yet/);
});

test('no release at the frozen commit passes with its log line', () => {
  const r = run({ PEEL: 'bbbb' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /frozen 1\.0 at aaaa; no published release there yet/);
});

for (const call of ['tags', 'ref', 'list', 'candidate', 'peel']) {
  test(`a failed ${call} lookup fails the gate`, () => {
    const r = run({ FAIL: call });
    assert.notEqual(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /no published release there yet|nothing to check/);
  });
}
