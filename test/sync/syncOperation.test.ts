// The sync shell (issue #676, layer 3 of epic #24) over a faked transport: the
// fake rig (test/helpers/journalingRig.ts) answers the #673 routes — clone,
// copy, push, delete — over an in-memory Door43 repository, and the apply (D100)
// writes the pushed tree into the project. Each test asserts
// codes and the state of the folders, never message text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { JournalStore, forgetSharedClocks } from '../../src/data/journal/journalStore';
import { actorIdFor } from '../../src/data/journal/identity';
import { APPLY_MARKER, OpsLog, applyScratch, opsEntriesOf, scratchPathOf, serialSettingsWriter, type OpsRecoveryApi } from '../../src/data/journal/opsLog';
import { recordInstalled } from '../../src/data/installed';
import { assertRepoPath } from '../../src/data/serverApi';
import { fold, makeClock, reportError } from '../../src/data/journal/runtime';
import { sealAction, segmentName, validateSegment, type JournalEvent } from '../../src/data/journal/seal';
import { sync, SYNC_TRIES, withClonePath, type SyncDeps } from '../../src/data/share/syncOperation';
import { journalingRig, memKv, tickingNow, type JournalingRig } from '../helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const URL_ = 'https://qa.door43.org/facilitator/prueba';
const CLONE_PATH = 'qa.door43.org/facilitator/prueba';
const TOKEN = 'tok-sync-secret-676';
const SESSION = { username: 'facilitator', token: TOKEN };
const SCRATCH = scratchPathOf(REPO);
const TEAMMATE = 'b676teammate0001';
const usfm = (v1: string, v2 = '___') => ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', `\\v 1 ${v1}`, `\\v 2 ${v2}`, ''].join('\n');
const tick = () => new Promise((r) => setTimeout(r, 1));

/** The client-settings document; `hang` makes every later write never settle (a kill). */
function settingsDoc() {
  let doc: Record<string, unknown> = {};
  let hung = false;
  let writes = 0;
  const read = async () => {
    await tick();
    return structuredClone(doc);
  };
  const write = async (next: Record<string, unknown>) => {
    if (hung) return new Promise<void>(() => {});
    writes += 1;
    await tick();
    doc = structuredClone(next);
  };
  return { read, write, get: () => doc, hang: () => (hung = true), unhang: () => (hung = false), writes: () => writes };
}
const appStart = (settings: ReturnType<typeof settingsDoc>) =>
  new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });

interface World {
  rig: JournalingRig;
  kv: ReturnType<typeof memKv>;
  api: ServerApi;
  settings: ReturnType<typeof settingsDoc>;
  deps: (api?: ServerApi) => SyncDeps;
  ops: OpsLog;
  actor: string;
  /** the own journal files before the sync, by path */
  own: () => Map<string, string>;
}

/** A shared project: one translator drafted TIT 1:1, checkpointed, shared to Door43,
 * then drafted TIT 1:2 (one more own segment, not on Door43 yet). With `outbox`,
 * a third draft is staged but its write failed: one outbox entry. */
async function world(opts: { outbox?: boolean; teammate?: boolean } = {}): Promise<World> {
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
  if (opts.teammate) {
    // a teammate names itself on Door43 main: a valid sealed segment of another actor
    let at = Date.parse('2026-10-13T12:00:00.000Z');
    const event = { v: 3, op: 'actor.name.set', actor: TEAMMATE, ts: makeClock(TEAMMATE, () => (at += 1)).issue(), base: null, username: 'teammate' };
    const path = `checking/journal/${TEAMMATE}/segments/${segmentName(event.ts)}`;
    const bytes = await sealAction([event]);
    rig.teammatePush(URL_, (remote) => remote.files.set(path, bytes));
  }
  const settings = settingsDoc();
  const ops = appStart(settings);
  await ops.recover(api);
  const own = () => new Map([...rig.repos.get(REPO)!.files].filter(([p]) => p.startsWith(`checking/journal/${actor}/`)));
  const deps = (over = api): SyncDeps => ({ api: over, kv, door43Server: 'https://qa.door43.org', coverage: {}, ops, now: () => clock.advance(17) });
  return { rig, kv, api, settings, deps, ops, actor, own };
}

