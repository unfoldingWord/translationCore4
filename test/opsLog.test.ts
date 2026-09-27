// The ops log (issue #374; TEAM-SYNC-PLAN 1.4): each store operation writes a
// record before its first side effect and closes it with its Report; a record a
// killed operation left open is resolved at the next start of the app.
import { describe, expect, it, vi } from 'vitest';
import { OpsLog, opsEntriesOf, serialSettingsWriter } from '../src/data/journal/opsLog';
import { reportError } from '../src/data/journal/runtime';
import { runImport } from '../src/data/import/shell';
import { FAKE_PARSER } from '../src/data/import/parsers';
import type { ImportFile } from '../src/data/import/types';
import { runExport, type ExportProducer } from '../src/data/export/kernel';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from './helpers/journalingRig';

const usfm = (code: string, name: string) => ['\\id ' + code + ' fake', '\\usfm 3.0', `\\h ${name}`, '\\mt ' + name, '\\c 1', '\\p', '\\v 1 Uno.', '\\v 2 Dos.', ''].join('\n');
const FILES: ImportFile[] = [{ name: '57-TIT.usfm', bytes: new TextEncoder().encode(usfm('TIT', 'Tito')) }];
const REPO = '_local_/_local_/fake_import';
const tick = () => new Promise((r) => setTimeout(r, 1));

/** The platform's client-settings document, with a slow read and write so
 * writes that overlap really interleave unless the writer serializes them. */
function settingsDoc() {
  let doc: Record<string, unknown> = {};
  let failNext = 0;
  const read = async () => {
    await tick();
    return structuredClone(doc);
  };
  const write = async (next: Record<string, unknown>) => {
    await tick();
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('client-settings write refused');
    }
    doc = structuredClone(next);
  };
  return { read, write, get: () => doc, failNextWrite: () => (failNext += 1) };
}

/** One app start: a fresh ops log over the SAME stored document. */
const appStart = (settings: ReturnType<typeof settingsDoc>) =>
  new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });

const rigSetup = () => {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const clock = tickingNow('2026-09-27T09:00:00.000Z');
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  return { rig, api, store };
};

describe('#374 each operation writes and closes an ops record', () => {
  it('an import writes its record before the first side effect and closes it with its Report', async () => {
    const settings = settingsDoc();
    const ops = appStart(settings);
    const rig = rigSetup();
    const created: string[] = [];
    const spy = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      // The first side effect: the record already names the new repository.
      if (String(input).includes('/git/new-text-translation')) created.push(JSON.stringify(opsEntriesOf(settings.get())));
      return rig.rig.fetchFn(input, init);
    }) as typeof fetch });
    const report = await runImport(FAKE_PARSER, FILES, {}, { api: spy, store: rig.store, ops });
    expect(report.ok).toBe(true);
    const before = JSON.parse(created[0]);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ op: 'import', facts: { parser: FAKE_PARSER.id, repoPath: REPO } });
    expect(before[0].report).toBeUndefined();
    const [entry] = opsEntriesOf(settings.get());
    expect(entry.report).toEqual(report);
  });

  it('the import shell\'s rollback is visible in the ops log', async () => {
    const settings = settingsDoc();
    const { rig, api, store } = rigSetup();
    rig.failOn(({ route }) => route.includes('/git/add-and-commit/'), Infinity);
    const report = await runImport(FAKE_PARSER, FILES, {}, { api, store, ops: appStart(settings) });
    expect(report).toMatchObject({ ok: false, code: 'import.write-failed', facts: { repoPath: REPO, rolledBack: true } });
    expect(rig.repos.has(REPO)).toBe(false);
    expect(opsEntriesOf(settings.get())).toEqual([expect.objectContaining({ op: 'import', facts: { parser: FAKE_PARSER.id, repoPath: REPO }, report })]);
  });

  it('an open and a checkpoint of the app store each leave a closed record', async () => {
    const settings = settingsDoc();
    const ops = appStart(settings);
    forgetSharedClocks();
    forgetProjectQueues();
    const rig = journalingRig();
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const clock = tickingNow('2026-09-27T09:00:00.000Z');
    const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13), ops });
    await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
    await store.commit('Project created (tC4)');
    await store.open('_local_/_local_/prueba');
    const entries = opsEntriesOf(settings.get());
    expect(entries.map((e) => [e.op, e.report?.ok])).toEqual(expect.arrayContaining([['checkpoint', true], ['open', true]]));
    for (const e of entries) expect(reportError(e.report)).toBeNull();
  });

  it('an export closes its record with its Report', async () => {
    const settings = settingsDoc();
    const ops = appStart(settings);
    const producer = { id: 'usfm-plain', label: 'x', appliesTo: () => true, produce: async () => { throw new Error('read failed'); } } as unknown as ExportProducer;
    const store = { commitPending: async () => null } as never;
    const report = await runExport(producer, { store, project: {} as never }, ops);
    expect(report).toMatchObject({ ok: false, code: 'export.read-failed' });
    expect(opsEntriesOf(settings.get())).toEqual([expect.objectContaining({ op: 'export', report })]);
  });
});

