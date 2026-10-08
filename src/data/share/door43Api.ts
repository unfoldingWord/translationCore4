// The Door43 adapter (issue #362, D79 point 12, D84 point 3): the ONE module
// that calls the Door43 API. Every call takes its server from `DCS_SERVER`
// (#120): the QA server in a development build, production in a packaged
// build. No other file under src/ builds a Door43 API address, and no file
// under src/data/share/ names a Door43 host, this comment included
// (test/noBypass.test.ts).
//
// The token travels in the `Authorization: token …` header only. It is never
// put in a URL, never written, never logged: an error carries the route, the
// status and Door43's message, nothing of the request.
//
// Shapes [VERIFIED — Door43 `swagger.v1.json`, `1.27.3+dcs`, read 2026-09-28,
// and read-only calls against the QA server the same day]:
// - `GET /api/v1/user/orgs` → `Organization[]` (`username`, `full_name`), paged.
// - `GET /api/v1/users/{username}/orgs/{org}/permissions` → `{can_create_repository, …}`.
// - `GET /api/v1/repos/search?owner=<org>&lang=<tag>&limit=1` → the count is the
//   `X-Total-Count` header (37 for unfoldingWord/en, 0 for a made-up tag), which
//   Door43 exposes to a browser (`Access-Control-Expose-Headers`).
// - `POST /api/v1/user/repos` and `POST /api/v1/orgs/{org}/repos` with
//   `CreateRepoOption` → 201 `Repository` (`full_name`, `html_url`, `clone_url`);
//   409 when the name exists on the account (the swagger lists no 409 for the
//   organization route; the live leg of #185 records that answer).
// - A failure body is `{"message": "…", "url": "…"}`; 401 says
//   "invalid username, password or token".
// - The sign-in (#203, D79 point 13), with Basic auth (username or email, and
//   the password) on each call [swagger read 2026-09-28; the live leg of #203
//   test 3 runs these on the QA server when the QA credentials are present]:
//   `GET /api/v1/user` → `{login}`; `GET /api/v1/users/{login}/tokens` →
//   `AccessToken[]` (`id`, `name`, `token_last_eight`, `scopes`; the secret
//   is not listed); `DELETE /api/v1/users/{login}/tokens/{id}` → 204;
//   `POST /api/v1/users/{login}/tokens` with `CreateAccessTokenOption`
//   (`name`, `scopes`) → 201 `AccessToken` with `sha1`, the secret, shown
//   once; 400 when the name is used already.
import { DCS_SERVER } from '../dcsServer';
import { NO_CONSENT } from '../internet';

/** A signed-in Door43 user: the token is held in memory by #203, never here.
 * `username` is the account login (it goes into the permissions route), not
 * the email a person may sign in with; `signIn` reads it from `GET /api/v1/user`. */
export interface Door43Session {
  username: string;
  token: string;
}

/** The name of the token the app mints on the user's account (D79 point 13).
 * tC3's is `translation-core`; the two never collide. */
export const TOKEN_NAME = 'translationCore';

/** The scopes the token asks for (D84 point 6): create a repository under the
 * account (`POST /user/repos` needs `write:user`) or an organization
 * (`POST /orgs/{org}/repos` needs `write:organization`), and push to it
 * (`write:repository`, which holds the read of `GET /repos/search`). A write
 * scope holds the read of its group, so `GET /user`, `GET /user/orgs` and the
 * organization permissions need no scope of their own. Door43 `1.27.3+dcs`
 * refused a create with `read:user` and `read:organization` (issue #467). */
export const TOKEN_SCOPES: readonly string[] = Object.freeze([
  'write:repository',
  'write:organization',
  'write:user',
]);

/** `Basic` credentials over the UTF-8 bytes (`btoa` alone refuses a password
 * with a character outside Latin-1). */
