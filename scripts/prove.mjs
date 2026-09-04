#!/usr/bin/env node
// prove.mjs — ONE proof command (legibility step L-1, issue #154, D67).
//
// Runs every suite that applies, detects the Pankosmia rig, refuses the rig-gated
// suites when the rig is not pristine, and writes docs/evidence/manifest.json: the
// commit, the date, the server version and pinned revision, and per suite the
// command, whether it needs the rig, whether it ran, the counts, and the duration.
//
//   npm run prove              run everything that applies; write the manifest
//   npm run prove -- --list    print one line per suite; run nothing
//   npm run prove -- --bench   also run the fold benchmark (slow: ~1 minute)
//   npm run prove -- --out P   write the manifest to P instead of the default
//
// Exit code: 0 when every suite that ran passed and no rig suite was refused;
// 1 otherwise. A SKIP is not a failure: each skip names its prerequisite.
//
// The manifest field names are recorded in docs/plans/LEGIBILITY.md (L-1).
// A suite's own summary line is the authoritative count (BURRITO-SPEC header);
// this script only reads those lines, it never counts checks itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONF = path.join(ROOT, 'conformance');
const RIG_API = process.env.RIG_API || 'http://127.0.0.1:19998/api';
const SAMPLE = '_local_/_local_/sample_burrito';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, dflt) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const LIST = flag('--list');
const BENCH = flag('--bench');
const OUT = path.resolve(ROOT, opt('--out', 'docs/evidence/manifest.json'));

// ---------------------------------------------------------------------------
// Summary-line parsers. Each returns { passed, failed, skipped, summary: [lines] }
// from the suite's own output, or null counts when the suite prints none.
// ---------------------------------------------------------------------------
const lines = (out) => out.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd());
const pickStart = (out, prefixes) => lines(out).filter((l) => prefixes.some((p) => l.trim().startsWith(p)));
const passFail = (line) => {
  const m = /(\d+) passed, (\d+) failed/.exec(line);
  return m ? { passed: +m[1], failed: +m[2] } : null;
};

const parsers = {
  none: (out) => ({ passed: null, failed: null, skipped: null, summary: pickStart(out, ['✓ built', 'error TS', '✖']).slice(0, 3) }),
  vitest: (out) => {
    const tests = lines(out).find((l) => /^\s*Tests\s+\d/.test(l)) || '';
    const files = lines(out).find((l) => /^\s*Test Files\s+\d/.test(l)) || '';
    const n = (kind) => { const m = new RegExp(`(\\d+) ${kind}`).exec(tests); return m ? +m[1] : 0; };
    return { passed: n('passed'), failed: n('failed'), skipped: n('skipped'), summary: [files.trim(), tests.trim()].filter(Boolean) };
  },
  phase1: (out) => {
    const s = pickStart(out, ['Stage-1', 'Stage-2', 'Phase-2']);
    const total = lines(out).reverse().find((l) => /^\d+ passed, \d+ failed$/.test(l.trim())) || '';
    const c = passFail(total) || { passed: null, failed: null };
    return { ...c, skipped: null, summary: [...s, total.trim()].filter(Boolean) };
  },
  journal: (out) => {
    const s = pickStart(out, ['Journal suite:'])[0] || '';
    return { ...(passFail(s) || { passed: null, failed: null }), skipped: null, summary: s ? [s.trim()] : [] };
  },
  normative: (out) => {
    const s = pickStart(out, ['rules in section', 'claimed by a check', 'uncovered', 'stale claims']).map((l) => l.trim());
    const num = (p) => { const l = s.find((x) => x.startsWith(p)); const m = l && /:\s*(\d+)/.exec(l); return m ? +m[1] : null; };
    const claimed = num('claimed by a check'), uncovered = num('uncovered'), stale = num('stale claims');
    return { passed: claimed, failed: uncovered == null || stale == null ? null : uncovered + stale, skipped: null, summary: s };
  },
  transport: (out) => {
    const s = pickStart(out, ['Transport rig:'])[0] || '';
    return { ...(passFail(s) || { passed: null, failed: null }), skipped: null, summary: s ? [s.trim()] : [] };
  },
  roundtrip: (out) => {
    const s = pickStart(out, ['Round-trip suite:'])[0] || '';
    return { ...(passFail(s) || { passed: null, failed: null }), skipped: null, summary: s ? [s.trim()] : [] };
  },
  bench: (out) => ({ passed: null, failed: null, skipped: null, summary: pickStart(out, ['[fold]', '[open]']).map((l) => l.trim()).slice(0, 12) }),
};

