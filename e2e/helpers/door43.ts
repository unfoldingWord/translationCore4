// A fake Door43 for the share legs (issues #362, #203, #185): the API calls the
// adapter makes, answered from memory with Door43's own shapes and status
// codes [VERIFIED — `swagger.v1.json` `1.27.3+dcs`, and read-only calls against
// qa.door43.org, 2026-09-28]. One handler serves two harnesses: a Playwright
// route on the browser context (the journeys) and a `fetchFn` (the Vitest
// suites). Every request is kept in `calls`, so a test can assert which server
// each call went to and that no URL carries the token.
//
// A created repository's `clone_url` comes from `cloneUrlFor`, so a rig leg can
// point the push at a local `file://` remote it controls; the default is the
// address Door43 would give.
import type { BrowserContext } from '@playwright/test';

export interface FakeOrganization {
  username: string;
  fullName?: string;
  canCreateRepository: boolean;
  /** Repositories by language tag, for `GET /repos/search` `X-Total-Count`. */
  repositories?: Record<string, number>;
}

export interface FakeDoor43Options {
  /** The server the app is built for (`DCS_SERVER`); calls to any other host are refused. */
  server: string;
  /** `email` lets a sign-in use the email as the login (#203). */
  user: { username: string; password: string; email?: string };
  /** Every request answers 503 (the sign-in's server-unavailable leg, #203). */
  outage?: boolean;
  organizations?: FakeOrganization[];
  /** `<owner>/<name>` that exist already. */
  existingRepositories?: string[];
  /** Tokens that are valid from the start (a session that skipped sign-in). */
  tokens?: string[];
  /** Token names the account holds already (the qa risk of #203: a stale `translationCore`). */
  existingTokens?: string[];
  cloneUrlFor?: (fullName: string) => string;
}

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** The UTF-8 text behind a Basic credential, or null when it is not base64. */
const decodeBasic = (credentials: string): string | null => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(credentials), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept',
  'Access-Control-Expose-Headers': 'X-Total-Count',
};

export class FakeDoor43 {
  readonly calls: FakeCall[] = [];
  /** `<owner>/<name>` → the clone url it was created with. */
  readonly repositories = new Map<string, string>();
  /** Token name → secret, for the token routes of #203. */
  readonly tokens = new Map<string, string>();
  /** The account's tokens as Door43 lists them: by id, the secret never listed. */
  readonly tokenRows: Array<{ id: number; name: string; secret: string; scopes: string[] }> = [];
  private readonly valid = new Set<string>();
  private readonly options: FakeDoor43Options;
  private nextToken = 1;

  constructor(options: FakeDoor43Options) {
    this.options = options;
    for (const name of options.existingRepositories ?? [])
      this.repositories.set(name, this.cloneUrl(name));
    for (const token of options.tokens ?? []) this.valid.add(token);
    for (const name of options.existingTokens ?? []) {
      const secret = `stale-token-${this.nextToken++}`;
      this.tokenRows.push({ id: this.nextToken, name, secret, scopes: [] });
      this.tokens.set(name, secret);
    }
  }

  private cloneUrl(fullName: string): string {
    return this.options.cloneUrlFor?.(fullName) ?? `${this.options.server}/${fullName}.git`;
  }

  /** Answer one request the way Door43 would. */
  handle(call: FakeCall): { status: number; headers: Record<string, string>; body: string } {
    this.calls.push(call);
    const answer = this.answer(call);
    const headers = { ...CORS, 'Content-Type': 'application/json', ...(answer.headers ?? {}) };
    return {
      status: answer.status,
      headers,
      body: answer.body === undefined ? '' : JSON.stringify(answer.body),
    };
  }

