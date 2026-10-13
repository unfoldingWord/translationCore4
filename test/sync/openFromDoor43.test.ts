// Open a project from Door43 (issue #677, layer 4 of epic #24) over the fake rig
// (test/helpers/journalingRig.ts): computer A shares a project; computer B (its own
// installation store) opens it under a name. Each refusal asserts its code and that
// nothing was written: the same repositories, byte for byte, and no clone left.
import { afterEach, describe, expect, it } from 'vitest';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../../src/data/journal/journalStore';
import { actorIdFor } from '../../src/data/journal/identity';
import { OpsLog, serialSettingsWriter } from '../../src/data/journal/opsLog';
import { openFromDoor43, openFromDoor43Asking, openRepoPathOf, openSourceOf, sync, type CloneSource } from '../../src/data/share/syncOperation';
import { journalingRig, memKv, tickingNow, type JournalingRig } from '../helpers/journalingRig';

const REPO = '_local_/_local_/prueba';
const URL_ = 'https://qa.door43.org/facilitator/prueba';
const CLONE_PATH = 'qa.door43.org/facilitator/prueba';
const SOURCE: CloneSource = { host: 'qa.door43.org', org: 'facilitator', repo: 'prueba' };
const OPENED = '_local_/_local_/prueba_b';
const SCRATCH = '_local_/_archive_/tc4-open--prueba_b';
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

afterEach(() => {
  forgetSharedClocks();
  forgetProjectQueues();
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
    // nothing was written: the same repositories, byte for byte; no project, scratch copy or clone
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

  it('an Open Bible Stories project refuses (Bible only, D98), and nothing is written', async () => {
    const w = await world();
    const remote = w.rig.remotes.get(URL_)!;
    (remote.meta as { type: unknown }).type = { flavorType: { name: 'gloss', flavor: { name: 'textStories' } } };
    const before = snapshot(w.rig);
    const refusal = await refusalOf(openFromDoor43({ api: w.api }, { source: SOURCE, name: 'prueba_b' }));
    expect(refusal.code).toBe('sync.obs-unsupported');
    expect(snapshot(w.rig)).toEqual(before);
  });

  it('a repository that is not on Door43 refuses sync.clone-failed, and nothing is written', async () => {
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
});