// ---------------------------------------------------------------------------
// The suites, in run order. `layer` groups them; `needsRig` gates them.
// ---------------------------------------------------------------------------
const integrationFiles = () =>
  fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.integration.test.ts')).map((f) => `test/${f}`).sort();

const SUITES = [
  { id: 'lint', layer: 'verify', cwd: ROOT, cmd: 'npm', args: ['run', 'lint'], parse: 'none' },
  { id: 'typecheck', layer: 'verify', cwd: ROOT, cmd: 'npm', args: ['run', 'typecheck'], parse: 'none' },
  { id: 'vitest', layer: 'unit', cwd: ROOT, cmd: 'npx', args: ['vitest', 'run'], parse: 'vitest' },
  { id: 'build', layer: 'verify', cwd: ROOT, cmd: 'npm', args: ['run', 'build'], parse: 'none' },
  { id: 'conformance:generate', layer: 'conformance', cwd: CONF, cmd: 'node', args: ['generate.mjs'], parse: 'none' },
  { id: 'conformance:validate', layer: 'conformance', cwd: CONF, cmd: 'node', args: ['validate.mjs'], parse: 'phase1' },
  { id: 'conformance:journal', layer: 'conformance', cwd: CONF, cmd: 'node', args: ['validate-journal.mjs'], parse: 'journal' },
  { id: 'conformance:normative', layer: 'conformance', cwd: CONF, cmd: 'node', args: ['normative/check.mjs'], parse: 'normative' },
  { id: 'vitest:rig', layer: 'rig', cwd: ROOT, cmd: 'npx', args: () => ['vitest', 'run', ...integrationFiles()], parse: 'vitest', needsRig: true },
  { id: 'conformance:transport', layer: 'rig', cwd: CONF, cmd: 'node', args: ['validate-transport.mjs'], parse: 'transport', needsRig: true },
  { id: 'conformance:roundtrip', layer: 'rig', cwd: CONF, cmd: 'node', args: ['validate-roundtrip.mjs'], parse: 'roundtrip', needsRig: true },
  { id: 'bench:fold', layer: 'bench', cwd: CONF, cmd: 'node', args: ['bench-fold.mjs'], parse: 'bench', optIn: '--bench' },
];

const argv = (s) => (typeof s.args === 'function' ? s.args() : s.args);
const commandOf = (s) => `${path.relative(ROOT, s.cwd) || '.'}$ ${s.cmd} ${argv(s).join(' ')}`;