  private answer(call: FakeCall): Answer {
    if (call.method === 'OPTIONS') return { status: 204 };
    const url = new URL(call.url);
    if (`${url.protocol}//${url.host}` !== this.options.server)
      return { status: 421, body: { message: `wrong server: ${url.host}` } };
    const route = url.pathname.replace(/^\/api\/v1/, '');
    const unauthorized: Answer = {
      status: 401,
      body: {
        message: 'invalid username, password or token',
        url: `${this.options.server}/api/swagger`,
      },
    };
    const authorization = call.headers.authorization ?? call.headers.Authorization ?? '';
    if (this.options.outage) return { status: 503, body: { message: 'service unavailable' } };

    // The sign-in routes (#203) take Basic auth, with the username or the
    // email as the login; everything else the token.
    const [scheme, credentials] = authorization.split(' ');
    const { username, email, password } = this.options.user;
    // Basic credentials are base64 over the UTF-8 bytes, as Gitea decodes them.
    const decoded = scheme === 'Basic' ? decodeBasic(credentials ?? '') : null;
    const basicOk = [username, email].some((login) => login && decoded === `${login}:${password}`);
    if (route === '/user' && call.method === 'GET' && scheme === 'Basic') {
      if (!basicOk) return unauthorized;
      return { status: 200, body: { id: 1, login: username, username, email: email ?? '' } };
    }
    const tokens = route.match(/^\/users\/([^/]+)\/tokens(?:\/(\d+))?$/);
    if (tokens) {
      if (!basicOk || tokens[1] !== username) return unauthorized;
      if (tokens[2]) {
        if (call.method !== 'DELETE') return { status: 404, body: { message: 'not found' } };
        const id = Number(tokens[2]);
        const held = this.tokenRows.find((row) => row.id === id);
        if (!held) return { status: 404, body: { message: 'token not found' } };
        this.tokenRows.splice(this.tokenRows.indexOf(held), 1);
        this.tokens.delete(held.name);
        this.valid.delete(held.secret);
        return { status: 204 };
      }
      if (call.method === 'GET') {
        return {
          status: 200,
          body: this.tokenRows.map((row) => ({
            id: row.id,
            name: row.name,
            token_last_eight: row.secret.slice(-8),
            scopes: row.scopes,
          })),
        };
      }
      const body = JSON.parse(call.body ?? '{}') as { name?: string; scopes?: string[] };
      if (!body.name) return { status: 422, body: { message: 'name is required' } };
      if (this.tokens.has(body.name))
        return { status: 400, body: { message: `access token name has been used already` } };
      const secret = `fake-token-${this.nextToken++}`;
      const row = { id: this.nextToken, name: body.name, secret, scopes: body.scopes ?? [] };
      this.tokenRows.push(row);
      this.tokens.set(body.name, secret);
      this.valid.add(secret);
      return {
        status: 201,
        body: { id: row.id, name: row.name, sha1: secret, scopes: row.scopes },
      };
    }

    if (route.startsWith('/repos/search')) {
      const owner = url.searchParams.get('owner') ?? '';
      const lang = url.searchParams.get('lang') ?? '';
      const org = this.options.organizations?.find((o) => o.username === owner);
      const count = org?.repositories?.[lang] ?? 0;
      return {
        status: 200,
        headers: { 'X-Total-Count': String(count) },
        body: { ok: true, data: [] },
      };
    }

    const token = authorization.startsWith('token ') ? authorization.slice(6) : '';
    if (!this.valid.has(token)) return unauthorized;

    if (route === '/user' && call.method === 'GET') {
      return {
        status: 200,
        body: { login: this.options.user.username, username: this.options.user.username },
      };
    }
    if (route === '/user/orgs' && call.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const page = Number(url.searchParams.get('page') ?? 1);
      const rows = (this.options.organizations ?? []).slice((page - 1) * limit, page * limit);
      return {
        status: 200,
        body: rows.map((o, id) => ({
          id: id + 1,
          username: o.username,
          full_name: o.fullName ?? '',
        })),
      };
    }
    const permissions = route.match(/^\/users\/([^/]+)\/orgs\/([^/]+)\/permissions$/);
    if (permissions && call.method === 'GET') {
      const org = this.options.organizations?.find((o) => o.username === permissions[2]);
      if (!org || permissions[1] !== this.options.user.username)
        return { status: 404, body: { message: 'not found' } };
      return {
        status: 200,
        body: {
          can_create_repository: org.canCreateRepository,
          can_read: true,
          can_write: org.canCreateRepository,
          is_admin: false,
          is_owner: false,
        },
      };
    }
    if (call.method === 'POST') {
      const org = route.match(/^\/orgs\/([^/]+)\/repos$/);
      let owner: string | null = null;
      if (route === '/user/repos') owner = this.options.user.username;
      else if (org) {
        const found = this.options.organizations?.find((o) => o.username === org[1]);
        if (!found) return { status: 404, body: { message: 'not found' } };
        if (!found.canCreateRepository)
          return {
            status: 403,
            body: { message: 'user is not allowed to create repositories in this organization' },
          };
        owner = found.username;
      }
      if (owner) {
        const body = JSON.parse(call.body ?? '{}') as { name?: string };
        if (!body.name) return { status: 422, body: { message: 'name is required' } };
        const fullName = `${owner}/${body.name}`;
        if (this.repositories.has(fullName))
          return {
            status: 409,
            body: { message: 'The repository with the same name already exists.' },
          };
        const cloneUrl = this.cloneUrl(fullName);
        this.repositories.set(fullName, cloneUrl);
        return {
          status: 201,
          body: {
            id: this.repositories.size,
            name: body.name,
            full_name: fullName,
            html_url: `${this.options.server}/${fullName}`,
            clone_url: cloneUrl,
            default_branch: 'main',
            owner: { login: owner },
          },
        };
      }
    }
    return { status: 404, body: { message: 'not found' } };
  }

  /** The fake as a `fetch`, for a `Door43Api({ fetchFn })` in a Vitest suite. */
  get fetchFn(): typeof fetch {
    return async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const body = typeof init?.body === 'string' ? init.body : null;
      const answer = this.handle({ method: init?.method ?? 'GET', url, headers, body });
      return new Response(answer.status === 204 ? null : answer.body, {
        status: answer.status,
        headers: answer.headers,
      });
    };
  }

  /** Serve the fake from the browser context: every request to the server. */
  async route(context: BrowserContext): Promise<void> {
    await context.route(`${this.options.server}/**`, async (route) => {
      const request = route.request();
      const answer = this.handle({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      });
      await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
  }
}
