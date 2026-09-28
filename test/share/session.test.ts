// A session resumed from a kept token (issue #366 test 5; D85) with the fake
// Door43 as the adapter's fetch, and a spy keychain seam. Kept as a unit suite
// because the journey cannot make the real server refuse a token on demand
// (D81 point 3). The ways the resume can fail, written before the code:
//   1. Door43 refuses the kept token (401, revoked or expired): the token is
//      not forgotten, so every start asks Door43 again and never the password;
//   2. no answer (offline, a 5xx) is treated as a refusal: a good token is
//      thrown away because the network was down;
//   3. a refused token leaves a session in memory;
//   4. the keychain fails to read (a damaged file): the app cannot start;
//   5. a resume overwrites a session the user signed in to;
//   6. the resumed username is not Door43's answer (a stored name).
import { afterEach, describe, expect, it } from 'vitest';
import { Door43Api, TOKEN_NAME } from '../../src/data/share/door43Api';
import { currentSession, resumeKeptSession, signIn, signOut, type TokenKeychain } from '../../src/data/share/session';
import { FakeDoor43 } from '../../e2e/helpers/door43';

const SERVER = 'https://qa.door43.org';
const USER = { username: 'facilitator', password: 'pa$$w0rd-ü' };

/** A spy keychain: holds one token in memory, records every call. */
function spyKeychain(token: string | null, readError?: Error): TokenKeychain & { calls: string[]; held: string | null } {
  const keychain = {
    calls: [] as string[],
    held: token,
    keep: async (value: string) => { keychain.calls.push('keep'); keychain.held = value; },
    read: async () => { keychain.calls.push('read'); if (readError) throw readError; return keychain.held; },
    forget: async () => { keychain.calls.push('forget'); keychain.held = null; },
  };
  return keychain;
}

afterEach(async () => {
  await signOut();
});

describe('#366 a kept token resumes the session, and a refused one is forgotten', () => {
  it('a kept token that Door43 accepts: the session is resumed with the username Door43 answers, and the keychain is only read', async () => {
    const door43 = new FakeDoor43({ server: SERVER, user: USER, tokens: ['kept-token-1'] });
    const keychain = spyKeychain('kept-token-1');
    const outcome = await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }), keychain });
    expect(outcome).toBe('resumed');
    expect(currentSession()).toEqual({ username: USER.username, token: 'kept-token-1' });
    expect(keychain.calls).toEqual(['read']);
    expect(door43.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${SERVER}/api/v1/user`]);
    // The token travels in the header, never in the URL.
    expect(door43.calls[0].headers.Authorization ?? door43.calls[0].headers.authorization).toBe('token kept-token-1');
  });

  it('no kept token: nothing asked of Door43, not signed in', async () => {
    const door43 = new FakeDoor43({ server: SERVER, user: USER });
    const keychain = spyKeychain(null);
    expect(await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }), keychain })).toBe('none');
    expect(currentSession()).toBeNull();
    expect(door43.calls).toEqual([]);
  });

  it('a kept token Door43 refuses (401): forgotten through the seam, no session, so the app asks the password again', async () => {
    // The fake holds no valid token, so the kept one is revoked.
    const door43 = new FakeDoor43({ server: SERVER, user: USER });
    const keychain = spyKeychain('revoked-token');
    // Negative control: the fake answers 401 to that token.
    await expect(new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }).user('revoked-token')).rejects.toMatchObject({ status: 401 });
    const outcome = await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }), keychain });
    expect(outcome).toBe('refused');
    expect(currentSession()).toBeNull();
    expect(keychain.calls).toEqual(['read', 'forget']);
    expect(keychain.held).toBeNull();
    // The next sign-in works as before, and keeps the new token when asked.
    const report = await signIn(
      { door43: new Door43Api({ server: SERVER, fetchFn: door43.fetchFn }), getNetEnabled: async () => true, keychain },
      { login: USER.username, password: USER.password, stay: true },
    );
    expect(report.ok).toBe(true);
    expect(keychain.held).toBe(door43.tokens.get(TOKEN_NAME));
  });

  it('no answer (offline, or Door43 down): the token stays kept, no session now, so a later share tries again', async () => {
    const noNetwork: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
    const offline = spyKeychain('kept-token-1');
    expect(await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: noNetwork }), keychain: offline })).toBe('unavailable');
    expect(currentSession()).toBeNull();
    expect(offline.calls).toEqual(['read']);
    expect(offline.held).toBe('kept-token-1');

    const down = new FakeDoor43({ server: SERVER, user: USER, tokens: ['kept-token-1'], outage: true });
    const kept = spyKeychain('kept-token-1');
    expect(await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: down.fetchFn }), keychain: kept })).toBe('unavailable');
    expect(kept.held).toBe('kept-token-1');

    // Door43 back: the same kept token resumes.
    const up = new FakeDoor43({ server: SERVER, user: USER, tokens: ['kept-token-1'] });
    expect(await resumeKeptSession({ door43: new Door43Api({ server: SERVER, fetchFn: up.fetchFn }), keychain: kept })).toBe('resumed');
    expect(currentSession()?.username).toBe(USER.username);
  });

  it('a keychain that cannot read counts as no kept token; a signed-in session is left as it is', async () => {
    const door43 = new FakeDoor43({ server: SERVER, user: USER, tokens: ['kept-token-1'] });
    const api = new Door43Api({ server: SERVER, fetchFn: door43.fetchFn });
    expect(await resumeKeptSession({ door43: api, keychain: spyKeychain('x', new Error('damaged')) })).toBe('none');
    expect(currentSession()).toBeNull();

    await signIn({ door43: api, getNetEnabled: async () => true }, { login: USER.username, password: USER.password, stay: false });
    const signed = currentSession()!;
    const keychain = spyKeychain('kept-token-1');
    expect(await resumeKeptSession({ door43: api, keychain })).toBe('resumed');
    expect(currentSession()).toEqual(signed);
    expect(keychain.calls).toEqual([]);
  });
});

// A startup effect can run twice, and a pending resume can finish after Sign out.
// Neither may duplicate authentication work or restore a session the user ended.
describe('#366 pending resume', () => {
  it('shares one pending resume between callers', async () => {
    const keychain = spyKeychain('kept-token-1');
    let calls = 0;
    const door43 = { user: async () => { calls++; return USER.username; } };
    await Promise.all([resumeKeptSession({ door43, keychain }), resumeKeptSession({ door43, keychain })]);
    expect(keychain.calls).toEqual(['read']);
    expect(calls).toBe(1);
  });

  it('does not restore a session after Sign out while Door43 replies', async () => {
    const keychain = spyKeychain('kept-token-1');
    let answer!: (user: string) => void;
    let reached!: () => void;
    const called = new Promise<void>((resolve) => { reached = resolve; });
    const door43 = { user: async () => {
      reached();
      return new Promise<string>((resolve) => { answer = resolve; });
    } };
    const pending = resumeKeptSession({ door43, keychain });
    await called;
    await signOut(keychain);
    answer(USER.username);
    await pending;
    expect(currentSession()).toBeNull();
    expect(keychain.held).toBeNull();
  });
});
