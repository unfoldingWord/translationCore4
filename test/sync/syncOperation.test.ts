// The sync shell (issue #676, layer 3 of epic #24) over a faked transport: the
// fake rig (test/helpers/journalingRig.ts) answers the #673 routes — clone,
// copy, push, delete — over an in-memory Door43 repository. Each test asserts
// codes and the state of the folders, never message text.
import { afterEach, describe, expect, it } from 'vitest';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { JournalStore, forgetSharedClocks } from '../../src/data/journal/journalStore';
import { actorIdFor } from '../../src/data/journal/identity';
import { OpsLog, opsEntriesOf, previousCopyKey, serialSettingsWriter, syncPathsOf } from '../../src/data/journal/opsLog';
import { fold, reportError } from '../../src/data/journal/runtime';
import { validateSegment, type JournalEvent } from '../../src/data/journal/seal';
import { sync, SYNC_TRIES, type SyncDeps } from '../../src/data/share/syncOperation';
import { journalingRig, memKv, tickingNow, type JournalingRig } from '../helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const URL_ = 'https://qa.door43.org/facilitator/prueba';
const CLONE_PATH = 'qa.door43.org/facilitator/prueba';
const TOKEN = 'tok-sync-secret-676';
const SESSION = { username: 'facilitator', token: TOKEN };
const PATHS = syncPathsOf(REPO);
const usfm = (v1: string, v2 = '___') => ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', `\\v 1 ${v1}`, `\\v 2 ${v2}`, ''].join('\n');
const tick = () => new Promise((r) => setTimeout(r, 1));

/** The client-settings document; `hang` makes every later write never settle (a kill). */
function settingsDoc() {
  let doc: Record<string, unknown> = {};
  let hung = false;
  const read = async () => {
    await tick();
    return structuredClone(doc);
  };
  const write = async (next: Record<string, unknown>) => {
    if (hung) return new Promise<void>(() => {});
    await tick();
    doc = structuredClone(next);
  };
  return { read, write, get: () => doc, hang: () => (hung = true) };
}
const appStart = (settings: ReturnType<typeof settingsDoc>) =>
  new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });

interface World {
  rig: JournalingRig;
  kv: ReturnType<typeof memKv>;
  api: ServerApi;
  settings: ReturnType<typeof settingsDoc>;
  deps: (api?: ServerApi) => SyncDeps;
  actor: string;
  /** the own journal files before the sync, by path */
  own: () => Map<string, string>;
}

/** A shared project: one translator drafted TIT 1:1, checkpointed, shared to Door43,
 * then drafted TIT 1:2 (one more own segment, not on Door43 yet). With `outbox`,
 * a third draft is staged but its write failed: one outbox entry. */
