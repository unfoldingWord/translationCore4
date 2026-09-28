// The share operation (issue #362 tests 6, 7, 10 and 12, unit legs) with a fake
// Door43 API and a recording platform transport: the create for the account
// and for an organization, every refusal with its code and no push, the
// second share with no create, and the token in the push body, never in a URL.
import { describe, expect, it } from 'vitest';
import { Door43Api } from '../../src/data/share/door43Api';
import { share, type ShareDeps, type ShareTransport } from '../../src/data/share/shareOperation';
import { reportError } from '../../src/data/journal/runtime';
import { ServerApiError } from '../../src/data/serverApi';
import { FakeDoor43, type FakeOrganization } from '../../e2e/helpers/door43';

const SERVER = 'https://qa.door43.org';
const REPO = '_local_/_local_/puntos';
const TOKEN = 'tok-secret-9f8e7d';
const SESSION = { username: 'facilitator', token: TOKEN };
const ORGS: FakeOrganization[] = [
  { username: 'orgA', canCreateRepository: true },
  { username: 'orgLocked', canCreateRepository: false },
];

/** A platform transport that records its calls and answers as the rig does. */
function transport(
  init: {
    net?: boolean;
    remotes?: Array<{ name: string; url: string }>;
    pushAnswer?: () => void;
  } = {},
) {
  const calls: string[] = [];
  const remotes = init.remotes ?? [];
  const pushes: Array<{ remote: string; username: string; passKey: string }> = [];
  const api: ShareTransport = {
    getNetEnabled: async () => {
      calls.push('net');
      return init.net ?? true;
    },
    listRemotes: async () => {
      calls.push('remotes');
      return remotes.map((r) => ({ ...r }));
    },
    addRemote: async (_repo, name, url) => {
      calls.push(`addRemote ${name} ${url}`);
      remotes.push({ name, url });
    },
    push: async (_repo, remote, username, passKey) => {
      calls.push(`push ${remote}`);
      pushes.push({ remote, username, passKey });
      init.pushAnswer?.();
    },
  };
  return { api, calls, remotes, pushes };
}

function deps(
  t: ReturnType<typeof transport>,
  door43: FakeDoor43,
  checkpoint: ShareDeps['commitPending'] = async () => null,
): ShareDeps {
  return {
    api: t.api,
    door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }),
    commitPending: checkpoint,
  };
}

const fake = (extra: Partial<ConstructorParameters<typeof FakeDoor43>[0]> = {}) =>
  new FakeDoor43({
    server: SERVER,
    user: { username: 'facilitator', password: 'pw' },
    tokens: [TOKEN],
    organizations: ORGS,
    ...extra,
  });

const request = (
  target: { kind: 'user' } | { kind: 'organization'; organization: string } = { kind: 'user' },
) => ({ repoPath: REPO, session: SESSION, target, name: 'puntos' });

describe('#362 share: the first share', () => {
  it('checkpoints, creates under the account, adds origin, pushes with the token in the body, and reports ok', async () => {
    const t = transport();
    const door43 = fake();
    const order: string[] = [];
    const d = deps(t, door43, async (messageFor) => {
      order.push('checkpoint');
      return messageFor([{ path: 'ingredients/TIT.usfm', change_type: 'modified' }]);
    });
    const report = await share(d, request());
    expect(reportError(report)).toBeNull();
    expect(report).toMatchObject({
      op: 'share',
      ok: true,
      facts: {
        repository: 'facilitator/puntos',
        url: `${SERVER}/facilitator/puntos`,
        created: true,
      },
    });
    expect(order).toEqual(['checkpoint']);
    expect(t.calls).toEqual([
      'net',
      'remotes',
      `addRemote origin ${SERVER}/facilitator/puntos.git`,
      'push origin',
    ]);
    expect(door43.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${SERVER}/api/v1/user/repos`,
    ]);
    expect(JSON.parse(door43.calls[0].body!)).toMatchObject({
      name: 'puntos',
      auto_init: false,
      default_branch: 'main',
    });
    expect(t.pushes).toEqual([{ remote: 'origin', username: 'facilitator', passKey: TOKEN }]);
  });

  it('creates under an organization through POST /orgs/{org}/repos', async () => {
    const t = transport();
    const door43 = fake();
    const report = await share(
      deps(t, door43),
      request({ kind: 'organization', organization: 'orgA' }),
    );
    expect(report).toMatchObject({ ok: true, facts: { repository: 'orgA/puntos', created: true } });
    expect(door43.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${SERVER}/api/v1/orgs/orgA/repos`,
    ]);
  });

  it('the token is in the Authorization header and the push body only: never in a URL, a remote, or the Report', async () => {
    const t = transport();
    const door43 = fake();
    const report = await share(deps(t, door43), request());
    expect(door43.calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect(door43.calls[0].headers.authorization).toBe(`token ${TOKEN}`);
    expect(t.remotes.map((r) => r.url).join(' ')).not.toContain(TOKEN);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
    expect(t.pushes[0].passKey).toBe(TOKEN);
  });
});

describe('#362 share: a later share', () => {
  it('finds origin, creates nothing, asks nothing, and pushes', async () => {
    const t = transport({ remotes: [{ name: 'origin', url: `${SERVER}/facilitator/puntos.git` }] });
    const door43 = fake({ existingRepositories: ['facilitator/puntos'] });
    const report = await share(deps(t, door43), request());
    expect(report).toMatchObject({
      ok: true,
      facts: {
        repository: 'facilitator/puntos',
        url: `${SERVER}/facilitator/puntos`,
        created: false,
      },
    });
    expect(door43.calls).toEqual([]);
    expect(t.calls).toEqual(['net', 'remotes', 'push origin']);
  });
});