/** A write, delete, remake or commit to the project: the calls of the apply. */
const liveCall = (route: string, method = 'POST') => method === 'POST' && [
  `/api/burrito/ingredient/raw/${REPO}`,
  `/api/burrito/ingredient/delete/${REPO}`,
  `/api/burrito/metadata/remake-ingredients/${REPO}`,
  `/api/git/add-and-commit/${REPO}`,
].some((r) => route.startsWith(r));
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
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
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
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
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
    // record the outbox at each write of the apply to the project
    const watching = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await w.rig.fetchFn(input, init);
      if (init?.method === 'POST' && liveCall(new URL(String(input)).pathname)) seen.push(outboxKeys(w).length);
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
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
  });

  it('not signed in refuses', async () => {
    for (const session of [null, { username: 'facilitator', token: '' }, { username: '', token: TOKEN }]) {
      const w = await world({ outbox: true });
      const requests = w.rig.log.length;
      const project = new Map(w.rig.repos.get(REPO)!.files);
      const kv = new Map(w.kv.map);
      const settingsWrites = w.settings.writes();
      const report = await sync(w.deps(), { repoPath: REPO, session });
      expect([report.ok, report.code]).toEqual([false, 'sync.auth-failed']);
      // before any request, the ops-log write included; nothing changes
      expect(w.rig.log.length).toBe(requests);
      expect(w.settings.writes()).toBe(settingsWrites);
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

  it('a clone that a kill left at the fixed clone path does not block the next sync: the sync deletes it and syncs', async () => {
    const w = await world();
    w.rig.createRepo(CLONE_PATH, { 'TIT.usfm': 'a clone left between the clone and the move' });
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([true, undefined]);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
  });

  it('a clone that holds the lock of the fixed clone path (#677 open from Door43) is not disturbed: the sync waits for it', async () => {
    const w = await world();
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let inFlight = false;
    const other = withClonePath(CLONE_PATH, async () => {
      w.rig.createRepo(CLONE_PATH, { 'TIT.usfm': 'the clone of the other operation' });
      inFlight = true;
      await gate;
      w.rig.repos.delete(CLONE_PATH); // its move off the fixed path
    });
    await vi.waitFor(() => expect(inFlight).toBe(true));
    const from = w.rig.log.length;
    const syncing = sync(w.deps(), { repoPath: REPO, session: SESSION });
    await new Promise((r) => setTimeout(r, 50));
    expect(w.rig.repos.get(CLONE_PATH)?.files.get('TIT.usfm')).toBe('the clone of the other operation');
    expect(w.rig.log.slice(from).filter(({ route }) => route.includes(`/git/delete/${CLONE_PATH}`) || route.includes('/git/clone-repo/'))).toEqual([]);
    release();
    await other;
    expect((await syncing).ok).toBe(true);
  });

  it('a project at the fixed clone path refuses sync.clone-path-exists and is not deleted', async () => {
    const w = await world();
    w.rig.createRepo(CLONE_PATH, Object.fromEntries(w.rig.repos.get(REPO)!.files)).origin = URL_;
    const report = await sync(w.deps(), { repoPath: CLONE_PATH, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.clone-path-exists']);
    expect(w.rig.repos.get(CLONE_PATH)?.files.size).toBe(w.rig.repos.get(REPO)!.files.size);
  });

  it('a copy that is not the fold of its journal refuses sync.verify-failed and pushes nothing', async () => {
    const w = await world();
    // the write of TIT.usfm into the scratch copy lands with other bytes
    const garbling = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === 'POST' && url.pathname.includes(`/ingredient/raw/${SCRATCH}`) && url.searchParams.get('ipath') === 'TIT.usfm')
        return w.rig.fetchFn(input, { ...init, body: JSON.stringify({ payload: 'not the fold' }) });
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const report = await sync(w.deps(garbling), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.verify-failed']);
    expect(w.rig.remotes.get(URL_)!.version).toBe(1);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });

  it('a failure that is not a refusal still gives a coded Report (sync.failed); the project does not change', async () => {
    const w = await world();
    const project = new Map(w.rig.repos.get(REPO)!.files);
    // the platform's commit answers as a panic does: HTTP 500 "unknown error while serving"
    const panicking = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/git/add-and-commit/_local_/_archive_/')
        ? new Response('unknown error while serving /api/git/add-and-commit', { status: 500 })
        : w.rig.fetchFn(input, init)) as typeof fetch });
    const report = await sync(w.deps(panicking), { repoPath: REPO, session: SESSION });
    expect(reportError(report)).toBeNull();
    expect([report.ok, report.code]).toEqual([false, 'sync.failed']);
    expect(String(report.facts.error)).toContain('add-and-commit');
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    const [entry] = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect(entry.report).toEqual(report);
  });

  it('any other push failure refuses sync.push-failed', async () => {
    const w = await world();
    const failing = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/git/push/')
        ? new Response(JSON.stringify({ is_good: false, reason: 'Could not push repo: failed to resolve path; class=Os (2)' }), { status: 500 })
        : w.rig.fetchFn(input, init)) as typeof fetch });
    const report = await sync(w.deps(failing), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.push-failed']);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });

  it('the Report is in the ops log, closed, with op sync', async () => {
    const w = await world();
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    const entries = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect(entries).toHaveLength(1);
    expect(entries[0].report).toEqual(report);
    expect(entries[0].facts).toMatchObject({ repoPath: REPO, phase: 'apply' });
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
  async function killAfter(k: number, counts: (route: string, method: string) => boolean, inside = false, teammate = false, prepare?: (w: World) => void) {
    const w = await world({ outbox: true, teammate });
    prepare?.(w);
    const from = w.rig.log.length;
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    let seen = 0;
    let killed = false;
    let cut = false; // the kill left a part folder
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (inside && counts(url.pathname, method) && seen + 1 === k) {
        killed = true;
        w.settings.hang();
        // the repository path follows /api/burrito/ingredient/raw/ or /api/git/(route)/
        const at = url.pathname.includes('/burrito/ingredient/') ? 5 : 4;
        const repo = url.pathname.split('/').slice(at, at + 3).map(decodeURIComponent).join('/');
        const source = w.rig.repos.get(repo);
        const half = <T,>(m: Map<string, T>) => [...m].slice(0, Math.ceil(m.size / 2));
        cut = !!source && source.files.size > 1;
        if (source && url.pathname.includes('/git/copy/'))
          w.rig.repos.set(url.searchParams.get('target_path')!, { files: new Map(half(source.files)), meta: {}, commits: [], dirty: new Set() });
        if (source && url.pathname.includes('/git/delete/')) source.files = new Map(half(source.files));
        if (source && url.pathname.includes('/burrito/ingredient/raw/')) {
          // a part write: the server stopped half way through the file
          const payload = (JSON.parse(String(init?.body)) as { payload: string }).payload;
          source.files.set(url.searchParams.get('ipath')!, payload.slice(0, Math.floor(payload.length / 2)));
          cut = true;
        }
        return new Promise<Response>(() => {});
      }
      const response = await w.rig.fetchFn(input, init);
      if (counts(new URL(String(input)).pathname, method) && (seen += 1) === k) {
        killed = true;
        w.settings.hang();
      }
      return response;
    }) as typeof fetch });
    const run = sync(w.deps(dying), { repoPath: REPO, session: SESSION });
    const done = await Promise.race([run.then(() => true), new Promise((r) => setTimeout(() => r(false), 200))]);
    return { w, before, staged, killed, done, cut, from };
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
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
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
    expect(['converged', 'regenerated-forward']).toContain(store.lastReport?.facts.classification); // never 'reconciled'
    store.dispose();
  }

  const storedOf = (w: World) => ({ read: async () => structuredClone(w.settings.get()), write: async (d: Record<string, unknown>) => { Object.assign(w.settings.get(), d); } });

  const applyWrite = ({ method, route }: { method: string; route: string }) => method === 'POST' && route.startsWith(`/api/burrito/ingredient/raw/${REPO}`);

  it('[G8] a server failure in the apply is retried once in the same run, and the sync completes', async () => {
    const w = await world({ outbox: true });
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    w.rig.failOn(applyWrite, 1);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([true, undefined]);
    const [entry] = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect(entry.report).toEqual(report);
    expect(await restart(w, storedOf(w))).toEqual([]);
    await expectOneProjectWithOwnWork(w, before, staged);
  });

  it('[G8] when the retry fails too: sync.apply-pending; the marker stays, so the project takes no open; the next sync finishes the apply first', async () => {
    const w = await world({ outbox: true, teammate: true });
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    w.rig.failOn(applyWrite, 2);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.apply-pending']);
    expect(w.rig.repos.get(SCRATCH)!.files.has(APPLY_MARKER)).toBe(true);
    // the disk decides: no open while the marker is there
    forgetSharedClocks();
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kv, ops: w.ops });
    await expect(store.open(REPO)).rejects.toMatchObject({ code: 'sync.apply-pending' });
    store.dispose();
    // a sync of the project finishes the pending apply first, then syncs
    const again = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([again.ok, again.code]).toEqual([true, undefined]);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(await restart(w, storedOf(w))).toEqual([]);
    await expectOneProjectWithOwnWork(w, before, staged);
  });

  it('[G8] one record whose recovery throws does not stop the others: it stays open and is reported', async () => {
    const w = await world();
    await w.ops.begin('sync', { repoPath: REPO, phase: 'push' });
    await w.ops.begin('export', { repoPath: REPO });
    const throwing = fakeApi({ [SCRATCH]: new Map([['TIT.usfm', 'x']]), [REPO]: new Map() }, { failDeleteRepo: true });
    const stored = storedOf(w);
    const next = new OpsLog({ read: stored.read, update: serialSettingsWriter(stored.read, stored.write) });
    const resolved = await next.recover(throwing);
    expect(resolved.map((e) => e.op)).toEqual(['export']);
    expect(next.errors.map((e) => e.op)).toContain('sync');
    expect(opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync' && !e.report)).toHaveLength(1);
  });

  it('a sync is refused until the ops log has loaded at this start', async () => {
    const w = await world();
    const fresh = appStart(settingsDoc());
    const requests = w.rig.log.length;
    const report = await sync({ ...w.deps(), ops: fresh }, { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'opslog.not-loaded']);
    expect(w.rig.log.length).toBe(requests);
  });

  it('[G8] a sync with no ops log is refused before any request: no scratch copy, no copy call', async () => {
    const w = await world();
    const requests = w.rig.log.length;
    const report = await sync({ ...w.deps(), ops: undefined }, { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'opslog.not-loaded']);
    expect(w.rig.log.length).toBe(requests);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
  });

  it('[G8] a kill after the push and before the apply leaves the project as it was', async () => {
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

  it('[G1][G8] a marker that comes from Door43 never authorizes an apply: a kill right after the clone moves to the scratch copy leaves the project as it was (bench round 5)', async () => {
    // Door43 main carries an apply marker and other bytes at an own journal path
    const incoming = (w: World) => w.rig.teammatePush(URL_, (remote) => {
      const ownPath = [...remote.files.keys()].find((p) => p.startsWith(`checking/journal/${w.actor}/segments/`))!;
      remote.files.set(ownPath, 'not a sealed segment');
      remote.files.set(APPLY_MARKER, JSON.stringify({ actor: 'someone', at: '2026-10-14T00:00:00.000Z' }));
    });
    const { w, before, staged, killed } = await killAfter(1, (route) => route.includes('/git/copy/'), false, false, incoming);
    expect(killed).toBe(true);
    expect(w.rig.repos.get(SCRATCH)?.files.has(APPLY_MARKER) ?? false).toBe(false);
    const project = new Map(w.rig.repos.get(REPO)!.files);
    await restart(w, storedOf(w));
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    await expectOneProjectWithOwnWork(w, before, staged);
  });
  // ---- escalation fixes (PR #688 rounds 1-5) ------------------------------------

  it('[G1] a store opened before an apply is stale after it: a save queued during the sync and a later checkpoint are refused', async () => {
    const w = await world();
    const store = new JournalingStore({ api: w.api, kv: w.kv, ops: w.ops });
    await store.open(REPO);
    const syncing = sync(w.deps(), { repoPath: REPO, session: SESSION });
    const queued = store.writeBook('TIT', usfm('Pablo.', 'GUARDADO EN COLA')); // queued behind the sync
    expect((await syncing).ok).toBe(true);
    await expect(queued).rejects.toMatchObject({ code: 'sync.project-replaced' });
    await expect(store.commit('stale save (tC4)')).rejects.toMatchObject({ code: 'sync.project-replaced' });
    store.dispose();
    expect([...w.rig.repos.get(REPO)!.files.values()].some((b) => b.includes('GUARDADO EN COLA'))).toBe(false);
    // a store opened after the apply saves
    const fresh = new JournalingStore({ api: w.api, kv: w.kv, ops: w.ops });
    await fresh.open(REPO);
    await fresh.writeBook('TIT', usfm('Pablo.', 'DESPUES'));
    await fresh.commit('save after the sync (tC4)');
    fresh.dispose();
  });

  it('[G8] an open holds the project queue to its end: a sync starts no git call while an open runs', async () => {
    const w = await world();
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let paused = false;
    const slow = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!paused && String(input).includes('/burrito/metadata/summary/')) {
        paused = true;
        await gate;
      }
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const gitCalls: string[] = [];
    const watching = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/git/')) gitCalls.push(new URL(String(input)).pathname);
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const store = new JournalingStore({ api: slow, kv: w.kv, ops: w.ops });
    const opening = store.open(REPO);
    await vi.waitFor(() => expect(paused).toBe(true));
    const syncing = sync(w.deps(watching), { repoPath: REPO, session: SESSION });
    await new Promise((r) => setTimeout(r, 50));
    expect(gitCalls).toEqual([]);
    release();
    await opening;
    store.dispose();
    expect((await syncing).ok).toBe(true);
  });

  it('[G4] a Door43 repository whose default branch is not main is refused (sync.not-main); nothing changes on Door43 or here', async () => {
    const w = await world();
    w.rig.remotes.get(URL_)!.defaultBranch = 'other';
    const project = new Map(w.rig.repos.get(REPO)!.files);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.not-main']);
    expect(w.rig.remotes.get(URL_)!.version).toBe(1);
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });

  it('the scratch names come from the whole project path: no two paths share them, and each passes the path rules', () => {
    const paths = ['_local_/_local_/prueba', 'qa.door43.org/facilitator/prueba', '_local_/_local_/a-sb', '_local_/_local_-s/b', '_local_/_local_/a_b'];
    const names = paths.map((p) => scratchPathOf(p));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(() => assertRepoPath(name)).not.toThrow();
    for (const name of names) expect(name.includes('..')).toBe(false);
  });

  it('a recorder that does not say it recovered is not loaded: the sync is refused', async () => {
    const w = await world();
    const loose = { begin: w.ops.begin.bind(w.ops) };
    const report = await sync({ ...w.deps(), ops: loose }, { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'opslog.not-loaded']);
  });

  // ---- full review of b542af5 ----------------------------------------------------

  it('[G8] a settings document that does not parse: one start keeps its bytes under their own key, starts an empty ops log, and the app opens projects', async () => {
    const w = await world();
    const bad = '{"opsLog":[{"id":"x","op":"sync","facts":{"phase":"app';
    let doc: Record<string, unknown> | null = null;
    const ops = new OpsLog({
      read: async () => (doc ? structuredClone(doc) : JSON.parse(bad)),
      update: serialSettingsWriter(async () => (doc ? structuredClone(doc) : JSON.parse(bad)), async (d) => { doc = structuredClone(d); }),
      readText: async () => bad,
      replace: async (d) => { doc = structuredClone(d); },
    });
    expect(await ops.recover(w.api)).toEqual([]);
    expect(ops.recovered).toBe(true);
    expect((doc as unknown as Record<string, Array<{ bytes: string }>>).unreadableSettings[0].bytes).toBe(bad);
    expect(ops.errors.map((e) => e.kind)).toEqual(['settings-unreadable']);
    const store = new JournalingStore({ api: w.api, kv: w.kv, ops });
    await store.open(REPO);
    store.dispose();
  });

  it('[G8] a settings read that fails for another reason still fails closed', async () => {
    const w = await world();
    const ops = new OpsLog({ read: async () => { throw new TypeError('fetch failed'); }, update: serialSettingsWriter(async () => ({}), async () => {}),
      readText: async () => '', replace: async () => {} });
    await expect(ops.recover(w.api)).rejects.toThrow();
    expect(ops.recovered).toBe(false);
  });

  it('a sync refused before the apply whose close is not saved does not lock the project (P3)', async () => {
    const w = await world();
    w.rig.setNet(false);
    let failWrites = false;
    const ops = new OpsLog({ read: w.settings.read, update: serialSettingsWriter(w.settings.read, async (d) => {
      if (failWrites) throw new Error('settings write failed');
      await w.settings.write(d);
    }) });
    await ops.recover(w.api);
    const begin = ops.begin.bind(ops);
    let first = true;
    ops.begin = async (...a: Parameters<typeof begin>) => {
      const handle = await begin(...a);
      if (first) failWrites = true; // the first sync's close is not saved
      first = false;
      return handle;
    };
    const report = await sync({ ...w.deps(), ops }, { repoPath: REPO, session: SESSION });
    failWrites = false;
    expect(report.code).toBe('sync.offline');
    const store = new JournalingStore({ api: w.api, kv: w.kv, ops });
    await store.open(REPO);
    store.dispose();
    w.rig.setNet(true);
    expect((await sync({ ...w.deps(), ops }, { repoPath: REPO, session: SESSION })).ok).toBe(true);
  });

  it('a refused token is matched on the libgit2 code (code=Auth (-16)), not on the text', async () => {
    const pushReply = (reason: string) => async () => {
      const w = await world();
      const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/git/push/')
          ? new Response(JSON.stringify({ is_good: false, reason }), { status: 500 })
          : w.rig.fetchFn(input, init)) as typeof fetch });
      return (await sync(w.deps(api), { repoPath: REPO, session: SESSION })).code;
    };
    // the reply that the owner run recorded (docs/evidence/sync-transport-spike-2026-10-13.md, step 3)
    expect(await pushReply('Could not push repo: server requires authentication that we do not support; class=Http (34); code=Auth (-16)')()).toBe('sync.auth-failed');
    // the word alone is not the code
    expect(await pushReply('Could not push repo: authentication hook said no; class=Http (34)')()).toBe('sync.push-failed');
  });

  it('a clone that does not move, and whose clean-up delete fails too, keeps its record open: the next start deletes the clone path (N4)', async () => {
    const w = await world();
    w.rig.failOn(({ route }) => route.startsWith(`/api/git/copy/${CLONE_PATH}`), 1);
    w.rig.failOn(({ route }) => route.startsWith(`/api/git/delete/${CLONE_PATH}`), 1);
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([false, 'sync.move-failed']);
    expect(report.facts).toMatchObject({ refusal: { clonePathLeft: true } });
    expect(w.rig.repos.has(CLONE_PATH)).toBe(true);
    const [entry] = opsEntriesOf(w.settings.get()).filter((e) => e.op === 'sync');
    expect([entry.report, entry.facts.phase]).toEqual([undefined, 'clone']);
    await restart(w, storedOf(w));
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
  });

  // ---- the apply (D100) -------------------------------------------------------

  it('audio is outside the sync (D100): nothing writes or deletes it, own audio stays here, and a teammate audio file does not reach this project', async () => {
    const w = await world();
    const own = 'ID3 own audio';
    w.rig.repos.get(REPO)!.files.set('audio/TIT/1.mp3', own);
    w.rig.remotes.get(URL_)!.files.set('audio/TIT/2.mp3', 'ID3 teammate audio');
    const audioCalls: string[] = [];
    const watching = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      // the verifier reads the scratch copy's audio as text to list it as tolerated; nothing writes or deletes audio
      if (init?.method === 'POST' && (url.searchParams.get('ipath') ?? '').startsWith('audio')) audioCalls.push(url.pathname);
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    const report = await sync(w.deps(watching), { repoPath: REPO, session: SESSION });
    expect(report.ok).toBe(true);
    expect(audioCalls).toEqual([]);
    expect(w.rig.repos.get(REPO)!.files.get('audio/TIT/1.mp3')).toBe(own);
    expect(w.rig.repos.get(REPO)!.files.has('audio/TIT/2.mp3')).toBe(false);
  });

  const tree = (files: Map<string, string>) => new Map([...files].filter(([p]) => !p.startsWith('audio/')).sort(([a], [b]) => (a < b ? -1 : 1)));

  /** Counts every server call after the push (stateful: one per run). */
  const afterPush = () => {
    let pushed = false;
    return (route: string) => {
      if (route.includes('/git/push/')) {
        pushed = true;
        return false;
      }
      return pushed;
    };
  };

  it('[G8] apply kill sweep: a kill after each server call after the push, and inside each one (marker write, apply, marker delete, scratch delete); the next start leaves one project that opens, never reconciled, with every own segment', async () => {
    const dry = await killAfter(Infinity, () => false, false, true);
    expect(dry.done).toBe(true);
    const log = dry.w.rig.log.slice(dry.from);
    const total = log.length - 1 - log.map((l) => l.route.includes('/git/push/')).lastIndexOf(true);
    expect(total).toBeGreaterThanOrEqual(10);
    let kills = 0;
    let applied = 0;
    let unchanged = 0;
    for (const inside of [false, true])
      for (let k = 1; k <= total; k += 1) {
        const { w, before, staged, killed } = await killAfter(k, afterPush(), inside, true);
        expect(killed, `kill ${k}${inside ? ' inside' : ''}`).toBe(true);
        const project = new Map(w.rig.repos.get(REPO)!.files);
        const marker = w.rig.repos.get(SCRATCH)?.files.has(APPLY_MARKER) ?? false;
        const [entry] = await restart(w, storedOf(w));
        expect(reportError(entry.report)).toBeNull();
        expect(w.rig.repos.has(SCRATCH), `kill ${k}`).toBe(false);
        const live = w.rig.repos.get(REPO)!.files;
        if (marker) expect(entry.report?.facts.finishedApply, `kill ${k}`).toBe(true);
        // either the pushed tree is applied whole, or the project is as it was
        if (tree(live).size === tree(w.rig.remotes.get(URL_)!.files).size && [...tree(w.rig.remotes.get(URL_)!.files)].every(([p, b]) => live.get(p) === b)) applied += 1;
        else {
          expect(live, `kill ${k}`).toEqual(project);
          unchanged += 1;
        }
        await expectOneProjectWithOwnWork(w, before, staged);
        kills += 1;
      }
    expect(kills).toBe(2 * total);
    expect(applied).toBeGreaterThanOrEqual(1);
    console.log(`[G8] apply kill sweep: ${kills} kill cases (${total} server calls after the push, after and inside each): ${applied} applied whole, ${unchanged} as they were`);
  }, 180_000);

  it('[G8] a kill inside the settings write of the apply phase: nothing was applied, the next start deletes the scratch copy, and the project opens', async () => {
    const w = await world({ outbox: true, teammate: true });
    const before = w.own();
    const staged = new Map([...w.kv.map].filter(([key]) => key.startsWith('outbox:')));
    const project = new Map(w.rig.repos.get(REPO)!.files);
    let killed = false;
    const ops = new OpsLog({ read: w.settings.read, update: serialSettingsWriter(w.settings.read, async (d) => {
      if (opsEntriesOf(d).some((e) => e.op === 'sync' && e.facts.phase === 'apply')) {
        killed = true;
        w.settings.hang();
        return new Promise<void>(() => {});
      }
      await w.settings.write(d);
    }) });
    await ops.recover(w.api);
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
      killed ? new Promise<Response>(() => {}) : w.rig.fetchFn(input, init)) as typeof fetch });
    void sync({ ...w.deps(dying), ops }, { repoPath: REPO, session: SESSION });
    await vi.waitFor(() => expect(killed).toBe(true));
    expect(w.rig.repos.get(REPO)!.files).toEqual(project);
    const [entry] = await restart(w, storedOf(w));
    expect(entry.report).toMatchObject({ op: 'sync', ok: false, facts: { phase: 'push', rolledBack: true } });
    await expectOneProjectWithOwnWork(w, before, staged);
  });
  // ---- the disk record (D100): the settings document never locks or unlocks ------

  /** A teammate changed TIT 1:2 on Door43 main; this computer changed TIT 1:1 later. */
  async function teammateTextWorld() {
    const w = await world({ outbox: false });
    const TM = '_local_/_local_/companero';
    const remote = w.rig.remotes.get(URL_)!;
    w.rig.repos.set(TM, { files: new Map(remote.files), meta: structuredClone(remote.meta), commits: [], dirty: new Set() });
    forgetSharedClocks();
    forgetProjectQueues();
    let at = Date.parse('2026-10-13T08:00:00.000Z');
    const tm = new JournalingStore({ api: w.api, kv: memKv(), now: () => (at += 1) });
    await tm.open(TM);
    await tm.writeBook('TIT', usfm('Pablo.', 'TEAMMATE TEXT'));
    const tmActor = tm.actorId;
    tm.dispose();
    const tmFiles = w.rig.repos.get(TM)!.files;
    w.rig.teammatePush(URL_, (r) => { for (const [p, b] of tmFiles) if (p.startsWith(`checking/journal/${tmActor}/`)) r.files.set(p, b); });
    w.rig.repos.delete(TM);
    forgetSharedClocks();
    forgetProjectQueues();
    return w;
  }

  /** Kill the sync at its first derived write of the apply (journal files are written). */
  async function killInApply(w: World, ops: OpsLog) {
    let killed = false;
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      if (url.pathname.startsWith(`/api/burrito/ingredient/raw/${REPO}`) && init?.method === 'POST' && !(url.searchParams.get('ipath') ?? '').startsWith('checking/journal/')) {
        killed = true;
        w.settings.hang();
        return new Promise<Response>(() => {});
      }
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    void sync({ ...w.deps(dying), ops }, { repoPath: REPO, session: SESSION });
    await vi.waitFor(() => expect(killed).toBe(true));
  }

  /** The reopen keeps the teammate's text and seals no own edit of it. */
  async function expectTeammateKept(w: World) {
    forgetSharedClocks();
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kv });
    await store.open(REPO);
    expect(store.lastReport?.facts.classification).not.toBe('reconciled');
    store.dispose();
    expect(w.rig.repos.get(REPO)!.files.get('TIT.usfm')).toContain('TEAMMATE TEXT');
    const own = await eventsOf(w.rig.repos.get(REPO)!.files, w.actor);
    expect(own.some((e) => JSON.stringify(e).includes('___') && e.op !== 'book.add')).toBe(false);
  }

  it('[G1][G8] a concurrent raw settings write (recordInstalled) that drops the apply phase from the record: the marker still finishes the apply, and the teammate text stays (B1)', async () => {
    const w = await teammateTextWorld();
    let release = (): void => {};
    const applySaved = new Promise<void>((r) => (release = r));
    let started = false;
    let installed = false;
    const update = serialSettingsWriter(w.settings.read, async (d) => {
      await w.settings.write(d);
      const record = opsEntriesOf(d).find((e) => e.op === 'sync');
      if (record?.facts.phase === 'push' && !started) {
        started = true;
        // a resource download ends now: a whole-document read, then a write after the apply phase
        const raw = { getClientSettings: () => w.settings.read(), setClientSettings: async (_id: string, doc: Record<string, unknown>) => { await applySaved; await w.settings.write(doc); installed = true; } };
        void recordInstalled(raw as never, 'uw-tc4', 'en_ult', { repoPath: 'unfoldingWord/en_ult', version: 'v1', sha: 'abc', flavor: 'x' } as never);
      }
      if (record?.facts.phase === 'apply') release();
    });
    const ops = new OpsLog({ read: w.settings.read, update });
    await ops.recover(w.api);
    await killInApply(w, ops);
    await vi.waitFor(() => expect(installed).toBe(true));
    expect(opsEntriesOf(w.settings.get()).find((e) => e.op === 'sync')?.facts.phase).toBe('push'); // the record lost the apply phase
    const [entry] = await restart(w, storedOf(w));
    expect(entry.report).toMatchObject({ op: 'sync', ok: true, facts: { finishedApply: true } });
    await expectTeammateKept(w);
  });

  it('[G1][G8] a settings document torn at restart, with an apply pending: the disk rule still finishes the apply, and the teammate text stays (B2)', async () => {
    const w = await teammateTextWorld();
    await killInApply(w, w.ops);
    expect(w.rig.repos.get(SCRATCH)!.files.has(APPLY_MARKER)).toBe(true);
    const torn = JSON.stringify(w.settings.get()).slice(0, 40);
    forgetSharedClocks();
    forgetProjectQueues();
    let doc: Record<string, unknown> | null = null;
    const next = new OpsLog({
      read: async () => (doc ? structuredClone(doc) : JSON.parse(torn)),
      update: serialSettingsWriter(async () => (doc ? structuredClone(doc) : JSON.parse(torn)), async (d) => { doc = structuredClone(d); }),
      readText: async () => torn,
      replace: async (d) => { doc = structuredClone(d); },
    });
    await next.recover(w.api);
    expect(next.errors.map((e) => e.kind)).toContain('settings-unreadable');
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    await expectTeammateKept(w);
  });

  it('[G1][G8] a kill inside the scratch delete after the apply: the part copy has no marker, so the next start only deletes it, and the project opens (B3)', async () => {
    const w = await teammateTextWorld();
    const isScratchDelete = (route: string) => route === `/api/git/delete/${SCRATCH}`;
    let deletes = 0;
    let killed = false;
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      // the last scratch delete of the sync, after the push: the server stops half way
      if (isScratchDelete(url.pathname) && w.rig.remotes.get(URL_)!.version > 2 && (deletes += 1) === 1) {
        killed = true;
        w.settings.hang();
        const scratch = w.rig.repos.get(SCRATCH)!;
        scratch.files = new Map([...scratch.files].filter(([p]) => p !== 'TIT.usfm'));
        return new Promise<Response>(() => {});
      }
      return w.rig.fetchFn(input, init);
    }) as typeof fetch });
    void sync(w.deps(dying), { repoPath: REPO, session: SESSION });
    await vi.waitFor(() => expect(killed).toBe(true));
    expect(w.rig.repos.get(SCRATCH)!.files.has(APPLY_MARKER)).toBe(false);
    const applied = new Map(w.rig.repos.get(REPO)!.files);
    await restart(w, storedOf(w));
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.get(REPO)!.files).toEqual(applied); // nothing applied from the part copy
    await expectTeammateKept(w);
  });

  it('[G8] a sync started while the marker is there finishes the pending apply first', async () => {
    const w = await teammateTextWorld();
    await killInApply(w, w.ops);
    w.settings.unhang();
    forgetSharedClocks();
    forgetProjectQueues();
    const report = await sync(w.deps(), { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code]).toEqual([true, undefined]);
    await expectTeammateKept(w);
  });

  it('[G8] the start finishes a pending apply of a project at any path, not only under _local_/_local_/', async () => {
    const w = await world();
    const OTHER = 'qa.door43.org/team/otro';
    w.rig.createRepo(OTHER, { 'TIT.usfm': 'old text', 'gone.json': '{}' });
    w.rig.createRepo(scratchPathOf(OTHER), { 'TIT.usfm': 'Door43 main text', [APPLY_MARKER]: '{}' });
    await appStart(settingsDoc()).recover(w.api);
    expect(w.rig.repos.has(scratchPathOf(OTHER))).toBe(false);
    const files = w.rig.repos.get(OTHER)!.files;
    expect([files.get('TIT.usfm'), files.has('gone.json'), files.has(APPLY_MARKER)]).toEqual(['Door43 main text', false, false]);
  });

  it('[G8] an open whose check for the marker gets no answer (HTTP 500) refuses with a code: fail closed', async () => {
    const w = await world();
    w.rig.failOn(({ method, route }) => method === 'GET' && route === `/api/burrito/paths/${SCRATCH}`, 1);
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kv, ops: w.ops });
    await expect(store.open(REPO)).rejects.toMatchObject({ code: 'sync.apply-pending' });
    await store.open(REPO); // the next check answers: the project opens
    store.dispose();
  });
});


