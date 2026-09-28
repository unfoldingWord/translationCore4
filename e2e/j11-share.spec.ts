// J11 — Share the project to Door43: sign in once, push the working main branch, read the URL
// docs/JOURNEYS.md J11 · Increment 8.5 (#362 share operation, #203 sign-in, #120 authority, #185 journey)
//
// The sign-in cases (#203) run here against the fake Door43 (e2e/helpers/door43.ts), served
// as a Playwright route on the QA server the dev build signs in to. Until #362 pull request 2
// adds the Share action, the Door43 bar's Sign in on Home opens the same sign-in step, and the
// cases use it; the legs that need a push stay fixme. The live leg runs against qa.door43.org
// only when the QA credentials are present (#185) and reports a labelled skip otherwise.
// Ground truth is the fake's record of calls, the rig's disk and the browser's storage, never
// the app's own claims.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { FakeDoor43, type FakeDoor43Options } from './helpers/door43';
import { TC4_ROOT, readShareIdentity, resetShareIdentity } from './helpers/rig';

/** The server a development build signs in to (src/data/dcsServer.ts, #120). */
const QA_SERVER = 'https://qa.door43.org';
const RIG_API = 'http://127.0.0.1:19998/api';
const RIG_STATE = path.join(TC4_ROOT, 'dev-env', 'state');
const USER = { username: 'facilitator', password: 'a pass-word', email: 'facilitator@example.org' };
const IDENTITY = { name: 'Ana Ejemplo', email: 'ana@example.org' };
const D7_NOTICE = /name and email are recorded in every commit you share/;
const SESSION_REASON = /lasts for one app session/;

/** The scopes the adapter asks for, read from its source (test 3 asserts against this list;
 * the adapter module is not imported here because it reads `import.meta.env`). */
