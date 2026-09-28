// The share operation against the LIVE pankosmia rig (issue #362 test 7, and
// the rig legs of tests 6 and 10): the push goes to a local `file://` remote
// the test controls, the way the conformance transport suite does; the fake
// Door43 answers the create with that remote as `clone_url`. Ground truth is
// the bare remote's `main` and the rig's disk, never the Report alone.
//
// Rig-gated like the other *.integration suites: skipped with a message when
// the rig is not reachable. The rig's net gate is switched on for the pushes
// and off again at the end. `RIG_REPOS` overrides the repos directory, else
// this repository's own dev-env/state/work/repos (#396).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpStore } from '../../src/data/httpStore';
import { ServerApi } from '../../src/data/serverApi';
import { Door43Api } from '../../src/data/share/door43Api';
import { share, type ShareDeps } from '../../src/data/share/shareOperation';
import { checkpointMessage } from '../../src/data/checkpoint';
import { FakeDoor43 } from '../../e2e/helpers/door43';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { execFileSync } = process.getBuiltinModule('node:child_process');

const BASE = 'http://127.0.0.1:19998/api';
const SERVER = 'https://qa.door43.org';
const REPOS = process.env.RIG_REPOS || path.resolve(process.cwd(), 'dev-env/state/work/repos');
const TOKEN = 'tok-rig-secret-3c1a';
const SESSION = { username: 'facilitator', token: TOKEN };

const rigUp = await (async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
})();

if (!rigUp) {
  console.warn(
    `[shareRig.integration] pankosmia rig not reachable at ${BASE} — the live-rig suite is skipped (start the rig to run it).`,
  );
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const RUN = Date.now();
const ABBR = `share362_${RUN}`;
const REPO = `_local_/_local_/${ABBR}`;

describe.skipIf(!rigUp)('#362 share against the live rig, over a file:// remote', () => {
  const api = new ServerApi({ baseUrl: BASE });
  const store = new HttpStore({ baseUrl: BASE });
  let tmp: string;
  let bare: string;
  let door43: FakeDoor43;
  let deps: ShareDeps;
  const localDir = () => path.join(REPOS, ...REPO.split('/'));
  const head = () => git(localDir(), 'rev-parse', 'HEAD');
  const remoteMain = () => git(bare, 'rev-parse', 'main');

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-share362-'));
    bare = path.join(tmp, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    door43 = new FakeDoor43({
      server: SERVER,
      user: { username: 'facilitator', password: 'pw' },
      tokens: [TOKEN],
      cloneUrlFor: () => `file://${bare}`,
    });
    deps = {
      api,
      door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }),
      commitPending: (messageFor) => store.commitPending(messageFor),
      // The rig's remote is a local file:// remote; production never sets this.
      allowFileRemote: true,
    };
    await store.createProject({
      content_name: `Share 362 rig test ${RUN}`,
      content_abbr: ABBR,
      content_language_code: 'es',
      content_language_name: 'Spanish',
      add_book: true,
      book_code: 'TIT',
      book_title: 'Tito',
      book_abbr: 'Tit',
      add_cv: true,
      versification: 'eng',
    });
    await store.open(REPO);
    await api.enableNet();
  }, 60_000);

  afterAll(async () => {
    await api.disableNet().catch(() => {});
    await api.deleteRepo(REPO).catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the first share creates the repository, sets origin, and the remote main equals the local main', async () => {
    const report = await share(deps, {
      repoPath: REPO,
      session: SESSION,
      target: { kind: 'user' },
      name: ABBR,
    });
    expect(report).toMatchObject({
      op: 'share',
      ok: true,
      facts: {
        repository: `facilitator/${ABBR}`,
        url: `${SERVER}/facilitator/${ABBR}`,
        created: true,
      },
    });
    expect(door43.repositories.get(`facilitator/${ABBR}`)).toBe(`file://${bare}`);
    expect(remoteMain()).toBe(head());
    const remotes = await api.listRemotes(REPO);
    expect(remotes).toEqual([{ name: 'origin', url: `file://${bare}` }]);
  }, 30_000);

  it('origin is the only record: the git config holds it, and neither it nor the rig state holds the token', async () => {
    const config = fs.readFileSync(path.join(localDir(), '.git', 'config'), 'utf8');
    expect(config).toContain(`url = file://${bare}`);
    expect(config).not.toContain(TOKEN);
    const settingsDir = path.join(REPOS, '..', 'client_settings');
    const settings = fs.existsSync(settingsDir)
      ? fs
          .readdirSync(settingsDir)
          .map((f) => fs.readFileSync(path.join(settingsDir, f), 'utf8'))
          .join('\n')
      : '';
    expect(settings).not.toContain(TOKEN);
    expect(settings).not.toContain(`file://${bare}`);
  });

  it('a second share with a new commit creates nothing and pushes it', async () => {
    await api.writeIngredient(
      REPO,
      'checking/settings.json',
      JSON.stringify({ schemaVersion: 1, share362: RUN }),
      { keepBak: false },
    );
    await api.addAndCommit(
      REPO,
      checkpointMessage('before share', [
        { path: 'ingredients/checking/settings.json', change_type: 'modified' },
      ])!,
    );
    const before = remoteMain();
    const creates = door43.calls.filter((c) => c.method === 'POST').length;
    const report = await share(deps, {
      repoPath: REPO,
      session: SESSION,
      target: { kind: 'user' },
      name: ABBR,
    });
    // A later share reads its identity back from origin (`.git` dropped): here the file:// remote.
    expect(report).toMatchObject({
      ok: true,
      facts: { created: false, url: `file://${bare.replace(/\.git$/, '')}` },
    });
    expect(door43.calls.filter((c) => c.method === 'POST').length).toBe(creates);
    expect(remoteMain()).not.toBe(before);
    expect(remoteMain()).toBe(head());
  }, 30_000);

  it('a push that is not a fast-forward is refused with share.non-fast-forward, and the remote is unchanged', async () => {
    // Another device: clone the remote, commit, push.
    const other = path.join(tmp, 'other');
    execFileSync('git', ['clone', '-q', `file://${bare}`, other]);
    fs.writeFileSync(path.join(other, 'other-device.txt'), 'x\n');
    git(other, 'add', 'other-device.txt');
    git(other, '-c', 'user.email=o@x', '-c', 'user.name=other', 'commit', '-qm', 'other device');
    git(other, 'push', '-q', 'origin', 'main');
    const theirs = remoteMain();
    expect(theirs).not.toBe(head());
    // This device: a new local commit, then share.
    await api.writeIngredient(
      REPO,
      'checking/settings.json',
      JSON.stringify({ schemaVersion: 1, share362: RUN, local: true }),
      { keepBak: false },
    );
    await api.addAndCommit(REPO, 'local edit');
    const report = await share(deps, {
      repoPath: REPO,
      session: SESSION,
      target: { kind: 'user' },
      name: ABBR,
    });
    expect(report).toMatchObject({ ok: false, code: 'share.non-fast-forward' });
    expect(remoteMain()).toBe(theirs);
  }, 30_000);

  it('offline (the platform net gate), the share is refused with share.offline and nothing is pushed', async () => {
    await api.disableNet();
    const theirs = remoteMain();
    const report = await share(deps, {
      repoPath: REPO,
      session: SESSION,
      target: { kind: 'user' },
      name: ABBR,
    });
    expect(report).toMatchObject({ ok: false, code: 'share.offline' });
    expect(remoteMain()).toBe(theirs);
  }, 30_000);
});
