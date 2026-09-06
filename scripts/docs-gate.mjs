#!/usr/bin/env node
// docs-gate.mjs — the docs gate (legibility step L-2, issue #155, D67).
//
// Numbers typed into prose go stale. This gate reads every statement in docs/, README.md,
// CONTRIBUTING.md and conformance/README.md that is MARKED as manifest-derived and fails when the value
// disagrees with docs/evidence/manifest.json (written by `npm run prove`). Unmarked prose
// is not checked: the gate starts small and grows as documents adopt the marker.
//
//   npm run docs:gate                       check the documents against the manifest on disk
//   npm run docs:gate -- --manifest PATH    read another manifest (the tests use this)
//
// Marker grammar (recorded in docs/plans/LEGIBILITY.md 3.2). An HTML comment, invisible
// when GitHub renders the page, placed immediately before the value it vouches for:
//
//   <!-- manifest: <suite-id> <field> -->VALUE      a suite count
//   <!-- manifest: <path> -->VALUE                  a top-level field (dotted: rig.rev)
//
//   <field> is passed | failed | skippedTests, or summary[<prefix>]: the "N passed" of
//   the suite's own summary line that starts with <prefix> (the same line round-trip R7
//   reads; a suite's summary line is the authoritative count).
//   VALUE is the first token after the comment; markdown emphasis, backticks and brackets
//   before it are skipped, so `**809**` and `(809)` both read as 809; a trailing `.` or
//   `-` (sentence end) is not part of the value. Equality is exact on the manifest
//   value's string form.
//   Mark only values that are the same in every clean-clone CI run at one commit: suite
//   counts and rig.rev (the pinned revision). Never commit, date or node: CI runs the gate against
//   the manifest its own run writes, so those are always the run's own and a document
//   can never cite them correctly.
//
// Findings, one line each, name the file, the line, the marker path, the document's
// value and the manifest's value:
//   stale        the values differ
//   no-evidence  the manifest holds null at the path (the suite was skipped: the skip
//                reason is printed) — a marked claim without evidence is a failure
//   grammar      the marker names an unknown suite, field or path, or no value follows
// A marker inside a fenced code block or an inline code span is an example, not a claim,
// and is not checked.
//
// Journeys (issue #199, D69 rule 2). The gate also reads the index table of docs/JOURNEYS.md
// and every e2e/*.spec.ts, and fails when a journey does not resolve:
//   journey      a row has an empty Status or Proof (unless retired, Phase 2 or vision); a
//                cited e2e path does not exist (a "(to write)" cell is allowed while the
//                status is not shipped); a shipped row cites a spec with no test outside
//                test.fixme; a spec header cites JOURNEYS-AND-GAPS, PRD FR- or TEST-PLAN E-J;
//                or an e2e/j*.spec.ts is cited by no row.
// The gate checks that things resolve. It never runs a test.
//
// Exit code: 0 when every marked statement agrees; 1 on any finding; 2 when the manifest
// cannot be read. The pure functions are exported for test/docsGate.test.ts (the gate's
// positive and negative controls); only main() touches the file system.

