// The import shell (issue #361): the fake parser proves the shell end to end on
// the fake rig — an accept is one new project whose seeded events carry
// `seed.source`, a refusal and a failed write leave the repository list as it
// was, and the fixture manifest runs through the same runner the rig uses.
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { primarySubtag, runImport } from '../src/data/import/shell';
import { FAKE_PARSER } from '../src/data/import/parsers';
import type { ImportFile } from '../src/data/import/types';
import { reportError } from '../src/data/journal/runtime';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';
import { assertNoRepoCreated, fixtureFile, readManifest, runManifest, seedEventsOf } from './helpers/import';

const usfm = (code: string, name: string) => ['\\id ' + code + ' fake', '\\usfm 3.0', `\\h ${name}`, '\\mt ' + name, '\\c 1', '\\p', '\\v 1 Uno.', '\\v 2 Dos.', ''].join('\n');
const decoder = new TextDecoder();
const file = (name: string, text: string): ImportFile => ({ name, bytes: new TextEncoder().encode(text) });
const TWO_FILES = [file('57-TIT.usfm', usfm('TIT', 'Tito')), file('32-JON.usfm', usfm('JON', 'Jonás'))];

const setup = () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  rig.refuseUnknownLanguages();
  const clock = tickingNow('2026-09-22T12:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  return { rig, api, store, deps: { api, store } };
};

