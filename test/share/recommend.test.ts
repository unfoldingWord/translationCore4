// The "Recommended" organization (issue #362 test 4, D84 point 3). A unit test,
// because the journey cannot cover every count case: one clear winner is
// marked; a tie marks none; all counts 0 mark none; an organization the user
// cannot create in is never marked. The count comes from `X-Total-Count` of
// `GET /api/v1/repos/search?owner=<org>&lang=<tag>&limit=1`.
import { describe, expect, it } from 'vitest';
import { Door43Api } from '../../src/data/share/door43Api';
import { organizationChoices, recommendOrganization } from '../../src/data/share/recommend';
import { FakeDoor43 } from '../../e2e/helpers/door43';

const SERVER = 'https://qa.door43.org';
const SESSION = { username: 'facilitator', token: 'tok-1' };

const fake = (organizations: ConstructorParameters<typeof FakeDoor43>[0]['organizations']) =>
  new FakeDoor43({
    server: SERVER,
    user: { username: 'facilitator', password: 'pw' },
    tokens: [SESSION.token],
    organizations,
  });

describe('#362 recommendOrganization', () => {
  const choice = (
    organization: string,
    repositoriesInLanguage: number,
    canCreateRepository = true,
  ) => ({ organization, canCreateRepository, repositoriesInLanguage });

  it('marks the one organization with the most repositories in the language', () => {
    expect(recommendOrganization([choice('a', 2), choice('b', 7), choice('c', 3)])).toBe('b');
  });

  it('marks none on a tie for the highest count', () => {
    expect(recommendOrganization([choice('a', 7), choice('b', 7), choice('c', 3)])).toBeNull();
  });

  it('marks none when no organization has a repository in the language', () => {
    expect(recommendOrganization([choice('a', 0), choice('b', 0)])).toBeNull();
    expect(recommendOrganization([])).toBeNull();
  });

  it('never marks an organization the user cannot create in, even with the highest count', () => {
    expect(recommendOrganization([choice('a', 9, false), choice('b', 2)])).toBe('b');
    expect(recommendOrganization([choice('a', 9, false)])).toBeNull();
  });
});

describe('#362 organizationChoices through the adapter', () => {
  it('asks the search with owner, lang and limit=1, reads X-Total-Count, and marks the winner', async () => {
    const door43 = fake([
      { username: 'orgA', canCreateRepository: true, repositories: { es: 3 } },
      {
        username: 'orgB',
        fullName: 'Org B',
        canCreateRepository: true,
        repositories: { es: 12, en: 40 },
      },
      { username: 'orgC', canCreateRepository: false, repositories: { es: 50 } },
    ]);
    const api = new Door43Api({ server: SERVER, fetchFn: door43.fetchFn });
    const choices = await organizationChoices(api, SESSION, 'es');
    expect(choices).toEqual([
      {
        organization: 'orgA',
        fullName: 'orgA',
        canCreateRepository: true,
        repositoriesInLanguage: 3,
        recommended: false,
      },
      {
        organization: 'orgB',
        fullName: 'Org B',
        canCreateRepository: true,
        repositoriesInLanguage: 12,
        recommended: true,
      },
      {
        organization: 'orgC',
        fullName: 'orgC',
        canCreateRepository: false,
        repositoriesInLanguage: 50,
        recommended: false,
      },
    ]);
    const searches = door43.calls
      .filter((c) => c.url.includes('/repos/search'))
      .map((c) => `${c.method} ${c.url}`);
    expect(searches).toEqual([
      `GET ${SERVER}/api/v1/repos/search?owner=orgA&lang=es&limit=1`,
      `GET ${SERVER}/api/v1/repos/search?owner=orgB&lang=es&limit=1`,
      `GET ${SERVER}/api/v1/repos/search?owner=orgC&lang=es&limit=1`,
    ]);
    expect(door43.calls.every((c) => c.url.startsWith(`${SERVER}/api/v1/`))).toBe(true);
    expect(door43.calls.some((c) => c.url.includes(SESSION.token))).toBe(false);
  });

  it('a count that is not in X-Total-Count is an error, not zero', async () => {
    const api = new Door43Api({
      server: SERVER,
      fetchFn: async () => new Response('{"ok":true,"data":[]}', { status: 200 }),
    });
    await expect(api.countRepositories(SESSION, 'orgA', 'es')).rejects.toThrow(/X-Total-Count/);
  });
});
