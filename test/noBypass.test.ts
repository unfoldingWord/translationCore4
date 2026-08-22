// The no-bypass architecture test — issue #62: "Add an automated
// architecture/lint test that fails when application code calls a raw server
// mutation outside the store implementation."
//
// The boundary: every canonical project mutation goes through JournalingStore
// (src/data/journal/journalingStore.ts). A newly introduced direct server write
// anywhere else in src/ fails THIS test, so it cannot silently escape the
// journal-first proof.
//
// What is deliberately allowed:
// - src/data/httpStore.ts and src/data/serverApi.ts: the raw surface itself.
// - src/data/journal/**: the boundary implementation (store + segment writer).
// - api.postZippedBurrito in src/data/resourceFetch.ts: installs SIDELOADED
//   resource burritos (serverApi refuses any non-_sideloaded_ target), which
//   are machine-local resources, never project mutations.
// - api.setClientSettings / enableNet / disableNet / setCurrentProject:
//   user-machine and shell state, not project data.
import { describe, expect, it } from 'vitest';

// The app's vite-plugin-node-polyfills aliases node builtins to browser mocks
// even under the Vitest node environment, so the REAL fs/path come through
// process.getBuiltinModule — the same workaround test/journalStore.test.ts uses.
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SRC = path.resolve(process.cwd(), 'src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });

const rel = (file: string): string => path.relative(path.dirname(SRC), file).replaceAll('\\', '/');

/** The raw ServerApi PROJECT-MUTATION surface. Calling any of these outside the
 * whitelist bypasses the journal. (Read routes, client-settings, the net gate,
 * and the sideload importer are not project mutations.) */
const RAW_MUTATIONS = [
  '.writeIngredient(',
  '.remakeIngredients(',
  '.addAndCommit(',
  '.newTextTranslation(',
  '.newScriptureBook(',
  '.deleteRepo(',
];

const RAW_MUTATION_WHITELIST = new Set([
  'src/data/serverApi.ts', // defines the surface
  'src/data/httpStore.ts', // the raw store the boundary drives
  'src/data/journal/journalingStore.ts', // the boundary itself
  'src/data/journal/journalStore.ts', // the segment writer (#61)
]);

/** Constructing the raw HttpStore hands out its whole mutation surface. */
const HTTP_STORE_CONSTRUCTION = 'new HttpStore(';
const HTTP_STORE_WHITELIST = new Set([
  'src/data/httpStore.ts',
  'src/data/journal/journalingStore.ts',
]);

describe('#62 no-bypass: application code cannot reach a raw server mutation', () => {
  const files = walk(SRC);

  it('scans a plausible tree (the test itself is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => rel(f) === 'src/state.jsx')).toBe(true);
  });

  it('raw ServerApi mutations appear only inside the store implementations', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const name = rel(file);
      if (RAW_MUTATION_WHITELIST.has(name)) continue;
      for (const needle of RAW_MUTATIONS) {
        if (source.includes(needle)) offenders.push(`${name}: ${needle.slice(1, -1)}`);
      }
    }
    expect(offenders, `raw server mutations outside the boundary:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the raw HttpStore is constructed only by the boundary', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const name = rel(file);
      if (HTTP_STORE_WHITELIST.has(name)) continue;
      if (source.includes(HTTP_STORE_CONSTRUCTION)) offenders.push(name);
    }
    expect(offenders, `raw HttpStore constructed outside the boundary:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('restoreDecisionsText (the pre-#62 rollback) is not called anywhere in the application', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (name === 'src/data/httpStore.ts') continue; // the definition may remain (internal)
      if (fs.readFileSync(file, 'utf8').includes('restoreDecisionsText')) offenders.push(name);
    }
    expect(
      offenders,
      `published decision events are permanent; byte rollback must be unreachable:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