const basicAuthorization = (login: string, password: string): string => {
  const bytes = new TextEncoder().encode(`${login}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`;
};

export interface Door43Organization {
  /** The organization's account name, as it appears in a repository path. */
  username: string;
  fullName: string;
}

/** Where a share creates the repository (D84 point 3). */
export type ShareTarget = { kind: 'user' } | { kind: 'organization'; organization: string };

export interface Door43Repository {
  /** `<owner>/<name>`. */
  fullName: string;
  /** The page a person opens. */
  htmlUrl: string;
  /** The address git pushes to. */
  cloneUrl: string;
}

/** A Door43 answer other than success: the route, the HTTP status and Door43's
 * own message. `status` 0 means the request never got an answer (no network). */
export class Door43ApiError extends Error {
  readonly route: string;
  readonly status: number;

  constructor(route: string, status: number, message: string) {
    super(`${route} failed (HTTP ${status}): ${message}`);
    this.name = 'Door43ApiError';
    this.route = route;
    this.status = status;
  }
}

export interface Door43ApiInit {
  /** The server; defaults to `DCS_SERVER`. Tests pass the fake's address. */
  server?: string;
  /** Injectable fetch for the fake; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** D95: whether the internet is on for the app session. False refuses
   * every call before a request is made; the platform gate does not cover
   * this module, because it calls Door43 from the client. */
  allowed?: () => boolean;
}

/** A path segment that Door43 accepts as an account or repository name; refused
 * client-side so a bad name is a typed error, never a surprise route. */
const assertName = (name: string, what: string): void => {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) {
    throw new Door43ApiError(
      what,
      0,
      `${what} must be letters, digits, . _ or -, not starting or ending with a symbol: ${JSON.stringify(name)}`,
    );
  }
};

const messageOf = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // not a JSON body — the raw text is the message
  }
  return text.slice(0, 200) || '(empty body)';
};

export class Door43Api {
  readonly server: string;
  private readonly fetchFn: typeof fetch;
  private readonly allowed: () => boolean;

  constructor(init: Door43ApiInit = {}) {
    this.server = (init.server ?? DCS_SERVER).replace(/\/+$/, '');
    this.fetchFn = init.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.allowed = init.allowed ?? (() => true);
  }

