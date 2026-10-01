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
// - src/data/import/shell.ts (#361, D79 point 7): the import shell makes a NEW
//   repository through the platform's own primitive (create, remake, commit)
//   before any journal exists, and deletes it when a step fails. The seed of
//   its records goes through the boundary (JournalingStore.openImported).
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
  '.newObsResource(',
  '.newScriptureBook(',
  '.deleteRepo(',
];

const RAW_MUTATION_WHITELIST = new Set([
  'src/data/serverApi.ts', // defines the surface
  'src/data/httpStore.ts', // the raw store the boundary drives
  'src/data/journal/journalingStore.ts', // the boundary itself
  'src/data/journal/journalStore.ts', // the segment writer (#61)
  'src/data/import/shell.ts', // a new repository before its journal exists (#361)
  'src/data/journal/opsLog.ts', // finishes a killed import's rollback at the next start (#374)
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

// The share adapter (#362 tests 8 and 9; D84): Door43 is spoken to from ONE
// module, src/data/share/door43Api.ts, which takes its server from DCS_SERVER
// (#120). A view never builds a Door43 address or fetches for a share, and no
// share module names a Door43 host — so a packaged build can only reach the
// server dcsServer.ts resolves.
const DOOR43_ADAPTER = 'src/data/share/door43Api.ts';
/** The Door43 API path prefix, and the Door43 hosts. */
const DOOR43_API = '/api/v1/';
const DOOR43_HOST = /door43\.org/;
/** Files that may read DCS_SERVER: its own module and the adapter. */
const DCS_SERVER_READERS = new Set(['src/data/dcsServer.ts', DOOR43_ADAPTER]);

describe('#362 one Door43 adapter', () => {
  const files = walk(SRC);
  const read = (file: string): string => fs.readFileSync(file, 'utf8');

  it('the adapter exists, and only it reads DCS_SERVER', () => {
    expect(files.some((f) => rel(f) === DOOR43_ADAPTER)).toBe(true);
    const offenders = files.map(rel).filter((name, i) => !DCS_SERVER_READERS.has(name) && /\bDCS_SERVER\b/.test(read(files[i])));
    expect(offenders, `DCS_SERVER read outside the adapter:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no view calls the Door43 API or fetches for a share; only the adapter does', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (name === DOOR43_ADAPTER) continue;
      const source = read(file);
      if (name.startsWith('src/views/') && (source.includes(DOOR43_API) || DOOR43_HOST.test(source))) offenders.push(`${name}: a Door43 address`);
      if ((name.startsWith('src/views/') || name.startsWith('src/data/share/')) && /\bfetch\s*\(/.test(source)) offenders.push(`${name}: fetch(`);
    }
    expect(offenders, `Door43 reached outside the adapter:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no share module names a Door43 host; the server comes from dcsServer', () => {
    const offenders = files.map(rel).filter((name, i) => name.startsWith('src/data/share/') && DOOR43_HOST.test(read(files[i])));
    expect(offenders, `a Door43 host named under src/data/share/:\n${offenders.join('\n')}`).toEqual([]);
  });

  // #203 test 9: the sign-in code (the session module and the sign-in step)
  // names no Door43 host either; the step shows the adapter's own server.
  it('the sign-in module and the sign-in step exist, and neither names a Door43 host', () => {
    const signIn = ['src/data/share/session.ts', 'src/views/modals/ShareSignIn.jsx'];
    for (const name of signIn) {
      const file = files.find((f) => rel(f) === name);
      expect(file, `${name} is missing`).toBeDefined();
      expect(DOOR43_HOST.test(read(file!)), `${name} names a Door43 host`).toBe(false);
    }
  });

  it('the rules fire on the shapes they guard (the test is not vacuous)', () => {
    expect(DOOR43_HOST.test("fetch('https://git.door43.org/api/v1/user/repos')")).toBe(true);
    expect(DOOR43_HOST.test('https://qa.door43.org')).toBe(true);
    expect('await fetch(`${DCS_SERVER}/api/v1/user/orgs`)'.includes(DOOR43_API)).toBe(true);
    expect(/\bfetch\s*\(/.test('const r = await fetch (url)')).toBe(true);
  });
});