describe('#362 share: refusals, each with its code and nothing pushed', () => {
  const refused = async (
    d: ShareDeps,
    t: ReturnType<typeof transport>,
    req = request(),
    code?: string,
  ) => {
    const report = await share(d, req);
    expect(reportError(report)).toBeNull();
    expect(report.ok).toBe(false);
    if (code) expect(report.code).toBe(code);
    expect(t.pushes).toEqual([]);
    return report;
  };

  it('share.name-exists when the name exists on the account (409), and no remote is added', async () => {
    const t = transport();
    const door43 = fake({ existingRepositories: ['facilitator/puntos'] });
    const report = await refused(deps(t, door43), t, request(), 'share.name-exists');
    expect(t.remotes).toEqual([]);
    expect(report.facts).toMatchObject({ target: 'facilitator', refusal: { status: 409 } });
  });

  it('share.name-exists when the name exists on the organization', async () => {
    const t = transport();
    const door43 = fake({ existingRepositories: ['orgA/puntos'] });
    await refused(
      deps(t, door43),
      t,
      request({ kind: 'organization', organization: 'orgA' }),
      'share.name-exists',
    );
    expect(t.remotes).toEqual([]);
  });

  it('share.auth-failed when the session has no token, before any call', async () => {
    const t = transport();
    const door43 = fake();
    await refused(
      deps(t, door43),
      t,
      { ...request(), session: { username: 'facilitator', token: '' } },
      'share.auth-failed',
    );
    expect(t.calls).toEqual([]);
    expect(door43.calls).toEqual([]);
  });

  it('share.auth-failed when Door43 refuses the token (401) at the create', async () => {
    const t = transport();
    const door43 = fake({ tokens: [] });
    await refused(deps(t, door43), t, request(), 'share.auth-failed');
    expect(t.remotes).toEqual([]);
  });

  it('share.create-rejected when Door43 rejects the create (403 in an organization the user cannot create in)', async () => {
    const t = transport();
    const door43 = fake();
    const report = await refused(
      deps(t, door43),
      t,
      request({ kind: 'organization', organization: 'orgLocked' }),
      'share.create-rejected',
    );
    expect(report.facts).toMatchObject({ refusal: { status: 403 } });
  });

  it('share.offline when the platform network is off, before the create', async () => {
    const t = transport({ net: false });
    const door43 = fake();
    await refused(deps(t, door43), t, request(), 'share.offline');
    expect(door43.calls).toEqual([]);
    expect(t.calls).toEqual(['net']);
  });

  it('share.offline when the push answers HTTP 401 "offline mode"', async () => {
    const t = transport({
      remotes: [{ name: 'origin', url: `${SERVER}/facilitator/puntos.git` }],
      pushAnswer: () => {
        throw new ServerApiError('/git/push', 401, 'offline mode');
      },
    });
    const report = await share(deps(t, fake()), request());
    expect(report).toMatchObject({ ok: false, code: 'share.offline' });
  });

  it('share.non-fast-forward when another device pushed first', async () => {
    const reason =
      'Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)';
    const t = transport({
      remotes: [{ name: 'origin', url: `${SERVER}/facilitator/puntos.git` }],
      pushAnswer: () => {
        throw new ServerApiError('/git/push', 500, reason);
      },
    });
    const report = await share(deps(t, fake()), request());
    expect(report).toMatchObject({
      ok: false,
      code: 'share.non-fast-forward',
      facts: { created: false },
    });
  });

  it('share.push-failed for any other push failure', async () => {
    const t = transport({
      pushAnswer: () => {
        throw new ServerApiError('/git/push', 500, 'Could not push repo: authentication required');
      },
    });
    const report = await share(deps(t, fake()), request());
    expect(report).toMatchObject({
      ok: false,
      code: 'share.push-failed',
      facts: { created: true },
    });
  });

  it('a checkpoint failure is a failed Report with no code, before any Door43 call', async () => {
    const t = transport();
    const door43 = fake();
    const report = await refused(
      deps(t, door43, async () => {
        throw new Error('commit failed');
      }),
      t,
    );
    expect(report.code).toBeUndefined();
    expect(report.facts).toMatchObject({ step: 'checkpoint', error: 'commit failed' });
    expect(door43.calls).toEqual([]);
  });
});

describe('#362 share: the ops log (#374)', () => {
  it('opens one share record before the first call and closes it with the Report, a refusal included', async () => {
    const t = transport();
    const door43 = fake({ existingRepositories: ['facilitator/puntos'] });
    const events: string[] = [];
    const ops: ShareDeps['ops'] = {
      begin: async (op, facts) => {
        // `t.calls` is still empty here: the record opens before the first side effect.
        events.push(`begin ${op} ${JSON.stringify(facts)} after ${t.calls.length} platform calls`);
        return {
          note: async () => true,
          close: async (report) => {
            events.push(`close ok=${report.ok} code=${report.code}`);
            return true;
          },
        };
      },
    };
    const report = await share({ ...deps(t, door43), ops }, request());
    expect(report.code).toBe('share.name-exists');
    expect(events).toEqual([
      `begin share {"repoPath":"${REPO}"} after 0 platform calls`,
      'close ok=false code=share.name-exists',
    ]);
  });
});
