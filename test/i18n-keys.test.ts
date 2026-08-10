// Issue #12 — every UI string loads through i18n, with no missing keys.
//
// The proof has two halves:
//   1. This static scan: every i18n key that the client source names must exist in
//      the catalog. A new screen that names a missing key fails CI here.
//   2. The J4 journey assertion (e2e/j04-check-book.spec.ts, needs-rig): a full
//      checking session emits no "[i18n] missing key" console warning at runtime.
//      That half catches dynamic keys this scan can only pattern-match.
//
// Key call shapes in the source today, and how the scan covers each:
//   - t('literal.key')                        → exact catalog lookup
//   - t(cond ? 'key.a' : 'key.b')             → every quoted dotted string inside t(...)
//   - t(`family.${value}.title`)              → the template becomes a pattern; every
//     catalog key family it names must exist, and the pattern must match ≥ 1 key.
//     (The scan cannot enumerate runtime values; the J4 runtime assertion can.)
//   - name: 'sources.roleNotes' … t(role.name) → indirect keys: ANY quoted dotted
//     string whose first segment is a catalog namespace must be a catalog key.
import { describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n/index.js';

// Real node builtins via the runtime, NOT `import 'node:fs'` — the app's
// vite-plugin-node-polyfills aliases node builtins to browser mocks (fs → null)
// even under the Vitest node environment (same workaround as indexer.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

// Repo-root-relative, the same convention the other suites use (vitest runs
// from the repo root).
const SRC = path.resolve(process.cwd(), 'src');
const catalog: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(SRC, 'i18n', 'en.json'), 'utf8'),
);
const catalogKeys = Object.keys(catalog);
const namespaces = new Set(catalogKeys.map((k) => k.split('.')[0]));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Every client source file except the catalog itself.
const files = sourceFiles(SRC).filter((f) => !f.startsWith(path.join(SRC, 'i18n')));

type Found = { file: string; key: string };

/** Literal and ternary keys: every quoted dotted string inside a t(...) call. */
function literalKeys(): Found[] {
  const found: Found[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const call of src.matchAll(/\bt\(\s*([^)]*?)['"]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"]/g)) {
      found.push({ file: path.relative(SRC, file), key: call[2] });
    }
  }
  return found;
}

/** Indirect keys: quoted dotted strings anywhere in the source whose first
 * segment is a catalog namespace (e.g. the role table in state.jsx, resolved
 * later by t(role.name)). */
function namespacedStrings(): Found[] {
  const found: Found[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"]/g)) {
      if (namespaces.has(m[1].split('.')[0])) {
        found.push({ file: path.relative(SRC, file), key: m[1] });
      }
    }
  }
  return found;
}

/** Template keys: t(`family.${x}.title`) becomes a per-segment pattern. */
function templatePatterns(): Found[] {
  const found: Found[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*`([^`]+)`/g)) {
      found.push({ file: path.relative(SRC, file), key: m[1] });
    }
  }
  return found;
}

describe('i18n catalog completeness (issue #12)', () => {
  it('every literal key named in a t(...) call exists in the catalog', () => {
    const missing = literalKeys().filter(({ key }) => !(key in catalog));
    expect(missing, `keys used but absent from src/i18n/en.json: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('every catalog-namespaced string in the source is a real catalog key (covers indirect t(role.name)-style lookups)', () => {
    const missing = namespacedStrings().filter(({ key }) => !(key in catalog));
    expect(missing, `dotted strings in a catalog namespace but absent from src/i18n/en.json: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('every template key family (t(`…${x}…`)) matches at least one catalog key', () => {
    const patterns = templatePatterns();
    expect(patterns.length).toBeGreaterThan(0); // the shape exists in Check/Align today
    const unmatched = patterns.filter(({ key }) => {
      const re = new RegExp(
        '^' +
          key
            .split(/\$\{[^}]*\}/)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[\\w-]+') +
          '$',
      );
      return !catalogKeys.some((k) => re.test(k));
    });
    expect(unmatched, `template key families with no catalog match: ${JSON.stringify(unmatched)}`).toEqual([]);
  });

  it('the scan sees the known call shapes (guards against a silent regex miss)', () => {
    // If a refactor changes the call shapes, these floors force the scan to be updated
    // rather than passing vacuously.
    expect(literalKeys().length).toBeGreaterThan(100);
    expect(namespacedStrings().length).toBeGreaterThan(100);
  });

  it('t() warns once per missing key and falls back to the key itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(t('no.such.key.for.issue12')).toBe('no.such.key.for.issue12');
      expect(t('no.such.key.for.issue12')).toBe('no.such.key.for.issue12');
      const calls = warn.mock.calls.filter((c) =>
        String(c[0]).includes('[i18n] missing key: no.such.key.for.issue12'),
      );
      expect(calls.length).toBe(1); // once per key, not once per render
      expect(t('app.name')).toBe('translationCore4'); // present keys stay silent
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('app.name')).length,
      ).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
