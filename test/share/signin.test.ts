// The Door43 sign-in (issue #203 tests 5 and 6, and the qa-risk leg) with the
// fake Door43 as the adapter's fetch. Kept as a unit suite because the journey
// cannot make the real server fail on demand (D81 point 3). The ways the
// sign-in can fail, written before the code:
//   1. a wrong password: Door43 answers 401 → `share.auth-failed`, nothing stored;
//   2. no network: the fetch throws → `share.offline`; the net gate off →
//      `share.offline` before any Door43 call;
//   3. Door43 down: a 5xx → `share.server-unavailable`;
//   4. a refusal leaves a token in the settings store or in localStorage
//      (nothing may be written on a refusal);
//   5. with "Stay signed in" off, the token reaches the platform client
//      settings or localStorage (it may not); any sign-in writes a record of
//      the person — a name, an email, a login — to the settings store (D85: it
//      may not; the only stored item is the kept token, in the keychain);
//   6. a stale `translationCore` token on the account makes the create fail
//      (Door43 refuses a used name and lists no secret): it is deleted first;
//   7. an email login: the tokens route needs the account login, read from
//      `GET /user`; the session's username is that login, not the email;
//   8. the scopes asked differ from `TOKEN_SCOPES`, or the password or the
//      token lands in a URL;
//   9. sign-out leaves the token in memory;
//  10. the keychain receives more than the token (a username, a password).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Door43Api, TOKEN_NAME, TOKEN_SCOPES } from '../../src/data/share/door43Api';
import { currentSession, signIn, signOut, type SignInDeps } from '../../src/data/share/session';
import { reportError } from '../../src/data/journal/runtime';
import { serialSettingsWriter } from '../../src/data/journal/opsLog';
import { FakeDoor43, type FakeDoor43Options } from '../../e2e/helpers/door43';

const SERVER = 'https://qa.door43.org';
const USER = { username: 'facilitator', password: 'pa$$w0rd-ü', email: 'facilitator@example.org' };

/** A spy settings store (the platform client settings) and a spy localStorage:
 * every write is recorded so a test can assert that none happened. */
function stores() {
  const doc: Record<string, unknown> = {};
  const writes: Array<Record<string, unknown>> = [];
  const update = serialSettingsWriter(
    async () => ({ ...doc }),
    async (next) => {
      writes.push(next);
      Object.assign(doc, next);
    },
  );
  const local = new Map<string, string>();
  const localWrites: string[] = [];
  const localStorage = {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => {
      localWrites.push(`${k}=${v}`);
      local.set(k, v);
    },
    removeItem: (k: string) => local.delete(k),
  };
  return { doc, writes, update, localStorage, localWrites };
}

function fake(extra: Partial<FakeDoor43Options> = {}) {
  return new FakeDoor43({ server: SERVER, user: USER, ...extra });
}

function deps(door43: FakeDoor43, net = true): SignInDeps {
  return {
    door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }),
    getNetEnabled: async () => net,
  };
}

const request = (login = USER.username, password = USER.password, stay = false) => ({ login, password, stay });

beforeEach(() => {
  vi.stubGlobal('localStorage', stores().localStorage);
});

afterEach(async () => {
  await signOut();
  vi.unstubAllGlobals();
});

/** Every request the fake saw, as `METHOD url`. */
const urls = (door43: FakeDoor43) => door43.calls.map((c) => `${c.method} ${c.url}`);