const MARKER_RE = /<!--\s*manifest:\s*([^\s]+)(?:\s+([^\s]+))?\s*-->/g;
const VALUE_RE = /^[\s*_`([]*([A-Za-z0-9][A-Za-z0-9.-]*)/;
const FIELDS = new Set(['passed', 'failed', 'skippedTests']);

/** @typedef {{ file: string, line: number, marker: string, doc: string, manifest: string }} Checked */
/** @typedef {{ file: string, line: number, marker: string, kind: 'stale'|'no-evidence'|'grammar'|'journey', doc: string|null, manifest: string|null, detail: string }} Finding */

/** The document set the gate scans, relative to the repository root (LEGIBILITY 3.2). */
export const DOC_ROOTS = ['docs', 'README.md', 'CONTRIBUTING.md', 'conformance/README.md'];

/**
 * Resolve one marker against the manifest.
 * @returns {{ value?: unknown, skipped?: string|null, error?: string }}
 */
export function resolveMarker(manifest, first, second) {
  if (second === undefined) {
    let cur = manifest;
    for (const key of first.split('.')) {
      if (cur == null || typeof cur !== 'object' || !(key in cur)) return { error: `no field ${first} in the manifest` };
      cur = cur[key];
    }
    if (cur !== null && typeof cur === 'object') return { error: `${first} is an object, not a value` };
    return { value: cur, skipped: null };
  }
  const suite = (manifest.suites || []).find((s) => s.id === first);
  if (!suite) return { error: `no suite ${first} in the manifest (suites: ${(manifest.suites || []).map((s) => s.id).join(', ')})` };
  const sum = /^summary\[(.+)\]$/.exec(second);
  if (sum) {
    const line = (suite.summary || []).find((l) => l.trim().startsWith(sum[1]));
    if (!line) return { value: null, skipped: suite.skipped ?? `no summary line starts with ${sum[1]}` };
    const m = /(\d+) passed/.exec(line);
    if (!m) return { error: `summary line "${line}" has no "N passed"` };
    return { value: +m[1], skipped: null };
  }
  if (!FIELDS.has(second)) return { error: `unknown field ${second} (passed | failed | skippedTests | summary[<prefix>])` };
  return { value: suite[second], skipped: suite.skipped ?? null };
}

/**
 * Check one document's text. Returns every marker found (checked) and the findings.
 * @param {string} text  @param {object} manifest  @param {string} file  the path printed in findings
 */
export function checkText(text, manifest, file) {
  const checked = /** @type {Checked[]} */ ([]);
  const findings = /** @type {Finding[]} */ ([]);
  let fence = null; // the opening fence string (``` or ~~~); only the same string closes it
  text.split('\n').forEach((lineText, i) => {
    const f = /^\s*(```+|~~~+)/.exec(lineText);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    const line = i + 1;
    // an inline code span that holds a marker is an example too; blank it (same length, so
    // indices hold). A plain code span such as `37` after a marker is still a value.
    const live = lineText.replace(/`[^`]*`/g, (s) => (/<!--\s*manifest:/.test(s) ? ' '.repeat(s.length) : s));
    for (const m of live.matchAll(MARKER_RE)) {
      const marker = m[2] === undefined ? m[1] : `${m[1]} ${m[2]}`;
      const rest = live.slice(m.index + m[0].length);
      const v = VALUE_RE.exec(rest);
      const base = { file, line, marker };
      if (!v) { findings.push({ ...base, kind: 'grammar', doc: null, manifest: null, detail: 'no value follows the marker' }); continue; }
      const doc = v[1].replace(/[.-]+$/, ''); // `339.` at a sentence end is 339
      const r = resolveMarker(manifest, m[1], m[2]);
      if (r.error) { findings.push({ ...base, kind: 'grammar', doc, manifest: null, detail: r.error }); continue; }
      if (r.value === null || r.value === undefined) {
        findings.push({ ...base, kind: 'no-evidence', doc, manifest: null, detail: r.skipped ? `suite skipped: ${r.skipped}` : 'the manifest holds null here' });
        continue;
      }
      const expected = String(r.value);
      checked.push({ ...base, doc, manifest: expected });
      if (doc !== expected) findings.push({ ...base, kind: 'stale', doc, manifest: expected, detail: `document says ${doc}, manifest says ${expected}` });
    }
  });
  return { checked, findings };
}

/** Check many documents. @param {{file: string, text: string}[]} files */
export function checkFiles(files, manifest) {
  const out = { checked: /** @type {Checked[]} */ ([]), findings: /** @type {Finding[]} */ ([]) };
  for (const f of files) {
    const r = checkText(f.text, manifest, f.file);
    out.checked.push(...r.checked);
    out.findings.push(...r.findings);
  }
  return out;
}

export const formatFinding = (f) => `${f.kind.toUpperCase().padEnd(11)} ${f.file}:${f.line}  ${f.marker}: ${f.detail}`;