/** A fake platform for `applyScratch`: one Map of files per repository. A delete
 * of a missing file answers as the platform does (HTTP 400 "No such file: <path>"). */
function fakeApi(repos: Record<string, Map<string, string>>, opts: { failWrites?: boolean; failDeleteRepo?: boolean; listGone?: string[]; kill?: { after: number } } = {}) {
  let calls = 0;
  const dirty = new Set<string>();
  const step = (): void => {
    calls += 1;
    if (opts.kill && calls > opts.kill.after) throw new Error('killed');
  };
  const api = {
    listLocalRepos: async () => Object.keys(repos),
    deleteRepo: async (repo: string) => {
      if (opts.failDeleteRepo) throw new Error('delete refused');
      delete repos[repo];
    },
    listPaths: async (repo: string) => [...(repos[repo]?.keys() ?? []), ...(repo === REPO ? (opts.listGone ?? []) : [])],
    readIngredient: async (repo: string, ipath: string) => repos[repo].get(ipath) ?? '',
    readIngredientZipped: async () => { throw new Error('no zip route'); },
    writeIngredient: async (repo: string, ipath: string, payload: string) => {
      if (opts.failWrites) throw new Error('write refused');
      step();
      repos[repo].set(ipath, payload);
      dirty.add(repo);
    },
    deleteIngredient: async (repo: string, ipath: string) => {
      step();
      if (!repos[repo].has(ipath)) throw Object.assign(new Error('gone'), { status: 400, reason: `No such file: ${ipath}` });
      repos[repo].delete(ipath);
      dirty.add(repo);
    },
    gitStatus: async (repo: string) => (dirty.has(repo) ? [{ path: 'x', change_type: 'modified' }] : []),
    remakeIngredients: async () => step(),
    addAndCommit: async (repo: string) => {
      step();
      dirty.delete(repo);
    },
  };
  return api as unknown as OpsRecoveryApi;
}

