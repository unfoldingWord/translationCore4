// The export byte-identity guard (issue #375, D79): an export leaves the
// project repository byte-identical, except the one D9 checkpoint commit it may
// make. Node assert, not vitest's expect, so the vitest suites and the
// Playwright journeys (e2e/j07-publish.spec.ts) share this one helper.

// Real node builtins via the runtime: the app's polyfill plugin aliases the
// imports under Vitest (the test/noBypass.test.ts workaround).
const assert: typeof import('node:assert').strict = process.getBuiltinModule('node:assert').strict;
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const crypto = process.getBuiltinModule('node:crypto');
const { execFileSync } = process.getBuiltinModule('node:child_process');

const git = (repoPath: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();

/** Every file under the repository outside `.git`, as path -> sha256. */
function snapshot(repoPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoPath, full).split(path.sep).join('/');
      if (rel === '.git') continue;
      if (entry.isDirectory()) walk(full);
      else out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(repoPath);
  return out;
}

/** Run `fn` and assert the repository at `repoPath` is byte-identical after
 * it, except one checkpoint commit: at most one new commit, a "Checkpoint, …
 * (tC4)" child of the old HEAD, and only the paths that commit carries may
 * differ. Returns the number of commits `fn` added (0 or 1). */
export async function assertProjectUnchanged(repoPath: string, fn: () => Promise<unknown>): Promise<number> {
  const head = git(repoPath, 'rev-parse', 'HEAD');
  const before = snapshot(repoPath);
  await fn();
  const added = git(repoPath, 'rev-list', `${head}..HEAD`).split('\n').filter(Boolean);
  assert.ok(added.length <= 1, `expected at most one checkpoint commit, found ${added.length}`);
  const allowed = new Set<string>();
  if (added.length === 1) {
    assert.equal(git(repoPath, 'rev-parse', 'HEAD^'), head, 'the checkpoint commit is not a child of the old HEAD');
    assert.match(git(repoPath, 'log', '-1', '--format=%s'), /^Checkpoint, .+ \(tC4\)$/, 'the new commit is not a checkpoint');
    for (const p of git(repoPath, 'diff-tree', '--no-commit-id', '--name-only', '-r', head, 'HEAD').split('\n')) if (p) allowed.add(p);
  }
  const after = snapshot(repoPath);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p) && !allowed.has(p));
  assert.deepEqual(changed, [], `the export changed files outside a checkpoint commit: ${changed.join(', ')}`);
  return added.length;
}