describe('#361 runImport', () => {
  it('a two-file drop is one bundle and one new project; every seeded event carries seed.source', async () => {
    const { rig, deps } = setup();
    const report = await runImport(FAKE_PARSER, TWO_FILES, {}, deps);
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ op: 'import', ok: true, facts: { repoPath: '_local_/_local_/fake_import', seedSource: 'sidecar-migration' } });
    expect([...(report.facts.books as string[])].sort()).toEqual(['JON', 'TIT']);
    expect([...rig.repos.keys()]).toEqual(['_local_/_local_/fake_import']);
    const project = rig.repos.get('_local_/_local_/fake_import')!;
    expect(project.files.get('TIT.usfm')).toBe(usfm('TIT', 'Tito'));
    expect(project.files.get('JON.usfm')).toBe(usfm('JON', 'Jonás'));
    const seeded = seedEventsOf(project.files);
    expect(seeded.filter((e) => e.op === 'book.add').length).toBe(2);
    expect(new Set(seeded.map((e) => e.seed.source))).toEqual(new Set(['sidecar-migration']));
    expect(project.commits.at(-1)).toBe('Import Fake import (tC4)');
    expect(project.dirty.size).toBe(0);
  });

  it('a tC3 bundle seeds with tc3-import', async () => {
    const { rig, deps } = setup();
    const report = await runImport({ ...FAKE_PARSER, id: 'tc3' }, TWO_FILES, {}, deps);
    expect(report.ok).toBe(true);
    expect(new Set(seedEventsOf(rig.repos.get('_local_/_local_/fake_import')!.files).map((e) => e.seed.source))).toEqual(new Set(['tc3-import']));
  });

  it('the create route gets the primary language subtag; the edits name the project', async () => {
    const { rig, deps } = setup();
    const bodies: string[] = [];
    const fetchFn = rig.fetchFn;
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/git/new-text-translation')) bodies.push(String(init?.body));
      return fetchFn(input, init);
    }) as typeof fetch });
    const report = await runImport(FAKE_PARSER, TWO_FILES, { name: 'Biblia Kanuri', language: 'es-419' }, { ...deps, api });
    expect(report.ok).toBe(true);
    expect(report.facts.repoPath).toBe('_local_/_local_/biblia_kanuri');
    expect(JSON.parse(bodies[0])).toMatchObject({ content_name: 'Biblia Kanuri', content_language_code: 'es' });
    // remake writes the bundle's own metadata.json, with the full tag (D80 point 4)
    expect(rig.repos.get('_local_/_local_/biblia_kanuri')!.meta.languages).toEqual([{ tag: 'es-419', name: { en: 'es' } }]);
    expect([primarySubtag('es-419'), primarySubtag('kau'), primarySubtag('x-abc')]).toEqual(['es', 'kau', 'x-abc']);
  });

  it('all or nothing: a write failure after the repository exists deletes it and reports import.write-failed', async () => {
    const { rig, api, deps } = setup();
    rig.failOn(({ route }) => route.includes('/remake_burrito_from_zip/'));
    const report = await assertNoRepoCreated(() => runImport(FAKE_PARSER, TWO_FILES, {}, deps), api);
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({ ok: false, code: 'import.write-failed', facts: { rolledBack: true } });
    expect(rig.log.some((r) => r.route.startsWith('/api/git/delete/'))).toBe(true);
  });

  it('a failure after the seed also rolls back: the commit fails, no repository remains', async () => {
    const { rig, api, deps } = setup();
    rig.failOn(({ route }) => route.includes('/git/add-and-commit/'), Infinity);
    const report = await assertNoRepoCreated(() => runImport(FAKE_PARSER, TWO_FILES, {}, deps), api);
    expect(report).toMatchObject({ ok: false, code: 'import.write-failed' });
  });

  it('a refused create leaves no repository: the route refuses the primary subtag too', async () => {
    const { api, deps } = setup();
    const report = await assertNoRepoCreated(() => runImport(FAKE_PARSER, TWO_FILES, { language: 'qaa' }, deps), api);
    expect(report).toMatchObject({ ok: false, code: 'import.write-failed' });
    expect(report.facts.error).toMatch(/Unknown language code 'qaa'/);
  });

  it('refuse: a damaged finding creates nothing and carries its code', async () => {
    const { rig, api, deps } = setup();
    const report = await assertNoRepoCreated(() => runImport(FAKE_PARSER, [file('57-TIT-damaged.usfm', usfm('TIT', 'Tito'))], {}, deps), api);
    expect(report).toMatchObject({ ok: false, code: 'import.damaged.truncated' });
    expect(rig.log.some((r) => r.route.includes('/git/new-'))).toBe(false);
  });

  it('an existing folder name is refused before any write: import.name-exists', async () => {
    const { rig, api, deps } = setup();
    expect((await runImport(FAKE_PARSER, TWO_FILES, {}, deps)).ok).toBe(true);
    const commits = [...rig.repos.get('_local_/_local_/fake_import')!.commits];
    const report = await assertNoRepoCreated(() => runImport(FAKE_PARSER, TWO_FILES, {}, deps), api);
    expect(report).toMatchObject({ ok: false, code: 'import.name-exists' });
    expect(rig.repos.get('_local_/_local_/fake_import')!.commits).toEqual(commits);
  });

  it('a same-name create that races past the listing deletes nothing: the other project keeps its commits', async () => {
    const { rig, deps } = setup();
    expect((await runImport(FAKE_PARSER, TWO_FILES, {}, deps)).ok).toBe(true);
    const commits = [...rig.repos.get('_local_/_local_/fake_import')!.commits];
    // The listing is stale: another creator made the folder after it was read.
    const fetchFn = rig.fetchFn;
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/git/list-local-repos') ? new Response('[]', { status: 200 }) : fetchFn(input, init)) as typeof fetch });
    const report = await runImport(FAKE_PARSER, TWO_FILES, {}, { ...deps, api });
    expect(report).toMatchObject({ ok: false, code: 'import.name-exists' });
    expect(rig.repos.get('_local_/_local_/fake_import')?.commits).toEqual(commits);
    expect(rig.log.some((r) => r.route.startsWith('/api/git/delete/'))).toBe(false);
  });

  it('a bundle with archive is uploaded as it is: every file of the archive is byte-identical in the new project', async () => {
    const { rig, deps } = setup();
    const zip = fixtureFile('../../sample-burrito');
    const report = await runImport(FAKE_PARSER, [zip], { name: 'Muestra' }, deps);
    expect(report).toMatchObject({ ok: true, facts: { books: ['JON', 'TIT'] } });
    expect(report.facts.seedSource).toBeUndefined(); // the first open seeds it
    const project = rig.repos.get('_local_/_local_/muestra')!;
    const archive = Object.entries(unzipSync(zip.bytes)).filter(([name]) => !/(^|\/)\.git(ignore|attributes)$/.test(name)); // remake strips them (PLATFORM-NOTES #41)
    for (const [name, bytes] of archive) {
      if (name === 'metadata.json') expect(project.meta, name).toEqual(JSON.parse(decoder.decode(bytes)));
      else expect(project.files.get(name.slice('ingredients/'.length)), name).toBe(decoder.decode(bytes));
    }
    expect([...project.files.keys()].sort()).toEqual(archive.filter(([n]) => n !== 'metadata.json').map(([n]) => n.slice('ingredients/'.length)).sort());
    expect(project.commits.at(-1)).toMatch(/^Import /);
  });

  it('the fixture manifest: every entry has its outcome', async () => {
    const { rig, deps } = setup();
    const read = async (repoPath: string, rel: string) => {
      const project = rig.repos.get(repoPath)!;
      return rel === 'metadata.json' ? JSON.stringify(project.meta) : project.files.get(rel.slice('ingredients/'.length))!;
    };
    const reports = await runManifest(readManifest(), { fake: FAKE_PARSER }, deps, read);
    expect(reports.every((r) => r.ok)).toBe(true);
    // the runner's refuse branch, with an inline entry (#41 adds the damaged fixtures)
    const refused = await runManifest([{ file: '../../sample-burrito', parser: 'fake', expect: 'refuse', code: 'import.name-exists' }], { fake: FAKE_PARSER }, deps, read);
    expect(refused[0].code).toBe('import.name-exists');
  });
});