describe('#203 sign-in refusals (test 5): each cause has its code, and nothing is stored', () => {
  /** A browser with no network: the fetch rejects before any answer. */
  const noNetwork: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
  const cases: Array<[string, () => { door43: FakeDoor43; net?: boolean; password?: string; fetchFn?: typeof fetch }, string]> = [
    ['a wrong password (401)', () => ({ door43: fake(), password: 'wrong' }), 'share.auth-failed'],
    ['no network (the fetch throws)', () => ({ door43: fake(), fetchFn: noNetwork }), 'share.offline'],
    ['the net gate off', () => ({ door43: fake(), net: false }), 'share.offline'],
    ['Door43 down (503)', () => ({ door43: fake({ outage: true }) }), 'share.server-unavailable'],
  ];
  for (const [name, setup, code] of cases) {
    it(`${name} → ${code}`, async () => {
      const { door43, net, password, fetchFn } = setup();
      const store = stores();
      vi.stubGlobal('localStorage', store.localStorage);
      const api = new Door43Api({ server: SERVER, fetchFn: fetchFn ?? door43.fetchFn });
      const report = await signIn({ door43: api, getNetEnabled: async () => net ?? true }, request(USER.username, password));
      expect(reportError(report)).toBeNull();
      expect(report.ok).toBe(false);
      expect(report.code).toBe(code);
      expect(report.op).toBe('share');
      // The message is plain words for the user; the facts never carry the password.
      expect(JSON.stringify(report)).not.toContain(password ?? USER.password);
      expect(currentSession()).toBeNull();
      expect(store.writes).toEqual([]);
      expect(store.localWrites).toEqual([]);
      if (net === false) expect(door43.calls).toEqual([]);
    });
  }
  // The negative control of the auth case: the adapter itself sees the 401.
  it('the fake answers 401 to a wrong password, so the auth case is not vacuous', async () => {
    const door43 = fake();
    const api = new Door43Api({ server: SERVER, fetchFn: door43.fetchFn });
    await expect(api.signIn(USER.username, 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('#203 the token in memory only (test 6), and no record of the person (D85)', () => {
  it('with "Stay signed in" off, the session holds the token and no store or localStorage saw a write', async () => {
    const door43 = fake();
    const store = stores();
    vi.stubGlobal('localStorage', store.localStorage);
    const report = await signIn(deps(door43), request());
    expect(reportError(report)).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.facts).toMatchObject({ step: 'sign-in', username: USER.username, kept: false });
    const token = door43.tokens.get(TOKEN_NAME)!;
    expect(currentSession()).toEqual({ username: USER.username, token });
    expect(JSON.stringify(report)).not.toContain(token);
    // D85: no identity record, no login, no token — no write at all.
    expect(store.writes).toEqual([]);
    expect(store.doc).toEqual({});
    expect(store.localWrites).toEqual([]);
  });

  it('"Stay signed in" with no keychain wired keeps the token in memory, kept: false, and still writes nothing', async () => {
    const door43 = fake();
    const store = stores();
    vi.stubGlobal('localStorage', store.localStorage);
    const report = await signIn(deps(door43), request(USER.username, USER.password, true));
    expect(report.ok).toBe(true);
    expect(report.facts.kept).toBe(false);
    expect(currentSession()?.token).toBe(door43.tokens.get(TOKEN_NAME));
    expect(store.writes).toEqual([]);
    expect(store.localWrites).toEqual([]);
  });

  it('"Stay signed in" hands the keychain seam (#366) the token and nothing else; sign-out forgets it', async () => {
    const door43 = fake();
    const kept: unknown[] = [];
    let forgotten = 0;
    const keychain = { keep: async (value: unknown) => { kept.push(value); }, forget: async () => { forgotten++; } };
    const report = await signIn({ ...deps(door43), keychain }, request(USER.username, USER.password, true));
    expect(report.facts.kept).toBe(true);
    // The only keychain write is the token string: no username, no password.
    expect(kept).toEqual([door43.tokens.get(TOKEN_NAME)]);
    expect(JSON.stringify(kept)).not.toContain(USER.username);
    expect(JSON.stringify(kept)).not.toContain(USER.password);
    await signOut(keychain);
    expect(currentSession()).toBeNull();
    expect(forgotten).toBe(1);
  });

  it('a keychain that refuses is not a failed sign-in: the token stays in memory, kept: false', async () => {
    const door43 = fake();
    const keychain = { keep: async () => { throw new Error('no safeStorage'); }, forget: async () => {} };
    const report = await signIn({ ...deps(door43), keychain }, request(USER.username, USER.password, true));
    expect(report.ok).toBe(true);
    expect(report.facts.kept).toBe(false);
    expect(report.facts.keepError).toMatch(/no safeStorage/);
    expect(currentSession()?.token).toBe(door43.tokens.get(TOKEN_NAME));
  });

  it('sign-out drops the token from memory', async () => {
    await signIn(deps(fake()), request());
    expect(currentSession()).not.toBeNull();
    await signOut();
    expect(currentSession()).toBeNull();
  });
});

describe('#203 the token call', () => {
  it('asks exactly TOKEN_SCOPES, and puts neither the password nor the token in a URL', async () => {
    const door43 = fake();
    await signIn(deps(door43), request());
    const create = door43.calls.find((c) => c.method === 'POST' && /\/tokens$/.test(c.url))!;
    expect(JSON.parse(create.body!)).toEqual({ name: TOKEN_NAME, scopes: [...TOKEN_SCOPES] });
    expect(door43.tokenRows.map((row) => row.scopes)).toEqual([[...TOKEN_SCOPES]]);
    const token = door43.tokens.get(TOKEN_NAME)!;
    for (const url of urls(door43)) {
      expect(url).not.toContain(USER.password);
      expect(url).not.toContain(token);
      expect(url.startsWith(`GET ${SERVER}/`) || url.startsWith(`POST ${SERVER}/`) || url.startsWith(`DELETE ${SERVER}/`)).toBe(true);
    }
  });

  it('an email login: the account login comes from GET /user and is the session username', async () => {
    const door43 = fake();
    const report = await signIn(deps(door43), request(USER.email));
    expect(report.ok).toBe(true);
    expect(currentSession()?.username).toBe(USER.username);
    expect(urls(door43)[0]).toBe(`GET ${SERVER}/api/v1/user`);
    expect(urls(door43)).toContain(`GET ${SERVER}/api/v1/users/${USER.username}/tokens?limit=50`);
  });

  it('a stale translationCore token on the account is deleted, and a new one minted (the qa risk)', async () => {
    const door43 = fake({ existingTokens: [TOKEN_NAME, 'other-app'] });
    const stale = door43.tokens.get(TOKEN_NAME)!;
    const report = await signIn(deps(door43), request());
    expect(report.ok).toBe(true);
    const fresh = currentSession()!.token;
    expect(fresh).not.toBe(stale);
    expect(door43.tokenRows.map((row) => row.name).sort()).toEqual(['other-app', TOKEN_NAME].sort());
    expect(urls(door43).filter((u) => u.startsWith('DELETE'))).toHaveLength(1);
    // A second sign-in in the same fake does the same, so it is repeatable.
    const again = await signIn(deps(door43), request());
    expect(again.ok).toBe(true);
    expect(currentSession()!.token).not.toBe(fresh);
  });

  it('a create that answers no secret is a refusal, not a session without a token', async () => {
    const door43 = fake();
    const fetchFn: typeof fetch = async (input, init) => {
      const response = await door43.fetchFn(input, init);
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 9, name: TOKEN_NAME }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      return response;
    };
    const report = await signIn({ door43: new Door43Api({ server: SERVER, fetchFn }), getNetEnabled: async () => true }, request());
    expect(report.ok).toBe(false);
    expect(report.code).toBe('share.sign-in-rejected');
    expect(currentSession()).toBeNull();
  });

  // Only 401 and 403 are about the password; any other answer keeps Door43's words.
  const rejected: Array<[string, number, string]> = [
    ['a used token name (400)', 400, 'access token name has been used already'],
    ['a rate limit (429)', 429, 'too many requests'],
  ];
  for (const [name, status, message] of rejected) {
    it(`${name} at the token create → share.sign-in-rejected, not share.auth-failed`, async () => {
      const door43 = fake();
      const store = stores();
      const fetchFn: typeof fetch = async (input, init) => {
        if (init?.method === 'POST') return new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } });
        return door43.fetchFn(input, init);
      };
      const report = await signIn({ door43: new Door43Api({ server: SERVER, fetchFn }), getNetEnabled: async () => true }, request());
      expect(reportError(report)).toBeNull();
      expect(report.code).toBe('share.sign-in-rejected');
      expect(JSON.stringify(report)).toContain(message);
      expect(currentSession()).toBeNull();
      expect(store.writes).toEqual([]);
    });
  }

  it('a /user login that fails the name rule is Door43 answering, not share.offline', async () => {
    const door43 = fake();
    const fetchFn: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/api/v1/user')) return new Response(JSON.stringify({ login: '-bad-' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return door43.fetchFn(input, init);
    };
    const report = await signIn({ door43: new Door43Api({ server: SERVER, fetchFn }), getNetEnabled: async () => true }, request());
    expect(report.code).toBe('share.sign-in-rejected');
    expect(currentSession()).toBeNull();
  });
});