describe('#374 a kill between the two leaves a record the next start resolves', () => {
  it('an import killed after it created the repository: the next start deletes the partial repository', async () => {
    const settings = settingsDoc();
    const { rig, store } = rigSetup();
    // The kill: the upload never answers, so runImport never reaches its close.
    const killed = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/temp-bytes') || String(input).includes('/remake')
        ? new Promise<Response>(() => {})
        : rig.fetchFn(input, init)) as typeof fetch });
    void runImport(FAKE_PARSER, FILES, {}, { api: killed, store, ops: appStart(settings) });
    await vi.waitFor(() => expect(rig.repos.has(REPO)).toBe(true));
    await vi.waitFor(() => expect(opsEntriesOf(settings.get())[0]?.facts.repoPath).toBe(REPO));
    expect(opsEntriesOf(settings.get())[0].report).toBeUndefined();

    const next = appStart(settings);
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const resolved = await next.recover(api);
    expect(rig.repos.has(REPO)).toBe(false);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].report).toMatchObject({ op: 'import', ok: false, code: 'import.write-failed', facts: { repoPath: REPO, rolledBack: true, interrupted: true } });
    expect(opsEntriesOf(settings.get())[0].report).toEqual(resolved[0].report);
    // Resolved once: a second start has nothing left to resolve.
    expect(await appStart(settings).recover(api)).toEqual([]);
  });

  it('an interrupted export is simply gone; an interrupted open is left to the journal; nothing is deleted', async () => {
    const settings = settingsDoc();
    const before = appStart(settings);
    await before.begin('export', { producer: 'pdf' });
    await before.begin('open', { repoPath: '_local_/_local_/prueba' });
    const api = { listLocalRepos: vi.fn(async () => ['_local_/_local_/prueba']), deleteRepo: vi.fn(async () => {}) };
    const resolved = await appStart(settings).recover(api);
    expect(resolved.map((e) => [e.op, e.report?.ok, e.report?.facts.interrupted])).toEqual([['export', false, true], ['open', false, true]]);
    expect(api.deleteRepo).not.toHaveBeenCalled();
  });

  it('a record this session began is running, not interrupted', async () => {
    const settings = settingsDoc();
    const ops = appStart(settings);
    await ops.begin('checkpoint', {});
    expect(await ops.recover({ listLocalRepos: async () => [], deleteRepo: async () => {} })).toEqual([]);
  });
});

describe('#374 the one settings writer', () => {
  it('an ops write and a draft-unit write run together; both survive', async () => {
    const settings = settingsDoc();
    const update = serialSettingsWriter(settings.read, settings.write);
    const ops = new OpsLog({ read: settings.read, update });
    await Promise.all([
      ops.begin('open', { repoPath: 'x' }),
      update((doc) => ({ ...doc, draftUnits: { 'x|TIT': 'verse' } })),
    ]);
    expect(settings.get().draftUnits).toEqual({ 'x|TIT': 'verse' });
    expect(opsEntriesOf(settings.get())).toHaveLength(1);
  });

  it('a failed ops write is reported, never dropped', async () => {
    const settings = settingsDoc();
    const ops = appStart(settings);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard = vi.fn();
    ops.subscribe(heard);
    settings.failNextWrite();
    const record = await ops.begin('export', { producer: 'pdf' });
    expect(ops.errors).toEqual([expect.objectContaining({ op: 'export', error: 'client-settings write refused' })]);
    expect(ops.entries).toHaveLength(1); // kept in this session
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the export record was not saved'));
    expect(heard).toHaveBeenCalled();
    // The next write of the same record stores it whole.
    await record.note({ filename: 'a.pdf' });
    expect(opsEntriesOf(settings.get())).toEqual([expect.objectContaining({ op: 'export', facts: { producer: 'pdf', filename: 'a.pdf' } })]);
    error.mockRestore();
  });
});