describe('#676 applyScratch (D100)', () => {
  const scratchFiles = () => new Map([
    ['TIT.usfm', 'new TIT'],
    ['checking/journal/a1/segments/s1.action.json', 'own 1'],
    ['checking/journal/b1/segments/t1.action.json', 'teammate 1'],
  ]);
  const liveFiles = () => new Map([
    ['TIT.usfm', 'old TIT'],
    ['checking/alignments/JON.json', 'a file the fold no longer projects'],
    ['checking/journal/a1/segments/s1.action.json', 'own 1'],
    ['checking/journal/a1/segments/s2.action.json', 'own 2, saved after the apply began'],
    ['audio/TIT/1.mp3', 'own audio'],
  ]);

  it('[G8] a kill after each write, delete, remake and commit, then a run again: the project equals the scratch copy, keeps its own journal files and audio, and loses no journal file', async () => {
    const dry = { [SCRATCH]: scratchFiles(), [REPO]: liveFiles() };
    let total = 0;
    const counting = fakeApi(dry);
    const wrap = new Proxy(counting, { get: (t, k) => (['writeIngredient', 'deleteIngredient', 'remakeIngredients', 'addAndCommit'].includes(String(k))
      ? async (...a: unknown[]) => { total += 1; return (t as never as Record<string, (...x: unknown[]) => unknown>)[String(k)](...a); }
      : (t as never as Record<string, unknown>)[String(k)]) });
    await applyScratch(wrap, REPO, SCRATCH);
    expect(total).toBeGreaterThanOrEqual(5); // a write, a write, a delete, a remake, a commit
    for (let k = 0; k < total; k += 1) {
      const repos = { [SCRATCH]: scratchFiles(), [REPO]: liveFiles() };
      await expect(applyScratch(fakeApi(repos, { kill: { after: k } }), REPO, SCRATCH)).rejects.toThrow('killed');
      await applyScratch(fakeApi(repos), REPO, SCRATCH);
      const live = repos[REPO];
      expect(live.get('TIT.usfm'), `kill ${k}`).toBe('new TIT');
      expect(live.has('checking/alignments/JON.json')).toBe(false);
      expect(live.get('checking/journal/b1/segments/t1.action.json')).toBe('teammate 1');
      expect(live.get('checking/journal/a1/segments/s2.action.json')).toBe('own 2, saved after the apply began');
      expect(live.get('audio/TIT/1.mp3')).toBe('own audio');
    }
  });

  it('[G8] a run again deletes a file already gone without an error (HTTP 400 "No such file: <path>")', async () => {
    const repos = { [SCRATCH]: scratchFiles(), [REPO]: liveFiles() };
    await expect(applyScratch(fakeApi(repos, { listGone: ['checking/translationWords/JON.json'] }), REPO, SCRATCH)).resolves.toMatchObject({ removed: 2 });
  });
});

