// #801 (B1): the development hook that makes the open store old is never in the web
// bundle. No file of a production build may hold the hook's name or its localStorage key.
// Control: the same search finds the catalogue sentence of `sync.project-replaced`, so it
// reads the bundle that ships.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const HOOK_NAMES = ['__tc4StaleStore', 'tc4.e2e.staleStore'];
const CONTROL = JSON.parse(fs.readFileSync(path.join(repo, 'src/i18n/en.json'), 'utf8'))['refusal.sync.project-replaced'];

const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

test('a production build holds neither the stale-store hook name nor its key', { timeout: 300_000 }, (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-bundle-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: repo,
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const texts = filesUnder(out).map((f) => fs.readFileSync(f, 'latin1'));
  assert.ok(CONTROL && texts.some((x) => x.includes(CONTROL)), 'control: the sync.project-replaced sentence is in the bundle');
  assert.deepEqual(filesUnder(out).filter((f, i) => HOOK_NAMES.some((n) => texts[i].includes(n))), []);
});