const scopesInSource = (): string[] => {
  const source = fs.readFileSync(path.join(TC4_ROOT, 'src', 'data', 'share', 'door43Api.ts'), 'utf8');
  const literal = source.match(/TOKEN_SCOPES[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/);
  if (!literal) throw new Error('TOKEN_SCOPES not found in door43Api.ts');
  return [...literal[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/** Every file under `dir` whose bytes contain `needle`. */
const filesHolding = (dir: string, needle: string): string[] => {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && fs.readFileSync(full).includes(needle)) out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out;
};

async function fakeFor(context: BrowserContext, extra: Partial<FakeDoor43Options> = {}): Promise<FakeDoor43> {
  const fake = new FakeDoor43({ server: QA_SERVER, user: USER, ...extra });
  await fake.route(context);
  return fake;
}

async function signIn(page: Page, opts: { identity?: boolean; password?: string } = {}): Promise<void> {
  if (opts.identity) {
    await page.getByLabel('Name', { exact: true }).fill(IDENTITY.name);
    await page.getByLabel('Email', { exact: true }).fill(IDENTITY.email);
  }
  await page.getByLabel('Door43 username or email').fill(USER.username);
  await page.getByLabel('Password', { exact: true }).fill(opts.password ?? USER.password);
  await page.getByTestId('signin-submit').click();
}

const SIGNED_IN = `Signed in to Door43 as ${USER.username}`;
const NOT_SIGNED_IN = 'Not signed in to Door43';

test.describe('J11 — a facilitator shares the project to Door43', () => {
  test.describe('sign in (#203)', () => {
    test.beforeAll(async () => {
      // The rig boots with the net gate off; sign-in refuses offline before any Door43 call.
      await fetch(`${RIG_API}/net/enable`, { method: 'POST' });
    });
    test.afterAll(async () => {
      await fetch(`${RIG_API}/net/disable`, { method: 'POST' });
    });
    test.beforeEach(async ({ page }) => {
      resetShareIdentity();
      await page.goto('/');
      await expect(page.getByTestId('door43-bar')).toBeVisible();
    });

    test('1. the sign-in step shows the fields, the checkbox, the D7 notice and the server; Cancel creates and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      const dialog = page.getByTestId('share-signin');
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel('Door43 username or email')).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
      await expect(page.getByLabel('Stay signed in on this computer')).not.toBeChecked();
      // A fresh installation: the name, the email and the D7 notice.
      await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await expect(page.getByTestId('signin-notice')).toHaveText(D7_NOTICE);
      await expect(page.getByTestId('signin-server')).toContainText('qa.door43.org');
      await expect(page.getByTestId('signin-cancel')).toBeVisible();
      await expect(page.getByTestId('signin-submit')).toHaveText('Sign in');
      // Cancel: no call reached Door43, no token exists, nothing stored.
      await page.getByLabel('Name', { exact: true }).fill(IDENTITY.name);
      await page.getByTestId('signin-cancel').click();
      await expect(dialog).toHaveCount(0);
      expect(fake.calls).toEqual([]);
      expect(fake.tokens.size).toBe(0);
      expect(readShareIdentity()).toBeNull();
      await expect(page.getByTestId('door43-bar')).toHaveAttribute('data-signed-in', '0');
    });

    test('2. the Door43 bar says "Not signed in" before, the user after; Sign out, then Sign in asks the password again', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      const status = page.getByTestId('door43-status');
      await expect(status).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page, { identity: true });
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(status).toHaveText(SIGNED_IN);
      await expect(page.getByTestId('door43-bar')).toHaveAttribute('data-signed-in', '1');
      // The fake minted the app's token with the adapter's scopes (test 3, the fake leg).
      expect(fake.tokenRows.map((row) => [row.name, row.scopes])).toEqual([['translationCore', scopesInSource()]]);
      expect(readShareIdentity()).toEqual({ ...IDENTITY, login: USER.username });

      await page.getByTestId('door43-sign-out').click();
      await expect(status).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue(USER.username);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      // The identity is stored: shown with Change, not asked again (test 4, the installation part).
      await expect(page.getByTestId('signin-identity')).toContainText(`${IDENTITY.name} <${IDENTITY.email}>`);
      await expect(page.getByTestId('signin-identity-form')).toHaveCount(0);
      await expect(page.getByTestId('signin-reason')).toHaveCount(0);
      const created = fake.calls.filter((c) => c.method === 'POST').length;
      await signIn(page);
      await expect(status).toHaveText(SIGNED_IN);
      expect(fake.calls.filter((c) => c.method === 'POST').length).toBe(created + 1);
    });

    test('3. (live) the token on qa.door43.org has the scopes the adapter names', { tag: ['@inc85', '@J11'] }, async () => {
      const user = process.env.DCS_QA_USER;
      const secret = process.env.DCS_QA_PASSWORD ?? process.env.DCS_QA_TOKEN;
      test.skip(!user || !secret, 'labelled skip: set DCS_QA_USER and DCS_QA_PASSWORD (or DCS_QA_TOKEN) to run the live leg on qa.door43.org');
      // The Basic credentials over UTF-8, as the adapter builds them.
      const basic = `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
      const headers = { Authorization: basic, Accept: 'application/json', 'Content-Type': 'application/json' };
      const me = await fetch(`${QA_SERVER}/api/v1/user`, { headers });
      expect(me.status, 'GET /user with the QA credentials').toBe(200);
      const { login } = (await me.json()) as { login: string };
      const tokensRoute = `${QA_SERVER}/api/v1/users/${encodeURIComponent(login)}/tokens`;
      // The adapter's own sequence, on the real server: drop a stale translationCore, mint it again.
      const listed = (await (await fetch(`${tokensRoute}?limit=50`, { headers })).json()) as Array<{ id: number; name: string }>;
      for (const token of listed) if (token.name === 'translationCore') await fetch(`${tokensRoute}/${token.id}`, { method: 'DELETE', headers });
      const created = await fetch(tokensRoute, { method: 'POST', headers, body: JSON.stringify({ name: 'translationCore', scopes: scopesInSource() }) });
      expect(created.status, await created.text().catch(() => '')).toBe(201);
      const after = (await (await fetch(`${tokensRoute}?limit=50`, { headers })).json()) as Array<{ name: string; scopes: string[] }>;
      expect(after.find((token) => token.name === 'translationCore')?.scopes.sort()).toEqual([...scopesInSource()].sort());
      // The create and the push with this token are the live leg of #185.
    });

    test.fixme('4. name and email for the installation: project B asks nothing; the pushed commit carries the author; Change gives the next commit a new author', { tag: ['@inc85', '@J11'] }, async () => {
      // Needs the Share action and a push (#362 pull request 2). The author assertion also
      // needs a platform route that sets the commit signature: pankosmia-web 0.18.5
      // `add_and_commit.rs` takes `repo.signature()` from the git config, and no route
      // writes it (finding routed through the owner). The installation part of this
      // test (stored once, shown with Change, changed there) runs in cases 2 and 7.
    });

    test('5. a sign-in failure names the cause with its code, and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page, { identity: true, password: 'wrong' });
      const error = page.getByTestId('signin-error');
      await expect(error).toHaveAttribute('data-code', 'share.auth-failed');
      await expect(error).toContainText('did not accept that username or password');
      await expect(page.getByTestId('door43-status')).toHaveText(NOT_SIGNED_IN);
      expect(readShareIdentity()).toBeNull();
      // The other causes (no network, a 5xx) are test/share/signin.test.ts: the real server cannot fail on demand.
    });

    test('6. after a sign-in without "Stay signed in", the token is on no disk and in no storage', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page, { identity: true });
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
      const token = fake.tokens.get('translationCore');
      expect(token).toBeTruthy();
      // The rig's disk (its state: repos, client settings, temp) holds no file with the token or the password.
      expect(filesHolding(RIG_STATE, token!)).toEqual([]);
      expect(filesHolding(RIG_STATE, USER.password)).toEqual([]);
      // The app's storage in the browser: localStorage and sessionStorage hold no value with either.
      const stored = await page.evaluate(() => {
        const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
        return [...dump(localStorage), ...dump(sessionStorage)];
      });
      expect(stored.filter((entry) => entry.includes(token!) || entry.includes(USER.password))).toEqual([]);
      // The negative control: the identity IS on the rig's disk, so the search can find things.
      expect(filesHolding(RIG_STATE, IDENTITY.email)).not.toEqual([]);
    });

    test('7. a new app session without a kept token asks only the password, says why in one line; Change is where the identity changes', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page, { identity: true });
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
      // A new app session: the token was in renderer memory only.
      await page.reload();
      await expect(page.getByTestId('door43-status')).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue(USER.username);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.getByTestId('signin-reason')).toHaveText(SESSION_REASON);
      await expect(page.getByTestId('signin-identity-form')).toHaveCount(0);
      // Change is the only place the identity changes (D84 point 7).
      await page.getByTestId('signin-change').click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(IDENTITY.name);
      await page.getByLabel('Name', { exact: true }).fill('Ana Cambiada');
      await expect(page.getByTestId('signin-notice')).toHaveText(D7_NOTICE);
      await signIn(page);
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
      expect(readShareIdentity()).toEqual({ name: 'Ana Cambiada', email: IDENTITY.email, login: USER.username });
    });

    test.fixme('7b. a later share in the same session asks nothing (Upload changes)', { tag: ['@inc85', '@J11'] }, async () => {
      // Needs the Share action (#362 pull request 2).
    });
  });

  test.fixme(
    'the first share signs in once, creates the repository under the account, and pushes main',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'a second share pushes main again with no dialog, and the project is byte-identical',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'a name collision, a non-fast-forward push, and an offline app each refuse with a Report code and push nothing',
    { tag: ['@inc85', '@J11'] },
    async () => {},
  );
  test.fixme(
    'an OBS project shares the same way (J24)',
    { tag: ['@inc85', '@J11', '@J24'] },
    async () => {},
  );
});