async function world(opts: { outbox?: boolean } = {}): Promise<World> {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const kv = memKv();
  const clock = tickingNow('2026-10-13T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv, now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: usfm('Pablo.') });
  await store.commit('first (tC4)');
  rig.publish(REPO, URL_);
  await store.writeBook('TIT', usfm('Pablo, siervo.'));
  if (opts.outbox) {
    rig.failOn(({ method, ipath }) => method === 'POST' && !!ipath?.includes('/segments/'), 1);
    await expect(store.writeBook('TIT', usfm('Pablo, siervo.', 'en la esperanza.'))).rejects.toThrow();
  }
  const actor = store.actorId;
  store.dispose();
  const settings = settingsDoc();
  const ops = appStart(settings);
  const own = () => new Map([...rig.repos.get(REPO)!.files].filter(([p]) => p.startsWith(`checking/journal/${actor}/`)));
  const deps = (over = api): SyncDeps => ({ api: over, kv, door43Server: 'https://qa.door43.org', coverage: {}, ops, now: () => clock.advance(17) });
  return { rig, kv, api, settings, deps, actor, own };
}

const outboxKeys = (w: World) => [...w.kv.map.keys()].filter((k) => k.startsWith('outbox:'));
const journalOf = (files: Map<string, string>) => [...files].filter(([p]) => p.startsWith('checking/journal/'));
const eventsOf = async (files: Map<string, string>, actor: string): Promise<JournalEvent[]> => {
  const out: JournalEvent[] = [];
  for (const [p, bytes] of files)
    if (p.startsWith(`checking/journal/${actor}/segments/`)) {
      const v = await validateSegment(bytes);
      if (v.ok) out.push(...v.events);
    }
  return out;
};

afterEach(() => {
  forgetSharedClocks();
  forgetProjectQueues();
});

describe('#676 the sync shell', () => {
  it('[G5] same path and actor', async () => {
    const w = await world({ outbox: true });
    const before = w.own();
    const staged = outboxKeys(w);
    expect(staged).toHaveLength(1);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([true, undefined]);
    expect(reportError(report)).toBeNull();
    // the project is at the same path; no scratch copy is left
    expect(w.rig.repos.has(REPO)).toBe(true);
    expect(w.rig.repos.has(PATHS.scratch)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    // the same actor id, and every own file before the sync is in the project, byte for byte
    expect(await actorIdFor(w.kv, REPO)).toBe(w.actor);
    const live = w.rig.repos.get(REPO)!.files;
    for (const [p, bytes] of before) expect(live.get(p), p).toBe(bytes);
    // a store that opens the project again derives the same actor and finds its journal
    forgetSharedClocks();
    const reopened = new JournalingStore({ api: w.api, kv: w.kv });
    await reopened.open(REPO);
    expect(reopened.actorId).toBe(w.actor);
    reopened.dispose();
    // Door43 main holds the same journal as the live project
    const remote = w.rig.remotes.get(URL_)!;
    expect(journalOf(remote.files)).toEqual(journalOf(live));
  });

  it('[G1] after a sync, every own file and outbox entry is in the live project', async () => {
    const w = await world({ outbox: true });
    const before = w.own();
    const staged = [...w.kv.map].filter(([key]) => key.startsWith('outbox:')).map(([, bytes]) => bytes);
    expect(staged).toHaveLength(1);
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).ok).toBe(true);
    const live = w.rig.repos.get(REPO)!.files;
    for (const [p, bytes] of before) expect(live.get(p), p).toBe(bytes);
    for (const bytes of staged) expect([...live.values()]).toContain(bytes);
  });

  it('[G4] retries then stops', async () => {
    const w = await world();
    const before = new Map(w.rig.repos.get(REPO)!.files);
    const pushes: string[] = [];
    // a teammate pushes before each of our pushes: Door43 main always moves on
    const racing = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/git/push/')) {
        pushes.push(String(init?.body));
        w.rig.teammatePush(URL_);
      }
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const report = await sync(w.deps(racing), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.non-fast-forward']);
    expect(report.facts.tries).toBe(SYNC_TRIES);
    expect(pushes).toHaveLength(SYNC_TRIES);
    // never a force push: each push body is the platform's four fields, nothing else
    for (const body of pushes) expect(Object.keys(JSON.parse(body)).sort()).toEqual(['cred_type', 'pass_key', 'remote', 'username']);
    // nothing changed: the project, and no scratch copy
    expect(w.rig.repos.get(REPO)!.files).toEqual(before);
    expect(w.rig.repos.has(PATHS.scratch)).toBe(false);
  });

  it('[G4] a push that is not a fast-forward starts again, and the second try lands', async () => {
    const w = await world();
    let raced = false;
    const racing = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/git/push/') && !raced) {
        raced = true;
        w.rig.teammatePush(URL_);
      }
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const report = await sync(w.deps(racing), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.facts.tries]).toEqual([true, 2]);
  });

  it('outbox cleared after live', async () => {
    const w = await world({ outbox: true });
    const staged = outboxKeys(w);
    const stagedBytes = w.kv.map.get(staged[0]);
    const seen: number[] = [];
    // record the outbox at each server call of the swap
    const watching = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await w.rig.fetchFn(input, init);
      if (/\/git\/(copy|delete)\//.test(String(input)) && w.rig.remotes.get(URL_)!.version > 1) seen.push(outboxKeys(w).length);
      return response;
    }) as typeof fetch });
    const report = await sync(w.deps(watching), { repoPath: REPO, session: SESSION });
    expect(report.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((n) => n === staged.length)).toBe(true);
    expect(outboxKeys(w)).toEqual([]);
    // the entry's bytes are live in the project
    expect([...w.rig.repos.get(REPO)!.files.values()]).toContain(stagedBytes);
  });

  it('no write access refuses', async () => {
    const w = await world({ outbox: true });
    w.rig.remotes.get(URL_)!.writable = false;
    const project = new Map(w.rig.repos.get(REPO)!.files);
    const remote = new Map(w.rig.remotes.get(URL_)!.files);
    const staged = outboxKeys(w);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.no-write-access']);
    // nothing changed: the project, Door43 main, the outbox; no copy is left
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    expect(w.rig.remotes.get(URL_)!.files).toEqual(remote);
    expect(w.rig.remotes.get(URL_)!.version).toBe(1);
    expect(outboxKeys(w)).toEqual(staged);
    expect(w.rig.repos.has(PATHS.scratch)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
  });

  it('not signed in refuses', async () => {
    for (const session of [null, { username: 'facilitator', token: '' }, { username: '', token: TOKEN }]) {
      const w = await world({ outbox: true });
      const requests = w.rig.log.length;
      const project = new Map(w.rig.repos.get(REPO)!.files);
      const kv = new Map(w.kv.map);
      const report = await sync(w.deps(), { repoPath: REPO, session });
      expect([report.ok, report.code]).toEqual([false, 'sync.auth-failed']);
      // before any request; nothing changes
      expect(w.rig.log.length).toBe(requests);
      expect(w.rig.repos.get(REPO)!.files).toEqual(project);
      expect(w.kv.map).toEqual(kv);
    }
  });

  it('offline refuses before any git request', async () => {
    const w = await world();
    w.rig.setNet(false);
    const from = w.rig.log.length;
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.offline']);
    expect(w.rig.log.slice(from).filter((l) => l.route.includes('/git/'))).toEqual([]);
  });

  it('a project that was never shared refuses', async () => {
    const w = await world();
    delete w.rig.repos.get(REPO)!.origin;
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.not-shared']);
  });

  it('previous copy deleted at next save', async () => {
    const w = await world();
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).ok).toBe(true);
    // after the sync the previous copy is kept, and named in the installation store
    expect(w.rig.repos.has(PATHS.previous)).toBe(true);
    expect(await w.kv.get(previousCopyKey(REPO))).toBe(PATHS.previous);
    forgetSharedClocks();
    const store = new JournalingStore({ api: w.api, kv: w.kv });
    await store.open(REPO);
    // a save that is not a checkpoint keeps it
    await store.writeBook('TIT', usfm('Pablo, siervo de Dios.'));
    expect(w.rig.repos.has(PATHS.previous)).toBe(true);
    // the next successful save (the checkpoint) deletes it
    await store.commit('save (tC4)');
    expect(w.rig.repos.has(PATHS.previous)).toBe(false);
    expect(await w.kv.get(previousCopyKey(REPO))).toBeUndefined();
    store.dispose();
  });

  it('the Report is in the ops log, closed, with op sync', async () => {
    const w = await world();
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    const entries = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect(entries).toHaveLength(1);
    expect(entries[0].report).toEqual(report);
    expect(entries[0].facts).toMatchObject({ repoPath: REPO, phase: 'live' });
  });
});

