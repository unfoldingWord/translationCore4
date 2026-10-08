// #378: the help-desk token is never in the web bundle. The web client is built
// with a marker in TC_HELP_DESK_TOKEN and TC_HELP_DESK_EMAIL, and no file of the
// build may hold either marker. Control: the same search finds a catalogue
// sentence of the Feedback dialog, so it reads the bundle that ships.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const TOKEN = 'SG.tc4-marker-token-378';
const EMAIL = 'tc4-marker-378@example.invalid';
const CONTROL = JSON.parse(fs.readFileSync(path.join(repo, 'src/i18n/en.json'), 'utf8'))['feedback.emailHint'];

const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

test('a build with the help-desk values set holds neither value', { timeout: 300_000 }, (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-bundle-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: repo,
    env: { ...process.env, TC_HELP_DESK_TOKEN: TOKEN, TC_HELP_DESK_EMAIL: EMAIL },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const texts = filesUnder(out).map((f) => fs.readFileSync(f, 'latin1'));
  assert.ok(CONTROL && texts.some((x) => x.includes(CONTROL)), 'control: the Feedback dialog text is in the bundle');
  assert.deepEqual(filesUnder(out).filter((f, i) => texts[i].includes(TOKEN) || texts[i].includes(EMAIL)), []);
});
