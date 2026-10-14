// One full sync against the LIVE pankosmia rig and the #673 stand-in for Door43
// (issue #676): a bare `file://` remote is Door43 `main`, and a never-committed
// mirror under `_local_/_archive_/<org>--<repo>` is what the clone copies, then
// pulls (docs/evidence/sync-transport-spike-2026-10-13.md, "The rig stand-in").
// Ground truth is the bare remote's `main`, the rig's disk and the verifier,
// never the Report alone.
//
// It runs ONLY on a rig that the caller names: `RIG_API` (which `npm run prove`
// sets, with `RIG_REPOS`, after it checks that the rig is pristine) or
// `TC4_RIG_PORT`. With neither, it skips: the default lane can be another
// session's rig. The repos directory is `RIG_REPOS`, else this worktree's
// dev-env/state/work/repos (#396); the suite stops before it writes to disk if
// the project it made on the rig is not in that directory. The rig's net state
// is put back at the end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../../src/data/journal/journalStore';
import { OpsLog, opsEntriesOf, serialSettingsWriter, syncPathsOf } from '../../src/data/journal/opsLog';
import { makeClock, reportError } from '../../src/data/journal/runtime';
import { sealAction, segmentName } from '../../src/data/journal/seal';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../../src/data/journal/verify';
import { standInCloneRepo, sync, type SyncDeps } from '../../src/data/share/syncOperation';
import { memKv } from '../helpers/journalingRig';
import { lane } from '../../e2e/lane.mjs';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { pathToFileURL } = process.getBuiltinModule('node:url');
const { execFileSync } = process.getBuiltinModule('node:child_process');

const NAMED = Boolean(process.env.RIG_API || process.env.TC4_RIG_PORT);
const BASE = process.env.RIG_API || lane().rigApi;
const REPOS = process.env.RIG_REPOS || path.resolve(process.cwd(), 'dev-env/state/work/repos');
const TOKEN = 'tok-rig-sync-676';
const SESSION = { username: 'facilitator', token: TOKEN };

const rigUp = NAMED && await (async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
})();
if (!rigUp)
  console.warn(NAMED
    ? `[syncRig.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped (start the rig to run it).`
    : '[syncRig.integration] no rig named (set TC4_RIG_PORT, or run it from npm run prove) — the live-rig suite is skipped.');

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const RUN = Date.now();
const ABBR = `sync676_${RUN}`;
const REPO = `_local_/_local_/${ABBR}`;
const ORG = 'facilitator';
const MIRROR = `_local_/_archive_/${ORG}--${ABBR}`;
const FIXED = `file/${ORG}/${ABBR}`;
const PATHS = syncPathsOf(REPO);
const TEAMMATE = 'b676teammate0001';
const usfm = (v1: string) => ['\\id TIT sync', '\\h Tito', '\\mt Tito', '\\c 1', '\\p', `\\v 1 ${v1}`, '\\v 2 ___', ''].join('\n');

