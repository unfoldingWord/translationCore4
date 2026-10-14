// Open a project from Door43 (issue #677, layer 4 of epic #24) over the fake rig
// (test/helpers/journalingRig.ts): computer A shares a project; computer B (its own
// installation store) opens it under a name. Each refusal asserts its code and that
// no repository was written: the same repositories, byte for byte, and no clone left.
import { afterEach, describe, expect, it } from 'vitest';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues, inProjectQueue } from '../../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../../src/data/journal/journalStore';
import { actorIdFor } from '../../src/data/journal/identity';
import { OpsLog, forgetRunningOpens, openRunning, serialSettingsWriter } from '../../src/data/journal/opsLog';
import { runImport } from '../../src/data/import/shell';
import { FAKE_PARSER } from '../../src/data/import/parsers';
import { reportError } from '../../src/data/journal/runtime';
import { openDefaultName, openFromDoor43, openFromDoor43Asking, openRepoPathOf, openSourceOf, sync, withClonePath, type CloneSource } from '../../src/data/share/syncOperation';
import { journalingRig, memKv, tickingNow, type JournalingRig } from '../helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const URL_ = 'https://qa.door43.org/facilitator/prueba';
const CLONE_PATH = 'qa.door43.org/facilitator/prueba';
const SOURCE: CloneSource = { host: 'qa.door43.org', org: 'facilitator', repo: 'prueba' };
const OPENED = '_local_/_local_/prueba_b';
// The scratch path names the WHOLE project path (archiveNameOf: '-' becomes '-d', '/' becomes '-s').
const SCRATCH = '_local_/_archive_/tc4-open--_local_-s_local_-sprueba_b';
const usfm = (v1: string) => ['\\id TIT prueba', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', `\\v 1 ${v1}`, '\\v 2 ___', ''].join('\n');

interface World {
  rig: JournalingRig;
  api: ServerApi;
  /** computer A's actor id */
  actorA: string;
  /** computer B's installation store */
  kvB: ReturnType<typeof memKv>;
}

/** Computer A drafts TIT 1:1, checkpoints and shares the project to Door43. */
async function world(): Promise<World> {
  forgetSharedClocks();
  forgetProjectQueues();
  const rig = journalingRig();
  const clock = tickingNow('2026-10-13T09:00:00.000Z');
  const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
  const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
  await store.createProject({ content_name: 'Prueba', content_abbr: 'prueba', content_language_code: 'es', add_book: false, versification: 'eng' });
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: usfm('Pablo, siervo.') });
  await store.commit('first (tC4)');
  rig.publish(REPO, URL_);
  const actorA = store.actorId;
  store.dispose();
  return { rig, api, actorA, kvB: memKv() };
}

/** Every repository and its files, to compare before and after a refusal. */
const snapshot = (rig: JournalingRig) =>
  new Map([...rig.repos].map(([path, project]) => [path, new Map(project.files)]));
const journalOf = (files: Map<string, string>) => [...files].filter(([p]) => p.startsWith('checking/journal/'));
const actorsOf = (files: Map<string, string>) => new Set(journalOf(files).map(([p]) => p.split('/')[2]));
/** A git request that writes: a clone, a copy or move, a delete. */
const gitWrite = (entry: { route: string }) => /^\/api\/git\/(clone-repo|copy|delete)\//.test(entry.route);
const refusalOf = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; facts?: Record<string, unknown> };
  }
  throw new Error('the open did not refuse');
};

/** True while the log holds an open record of the open of `repoPath` (at `phase`, when given). */
const openRecord = (ops: OpsLog, repoPath: string, phase?: string): boolean =>
  ops.entries.some((e) => e.op === 'open-door43' && !e.report && e.facts.repoPath === repoPath && (phase === undefined || e.facts.phase === phase));

afterEach(() => {
  forgetSharedClocks();
  forgetProjectQueues();
  forgetRunningOpens();
});

