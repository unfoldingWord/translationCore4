// The docs gate's own controls (legibility step L-2, issue #155). The gate,
// scripts/docs-gate.mjs, compares every statement marked as manifest-derived in docs/,
// README.md, CONTRIBUTING.md and conformance/README.md with docs/evidence/manifest.json.
//
// Positive control: a marked statement that matches passes — on a fixture, and on the
// real documents against the committed manifest.
// Negative control: a marked statement with a stale value fails and the finding names
// the file, the line and the manifest path — on a fixture, and through the CLI against
// the real documents with one manifest count altered.
import { describe, expect, it } from 'vitest';
import { DOC_ROOTS, checkFiles, checkJourneys, checkText, liveTestCount, resolveMarker } from '../scripts/docs-gate.mjs';

// vite-plugin-node-polyfills aliases node builtins even under the node environment; the
// real ones come through process.getBuiltinModule (same workaround as noBypass.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const os = process.getBuiltinModule('node:os');
const { spawnSync } = process.getBuiltinModule('node:child_process');

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'docs/evidence/manifest.json');
const realManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// A small fixture manifest in the recorded shape (LEGIBILITY 3.1).
const fixture = {
  schemaVersion: 1,
  commit: 'abc1234abc1234abc1234abc1234abc1234abc12',
  rig: { detected: false, rev: '99fd9be' },
  suites: [
    {
      id: 'vitest',
      ran: true,
      skipped: null,
      passed: 809,
      failed: 0,
      skippedTests: 37,
      summary: [],
    },
    {
      id: 'conformance:validate',
      ran: true,
      skipped: null,
      passed: 40,
      failed: 0,
      skippedTests: null,
      summary: [
        'Stage-1 (path-authoritative): 35 passed, 0 failed',
        'Stage-2 (roles): 2 passed, 0 failed',
        '40 passed, 0 failed',
      ],
    },
    {
      id: 'conformance:transport',
      ran: false,
      skipped: 'no rig at http://127.0.0.1:19998/api',
      passed: null,
      failed: null,
      skippedTests: null,
      summary: [],
    },
  ],
};

const walk = (p: string): string[] => {
  const abs = path.join(ROOT, p);
  if (fs.statSync(abs).isDirectory()) {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .flatMap((e: { name: string }) => walk(path.join(p, e.name)))
      .sort();
  }
  return p.endsWith('.md') ? [p] : [];
};
const realDocs = () =>
  DOC_ROOTS.flatMap(walk).map((p: string) => ({
    file: p,
    text: fs.readFileSync(path.join(ROOT, p), 'utf8'),
  }));

describe('docs gate: marker grammar', () => {
  it('resolves a suite field, a summary line count and a top-level path', () => {
    expect(resolveMarker(fixture, 'vitest', 'passed')).toEqual({ value: 809, skipped: null });
    expect(resolveMarker(fixture, 'vitest', 'skippedTests')).toEqual({ value: 37, skipped: null });
    expect(resolveMarker(fixture, 'conformance:validate', 'summary[Stage-1]')).toEqual({
      value: 35,
      skipped: null,
    });
    expect(resolveMarker(fixture, 'rig.rev')).toEqual({ value: '99fd9be', skipped: null });
  });

  it('reports an unknown suite, field or path as a grammar error', () => {
    expect(resolveMarker(fixture, 'nosuch', 'passed').error).toMatch(/no suite nosuch/);
    expect(resolveMarker(fixture, 'vitest', 'count').error).toMatch(/unknown field count/);
    expect(resolveMarker(fixture, 'rig.nosuch').error).toMatch(/no field rig.nosuch/);
    expect(resolveMarker(fixture, 'rig').error).toMatch(/object, not a value/);
  });

  it('reads the value through markdown emphasis, backticks and brackets', () => {
    const text = [
      'Expect <!-- manifest: vitest passed -->**809 tests passed** and <!-- manifest: vitest skippedTests -->`37` skipped',
      'Total (<!-- manifest: conformance:validate passed -->40) checks',
      'The journal suite has <!-- manifest: vitest passed -->809.',
    ].join('\n');
    const r = checkText(text, fixture, 'x.md');
    expect(r.findings).toEqual([]);
    expect(r.checked.map((c) => `${c.line} ${c.marker}=${c.doc}`)).toEqual([
      '1 vitest passed=809',
      '1 vitest skippedTests=37',
      '2 conformance:validate passed=40',
      '3 vitest passed=809',
    ]);
  });

  it('ignores a marker inside a fenced code block or an inline code span (an example, not a claim)', () => {
    const text = [
      '```',
      '<!-- manifest: vitest passed -->460',
      '~~~ a different fence string inside a ``` block does not close it',
      '<!-- manifest: vitest passed -->460',
      '```',
      'grammar: `<!-- manifest: <suite-id> <field> -->VALUE` and `<!--  manifest: vitest passed -->460`',
      'live: <!-- manifest: vitest passed -->809',
      '~~~~',
      '<!-- manifest: vitest passed -->460',
      '~~~ a shorter fence of the same character does not close a ~~~~ block',
      '<!-- manifest: vitest passed -->460',
      '~~~~~ a longer one does',
      'live again: <!-- manifest: vitest passed -->809',
    ].join('\n');
    const r = checkText(text, fixture, 'x.md');
    expect(r.findings).toEqual([]);
    expect(r.checked.map((c) => c.line)).toEqual([7, 13]);
  });

  it('compares exactly: a 7-character prefix of a string value is stale', () => {
    const r = checkText(
      'pinned <!-- manifest: rig.rev -->99fd9be; commit <!-- manifest: commit -->abc1234.',
      fixture,
      'x.md',
    );
    expect(r.findings).toMatchObject([{ kind: 'stale', marker: 'commit', doc: 'abc1234' }]);
    expect(r.checked.map((c) => c.marker)).toEqual(['rig.rev', 'commit']);
  });
});