describe('#676 the name action (R-8.5.25, R-8.5.26)', () => {
  it('name written once', async () => {
    const w = await world();
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).ok).toBe(true);
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).ok).toBe(true);
    const names = (await eventsOf(w.rig.repos.get(REPO)!.files, w.actor)).filter((e) => e.op === 'actor.name.set');
    expect(names).toHaveLength(1);
    expect((await eventsOf(w.rig.remotes.get(URL_)!.files, w.actor)).filter((e) => e.op === 'actor.name.set')).toHaveLength(1);
    expect(fold(await eventsOf(w.rig.repos.get(REPO)!.files, w.actor)).names).toEqual({ [w.actor]: 'facilitator' });
    // the app writer refuses a second name (R-8.5.26)
    forgetSharedClocks();
    const journal = new JournalStore({ api: w.api, repoPath: REPO, kv: w.kv });
    await journal.open();
    const second = { v: 3, op: 'actor.name.set', actor: w.actor, ts: journal.issueTs(), base: null, username: 'otro' };
    await expect(journal.publish([second])).rejects.toMatchObject({ code: 'actor.name-already-set' });
    await expect(journal.stage([second])).rejects.toMatchObject({ code: 'actor.name-already-set' });
    await expect(journal.sealName('otro')).rejects.toMatchObject({ code: 'actor.name-already-set' });
  });

  it('a refused sync writes no name', async () => {
    const w = await world();
    w.rig.remotes.get(URL_)!.writable = false;
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).code).toBe('sync.no-write-access');
    expect((await eventsOf(w.rig.repos.get(REPO)!.files, w.actor)).filter((e) => e.op === 'actor.name.set')).toEqual([]);
  });

  it('no email or token in the journal', async () => {
    const w = await world();
    expect((await sync(w.deps(), { repoPath: REPO, session: SESSION })).ok).toBe(true);
    for (const files of [w.rig.repos.get(REPO)!.files, w.rig.remotes.get(URL_)!.files])
      for (const [p, bytes] of journalOf(files)) {
        expect(bytes.includes(TOKEN), p).toBe(false);
        expect(bytes.includes('@'), p).toBe(false);
      }
    const [name] = (await eventsOf(w.rig.repos.get(REPO)!.files, w.actor)).filter((e) => e.op === 'actor.name.set');
    expect(Object.keys(name).sort()).toEqual(['actor', 'base', 'op', 'ts', 'username', 'v']);
    expect([name.v, name.username, name.base]).toEqual([3, 'facilitator', null]);
  });
});