describe('#677 open a project from Door43', () => {
  it('opens a public project under a name, with the text of Door43 main, a new actor id and its origin', async () => {
    const w = await world();
    const { repoPath } = await openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' });
    expect(repoPath).toBe(OPENED);
    const remote = w.rig.remotes.get(URL_)!;
    const opened = w.rig.repos.get(OPENED)!;
    // the same text and the same journal as Door43 main
    expect(opened.files.get('TIT.usfm')).toBe(remote.files.get('TIT.usfm'));
    expect(journalOf(opened.files)).toEqual(journalOf(remote.files));
    // no scratch copy and no clone path are left; the shared project is unchanged
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    // `origin` names the Door43 repository, so the card reads "Sync with Door43" (#678)
    expect(opened.origin).toBe(URL_);
    // a new actor id: identity is per path (D53(c)), and computer B's id is not in the journal
    const actorB = await actorIdFor(w.kvB, OPENED);
    expect(actorB).not.toBe(w.actorA);
    expect(actorsOf(opened.files).has(actorB)).toBe(false);
    // the project opens on computer B, and its first sync needs no extra step
    const storeB = new JournalingStore({ api: w.api, kv: w.kvB });
    await storeB.open(OPENED);
    expect(storeB.actorId).toBe(actorB);
    await storeB.writeBook('TIT', usfm('Pablo, siervo de Dios.'));
    await storeB.commit('B drafts (tC4)');
    storeB.dispose();
    const ops = new OpsLog({ read: async () => ({}), update: serialSettingsWriter(async () => ({}), async () => {}) });
    await ops.recover(w.api);
    const report = await sync(
      { api: w.api, kv: w.kvB, door43Server: 'https://qa.door43.org', coverage: {}, ops },
      { repoPath: OPENED, session: { username: 'translator_b', token: 'tok-677' } },
    );
    expect([report.ok, report.code]).toEqual([true, undefined]);
    expect(actorsOf(remote.files).has(actorB)).toBe(true);
  });

  it('[G2] open refuses an invalid file', async () => {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    const segment = journalOf(remote.files).find(([p]) => p.includes('/segments/'))![0];
    remote.files.set(segment, '{"not":"a sealed segment"}\n');
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('sync.incoming-invalid');
    expect((refusal.facts?.failures as Array<{ path: string }>).map((f) => f.path)).toEqual([segment]);
    // no repository was written: the same repositories, byte for byte; no project, scratch copy or clone
    expect(snapshot(w.rig)).toEqual(before);
    expect(await w.api.listLocalRepos()).not.toContain(OPENED);
  });

  it('open refuses a name in use', async () => {
    const w = await world();
    const before = snapshot(w.rig);
    const start = w.rig.log.length;
    // the same name, and the same name in another case (one folder on macOS and Windows)
    for (const name of ['prueba', 'Prueba']) {
      const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: SOURCE, name }));
      expect(refusal.code, name).toBe('open-door43.name-exists');
    }
    // nothing was written, and nothing was asked of Door43: the check is local and comes first
    expect(snapshot(w.rig)).toEqual(before);
    expect(w.rig.log.slice(start).filter(gitWrite)).toEqual([]);
    // control: an open under a free name does ask for the clone
    await openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' });
    expect(w.rig.log.slice(start).filter(gitWrite).some((e) => e.route.startsWith('/api/git/clone-repo/'))).toBe(true);
  });

  it('open refuses with the internet off, before any clone', async () => {
    const w = await world();
    w.rig.setNet(false);
    const before = snapshot(w.rig);
    const offline = { getNetEnabled: async () => false };
    const api = Object.assign(Object.create(w.api), offline) as ServerApi;
    const refusal = await refusalOf(openFromDoor43({ api }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('sync.offline');
    expect(snapshot(w.rig)).toEqual(before);
  });

  it('open asks for the internet', async () => {
    const w = await world();
    w.rig.setNet(false);
    let on = false;
    const api = Object.assign(Object.create(w.api), { getNetEnabled: async () => on }) as ServerApi;
    const before = snapshot(w.rig);
    // Not now: the question was asked once, the open did not run, and nothing was written
    const asked: string[] = [];
    const notNow = async () => {
      asked.push('open');
      return undefined;
    };
    expect(await openFromDoor43Asking({ api, ask: notNow }, { source: SOURCE, name: 'prueba_b' })).toBeUndefined();
    expect(asked).toEqual(['open']);
    expect(snapshot(w.rig)).toEqual(before);
    // a name in use refuses before the question: nothing is asked
    await expect(openFromDoor43Asking({ api, ask: notNow }, { source: SOURCE, name: 'prueba' })).rejects.toMatchObject({ code: 'open-door43.name-exists' });
    expect(asked).toEqual(['open']);
    // Turn on internet: the open runs after the yes
    const turnOn = async (run: () => Promise<{ repoPath: string }>) => {
      on = true;
      w.rig.setNet(true);
      return run();
    };
    expect(await openFromDoor43Asking({ api, ask: turnOn }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    expect(w.rig.repos.has(OPENED)).toBe(true);
  });

  it('an Open Bible Stories project refuses (Bible only, D98), and no repository is written', async () => {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    (remote.meta as { type: unknown }).type = { flavorType: { name: 'gloss', flavor: { name: 'textStories' } } };
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('sync.obs-unsupported');
    expect(snapshot(w.rig)).toEqual(before);
  });

  it('a repository that is not on Door43 refuses sync.clone-failed, and no repository is written', async () => {
    const w = await world();
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: { ...SOURCE, repo: 'missing' }, name: 'prueba_b' }));
    expect(refusal.code).toBe('sync.clone-failed');
    expect(snapshot(w.rig)).toEqual(before);
  });
});

describe('#677 the dialog fields', () => {
  it('reads owner/repo and links on the Door43 server only; file:// only on the rig', () => {
    const server = 'https://git.door43.org';
    expect(openSourceOf('anna_k/titus-team-draft', server)).toEqual({ host: 'git.door43.org', org: 'anna_k', repo: 'titus-team-draft' });
    expect(openSourceOf(' https://git.door43.org/anna_k/titus-team-draft.git/ ', server)).toEqual({ host: 'git.door43.org', org: 'anna_k', repo: 'titus-team-draft' });
    expect(openSourceOf('https://example.org/anna_k/titus', server)).toBeNull();
    expect(openSourceOf('https://user:pw@git.door43.org/anna_k/titus', server)).toBeNull();
    expect(openSourceOf('anna_k', server)).toBeNull();
    expect(openSourceOf('file:///tmp/x/anna_k/titus.git', server)).toBeNull();
    expect(openSourceOf('file:///tmp/x/anna_k/titus.git', server, true)).toEqual({ host: 'file', org: 'anna_k', repo: 'titus' });
  });

  it('a project name is one folder name of letters, numbers, hyphens and underscores', () => {
    expect(openRepoPathOf('titus-team-draft')).toBe('_local_/_local_/titus-team-draft');
    for (const bad of ['', ' ', 'a b', '../x', 'a/b', '.hidden', 'x.y', 'ñandú']) expect(openRepoPathOf(bad), bad).toBeNull();
  });

  it('the default name of a valid repository name is always a valid project name', () => {
    expect(openDefaultName('titus-team-draft')).toBe('titus-team-draft');
    expect(openDefaultName('en_ult.v2')).toBe('en_ult-v2');
    expect(openDefaultName('.hidden.repo')).toBe('hidden-repo');
    for (const repo of ['titus-team-draft', 'en_ult.v2', '.hidden.repo', 'a..b', 'x.y.z', 'repo-1.0'])
      expect(openRepoPathOf(openDefaultName(repo)), repo).not.toBeNull();
  });
});