  private async request(
    route: string,
    session: Door43Session | null,
    init: { method?: string; body?: unknown; authorization?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.authorization) headers.Authorization = init.authorization;
    else if (session) headers.Authorization = `token ${session.token}`;
    const request: RequestInit = { method: init.method ?? 'GET', headers };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(init.body);
    }
    if (!this.allowed()) throw new Door43ApiError(route, 0, NO_CONSENT);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.server}/api/v1${route}`, request);
    } catch (error) {
      throw new Door43ApiError(route, 0, String((error as Error)?.message ?? error));
    }
    if (!response.ok)
      throw new Door43ApiError(route, response.status, messageOf(await response.text()));
    return response;
  }

  /** The account login a token belongs to (`GET /api/v1/user` with the token;
   * #366 resumes a kept token with it). A revoked or expired token answers
   * 401, a `Door43ApiError` with that status. */
  async user(token: string): Promise<string> {
    const user = (await (await this.request('/user', { username: '', token })).json()) as { login?: unknown };
    if (typeof user.login !== 'string' || !user.login)
      throw new Door43ApiError('/user', 200, 'the answer carries no login');
    try {
      assertName(user.login, 'username');
    } catch (error) {
      throw new Door43ApiError('/user', 200, (error as Error).message);
    }
    return user.login;
  }

  /** The organizations the user belongs to, every page. */
  async listOrganizations(session: Door43Session): Promise<Door43Organization[]> {
    const limit = 50;
    const out: Door43Organization[] = [];
    for (let page = 1; ; page++) {
      const response = await this.request(`/user/orgs?limit=${limit}&page=${page}`, session);
      const rows = (await response.json()) as Array<{ username: string; full_name?: string }>;
      for (const row of rows)
        out.push({ username: row.username, fullName: row.full_name || row.username });
      if (rows.length < limit) return out;
    }
  }

  /** Whether the user may create a repository in `organization`. */
  async canCreateRepository(session: Door43Session, organization: string): Promise<boolean> {
    assertName(organization, 'organization');
    assertName(session.username, 'username');
    const response = await this.request(
      `/users/${encodeURIComponent(session.username)}/orgs/${encodeURIComponent(organization)}/permissions`,
      session,
    );
    const body = (await response.json()) as { can_create_repository?: boolean };
    return body.can_create_repository === true;
  }

  /** How many repositories `owner` has in the language `tag`: the
   * `X-Total-Count` of the search, with `limit=1` so no repository body is read. */
  async countRepositories(
    session: Door43Session | null,
    owner: string,
    tag: string,
  ): Promise<number> {
    assertName(owner, 'owner');
    const response = await this.request(
      `/repos/search?owner=${encodeURIComponent(owner)}&lang=${encodeURIComponent(tag)}&limit=1`,
      session,
    );
    const raw = response.headers.get('X-Total-Count');
    if (raw === null || !/^\d+$/.test(raw))
      throw new Door43ApiError(
        '/repos/search',
        response.status,
        `the answer carries no X-Total-Count (got ${JSON.stringify(raw)})`,
      );
    return Number(raw);
  }

  /** Create the repository `name` under the account or the organization. */
  async createRepository(
    session: Door43Session,
    target: ShareTarget,
    name: string,
  ): Promise<Door43Repository> {
    assertName(name, 'repository name');
    let route = '/user/repos';
    if (target.kind === 'organization') {
      assertName(target.organization, 'organization');
      route = `/orgs/${encodeURIComponent(target.organization)}/repos`;
    }
    // `auto_init: false`: the push brings the whole history; an initial commit
    // on Door43 would make the first push a non-fast-forward.
    const response = await this.request(route, session, {
      method: 'POST',
      body: { name, auto_init: false, default_branch: 'main', private: false },
    });
    const body = (await response.json()) as {
      full_name: string;
      html_url: string;
      clone_url: string;
    };
    return { fullName: body.full_name, htmlUrl: body.html_url, cloneUrl: body.clone_url };
  }

  /** Sign in with a username or an email and the password (D79 point 13,
   * tC3's flow): read the account login, drop the token named `translationCore`
   * when the account holds one (Door43 lists a token without its secret and
   * refuses a second token of the same name), and mint it again with
   * `TOKEN_SCOPES`. The password travels in the `Authorization` header of
   * these calls only; the caller keeps the session in memory (#203). */
  async signIn(login: string, password: string): Promise<Door43Session> {
    const authorization = basicAuthorization(login, password);
    const basic = { authorization };
    const user = (await (await this.request('/user', null, basic)).json()) as { login?: unknown };
    if (typeof user.login !== 'string' || !user.login)
      throw new Door43ApiError('/user', 200, 'the answer carries no login');
    // Door43 answered, so a login that fails the name rule is its answer (200),
    // not an unreachable server (status 0).
    try {
      assertName(user.login, 'username');
    } catch (error) {
      throw new Door43ApiError('/user', 200, (error as Error).message);
    }
    const tokensRoute = `/users/${encodeURIComponent(user.login)}/tokens`;
    const tokens = (await (await this.request(`${tokensRoute}?limit=50`, null, basic)).json()) as Array<{
      id: number;
      name: string;
    }>;
    for (const token of tokens) {
      if (token.name === TOKEN_NAME)
        await this.request(`${tokensRoute}/${token.id}`, null, { ...basic, method: 'DELETE' });
    }
    const created = (await (
      await this.request(tokensRoute, null, {
        ...basic,
        method: 'POST',
        body: { name: TOKEN_NAME, scopes: [...TOKEN_SCOPES] },
      })
    ).json()) as { sha1?: string };
    if (!created.sha1)
      throw new Door43ApiError(tokensRoute, 201, 'the created token carries no secret');
    return { username: user.login, token: created.sha1 };
  }
}