describe.skipIf(!rigUp)('#676 one full sync against the live rig and the #673 stand-in', () => {
  const api = new ServerApi({ baseUrl: BASE });
  const kv = memKv();
  let tmp: string;
  let bare: string;
  let doc: Record<string, unknown> = {};
  const ops = new OpsLog({ read: async () => structuredClone(doc), update: serialSettingsWriter(async () => structuredClone(doc), async (d) => { doc = structuredClone(d); }) });
  const dir = (repoPath: string) => path.join(REPOS, ...repoPath.split('/'));
  let actor = '';
  let teammatePath = '';
  let netWas: boolean | null = null;

  beforeAll(async () => {
    forgetSharedClocks();
    forgetProjectQueues();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-sync676-'));
    // the bare remote sits at <tmp>/<org>/<repo>.git, so its file:// url names <org>/<repo>
    bare = path.join(tmp, ORG, `${ABBR}.git`);
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    netWas = await api.getNetEnabled();
    await api.enableNet();
    await ops.recover(api); // as the app does at each start

    // this translator's project: TIT 1:1 drafted and checkpointed, then shared to the bare remote
    const store = new JournalingStore({ api, kv });
    await store.createProject({ content_name: `Sync 676 rig ${RUN}`, content_abbr: ABBR, content_language_code: 'es', add_book: false, versification: 'eng' });
    await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: usfm('Pablo.') });
    await store.commit('first (tC4)');
    actor = store.actorId;
    // REPOS must be the directory of THIS rig before anything is written to disk
    if (!fs.existsSync(path.join(dir(REPO), 'metadata.json')))
      throw new Error(`${REPOS} is not the repos directory of the rig at ${BASE}; set RIG_REPOS`);
    const url = pathToFileURL(bare).href;
    await api.addRemote(REPO, 'origin', url);
    await api.push(REPO, 'origin', SESSION.username, SESSION.token);
    // the mirror the stand-in clone copies: never committed to
    execFileSync('git', ['clone', '-q', url, dir(MIRROR)]);
    // the server's own clone writes a local git identity (clone_repo.rs:84-93); the
    // platform commit panics without one, and a CI runner has no global identity
    git(dir(MIRROR), 'config', 'user.name', 'rig');
    git(dir(MIRROR), 'config', 'user.email', 'rig@localhost');
    // after the share: one more own draft (only on this computer) ...
    await store.writeBook('TIT', usfm('Pablo, siervo de Dios.'));
    store.dispose();
    // ... and a teammate names itself on Door43 main (a valid sealed segment, pushed with git)
    let at = Date.parse('2026-10-13T12:00:00.000Z');
    const clock = makeClock(TEAMMATE, () => (at += 1));
    const event = { v: 3, op: 'actor.name.set', actor: TEAMMATE, ts: clock.issue(), base: null, username: 'teammate' };
    teammatePath = `checking/journal/${TEAMMATE}/segments/${segmentName(event.ts)}`;
    const work = path.join(tmp, 'teammate');
    execFileSync('git', ['clone', '-q', url, work]);
    git(work, 'config', 'user.email', 'teammate@rig.test');
    git(work, 'config', 'user.name', 'teammate');
    fs.mkdirSync(path.dirname(path.join(work, 'ingredients', teammatePath)), { recursive: true });
    fs.writeFileSync(path.join(work, 'ingredients', teammatePath), await sealAction([event]));
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'teammate name');
    git(work, 'push', '-q', 'origin', 'main');
  }, 120_000);

  afterAll(async () => {
    if (netWas === false) await api.disableNet().catch(() => {});
    // `list-local-repos` skips _local_/_archive_/, so each path is deleted by name
    for (const repoPath of [REPO, PATHS.scratch, PATHS.previous, MIRROR, FIXED]) await api.deleteRepo(repoPath).catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a full sync: Door43 main moves forward to the project, the project keeps its path and actor, and verifies', async () => {
    const before = git(bare, 'rev-parse', 'main');
    const deps: SyncDeps = {
      api: Object.assign(Object.create(api) as ServerApi, { cloneRepo: standInCloneRepo(api) }),
      kv,
      door43Server: 'https://qa.door43.org',
      coverage: {},
      ops,
      allowFileRemote: true,
    };
    const report = await sync(deps, { repoPath: REPO, session: SESSION });
    expect(reportError(report)).toBeNull();
    expect([report.ok, report.code], JSON.stringify(report)).toEqual([true, undefined]);
    expect(report.facts).toMatchObject({ tries: 1, received: { [TEAMMATE]: 1 }, names: { [actor]: 'facilitator', [TEAMMATE]: 'teammate' } });

    // G4: Door43 main moved forward, and it is the live project's HEAD
    const after = git(bare, 'rev-parse', 'main');
    expect(after).not.toBe(before);
    expect(git(bare, 'merge-base', '--is-ancestor', before, after)).toBe('');
    expect(git(dir(REPO), 'rev-parse', 'HEAD')).toBe(after);
    // G5: the same path; the scratch copy and the fixed clone path are gone; the previous copy waits for the next save
    expect(fs.existsSync(dir(REPO))).toBe(true);
    expect(fs.existsSync(dir(PATHS.scratch))).toBe(false);
    expect(fs.existsSync(dir(FIXED))).toBe(false);
    expect(fs.existsSync(dir(PATHS.previous))).toBe(true);
    // the teammate's file and the own name are in the project; the store opens it with the same actor
    expect(fs.existsSync(path.join(dir(REPO), 'ingredients', teammatePath))).toBe(true);
    forgetSharedClocks();
    forgetProjectQueues();
    const reopened = new JournalingStore({ api, kv });
    await reopened.open(REPO);
    expect(reopened.actorId).toBe(actor);
    reopened.dispose();
    const verified = await verifyProjectAgainstJournal(api, REPO);
    expect(verified.ok, describeVerifierReport(verified)).toBe(true);
    // the Report is the closed ops record
    expect(opsEntriesOf(doc).find((e) => e.op === 'sync')?.report).toEqual(report);
    console.log(`[syncRig] main ${before.slice(0, 7)} -> ${after.slice(0, 7)}; facts ${JSON.stringify({ tries: report.facts.tries, carried: report.facts.carried, received: report.facts.received, names: report.facts.names })}`);
  }, 120_000);

  it('[G4] a Door43 repository whose HEAD names another branch is refused (sync.not-main): Door43 and the project do not change', async () => {
    // Door43's default branch becomes `other`; the stand-in mirror is cloned again, so it checks that branch out
    git(bare, 'branch', 'other', 'main');
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/other');
    await api.deleteRepo(MIRROR);
    execFileSync('git', ['clone', '-q', pathToFileURL(bare).href, dir(MIRROR)]);
    git(dir(MIRROR), 'config', 'user.name', 'rig');
    git(dir(MIRROR), 'config', 'user.email', 'rig@localhost');
    const branches = await api.listBranches(MIRROR);
    expect(branches.find((b) => b.is_head)?.name).toBe('other');
    const mainBefore = git(bare, 'rev-parse', 'main');
    const otherBefore = git(bare, 'rev-parse', 'other');
    const headBefore = git(dir(REPO), 'rev-parse', 'HEAD');
    const deps: SyncDeps = {
      api: Object.assign(Object.create(api) as ServerApi, { cloneRepo: standInCloneRepo(api) }),
      kv,
      door43Server: 'https://qa.door43.org',
      coverage: {},
      ops,
      allowFileRemote: true,
    };
    const report = await sync(deps, { repoPath: REPO, session: SESSION });
    expect([report.ok, report.code], JSON.stringify(report)).toEqual([false, 'sync.not-main']);
    expect(report.facts).toMatchObject({ refusal: { branch: 'other' } });
    expect([git(bare, 'rev-parse', 'main'), git(bare, 'rev-parse', 'other')]).toEqual([mainBefore, otherBefore]);
    expect(git(dir(REPO), 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(fs.existsSync(dir(PATHS.scratch))).toBe(false);
    expect(fs.existsSync(dir(FIXED))).toBe(false);
    console.log(`[syncRig] default branch other: ${report.code}; main ${mainBefore.slice(0, 7)} and other ${otherBefore.slice(0, 7)} unchanged`);
  }, 120_000);
});