describe('#677 a repository that is not a tC4 project', () => {
  it('a repository with no tC4 journal refuses open-door43.no-journal, and no repository is written', async () => {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    for (const p of [...remote.files.keys()]) if (p.startsWith('checking/journal/')) remote.files.delete(p);
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('open-door43.no-journal');
    expect(snapshot(w.rig)).toEqual(before);
  });
});

// ---- crash recovery of the open (G8 class): the ops log records each phase ----

/** The client-settings document; `hang` makes every later write never settle (a kill). */
function settingsDoc() {
  let doc: Record<string, unknown> = {};
  let hung = false;
  const read = async () => structuredClone(doc);
  const write = async (next: Record<string, unknown>) => {
    if (hung) return new Promise<void>(() => {});
    doc = structuredClone(next);
  };
  return { read, write, get: () => doc, hang: () => (hung = true) };
}
const startApp = async (settings: ReturnType<typeof settingsDoc>, api: ServerApi) => {
  forgetRunningOpens(); // a start is a new process
  forgetProjectQueues(); // and its locks (the clone-path lock is a project-queue key)
  const ops = new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });
  const resolved = await ops.recover(api);
  return { ops, resolved };
};
/** Server calls that make or move or delete a folder. */
const folderCall = (route: string) => /^\/api\/git\/(clone-repo|copy|delete)\//.test(route);

describe('#677 crash recovery of the open (G8 class)', () => {
  /** Run one open and kill it after (or, with `inside`, during) the `k`-th folder call:
   * every later request and settings write never settles. A kill inside a copy
   * leaves half of the source's files at the target; inside a delete, half of the files. */
  async function killOpen(k: number, inside = false) {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    let seen = 0;
    let killed = false;
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      if (inside && folderCall(url.pathname) && seen + 1 === k) {
        killed = true;
        settings.hang();
        const repo = url.pathname.split('/').slice(4, 7).map(decodeURIComponent).join('/');
        const source = w.rig.repos.get(repo);
        const half = <T,>(m: Map<string, T>) => [...m].slice(0, Math.ceil(m.size / 2));
        if (source && url.pathname.includes('/git/copy/'))
          w.rig.repos.set(url.searchParams.get('target_path')!, { files: new Map(half(source.files)), meta: structuredClone(source.meta), commits: [], dirty: new Set() });
        if (source && url.pathname.includes('/git/delete/')) source.files = new Map(half(source.files));
        return new Promise<Response>(() => {});
      }
      const response = await w.rig.fetchFn(input, init);
      if (folderCall(url.pathname) && (seen += 1) === k) {
        killed = true;
        settings.hang();
      }
      return response;
    }) as typeof fetch });
    const logStart = w.rig.log.length; // the open's own calls only, not the setup's
    const run = openFromDoor43({ api: dying, ops }, { source: SOURCE, name: 'prueba_b' });
    const done = await Promise.race([run.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 200))]);
    return { w, settings, killed, done, openLog: w.rig.log.slice(logStart) };
  }

  /** The next start over the stored document; then the state of the folders. */
  async function restart(w: World, settings: ReturnType<typeof settingsDoc>) {
    const stored = settingsDoc();
    await stored.write(structuredClone(settings.get()));
    const { ops, resolved } = await startApp(stored, w.api);
    return { ops, resolved };
  }

  /** After recovery: no clone and no scratch copy; the project is whole, or not there. */
  function expectWholeOrNone(w: World): boolean {
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    const opened = w.rig.repos.get(OPENED);
    if (!opened) return false;
    expect(opened.files).toEqual(w.rig.remotes.get(URL_)!.files);
    return true;
  }

  it('[G8] a kill after the clone: the next start deletes the clone path and the scratch copy, and the same repository opens again', async () => {
    const dry = await killOpen(Infinity);
    expect(dry.done).toBe(true);
    const cloneCall = dry.openLog.filter((l) => folderCall(l.route)).findIndex((l) => l.route.startsWith('/api/git/clone-repo/')) + 1;
    expect(cloneCall).toBeGreaterThan(0);
    const { w, settings, killed, done } = await killOpen(cloneCall);
    expect([killed, done]).toEqual([true, false]);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(true);
    const { ops, resolved } = await restart(w, settings);
    expect(resolved.map((e) => e.op)).toEqual(['open-door43']);
    expect(reportError(resolved[0].report)).toBeNull();
    expect(resolved[0].report).toMatchObject({ ok: false, facts: { phase: 'clone', rolledBack: true } });
    expect(expectWholeOrNone(w)).toBe(false);
    // the same repository opens again: no sync.clone-path-exists
    expect(await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    expect(expectWholeOrNone(w)).toBe(true);
  });

  it('[G8] kill sweep after and inside each folder call: the project is whole or not there, and nothing is left behind', async () => {
    const dry = await killOpen(Infinity);
    const total = dry.openLog.filter((l) => folderCall(l.route)).length;
    expect(total).toBeGreaterThanOrEqual(3); // the stale-scratch delete, the clone, the moves
    let whole = 0;
    let none = 0;
    for (const inside of [false, true])
      for (let k = 1; k <= total; k += 1) {
        const { w, settings, killed } = await killOpen(k, inside);
        expect(killed, `kill ${k} inside=${inside}`).toBe(true);
        const { ops, resolved } = await restart(w, settings);
        for (const entry of resolved) expect(reportError(entry.report), `kill ${k}`).toBeNull();
        if (expectWholeOrNone(w)) whole += 1;
        else {
          none += 1;
          // nothing blocks a new open of the same repository
          expect(await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' }), `kill ${k} inside=${inside}`).toEqual({ repoPath: OPENED });
          expect(expectWholeOrNone(w)).toBe(true);
        }
      }
    expect(whole).toBeGreaterThanOrEqual(1);
    expect(none).toBeGreaterThanOrEqual(1);
  });

  it('the open is refused until the ops log has loaded at this start (opslog.not-loaded)', async () => {
    const w = await world();
    const settings = settingsDoc();
    const ops = new OpsLog({ read: settings.read, update: serialSettingsWriter(settings.read, settings.write) });
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('opslog.not-loaded');
    const asked = await refusalOf(openFromDoor43Asking({ api: w.api, ops, ask: async (run) => run() }, { source: SOURCE, name: 'prueba_b' }));
    expect(asked.code).toBe('opslog.not-loaded');
    expect(snapshot(w.rig)).toEqual(before);
  });

  it('an ok open and a refused open each close their record', async () => {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' });
    await refusalOf(openFromDoor43({ api: w.api, ops }, { source: { ...SOURCE, repo: 'missing' }, name: 'prueba_c' }));
    const entries = ops.entries.filter((e) => e.op === 'open-door43');
    expect(entries.map((e) => [e.report?.ok, e.report?.code])).toEqual([[true, undefined], [false, 'sync.clone-failed']]);
    for (const e of entries) expect(reportError(e.report)).toBeNull();
  });
});