// ---------------------------------------------------------------------------
// Journeys (issue #199, D69 rule 2). Pure: the texts come in, findings come out.
// ---------------------------------------------------------------------------

/** A row with one of these words in Status needs no proof row. */
const NO_PROOF_STATUSES = ['retired', 'phase 2', 'vision'];
/** Header citations of documents that do not exist (LEGACY-IDS rule 2). */
const DEAD_CITATIONS = /JOURNEYS-AND-GAPS|PRD FR-|TEST-PLAN E-J/;
const E2E_PATH_RE = /`(e2e\/[^`]+\.spec\.ts)`/g;

/** A spec with its block comments and whole-line `//` comments removed. */
const uncommented = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The number of `test(` calls in a spec that are not `test.fixme(` (nor `test.describe(`,
 * `test.step(`, `test.skip(`, `test.only(`, hooks — none of those is a bare `test(`).
 * Comments are removed first, so a commented-out spec counts zero.
 */
export function liveTestCount(specText) {
  return (uncommented(specText).match(/(^|[^.\w])test\(/gm) || []).length;
}

/** The leading comment region of a spec: every line up to the first line of code. */
export function leadingComment(specText) {
  const out = [];
  let inBlock = false;
  for (const line of specText.split('\n')) {
    const t = line.trim();
    if (inBlock) { out.push(line); if (t.includes('*/')) inBlock = false; continue; }
    if (t === '' || t.startsWith('//')) { out.push(line); continue; }
    if (t.startsWith('/*')) { out.push(line); inBlock = !t.includes('*/'); continue; }
    break;
  }
  return out.join('\n');
}

/** Split one markdown table row into trimmed cells; `\|` inside a cell is not a delimiter. */
const cellsOf = (row) => row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replaceAll('\\|', '|'));

const TO_WRITE_RE = /\(to write(?:,\s*[^)]*)?\)/;
const leadingStatus = (statusLc) => /^(retired|phase 2|vision)\b/.exec(statusLc)?.[1];

/**
 * Check the index table of docs/JOURNEYS.md against the e2e specs.
 * @param {string} journeysText  the text of docs/JOURNEYS.md
 * @param {Record<string, string>} specs  spec texts by repo-relative path (`e2e/j01-….spec.ts`)
 * @returns {{ checked: {id: string, status: string, proof: string[]}[], findings: Finding[] }}
 */
export function checkJourneys(journeysText, specs) {
  const file = 'docs/JOURNEYS.md';
  const checked = [];
  const findings = [];
  const cited = new Set();
  const finding = (f, line, marker, detail) => findings.push({ file: f, line, marker, kind: 'journey', doc: null, manifest: null, detail });

  journeysText.split('\n').forEach((lineText, i) => {
    const m = /^\|\s*(J\d+[a-z]?)\s*\|/.exec(lineText);
    if (!m) return;
    const line = i + 1;
    const id = m[1];
    const cells = cellsOf(lineText);
    if (cells.length !== 6) { finding(file, line, id, `row has ${cells.length} cells, expected 6 (ID, Actor, Activity, Goal, Status, Proof)`); return; }
    const status = cells[4];
    const proofCell = cells[5];
    const statusLc = status.toLowerCase();
    const noProof = NO_PROOF_STATUSES.includes(leadingStatus(statusLc));
    const paths = [...proofCell.matchAll(E2E_PATH_RE)].map((x) => x[1]);
    paths.forEach((p) => cited.add(p));
    checked.push({ id, status, proof: paths });

    if (!status) { finding(file, line, id, 'empty Status: every journey needs an owner'); return; }
    if (!noProof && paths.length === 0) { finding(file, line, id, `Proof names no e2e spec: "${proofCell || '(empty)'}"`); return; }
    const toWrite = TO_WRITE_RE.test(proofCell);
    const shipped = /^shipped\b/.test(statusLc);
    for (const p of paths) {
      const text = specs[p];
      if (text === undefined) {
        if (toWrite && !shipped) continue;
        finding(file, line, id, `proof ${p} does not exist${shipped && toWrite ? ' (a shipped row cannot be "to write")' : ''}`);
      } else if (shipped && liveTestCount(text) === 0) {
        finding(file, line, id, `status is shipped but ${p} has no test outside test.fixme`);
      }
    }
  });

  for (const [p, text] of Object.entries(specs)) {
    if (DEAD_CITATIONS.test(leadingComment(text))) {
      finding(p, 1, p, 'header cites a document that does not exist (JOURNEYS-AND-GAPS, PRD FR-, TEST-PLAN E-J); cite docs/JOURNEYS.md');
    }
    if (/^e2e\/j\d+/.test(p) && !cited.has(p)) finding(p, 1, p, 'journey spec is cited by no row of docs/JOURNEYS.md');
  }
  return { checked, findings };
}

