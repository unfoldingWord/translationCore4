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
//   `-` (sentence end) is not part of the value. Numbers compare exactly. A string value
//   (commit, date, node) also accepts a prefix of at least 7 characters: `674c1bf` for
//   the commit, `2026-09-04` for the date.
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
// Exit code: 0 when every marked statement agrees; 1 on any finding; 2 when the manifest
// cannot be read. The pure functions are exported for test/docsGate.test.ts (the gate's
// positive and negative controls); only main() touches the file system.

const MARKER_RE = /<!--\s*manifest:\s*([^\s]+)(?:\s+([^\s]+))?\s*-->/g;
const VALUE_RE = /^[\s*_`([]*([A-Za-z0-9][A-Za-z0-9.-]*)/;
const FIELDS = new Set(['passed', 'failed', 'skippedTests']);

/** @typedef {{ file: string, line: number, marker: string, doc: string, manifest: string }} Checked */
/** @typedef {{ file: string, line: number, marker: string, kind: 'stale'|'no-evidence'|'grammar', doc: string|null, manifest: string|null, detail: string }} Finding */

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
 * Does the document's token agree with the manifest value? Numbers and booleans: exact.
 * Strings (commit hash, ISO date, node version): exact, or the token is a prefix of at
 * least PREFIX_MIN characters — a 7-character hash or a YYYY-MM-DD date is how documents
 * cite them.
 */
export const PREFIX_MIN = 7;
export function agrees(doc, value) {
  const s = String(value);
  if (doc === s) return true;
  return typeof value === 'string' && doc.length >= PREFIX_MIN && s.startsWith(doc);
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
      if (!agrees(doc, r.value)) findings.push({ ...base, kind: 'stale', doc, manifest: expected, detail: `document says ${doc}, manifest says ${expected}` });
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
  for (const f of findings) console.log(formatFinding(f));
  const rig = manifest.rig?.detected ? `rig ${manifest.rig.version}` : 'no rig';
  console.log('');
  console.log(`manifest ${path.relative(ROOT, manifestPath)}: commit ${String(manifest.commit).slice(0, 7)} · ${manifest.date} · ${manifest.platform} · ci=${manifest.ci} · ${rig}`);
  if (!manifest.ci) {
    console.log('note: this manifest is from a local run; the committed manifest is the clean-clone record (git checkout docs/evidence/manifest.json)');
  }
  // every marker is either checked (agree or stale) or a finding of another kind
  const markers = checked.length + findings.filter((f) => f.kind !== 'stale').length;
  console.log(`docs gate: ${files.length} files, ${markers} marked statements, ${findings.length} findings`);
  console.log(findings.length === 0 ? 'DOCS GATE OK' : 'DOCS GATE FAILED');
  process.exit(findings.length === 0 ? 0 : 1);
}

const { pathToFileURL } = process.getBuiltinModule('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