describe('docs gate: controls', () => {
  it('positive control (fixture): a marked statement that matches passes', () => {
    const r = checkText(
      'Expect <!-- manifest: vitest passed -->809 tests passed.',
      fixture,
      'README.md',
    );
    expect(r.findings).toEqual([]);
    expect(r.checked).toEqual([
      { file: 'README.md', line: 1, marker: 'vitest passed', doc: '809', manifest: '809' },
    ]);
  });

  it('negative control (fixture): a stale value fails and names file, line and manifest path', () => {
    const text = ['# Title', '', 'Expect <!-- manifest: vitest passed -->460 tests passed.'].join(
      '\n',
    );
    const r = checkText(text, fixture, 'README.md');
    expect(r.findings).toEqual([
      {
        kind: 'stale',
        file: 'README.md',
        line: 3,
        marker: 'vitest passed',
        doc: '460',
        manifest: '809',
        detail: 'document says 460, manifest says 809',
      },
    ]);
  });

  it('negative control (fixture): a marker over a skipped suite is a claim without evidence', () => {
    const r = checkText(
      'Transport: <!-- manifest: conformance:transport passed -->10 checks.',
      fixture,
      'docs/X.md',
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      kind: 'no-evidence',
      file: 'docs/X.md',
      line: 1,
      marker: 'conformance:transport passed',
      doc: '10',
    });
    expect(r.findings[0].detail).toMatch(/suite skipped: no rig/);
  });

  it('negative control (fixture): a marker with no value after it is a grammar error', () => {
    const r = checkText('<!-- manifest: vitest passed -->', fixture, 'docs/X.md');
    expect(r.findings).toMatchObject([
      { kind: 'grammar', line: 1, detail: 'no value follows the marker' },
    ]);
  });

  it('positive control (real surface): every marked statement in the repository agrees with the committed manifest', () => {
    const r = checkFiles(realDocs(), realManifest);
    expect(r.findings.map((f) => `${f.file}:${f.line} ${f.marker} ${f.detail}`)).toEqual([]);
    // L-2 marks the counts in README, CONTRIBUTING, PLATFORM-NOTES and conformance/README:
    // the gate must see them, or it is checking nothing.
    expect(r.checked.length).toBeGreaterThanOrEqual(8);
    expect(r.checked.some((c) => c.file === 'README.md' && c.marker === 'vitest passed')).toBe(
      true,
    );
    expect(
      r.checked.some(
        (c) =>
          c.file === 'conformance/README.md' &&
          c.marker === 'conformance:validate summary[Stage-1]',
      ),
    ).toBe(true);
    expect(
      r.checked.some(
        (c) => c.file === 'docs/PLATFORM-NOTES.md' && c.marker === 'conformance:journal passed',
      ),
    ).toBe(true);
  });

  it('negative control (real surface, CLI): one altered manifest count fails the gate and names the file, line and path', () => {
    const altered = structuredClone(realManifest);
    const vitest = altered.suites.find((s: { id: string }) => s.id === 'vitest');
    vitest.passed = vitest.passed + 1;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gate-'));
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(altered));
    try {
      const r = spawnSync(process.execPath, ['scripts/docs-gate.mjs', '--manifest', manifestPath], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      const stale = r.stdout.split('\n').filter((l: string) => l.startsWith('STALE'));
      expect(stale.length).toBeGreaterThanOrEqual(1);
      expect(
        stale.every((l: string) =>
          /(README|CONTRIBUTING)\.md:\d+ {2}vitest passed: document says \d+, manifest says \d+/.test(
            l,
          ),
        ),
      ).toBe(true);
      expect(r.stdout).toContain('DOCS GATE FAILED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('positive control (real surface, CLI): the committed manifest passes the gate', () => {
    const r = spawnSync(process.execPath, ['scripts/docs-gate.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.stdout).toContain('DOCS GATE OK');
    expect(r.status).toBe(0);
  });
});

// Journeys (issue #199, D69 rule 2): every row of the docs/JOURNEYS.md index resolves to a
// proof file and an owner. The gate checks that things resolve; it never runs a test.
describe('docs gate: journeys', () => {
  const row = (id: string, status: string, proof: string) =>
    `| ${id} | translator | Translate | a goal | ${status} | ${proof} |`;
  const table = (...rows: string[]) =>
    ['# Journeys', '', '| ID | Actor | Activity | Goal | Status | Proof |', '|---|---|---|---|---|---|', ...rows].join('\n');
  const live = "// docs/JOURNEYS.md J1\nimport { test } from '@playwright/test';\ntest('a', async () => {});\n";
  const fixmeOnly = "// docs/JOURNEYS.md J7\nimport { test } from '@playwright/test';\ntest.fixme('a', async () => {});\n";

  it('counts live tests: test( counts, test.fixme( does not', () => {
    expect(liveTestCount(live)).toBe(1);
    expect(liveTestCount(fixmeOnly)).toBe(0);
    expect(liveTestCount(live + fixmeOnly)).toBe(1);
  });

  it('positive control (fixture): shipped with a live spec, fixme with an owner, "to write" with an owner, retired, Phase 2 and vision all pass', () => {
    const specs = { 'e2e/j01-a.spec.ts': live, 'e2e/j07-b.spec.ts': fixmeOnly, 'e2e/j10-c.spec.ts': fixmeOnly };
    const text = table(
      row('J1', 'shipped alpha.1', '`e2e/j01-a.spec.ts`'),
      row('J7', 'increment 7 (#19)', '`e2e/j07-b.spec.ts` (fixme)'),
      row('J9c', 'increment 7 (#195)', '`e2e/j09-x.spec.ts` (to write)'),
      row('J10', 'retired', '`e2e/j10-c.spec.ts` stays'),
      row('J11', 'Phase 2', 'none'),
      row('J20', 'vision (D66)', 'none'),
    );
    const r = checkJourneys(text, specs);
    expect(r.findings).toEqual([]);
    expect(r.checked.map((c) => c.id)).toEqual(['J1', 'J7', 'J9c', 'J10', 'J11', 'J20']);
  });

  it('negative control (fixture): a proof file that does not exist names the row', () => {
    const r = checkJourneys(table(row('J1', 'shipped alpha.1', '`e2e/j01-missing.spec.ts`')), {});
    expect(r.findings.map((f) => [f.file, f.line, f.marker, f.kind])).toEqual([['docs/JOURNEYS.md', 5, 'J1', 'journey']]);
    expect(r.findings[0].detail).toContain('e2e/j01-missing.spec.ts does not exist');
  });

  it('negative control (fixture): a shipped row cannot be "to write", and cannot cite a fixme-only spec', () => {
    const r1 = checkJourneys(table(row('J1', 'shipped alpha.1', '`e2e/j01-a.spec.ts` (to write)')), {});
    expect(r1.findings.map((f) => f.detail)).toEqual([expect.stringContaining('a shipped row cannot be "to write"')]);
    const r2 = checkJourneys(table(row('J7', 'shipped alpha.3', '`e2e/j07-b.spec.ts`')), { 'e2e/j07-b.spec.ts': fixmeOnly });
    expect(r2.findings.map((f) => f.detail)).toEqual([expect.stringContaining('no test outside test.fixme')]);
  });

  it('negative control (fixture): an empty Status, or an owned row with no e2e path, is a finding', () => {
    const r = checkJourneys(table(row('J1', '', '`e2e/j01-a.spec.ts`'), row('J2', 'increment 5', 'none yet')), { 'e2e/j01-a.spec.ts': live });
    expect(r.findings.map((f) => [f.marker, f.detail])).toEqual([
      ['J1', expect.stringContaining('empty Status')],
      ['J2', expect.stringContaining('Proof names no e2e spec')],
    ]);
  });

  it('negative control (fixture): a spec header citing a dead document, or a journey spec cited by no row, is a finding on the spec', () => {
    const dead = '// J3 — get resources\n// JOURNEYS-AND-GAPS §2 J3 · PRD FR-12 · TEST-PLAN E-J3\n' + live;
    const r = checkJourneys(table(row('J1', 'shipped alpha.1', '`e2e/j01-a.spec.ts`')), {
      'e2e/j01-a.spec.ts': live,
      'e2e/j03-dead.spec.ts': dead,
      'e2e/helpers.spec.ts': live,
    });
    expect(r.findings.map((f) => [f.file, f.detail])).toEqual([
      ['e2e/j03-dead.spec.ts', expect.stringContaining('header cites a document that does not exist')],
      ['e2e/j03-dead.spec.ts', expect.stringContaining('cited by no row')],
    ]);
  });

  it('positive control (real surface): every journey in docs/JOURNEYS.md resolves, and every e2e/j*.spec.ts is cited', () => {
    const specs = Object.fromEntries(
      fs
        .readdirSync(path.join(ROOT, 'e2e'))
        .filter((n: string) => n.endsWith('.spec.ts'))
        .map((n: string) => [`e2e/${n}`, fs.readFileSync(path.join(ROOT, 'e2e', n), 'utf8')]),
    );
    const r = checkJourneys(fs.readFileSync(path.join(ROOT, 'docs/JOURNEYS.md'), 'utf8'), specs);
    expect(r.findings).toEqual([]);
    expect(r.checked.length).toBeGreaterThanOrEqual(24);
  });
});