describe('#676 crash recovery of the sync (G8)', () => {
  /** Run one sync and kill it after the `k`-th server call that matches `counts`:
   * that call answers, then every later request and settings write never settles.
   * `inside`: the server is killed DURING the k-th call instead: a copy leaves half
   * of the source's files at the target, a delete leaves half of its files. */
  async function killAfter(k: number, counts: (route: string) => boolean, inside = false) {
    const w = await world({ outbox: true });
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    let seen = 0;
    let killed = false;
    let cut = false; // the kill left a part folder
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      if (inside && counts(url.pathname) && seen + 1 === k) {
        killed = true;
        w.settings.hang();
        const repo = url.pathname.split('/').slice(4, 7).map(decodeURIComponent).join('/');
        const source = w.rig.repos.get(repo);
        const half = <T,>(m: Map<string, T>) => [...m].slice(0, Math.ceil(m.size / 2));
        cut = !!source && source.files.size > 1;
        if (source && url.pathname.includes('/git/copy/'))
          w.rig.repos.set(url.searchParams.get('target_path')!, { files: new Map(half(source.files)), meta: {}, commits: [], dirty: new Set() });
        if (source && url.pathname.includes('/git/delete/')) source.files = new Map(half(source.files));
        return new Promise<Response>(() => {});
      }
      const response = await w.rig.fetchFn(input, init);
      if (counts(new URL(String(input)).pathname) && (seen += 1) === k) {
        killed = true;
        w.settings.hang();
      }
      return response;
    }) as typeof fetch });
    const run = sync(w.deps(dying), { repoPath: REPO, session: SESSION });
    const done = await Promise.race([run.then(() => true), new Promise((r) => setTimeout(() => r(false), 200))]);
    return { w, before, staged, killed, done, cut };
  }

  /** The next start: a new ops log over the same stored document, over a live server. */
  async function restart(w: World, settings: { read: () => Promise<Record<string, unknown>>; write: (d: Record<string, unknown>) => Promise<void> }) {
    forgetSharedClocks();
    forgetProjectQueues();
    const next = new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });
    return next.recover(w.api);
  }

  /** After recovery: exactly one project at the path, with every own file (G1, G8). */
  async function expectOneProjectWithOwnWork(w: World, before: Map<string, string>, staged: Map<string, string>) {
    expect(w.rig.repos.has(REPO)).toBe(true);
    expect(w.rig.repos.has(PATHS.scratch)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    const live = w.rig.repos.get(REPO)!.files;
    for (const [p, bytes] of before) expect(live.get(p), p).toBe(bytes);
    // each outbox entry is live at its path, or still in the outbox for the next open's replay
    for (const [key, bytes] of staged) {
      const inOutbox = w.kv.map.get(key) === bytes;
      const atPath = [...live.values()].includes(bytes);
      expect(inOutbox || atPath, key).toBe(true);
    }
    // the next open replays what is left and verifies
    forgetSharedClocks();
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kv });
    await store.open(REPO);
    expect(store.actorId).toBe(w.actor);
    store.dispose();
  }

  const swapCall = (route: string) => /\/git\/(copy|delete)\/(_local_\/_local_\/prueba|_local_\/_archive_\/tc4-(sync|previous)--prueba)/.test(route);

  it('[G8] swap kill sweep', async () => {
    // a dry run counts the server calls of the swap
    const dry = await killAfter(Infinity, () => false);
    expect(dry.done).toBe(true);
    const swapCalls = dry.w.rig.log.filter((l) => l.method === 'POST' && swapCall(l.route) && !l.route.includes('/copy/qa.door43.org')).length;
    expect(swapCalls).toBeGreaterThanOrEqual(4);
    let kills = 0;
    let projectGone = 0; // kills that hit the window where the project folder is absent
    // the first swap-matching call is the delete of a stale scratch copy before the clone;
    // count every one of them, so the sweep also covers the calls before the swap
    const total = dry.w.rig.log.filter((l) => l.method === 'POST' && swapCall(l.route)).length;
    for (let k = 1; k <= total; k += 1) {
      const { w, before, staged, killed, done } = await killAfter(k, swapCall);
      expect(killed, `kill ${k}`).toBe(true);
      expect(done, `kill ${k}`).toBe(false);
      if (!w.rig.repos.has(REPO)) projectGone += 1;
      const stored = { read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } };
      const resolved = await restart(w, stored);
      expect(resolved.map((e) => e.op), `kill ${k}`).toEqual(['sync']);
      expect(reportError(resolved[0].report)).toBeNull();
      await expectOneProjectWithOwnWork(w, before, staged);
      kills += 1;
    }
    expect(kills).toBeGreaterThanOrEqual(1);
    expect(kills).toBe(total);
    expect(projectGone).toBeGreaterThanOrEqual(1);
    console.log(`[G8] kill sweep: ${kills} kill cases, ${swapCalls} swap calls, ${projectGone} with the project folder absent at the kill`);
  });

  it('[G8] swap kill sweep inside each server call (a part copy, a part delete)', async () => {
    const dry = await killAfter(Infinity, () => false);
    const total = dry.w.rig.log.filter((l) => l.method === 'POST' && swapCall(l.route)).length;
    let kills = 0;
    let partial = 0; // kills that left a part folder at the project path, the scratch copy or the previous copy
    for (let k = 1; k <= total; k += 1) {
      const { w, before, staged, killed, cut } = await killAfter(k, swapCall, true);
      expect(killed, `kill ${k}`).toBe(true);
      if (cut) partial += 1;
      const stored = { read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } };
      await restart(w, stored);
      await expectOneProjectWithOwnWork(w, before, staged);
      kills += 1;
    }
    expect(kills).toBe(total);
    expect(partial).toBeGreaterThanOrEqual(1);
    console.log(`[G8] kill sweep inside the calls: ${kills} kill cases, ${partial} with a part folder at the kill`);
  });

  it('[G8] a server failure in the swap stops with sync.move-failed, keeps the record open, and the next start finishes it', async () => {
    const w = await world({ outbox: true });
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    // the copy of the scratch copy to the project path fails once: the project folder is absent
    w.rig.failOn(({ route }) => route.includes('/git/copy/_local_/_archive_/tc4-sync--prueba'), 1);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.move-failed']);
    expect(w.rig.repos.has(REPO)).toBe(false);
    const [open] = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect(open.report).toBeUndefined();
    expect(open.facts.phase).toBe('swap.copy-live');
    const stored = { read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } };
    const [entry] = await restart(w, stored);
    expect(entry.report).toMatchObject({ op: 'sync', ok: true, facts: { finishedSwap: true } });
    await expectOneProjectWithOwnWork(w, before, staged);
  });

  it('[G8] a kill after the push and before the swap leaves the project as it was', async () => {
    const { w, before, staged, killed } = await killAfter(1, (route) => route.includes('/git/push/'));
    expect(killed).toBe(true);
    const project = new Map(w.rig.repos.get(REPO)!.files);
    const stored = { read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } };
    const [entry] = await restart(w, stored);
    expect(entry.report).toMatchObject({ op: 'sync', ok: false, facts: { phase: 'push', rolledBack: true } });
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    await expectOneProjectWithOwnWork(w, before, staged);
  });

  it('[G8] a kill after the clone deletes the clone path and the scratch copy', async () => {
    const { w, before, staged, killed } = await killAfter(1, (route) => route.includes('/git/clone-repo/'));
    expect(killed).toBe(true);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(true);
    const stored = { read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } };
    const [entry] = await restart(w, stored);
    expect(entry.report).toMatchObject({ op: 'sync', ok: false, facts: { phase: 'clone', rolledBack: true } });
    await expectOneProjectWithOwnWork(w, before, staged);
  });
});