// ---------------------------------------------------------------------------
// CLI. The builtins come through process.getBuiltinModule so that this module can also be
// imported by the Vitest controls, where vite-plugin-node-polyfills aliases `node:fs`.
// ---------------------------------------------------------------------------
async function main() {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { fileURLToPath } = process.getBuiltinModule('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const i = args.indexOf('--manifest');
  const manifestPath = path.resolve(ROOT, i >= 0 && args[i + 1] ? args[i + 1] : 'docs/evidence/manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`docs gate: cannot read ${path.relative(ROOT, manifestPath)}: ${e.message}`);
    process.exit(2);
  }

  const walk = (p) => {
    const abs = path.join(ROOT, p);
    if (fs.statSync(abs).isDirectory()) {
      return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => walk(path.join(p, e.name))).sort();
    }
    return p.endsWith('.md') ? [p] : [];
  };
  const files = DOC_ROOTS.flatMap(walk).map((p) => ({ file: p.replaceAll('\\', '/'), text: fs.readFileSync(path.join(ROOT, p), 'utf8') }));

  const { checked, findings } = checkFiles(files, manifest);
  for (const c of checked) console.log(`OK          ${c.file}:${c.line}  ${c.marker} = ${c.manifest}`);
  const markerFindings = findings.length;

  const specs = Object.fromEntries(
    fs.readdirSync(path.join(ROOT, 'e2e')).filter((n) => n.endsWith('.spec.ts')).sort()
      .map((n) => [`e2e/${n}`, fs.readFileSync(path.join(ROOT, 'e2e', n), 'utf8')]),
  );
  const journeys = checkJourneys(fs.readFileSync(path.join(ROOT, 'docs/JOURNEYS.md'), 'utf8'), specs);
  for (const j of journeys.checked) console.log(`OK          journey ${j.id.padEnd(4)} ${j.status} → ${j.proof.join(', ') || '(no proof row required)'}`);
  findings.push(...journeys.findings);
  for (const f of findings) console.log(formatFinding(f));
  const rig = manifest.rig?.detected ? `rig ${manifest.rig.version}` : 'no rig';
  console.log('');
  console.log(`manifest ${path.relative(ROOT, manifestPath)}: commit ${String(manifest.commit).slice(0, 7)} · ${manifest.date} · ${manifest.platform} · ci=${manifest.ci} · ${rig}`);
  if (!manifest.ci) {
    console.log('note: this manifest is from a local run; the committed manifest is the clean-clone record (git checkout docs/evidence/manifest.json)');
  }
  // every marker is either checked (agree or stale) or a finding of another kind
  const markers = checked.length + findings.slice(0, markerFindings).filter((f) => f.kind !== 'stale').length;
  console.log(`docs gate: ${files.length} files, ${markers} marked statements, ${journeys.checked.length} journeys, ${findings.length} findings`);
  console.log(findings.length === 0 ? 'DOCS GATE OK' : 'DOCS GATE FAILED');
  process.exit(findings.length === 0 ? 0 : 1);
}

const { pathToFileURL } = process.getBuiltinModule('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