if (LIST) {
  for (const s of SUITES) {
    console.log(`${s.id.padEnd(22)} ${s.layer.padEnd(12)} ${s.needsRig ? 'rig ' : '    '} ${s.optIn ? `opt-in ${s.optIn} ` : ''}${commandOf(s)}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Context: commit, rig, repos dir, pristine state.
// ---------------------------------------------------------------------------
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const commit = git('rev-parse', 'HEAD');
const relOut = path.relative(ROOT, OUT);
const dirtyFiles = git('status', '--porcelain').split('\n').filter((l) => l && !l.endsWith(relOut));

const serverRev = (() => {
  const toml = fs.readFileSync(path.join(ROOT, 'dev-env/server/Cargo.toml'), 'utf8');
  const m = /pankosmia_web\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]+)"/.exec(toml);
  return m ? m[1] : null;
})();

const fetchJson = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
};

const version = await fetchJson(`${RIG_API}/version`);
const rig = {
  api: RIG_API,
  detected: !!version,
  version: version?.pkg_version ?? null,
  product: version?.product_name ?? null,
  rev: serverRev,
  revSource: 'dev-env/server/Cargo.toml (the pinned build revision; the HTTP API reports no hash)',
  repos: null,
  pristine: null,
  extraRepos: [],
};

let rigReason = null; // why the rig suites do not run
if (!rig.detected) {
  rigReason = `no rig at ${RIG_API} (dev-env/scripts/run.zsh)`;
} else {
  const repos = process.env.RIG_REPOS || path.join(ROOT, 'dev-env/state/work/repos');
  if (!fs.existsSync(path.join(repos, ...SAMPLE.split('/'), 'metadata.json'))) {
    rigReason = `RIG_REPOS is not set and ${path.relative(ROOT, repos)} has no ${SAMPLE}`;
  } else {
    rig.repos = repos;
    const list = (await fetchJson(`${RIG_API}/git/list-local-repos`)) || [];
    rig.extraRepos = list.filter((r) => r.startsWith('_local_/_local_/') && r !== SAMPLE).sort();
    rig.pristine = rig.extraRepos.length === 0;
    if (!rig.pristine) rigReason = `REFUSED: rig not pristine — extra repos under _local_/_local_: ${rig.extraRepos.join(', ')} (dev-env/scripts/stop.zsh; seed.zsh; run.zsh)`;
  }
}
const refused = rigReason?.startsWith('REFUSED') ?? false;

if (!fs.existsSync(path.join(CONF, 'node_modules'))) {
  console.error('conformance/node_modules is missing: run  cd conformance && npm ci  first (the harness has its own lockfile).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
const results = [];
for (const s of SUITES) {
  const rec = { id: s.id, layer: s.layer, command: commandOf(s), needsRig: !!s.needsRig, ran: false, skipped: null, ok: null, exitCode: null, passed: null, failed: null, skippedTests: null, summary: [], durationMs: null };
  if (s.optIn && !flag(s.optIn)) rec.skipped = `opt-in: pass ${s.optIn}`;
  else if (s.needsRig && rigReason) rec.skipped = rigReason;
  if (rec.skipped) {
    results.push(rec);
    console.log(`SKIP  ${s.id.padEnd(22)} ${rec.skipped}`);
    continue;
  }
  process.stdout.write(`RUN   ${s.id.padEnd(22)} ${rec.command}\n`);
  const t0 = Date.now();
  const env = { ...process.env, ...(s.needsRig && rig.repos ? { RIG_REPOS: rig.repos, RIG_API } : {}) };
  const r = spawnSync(s.cmd, argv(s), { cwd: s.cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  rec.durationMs = Date.now() - t0;
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  rec.ran = true;
  rec.exitCode = r.status;
  const p = parsers[s.parse](out);
  rec.passed = p.passed; rec.failed = p.failed; rec.skippedTests = p.skipped; rec.summary = p.summary;
  rec.ok = r.status === 0 && !(p.failed > 0);
  const counts = p.passed == null ? '' : ` ${p.passed} passed${p.failed ? `, ${p.failed} failed` : ''}${p.skipped ? `, ${p.skipped} skipped` : ''}`;
  console.log(`${rec.ok ? 'PASS ' : 'FAIL '} ${s.id.padEnd(22)}${counts}  (${(rec.durationMs / 1000).toFixed(1)}s)`);
  if (!rec.ok) console.log(out.trim().split('\n').slice(-40).map((l) => `      ${l}`).join('\n'));
  results.push(rec);
}

const ok = results.every((r) => r.ok !== false) && !refused;
const manifest = {
  schemaVersion: 1,
  tool: 'scripts/prove.mjs',
  commit,
  dirty: dirtyFiles.length > 0,
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  ci: !!process.env.CI,
  rig,
  suites: results,
  ok,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmp = `${OUT}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
fs.renameSync(tmp, OUT);

console.log('');
console.log(`commit ${commit.slice(0, 7)}${manifest.dirty ? ' (dirty)' : ''} · rig ${rig.detected ? `${rig.version} (${rig.rev?.slice(0, 7)}) pristine=${rig.pristine}` : 'absent'}`);
if (rigReason) console.log(`rig suites: ${rigReason}`);
console.log(`manifest → ${relOut}`);
console.log(ok ? 'PROVE OK' : 'PROVE FAILED');
process.exit(ok ? 0 : 1);
