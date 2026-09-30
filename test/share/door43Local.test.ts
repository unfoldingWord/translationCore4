// D86 point 4 (#486): in Local the Door43 adapter refuses every call before a
// request is made. The adapter calls Door43 from the client, so the platform's
// net gate does not cover it; this check is the only one.
import { describe, expect, it } from 'vitest';
import { Door43Api, Door43ApiError } from '../../src/data/share/door43Api';

const session = { username: 'tester', token: 'secret' };

/** Every adapter call, so a new one that skips the check fails here. */
const calls = (api: Door43Api): Array<[string, () => Promise<unknown>]> => [
  ['user', () => api.user('secret')],
  ['listOrganizations', () => api.listOrganizations(session)],
  ['canCreateRepository', () => api.canCreateRepository(session, 'org')],
  ['countRepositories', () => api.countRepositories(session, 'org', 'en')],
  ['createRepository', () => api.createRepository(session, { kind: 'user' }, 'repo')],
  ['signIn', () => api.signIn('tester', 'password')],
];

const ADAPTER_METHODS = Object.getOwnPropertyNames(Door43Api.prototype)
  .filter((name) => name !== 'constructor' && name !== 'request');

describe('the Door43 adapter in Local', () => {
  it('the list below names every public adapter call', () => {
    const listed = calls(new Door43Api({ server: 'https://door43.invalid' })).map(([name]) => name);
    expect(listed.sort()).toEqual([...ADAPTER_METHODS].sort());
  });

  it('refuses every call and never reaches fetch', async () => {
    const seen: string[] = [];
    const api = new Door43Api({
      server: 'https://door43.invalid',
      fetchFn: (async (input: RequestInfo | URL) => { seen.push(String(input)); throw new Error('must not be called'); }) as typeof fetch,
      allowed: () => false,
    });
    for (const [name, call] of calls(api)) {
      const error = await call().then(() => null, (e: unknown) => e);
      expect(error, name).toBeInstanceOf(Door43ApiError);
      expect((error as Door43ApiError).status, name).toBe(0);
      expect((error as Error).message, name).toContain('tC4 is set to Local');
    }
    expect(seen).toEqual([]);
  });

  it('control: with Internet allowed, the same call reaches fetch', async () => {
    const seen: string[] = [];
    const api = new Door43Api({
      server: 'https://door43.invalid',
      fetchFn: (async (input: RequestInfo | URL) => { seen.push(String(input)); return new Response('{"login":"tester"}', { status: 200 }); }) as typeof fetch,
      allowed: () => true,
    });
    expect(await api.user('secret')).toBe('tester');
    expect(seen).toEqual(['https://door43.invalid/api/v1/user']);
  });
});
