#!/usr/bin/env node
// Collect existing non-rig checks for an external tester. Never reseed/start a rig.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suites = [
  { id: 'format', script: 'conformance/validate.mjs', cwd: 'conformance' },
  { id: 'journal', script: 'conformance/validate-journal.mjs', cwd: 'conformance' },
  { id: 'normative', script: 'conformance/normative/check.mjs', cwd: 'conformance' },
];
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
  suites.forEach((suite) => console.log(`${suite.id}: node ${suite.script}`));
  process.exit(0);
}
if (args.length && !(args.length === 2 && args[0] === '--out')) {
  console.error('Usage: node scripts/collect-user-test-evidence.mjs [--out NEW_DIRECTORY | --list]');
  process.exit(2);
}
const started = new Date().toISOString();
const out = path.resolve(root, args[1] || `test-results/user-evidence/${started.replace(/[:.]/g, '-')}`);
if (fs.existsSync(out)) {
  console.error(`Refusing to overwrite evidence directory: ${out}`);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...argv) => {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
};
const inputs = {};
const recordTree = (relative) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) recordTree(name);
    else if (entry.isFile()) inputs[name] = hash(fs.readFileSync(path.join(root, name)));
  }
};
recordTree('conformance/sample-burrito');
recordTree('conformance/sample-burrito-obs');
for (const suite of suites) inputs[suite.script] = hash(fs.readFileSync(path.join(root, suite.script)));
fs.writeFileSync(path.join(out, 'input-hashes.json'), `${JSON.stringify(inputs, null, 2)}\n`);
const manifest = {
  schemaVersion: 1,
  started,
  finished: null,
  commit: git('rev-parse', 'HEAD'),
  workingTreeStatus: git('status', '--porcelain'),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  scope: 'Existing format, journal and normative checks on reference fixtures. No UI journeys or live projects tested.',
  inputs: 'input-hashes.json',
  results: [],
  ok: null,
};
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
save();
for (const suite of suites) {
  const logName = `${suite.id}.log`;
  const log = fs.createWriteStream(path.join(out, logName));
  const start = Date.now();
  const result = await new Promise((resolve) => {
    // Ignore caller fixture overrides: this command always tests the recorded reference fixtures.
    const env = { ...process.env };
    delete env.BURRITO;
    delete env.OBS_BURRITO;
    const child = spawn(process.execPath, [path.join(root, suite.script)], {
      cwd: path.join(root, suite.cwd), env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 300_000);
    child.stdout.on('data', (chunk) => log.write(chunk));
    child.stderr.on('data', (chunk) => log.write(chunk));
    child.on('error', (failure) => { error = failure.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      log.end(() => resolve({ exitCode, signal, error, timedOut }));
    });
  });
  const bytes = fs.readFileSync(path.join(out, logName));
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const summary = lines.filter((line) => /^(Stage-[12]|Phase-2|OBS|Journal suite:|\d+ passed, \d+ failed|\s*(rules in section|claimed by a check|uncovered|stale claims))/.test(line));
  const record = {
    id: suite.id, command: `node ${suite.script}`, cwd: suite.cwd,
    ...result, status: result.exitCode === 0 && !result.error && !result.timedOut ? 'PASS' : 'FAIL',
    durationMs: Date.now() - start, summary, log: logName, logSha256: hash(bytes),
  };
  manifest.results.push(record);
  save();
  console.log(`${record.status} ${suite.id}: ${summary.join('; ') || `exit ${result.exitCode}`}`);
}
manifest.finished = new Date().toISOString();
manifest.ok = manifest.results.every((record) => record.status === 'PASS');
save();
const summary = [
  '# Automated evidence for user testing', '',
  `Commit: ${manifest.commit}. Node: ${manifest.node}. Started: ${started}.`, '',
  manifest.scope, '',
  'A dirty working tree is recorded in manifest.json; the commit alone does not describe all tested source.', '',
  ...manifest.results.map((record) => `- ${record.status} ${record.id}: ${record.summary.join('; ') || `exit ${record.exitCode}`}. Full output: [${record.log}](${record.log}).`), '',
  'Grok: inspect manifest.json, input-hashes.json and the full logs. Confirm exit codes and no failed checks. These results cover reference-fixture invariants only. They do not prove that this installed build saved user work, rendered correctly, exported a PDF, or contacted no external server.', '',
  'Next evidence: run Playwright journeys in a dedicated disposable checkout and inspect its HTML/JSON report, traces and attached files. Do not reseed a shared rig.', '',
];
fs.writeFileSync(path.join(out, 'summary.md'), summary.join('\n'));
console.log(`Evidence: ${out}`);
process.exitCode = manifest.ok ? 0 : 1;