/** A settings document whose writes can fail on demand (not a kill: the app runs on). */
function failingSettingsDoc() {
  let doc: Record<string, unknown> = {};
  let failing = false;
  const read = async () => structuredClone(doc);
  const write = async (next: Record<string, unknown>) => {
    if (failing) throw new Error('settings write failed');
    doc = structuredClone(next);
  };
  return { read, write, get: () => doc, fail: (on: boolean) => (failing = on) };
}
const appOver = (s: { read: () => Promise<Record<string, unknown>>; write: (d: Record<string, unknown>) => Promise<void> }) =>
  (forgetRunningOpens(), forgetProjectQueues(), new OpsLog({ read: s.read, update: serialSettingsWriter(s.read, s.write) }));

describe('#677 the open never loses a project that opened (review B1, B2)', () => {
  it('[B1] the ops writes fail after the copy: the open is ok, the user edits, and the next start keeps the edited project', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    api.copyRepo = async (from: string, to: string, del?: boolean) => {
      await w.api.copyRepo(from, to, del);
      if (to === OPENED) s.fail(true); // every settings write after the copy fails
    };
    expect(await openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    s.fail(false);
    // the stored record still names move.copy: the later writes failed
    expect((s.get().opsLog as Array<{ facts: { phase?: string }; report?: unknown }>).find((e) => !e.report)?.facts.phase).toBe('move.copy');
    // the user edits the opened project in this session
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await store.open(OPENED);
    await store.writeBook('TIT', usfm('EDITED BY USER'));
    await store.commit('user edit (tC4)');
    store.dispose();
    // the next start keeps the project and the edit
    forgetProjectQueues();
    const resolved = await appOver(s).recover(w.api);
    expect(resolved.map((e) => [e.op, e.report?.ok])).toEqual([['open-door43', true]]);
    expect(reportError(resolved[0].report)).toBeNull();
    expect(w.rig.repos.get(OPENED)?.files.get('TIT.usfm')).toContain('EDITED BY USER');
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });

  it('a cleanup that fails keeps the record open, and the next start finishes it', async () => {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    const segment = journalOf(remote.files).find(([p]) => p.includes('/segments/'))![0];
    remote.files.set(segment, '{"not":"a sealed segment"}\n');
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    let deletes = 0;
    api.deleteRepo = async (p: string) => {
      // the stale-scratch delete at the start passes; the cleanup after the refusal fails
      if (p === SCRATCH && deletes++ === 1) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.deleteRepo(p);
    };
    expect((await refusalOf(openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' }))).code).toBe('sync.incoming-invalid');
    expect(w.rig.repos.has(SCRATCH)).toBe(true);
    expect(openRecord(ops, OPENED)).toBe(true);
    const resolved = await appOver(s).recover(w.api);
    expect(resolved.map((e) => [e.op, e.report?.ok])).toEqual([['open-door43', false]]);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.has(OPENED)).toBe(false);
  });

  it('[B3] a part copy whose delete fails: the scratch copy stays, the record stays open, and the next start deletes the part project', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    api.copyRepo = async (from: string, to: string, del?: boolean) => {
      await w.api.copyRepo(from, to, del);
      if (to === OPENED) {
        w.rig.repos.get(OPENED)!.files.delete('TIT.usfm'); // a part copy
        throw Object.assign(new Error('server 500'), { status: 500 });
      }
    };
    api.deleteRepo = async (p: string) => {
      if (p === OPENED) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.deleteRepo(p);
    };
    expect((await refusalOf(openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' }))).code).toBe('sync.move-failed');
    expect(openRecord(ops, OPENED, 'move.copy')).toBe(true);
    // the next start, with a healthy server: the part project is not certified
    forgetProjectQueues();
    const ops2 = appOver(s);
    const resolved = await ops2.recover(w.api);
    expect(resolved.map((e) => [e.op, e.report?.ok])).toEqual([['open-door43', false]]);
    expect(w.rig.repos.has(OPENED)).toBe(false);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(await openFromDoor43({ api: w.api, ops: ops2 }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
  });

  it('[B4] a clone whose move and delete fail: the record stays open, and the next start deletes the clone path so the open runs again', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    api.copyRepo = async (from: string, to: string, del?: boolean) => {
      if (from === CLONE_PATH) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.copyRepo(from, to, del);
    };
    api.deleteRepo = async (p: string) => {
      if (p === CLONE_PATH) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.deleteRepo(p);
    };
    expect((await refusalOf(openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' }))).code).toBe('sync.move-failed');
    expect(w.rig.repos.has(CLONE_PATH)).toBe(true);
    expect(openRecord(ops, OPENED, 'clone')).toBe(true);
    forgetProjectQueues();
    const ops2 = appOver(s);
    const resolved = await ops2.recover(w.api);
    expect(resolved.map((e) => [e.op, e.report?.ok])).toEqual([['open-door43', false]]);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    expect(await openFromDoor43({ api: w.api, ops: ops2 }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
  });

  // [B5] (bench round 4) expected "not ok, and the next start removes the project" when the
  // delete-scratch phase did not save and the scratch delete failed. Under the disk design
  // that outcome is wrong: the scratch marker is deleted only after the copy returned ok, so
  // the copy is proved finished and the open IS ok. The test that replaces it is
  // "[disk] a finished open with failed later cleanups is ok" below.

  it('[B1] a record for a path that holds a project and no marker deletes nothing of that project', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    // a record that a killed open left at move.copy (any facts), for a path that held a project already;
    // its scratch copy has no marker
    const scratch = '_local_/_archive_/tc4-open--_local_-s_local_-sprueba';
    const record = await ops.begin('open-door43', { repoPath: REPO, scratch, source: CLONE_PATH });
    await record.note({ phase: 'move.copy', targetAbsent: true, liveMark: '' });
    await w.api.copyRepo(REPO, scratch);
    const before = new Map(w.rig.repos.get(REPO)!.files);
    await appOver(s).recover(w.api);
    expect(w.rig.repos.get(REPO)!.files).toEqual(before);
    expect(w.rig.repos.has(scratch)).toBe(false);
  });

  it('[B2] a recovery that fails at start: the gate removes the part copy before any open or sync, and the repository opens again', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    api.copyRepo = async (from: string, to: string, del?: boolean) => {
      await w.api.copyRepo(from, to, del);
      if (to === OPENED) await new Promise(() => {}); // killed after the copy, before the scratch marker goes
    };
    void openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' });
    await new Promise((r) => setTimeout(r, 200));
    expect(w.rig.repos.get(SCRATCH)!.files.has(MARKER)).toBe(true);
    expect(w.rig.repos.has(OPENED)).toBe(true);
    // start 2: the recovery's delete of the project fails once
    forgetProjectQueues();
    const flaky = Object.create(w.api) as ServerApi;
    let n = 0;
    flaky.deleteRepo = async (p: string) => {
      if (p === OPENED && n++ === 0) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.deleteRepo(p);
    };
    const ops2 = appOver(s);
    await ops2.recover(flaky);
    expect(ops2.errors.map((e) => e.op)).toEqual(['open-door43']);
    expect(w.rig.repos.has(OPENED)).toBe(true);
    // no sync: the gate reads the marker, removes the copy that is not proved whole, and refuses
    const refused = await sync(
      { api: w.api, kv: w.kvB, door43Server: 'https://qa.door43.org', coverage: {}, ops: ops2 },
      { repoPath: OPENED, session: { username: 'translator_b', token: 'tok-677' } },
    );
    expect([refused.ok, refused.code]).toEqual([false, 'open-door43.removed']);
    expect(w.rig.repos.has(OPENED)).toBe(false);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    // the repository opens again
    forgetProjectQueues();
    expect(await openFromDoor43({ api: w.api, ops: ops2 }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
  });

  it('[B2] the gate on open: a part copy left with no record is removed, never opened', async () => {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    // a part copy at the project path and the marked scratch copy; the record was lost
    await w.api.copyRepo(REPO, SCRATCH);
    await w.api.writeIngredient(SCRATCH, MARKER, '{"open":"_local_/_local_/prueba_b"}', { updateIngredients: false, keepBak: false });
    await w.api.copyRepo(SCRATCH, OPENED);
    w.rig.repos.get(OPENED)!.files.delete('TIT.usfm');
    w.rig.repos.get(OPENED)!.files.delete(MARKER); // the copy stopped before the marker
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await expect(store.open(OPENED)).rejects.toMatchObject({ code: 'open-door43.removed' });
    store.dispose();
    expect(w.rig.repos.has(OPENED)).toBe(false);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });

  it('[B2] the gate on open: a whole copy whose markers were not all deleted finishes forward and opens', async () => {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    // the copy finished and the scratch marker went; the project marker and the scratch copy stay
    await w.api.copyRepo(REPO, SCRATCH);
    await w.api.writeIngredient(SCRATCH, MARKER, '{"open":"_local_/_local_/prueba_b"}', { updateIngredients: false, keepBak: false });
    await w.api.copyRepo(SCRATCH, OPENED);
    await w.api.deleteIngredient(SCRATCH, MARKER);
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await store.open(OPENED);
    store.dispose();
    expect(w.rig.repos.get(OPENED)!.files.has(MARKER)).toBe(false);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
  });
});

// ---- recovery and the gate decide from the disk only (the settings document is not load-bearing) ----

const MARKER = 'tc4-open/move.json';
/** A server call of the open that changes the disk: a folder call, or a marker write or delete. */
const diskCall = (route: string, method: string) =>
  folderCall(route) || (method === 'POST' && /^\/api\/burrito\/ingredient\/(raw|delete)\//.test(route));
type SettingsAfterKill = 'kept' | 'erased' | 'regressed';

describe('#677 the open recovers from the disk only', () => {
  /** Run one open and kill it after (or inside) the `k`-th disk call; then change the
   * stored settings as a lost update or a torn read would: `erased` (no ops log at all),
   * or `regressed` (the open record goes back to its first phase and loses its facts). */
  async function killAt(k: number, inside: boolean, after: SettingsAfterKill) {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    let seen = 0;
    let killed = false;
    const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (killed) return new Promise<Response>(() => {});
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (inside && diskCall(url.pathname, method) && seen + 1 === k) {
        killed = true;
        settings.hang();
        const repo = url.pathname.split('/').slice(4, 7).map(decodeURIComponent).join('/');
        const source = w.rig.repos.get(repo);
        const half = <T,>(m: Map<string, T>) => [...m].slice(0, Math.ceil(m.size / 2));
        if (source && url.pathname.includes('/git/copy/'))
          w.rig.repos.set(url.searchParams.get('target_path')!, { files: new Map(half(source.files)), meta: structuredClone(source.meta), commits: [], dirty: new Set() });
        if (source && url.pathname.includes('/git/delete/')) source.files = new Map(half(source.files));
        return new Promise<Response>(() => {});
      }
      const response = await w.rig.fetchFn(input, init);
      if (diskCall(url.pathname, method) && (seen += 1) === k) {
        killed = true;
        settings.hang();
      }
      return response;
    }) as typeof fetch });
    const logStart = w.rig.log.length;
    const run = openFromDoor43({ api: dying, ops }, { source: SOURCE, name: 'prueba_b' });
    await Promise.race([run.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 200))]);
    const openCalls = w.rig.log.slice(logStart).filter((l) => diskCall(l.route, l.method)).length;
    const stored = structuredClone(settings.get()) as { opsLog?: Array<{ op: string; facts: Record<string, unknown>; report?: unknown }> };
    if (after === 'erased') delete stored.opsLog;
    if (after === 'regressed')
      for (const e of stored.opsLog ?? []) if (e.op === 'open-door43' && !e.report) e.facts = { repoPath: e.facts.repoPath, phase: 'start' };
    return { w, stored, killed, openCalls, partial: w.rig.repos.has(OPENED) && !sameFiles(w, OPENED) };
  }
  const sameFiles = (w: World, repo: string) => {
    const files = new Map(w.rig.repos.get(repo)!.files);
    files.delete(MARKER);
    return JSON.stringify([...files].sort()) === JSON.stringify([...w.rig.remotes.get(URL_)!.files].sort());
  };

  /** The next start over `stored`, then the translator opens the project if Home lists it.
   * The project is whole and opens, or the open refuses and the project is gone. Never a
   * part project that opens. Then the same repository opens again. */
  async function restartAndCheck(w: World, stored: Record<string, unknown>, label: string) {
    const doc = settingsDoc();
    await doc.write(stored);
    forgetProjectQueues();
    const { ops } = await startApp(doc, w.api);
    let opened = false;
    if (w.rig.repos.has(OPENED)) {
      // judged before the open: an open legally rewrites some derived files
      const wholeBefore = sameFiles(w, OPENED);
      const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
      try {
        await store.open(OPENED);
        opened = true;
      } catch (error) {
        expect((error as { code?: string }).code, label).toBe('open-door43.removed');
      }
      store.dispose();
      if (opened) {
        expect(wholeBefore, `${label}: the project that opened is whole`).toBe(true);
        expect(w.rig.repos.get(OPENED)!.files.has(MARKER), `${label}: no marker in an opened project`).toBe(false);
      } else expect(w.rig.repos.has(OPENED), `${label}: a refused part project is gone`).toBe(false);
    }
    if (!opened) {
      forgetProjectQueues();
      // the same repository opens again, also over a clone path left with no record:
      // the clone (#676 `cloneProject`) deletes it under the clone-path lock
      expect(await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' }), label).toEqual({ repoPath: OPENED });
      expect(sameFiles(w, OPENED), label).toBe(true);
      expect(w.rig.repos.has(CLONE_PATH), label).toBe(false);
    }
    return opened;
  }

  it('[disk] kill sweep over every disk call, with the settings kept, erased or regressed: whole and openable, or absent', async () => {
    const dry = await killAt(Infinity, false, 'kept');
    const total = dry.openCalls;
    expect(total).toBeGreaterThanOrEqual(8); // stale delete, clone, move, marker, copy, marker deletes, scratch delete
    expect(dry.w.rig.log.some((l) => l.method === 'POST' && l.route.includes('/ingredient/raw/') && l.route.includes('tc4-open'))).toBe(true);
    let opened = 0;
    let partials = 0;
    let kills = 0;
    for (const after of ['kept', 'erased', 'regressed'] as const)
      for (const inside of [false, true])
        for (let k = 1; k <= total; k += 1) {
          const { w, stored, killed, partial } = await killAt(k, inside, after);
          const label = `kill ${k} inside=${inside} settings=${after}`;
          if (killed) kills += 1;
          if (partial) partials += 1;
          if (await restartAndCheck(w, stored, label)) opened += 1;
        }
    expect(kills).toBe(total * 6); // every disk call is killed, after it and inside it, under each settings case
    expect(opened).toBeGreaterThanOrEqual(1);
    expect(partials).toBeGreaterThanOrEqual(1); // the sweep reaches part copies at the project path
  }, 120_000);

  it('[disk] a finished open with failed later cleanups is ok, and the project opens (reverses bench B5)', async () => {
    const w = await world();
    const s = failingSettingsDoc();
    const ops = appOver(s);
    await ops.recover(w.api);
    const api = Object.create(w.api) as ServerApi;
    let copied = false;
    api.copyRepo = async (from: string, to: string, del?: boolean) => {
      await w.api.copyRepo(from, to, del);
      if (to === OPENED) {
        copied = true;
        s.fail(true); // every settings write after the copy fails
      }
    };
    api.deleteRepo = async (p: string) => {
      if (copied && p === SCRATCH) throw Object.assign(new Error('server 500'), { status: 500 });
      return w.api.deleteRepo(p);
    };
    expect(await openFromDoor43({ api, ops }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    s.fail(false);
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await store.open(OPENED);
    await store.writeBook('TIT', usfm('EDITED BY USER'));
    await store.commit('user edit (tC4)');
    store.dispose();
    forgetProjectQueues();
    await appOver(s).recover(w.api);
    expect(w.rig.repos.get(OPENED)?.files.get('TIT.usfm')).toContain('EDITED BY USER');
  });

  it('[disk] a marked scratch copy beside a project that is not its copy deletes nothing: the open refuses', async () => {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    // the translator's own project at the path (the create cleared any stale scratch first) ...
    const clock = tickingNow('2026-10-14T09:00:00.000Z');
    const mine = new JournalingStore({ api: w.api, kv: w.kvB, ops, now: () => clock.advance(7) });
    await mine.createProject({ content_name: 'Mine', content_abbr: 'prueba_b', content_language_code: 'es', add_book: false, versification: 'eng' });
    mine.dispose();
    // ... and then a marked scratch copy of a different project for that path (defense in depth)
    await w.api.copyRepo(REPO, SCRATCH);
    await w.api.writeIngredient(SCRATCH, MARKER, '{"open":"_local_/_local_/prueba_b"}', { updateIngredients: false, keepBak: false });
    const before = new Map(w.rig.repos.get(OPENED)!.files);
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await expect(store.open(OPENED)).rejects.toMatchObject({ code: 'open-door43.pending' });
    store.dispose();
    expect(w.rig.repos.get(OPENED)!.files).toEqual(before);
  });
});

describe('#677 a clone left at the fixed path', () => {
  it('a clone left with no record (a stop, then the record lost) does not block the next open of the repository', async () => {
    const w = await world();
    const { ops } = await startApp(settingsDoc(), w.api);
    // a stop between the clone and its move, and the settings lost: a folder at the
    // fixed clone path that no record names
    expect(await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    w.rig.repos.set(CLONE_PATH, structuredClone(w.rig.repos.get(OPENED)!));
    await w.api.deleteRepo(OPENED);
    expect((await w.api.listLocalRepos()).includes(CLONE_PATH)).toBe(true);
    expect(ops.entries.filter((e) => !e.report)).toEqual([]);
    // control: the left folder blocks a plain clone (the platform answers code=Exists)
    const blocked = (await refusalOf(w.api.cloneRepo(SOURCE.host, SOURCE.org, SOURCE.repo))) as { reason?: string; message?: string };
    expect(`${blocked.reason ?? ''} ${blocked.message ?? ''}`).toMatch(/code=Exists/);
    // the next open of the same repository succeeds, and the left clone is gone
    const { ops: next } = await startApp(settingsDoc(), w.api);
    expect(await openFromDoor43({ api: w.api, ops: next }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    expect(w.rig.repos.get(OPENED)!.files).toEqual(w.rig.remotes.get(URL_)!.files);
  });
});

describe('#677 the clone-path lock (#676 `withClonePath`, shared with the sync)', () => {
  it('calls for one clone path run one at a time, a failure frees the lock, and another path does not wait', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const first = withClonePath('qa.door43.org/facilitator/prueba', async () => {
      order.push('first start');
      await gate;
      order.push('first end');
      throw new Error('first failed');
    });
    const second = withClonePath('qa.door43.org/facilitator/prueba', async () => void order.push('second'));
    // control: another clone path does not wait for the first
    await withClonePath('qa.door43.org/facilitator/otra', async () => void order.push('other path'));
    expect(order).toEqual(['first start', 'other path']);
    release();
    await expect(first).rejects.toThrow('first failed');
    await second;
    expect(order).toEqual(['first start', 'other path', 'first end', 'second']);
  });

  it('lock order (#676): the open clones under the clone-path lock and never waits on a project queue', async () => {
    const w = await world();
    const settle = (run: Promise<unknown>) => Promise.race([run.then(() => 'done'), new Promise((r) => setTimeout(() => r('waits'), 500))]);
    // the project queues of the target and of the shared project are held (a sync holds its queue when it clones)
    let releaseQueues: () => void = () => {};
    const queuesHeld = new Promise<void>((r) => (releaseQueues = r));
    const queues = [inProjectQueue(OPENED, () => queuesHeld), inProjectQueue(REPO, () => queuesHeld)];
    expect(await settle(openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' }))).toBe('done');
    releaseQueues();
    await Promise.all(queues);
    // control: while the clone-path lock is held, the open waits for it
    await w.api.deleteRepo(OPENED);
    let releaseLock: () => void = () => {};
    const lockHeld = new Promise<void>((r) => (releaseLock = r));
    const lock = withClonePath(CLONE_PATH, () => lockHeld);
    const open = openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' });
    expect(await settle(open)).toBe('waits');
    releaseLock();
    await lock;
    expect(await open).toEqual({ repoPath: OPENED });
  });
});

describe('#677 a stale open never blocks a project made later at that path (the create chokepoint)', () => {
  /** A killed open left its marked scratch copy and no project; its record was lost. */
  async function staleMarkedScratch() {
    const w = await world();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    await w.api.copyRepo(REPO, SCRATCH);
    await w.api.writeIngredient(SCRATCH, MARKER, '{"open":"_local_/_local_/prueba_b"}', { updateIngredients: false, keepBak: false });
    expect(w.rig.repos.has(OPENED)).toBe(false);
    return { w, ops };
  }

  it('a New Bible with the same name is created and opens; the stale scratch copy is gone', async () => {
    const { w, ops } = await staleMarkedScratch();
    const clock = tickingNow('2026-10-14T09:00:00.000Z');
    const mine = new JournalingStore({ api: w.api, kv: w.kvB, ops, now: () => clock.advance(7) });
    await mine.createProject({ content_name: 'Mine', content_abbr: 'prueba_b', content_language_code: 'es', add_book: false, versification: 'eng' });
    mine.dispose();
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await store.open(OPENED);
    store.dispose();
  });

  it('an Import with the same name is made and opens; the stale scratch copy is gone', async () => {
    const { w, ops } = await staleMarkedScratch();
    const clock = tickingNow('2026-10-14T09:00:00.000Z');
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops, now: () => clock.advance(7) });
    const file = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) });
    const book = ['\\id TIT fake', '\\usfm 3.0', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', '\\v 1 Uno.', ''].join('\n');
    const report = await runImport(FAKE_PARSER, [file('57-TIT.usfm', book)], { name: 'prueba_b', language: 'es-419' }, { api: w.api, store });
    expect([report.ok, report.facts.repoPath]).toEqual([true, OPENED]);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    forgetProjectQueues();
    const again = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await again.open(OPENED);
    again.dispose();
  });

  it('control: while an open from Door43 of that path runs, the create is refused and writes nothing', async () => {
    const { w, ops } = await staleMarkedScratch();
    openRunning.add(OPENED);
    const mine = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await expect(mine.createProject({ content_name: 'Mine', content_abbr: 'prueba_b', content_language_code: 'es', add_book: false, versification: 'eng' }))
      .rejects.toMatchObject({ code: 'open-door43.pending' });
    mine.dispose();
    expect(w.rig.repos.has(OPENED)).toBe(false);
    expect(w.rig.repos.get(SCRATCH)!.files.has(MARKER)).toBe(true);
  });
});

describe('#677 reserved folders that come with Door43 content never reach the project (parity with #676 beforeMove)', () => {
  const SYNC_MARKER = 'tc4-sync/apply.json';
  const RESERVED = [MARKER, 'tc4-open/other.json', SYNC_MARKER];
  /** Door43 main carries files in the reserved folders (a repository someone pushed them to). */
  async function door43WithReservedFiles() {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    for (const ipath of RESERVED) remote.files.set(ipath, '{"from":"door43"}');
    return w;
  }
  const reservedIn = (w: World, repo: string) => [...(w.rig.repos.get(repo)?.files.keys() ?? [])].filter((p) => p.startsWith('tc4-'));

  it('the opened project holds no file of tc4-open/ or tc4-sync/, and it opens', async () => {
    const w = await door43WithReservedFiles();
    const settings = settingsDoc();
    const { ops } = await startApp(settings, w.api);
    expect(await openFromDoor43({ api: w.api, ops }, { source: SOURCE, name: 'prueba_b' })).toEqual({ repoPath: OPENED });
    expect(reservedIn(w, OPENED)).toEqual([]);
    expect(w.rig.repos.has(SCRATCH)).toBe(false);
    expect(w.rig.repos.has(CLONE_PATH)).toBe(false);
    forgetProjectQueues();
    const store = new JournalingStore({ api: w.api, kv: w.kvB, ops });
    await store.open(OPENED);
    store.dispose();
  });

  for (const after of ['kept', 'erased'] as const)
    it(`a kill right after the clone's move (settings ${after}): the scratch copy holds no marker that came with Door43, and nothing is mis-settled`, async () => {
      const w = await door43WithReservedFiles();
      const settings = settingsDoc();
      const { ops } = await startApp(settings, w.api);
      let killed = false;
      const dying = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (killed) return new Promise<Response>(() => {});
        const response = await w.rig.fetchFn(input, init);
        // the move of the clone off the fixed path: the copy from the clone path to the scratch copy
        if (new URL(String(input)).pathname.startsWith(`/api/git/copy/${CLONE_PATH}`)) {
          killed = true;
          settings.hang();
        }
        return response;
      }) as typeof fetch });
      void openFromDoor43({ api: dying, ops }, { source: SOURCE, name: 'prueba_b' });
      await new Promise((r) => setTimeout(r, 200));
      expect(killed).toBe(true);
      expect(w.rig.repos.has(SCRATCH)).toBe(true);
      // the one file that could make a scratch copy look like an unfinished copy did not come along
      expect(reservedIn(w, SCRATCH)).toEqual([]);
      // the next start, with the settings record kept or lost
      const stored = structuredClone(settings.get()) as { opsLog?: unknown };
      if (after === 'erased') delete stored.opsLog;
      const doc = settingsDoc();
      await doc.write(stored as Record<string, unknown>);
      forgetProjectQueues();
      const { ops: ops2 } = await startApp(doc, w.api);
      // the translator makes a project under that name: it is made and opens, and stays
      const clock = tickingNow('2026-10-14T09:00:00.000Z');
      const mine = new JournalingStore({ api: w.api, kv: w.kvB, ops: ops2, now: () => clock.advance(7) });
      await mine.createProject({ content_name: 'Mine', content_abbr: 'prueba_b', content_language_code: 'es', add_book: false, versification: 'eng' });
      mine.dispose();
      const before = new Map(w.rig.repos.get(OPENED)!.files);
      forgetProjectQueues();
      const again = new JournalingStore({ api: w.api, kv: w.kvB, ops: ops2 });
      await again.open(OPENED);
      again.dispose();
      for (const [ipath, bytes] of before) expect(w.rig.repos.get(OPENED)!.files.get(ipath), ipath).toBe(bytes);
      // and the repository opens under another name, with no reserved file
      forgetProjectQueues();
      expect(await openFromDoor43({ api: w.api, ops: ops2 }, { source: SOURCE, name: 'prueba_c' })).toEqual({ repoPath: '_local_/_local_/prueba_c' });
      expect(reservedIn(w, '_local_/_local_/prueba_c')).toEqual([]);
    });
});
