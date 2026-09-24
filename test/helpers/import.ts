// The import shell's test helpers (issue #361, docs/ARCHITECTURE.md §8). Node
// assert, not vitest's expect, so the vitest suites and the Playwright journeys
// (e2e/j09-import.spec.ts) share them.
import { zipSync } from 'fflate';
import type { ImportDeps } from '../../src/data/import/shell';
import type { ImportFile, ImportParser } from '../../src/data/import/types';
import type { Report } from '../../src/data/journal/runtime';
import { ServerApi } from '../../src/data/serverApi';

// Real node builtins via the runtime: the app's polyfill plugin aliases the
// imports under Vitest (the test/noBypass.test.ts workaround).
const assert: typeof import('node:assert').strict = process.getBuiltinModule('node:assert').strict;
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

/** The fixture manifest: one file tells every expected import outcome. */
export const MANIFEST_DIR = path.resolve(process.cwd(), 'conformance/fixtures/import');

export type ManifestEntry = {
  file: string | string[]; // relative to MANIFEST_DIR; a directory is zipped as it is (flat)
  wrap?: string; // zip the directory under this one top-level folder, as a DCS sb-zip is
  name?: string; // the review page's name edit: entries made from one burrito need their own project names
  lang?: string; // the review page's language edit: a USFM file carries no language
  parser: string;
  expect: 'accept' | 'refuse';
  code?: string;
  language?: string; // accept: the tag the stored metadata.json keeps
  books?: string[]; // accept: the book codes of the new project
  counts?: { chapters?: Record<string, number> }; // accept: `\c` markers per stored book
};

export const readManifest = (): ManifestEntry[] => JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, 'MANIFEST.json'), 'utf8')) as ManifestEntry[];

/** Every file under `dir` as zip entries keyed by relative path, under the folder `wrap` when given. */
export function zipDirectory(dir: string, wrap?: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries[(wrap ? `${wrap}/` : '') + path.relative(dir, full).split(path.sep).join('/')] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(dir);
  return zipSync(entries);
}

/** A manifest file as the import screen receives it: a directory becomes one zip. */
export function fixtureFile(rel: string, wrap?: string): ImportFile {
  const full = path.resolve(MANIFEST_DIR, rel);
  if (fs.statSync(full).isDirectory()) return { name: `${path.basename(full)}.zip`, bytes: zipDirectory(full, wrap) };
  return { name: path.basename(full), bytes: new Uint8Array(fs.readFileSync(full)) };
}

/** Every journal event of the segment files among `files` (ingredient path ->
 * text) that carries a `seed` marker. */
export function seedEventsOf(files: Iterable<[string, string]>): Array<{ op: string; seed: { source: string } }> {
  const out: Array<{ op: string; seed: { source: string } }> = [];
  for (const [ipath, text] of files) {
    if (!/^checking\/journal\/[^/]+\/segments\//.test(ipath)) continue;
    const { events } = JSON.parse((JSON.parse(text) as { body: string }).body) as { events: Array<{ op: string; seed?: { source: string } }> };
    for (const event of events) if (event.seed) out.push(event as { op: string; seed: { source: string } });
  }
  return out;
}

/** Run `fn` and assert the repository list is identical before and after it. */
export async function assertNoRepoCreated<T>(fn: () => Promise<T>, api: ServerApi = new ServerApi({ baseUrl: 'http://127.0.0.1:19998/api' })): Promise<T> {
  const before = await api.listLocalRepos();
  const out = await fn();
  assert.deepEqual(await api.listLocalRepos(), before, 'the import left a repository behind');
  return out;
}

/** Run every manifest entry through the shell and assert its outcome: an
 * accept is an ok Report whose project holds the entry's books, chapter counts
 * and language tag; a refuse is a failed Report with the entry's code and no
 * repository. `read(repoPath, rel)` reads a stored file (the fake rig or the
 * rig's disk). Returns each entry's Report. */
export async function runManifest(
  entries: ManifestEntry[],
  parsers: Record<string, ImportParser>,
  deps: ImportDeps & { api: ServerApi },
  read: (repoPath: string, rel: string) => Promise<string>,
): Promise<Report[]> {
  // Loaded here, not at the top: the Playwright journeys import this file for
  // the other helpers and never load the store.
  const { runImport } = await import('../../src/data/import/shell');
  const reports: Report[] = [];
  for (const entry of entries) {
    const parser = parsers[entry.parser];
    assert.ok(parser, `manifest entry ${JSON.stringify(entry.file)}: no parser "${entry.parser}"`);
    const files = (Array.isArray(entry.file) ? entry.file : [entry.file]).map((rel) => fixtureFile(rel, entry.wrap));
    const edits = { name: entry.name, language: entry.lang };
    const label = `manifest entry ${JSON.stringify(entry.file)}`;
    if (entry.expect === 'refuse') {
      const report = await assertNoRepoCreated(() => runImport(parser, files, edits, deps), deps.api);
      assert.equal(report.ok, false, `${label}: expected a refusal`);
      assert.equal(report.code, entry.code, `${label}: refusal code`);
      reports.push(report);
      continue;
    }
    const report = await runImport(parser, files, edits, deps);
    assert.equal(report.ok, true, `${label}: expected an import, got ${JSON.stringify(report.facts)}`);
    const repoPath = report.facts.repoPath as string;
    if (entry.books) assert.deepEqual([...(report.facts.books as string[])].sort(), [...entry.books].sort(), `${label}: books`);
    for (const [book, chapters] of Object.entries(entry.counts?.chapters ?? {}))
      assert.equal((await read(repoPath, `ingredients/${book}.usfm`)).match(/^\\c \d+/gm)?.length ?? 0, chapters, `${label}: ${book} chapters`);
    if (entry.language)
      assert.equal((JSON.parse(await read(repoPath, 'metadata.json')) as { languages: Array<{ tag: string }> }).languages[0].tag, entry.language, `${label}: language tag`);
    reports.push(report);
  }
  return reports;
}
