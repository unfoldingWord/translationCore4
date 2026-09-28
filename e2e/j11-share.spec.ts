// J11 — Share the project to Door43: sign in once, push the working main branch, read the URL
// docs/JOURNEYS.md J11 · Increment 8.5 (#362 share operation, #203 sign-in, #120 authority, #185 journey)
//
// The sign-in cases (#203) run here against the fake Door43 (e2e/helpers/door43.ts), served
// as a Playwright route on the QA server the dev build signs in to. Until #362 pull request 2
// adds the Share action, the Door43 bar's Sign in on Home opens the same sign-in step, and the
// cases use it; the legs that need a push stay fixme. The live leg runs against qa.door43.org
// only when the QA credentials are present (#185) and reports a labelled skip otherwise.
// Ground truth is the fake's record of calls, the rig's disk and the browser's storage, never
// the app's own claims. D85: nothing but a kept token is stored, so the disk checks look for
// the token, the password and the login and expect none.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { FakeDoor43, type FakeDoor43Options } from './helpers/door43';
import { TC4_ROOT, readClientSettingsDoc } from './helpers/rig';

/** The server a development build signs in to (src/data/dcsServer.ts, #120). */
const QA_SERVER = 'https://qa.door43.org';
const RIG_API = 'http://127.0.0.1:19998/api';
const RIG_STATE = path.join(TC4_ROOT, 'dev-env', 'state');
const USER = { username: 'facilitator-zq', password: 'a pass-word', email: 'facilitator-zq@example.org' };
const AUTHOR_NOTICE = /signed with the account name of this computer/;
const SESSION_NOTE = /lasts for one app session/;

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

async function signIn(page: Page, password = USER.password): Promise<void> {
  await page.getByLabel('Door43 username or email').fill(USER.username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('signin-submit').click();
}

/** The keys the app's client-settings document holds on the rig: none may record the person. */
const settingsKeys = (): string[] => Object.keys(readClientSettingsDoc() ?? {});
const PERSON_KEYS = /identity|login|user|name|email|token/i;

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
      await page.goto('/');
      await expect(page.getByTestId('door43-bar')).toBeVisible();
    });

    test('1. the sign-in step shows the fields, the checkbox, the author notice and the server; Cancel creates and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      const dialog = page.getByTestId('share-signin');
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue('');
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
      await expect(page.getByLabel('Stay signed in on this computer')).not.toBeChecked();
      // D85: no name, no email, no Change; the author notice tells the truth instead.
      await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('signin-notice')).toHaveText(AUTHOR_NOTICE);
      await expect(page.getByTestId('signin-server')).toContainText('qa.door43.org');
      await expect(page.getByTestId('signin-cancel')).toBeVisible();
      await expect(page.getByTestId('signin-submit')).toHaveText('Sign in');
      // Cancel: no call reached Door43, no token exists, nothing stored.
      await page.getByLabel('Door43 username or email').fill(USER.username);
      await page.getByTestId('signin-cancel').click();
      await expect(dialog).toHaveCount(0);
      expect(fake.calls).toEqual([]);
      expect(fake.tokens.size).toBe(0);
      expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);
      await expect(page.getByTestId('door43-bar')).toHaveAttribute('data-signed-in', '0');
    });

    test('2. the Door43 bar says "Not signed in" before, the user after; Sign out, then Sign in asks everything again', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      const status = page.getByTestId('door43-status');
      await expect(status).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page);
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(status).toHaveText(SIGNED_IN);
      await expect(page.getByTestId('door43-bar')).toHaveAttribute('data-signed-in', '1');
      // The fake minted the app's token with the adapter's scopes (test 3, the fake leg).
      expect(fake.tokenRows.map((row) => [row.name, row.scopes])).toEqual([['translationCore', scopesInSource()]]);
      // D85: the username on the bar is Door43's answer; the rig's settings hold no record of it.
      expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);

      await page.getByTestId('door43-sign-out').click();
      await expect(status).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue('');
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
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

    test.fixme('4. the pushed commit carries the computer account name as its author, and Door43 shows it', { tag: ['@inc85', '@J11'] }, async () => {
      // Needs the Share action and a push (#362 pull request 2). The platform sets the author
      // at project creation (user.name = the OS account name, user.email = <that>@localhost)
      // and signs every commit with it (PLATFORM-NOTES #47, D85); the app stores no identity.
    });

    test('5. a sign-in failure names the cause with its code, and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page, 'wrong');
      const error = page.getByTestId('signin-error');
      await expect(error).toHaveAttribute('data-code', 'share.auth-failed');
      await expect(error).toContainText('did not accept that username or password');
      await expect(page.getByTestId('door43-status')).toHaveText(NOT_SIGNED_IN);
      expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);
      // The other causes (no network, a 5xx) are test/share/signin.test.ts: the real server cannot fail on demand.
    });

    test('6. after a sign-in without "Stay signed in", the token, the password and the login are on no disk and in no storage', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page);
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
      const token = fake.tokens.get('translationCore');
      expect(token).toBeTruthy();
      // The rig's disk (its state: repos, client settings, temp) holds no file with any of the three.
      for (const secret of [token!, USER.password, USER.username]) expect(filesHolding(RIG_STATE, secret), secret).toEqual([]);
      // The app's storage in the browser: localStorage and sessionStorage hold no value with them.
      const stored = await page.evaluate(() => {
        const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
        return [...dump(localStorage), ...dump(sessionStorage)];
      });
      expect(stored.filter((entry) => [token!, USER.password, USER.username].some((s) => entry.includes(s)))).toEqual([]);
      // The negative control: the seed's install records ARE on the rig's disk, so the search can find things.
      expect(filesHolding(RIG_STATE, 'installedResources')).not.toEqual([]);
    });

    test('7. a new app session without a kept token asks the sign-in again, and says why in one line', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      await page.getByTestId('door43-sign-in').click();
      await signIn(page);
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
      // A new app session: the token was in renderer memory only, and nothing else was stored.
      await page.reload();
      await expect(page.getByTestId('door43-status')).toHaveText(NOT_SIGNED_IN);
      await page.getByTestId('door43-sign-in').click();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue('');
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.getByTestId('signin-reason')).toHaveText(SESSION_NOTE);
      await expect(page.getByTestId('signin-notice')).toHaveText(AUTHOR_NOTICE);
      await signIn(page);
      await expect(page.getByTestId('door43-status')).toHaveText(SIGNED_IN);
    });

    test.fixme('7b. a later share in the same session asks nothing (Upload changes); a kept token asks nothing in the next session (#366)', { tag: ['@inc85', '@J11'] }, async () => {
      // Needs the Share action (#362 pull request 2) and the keychain (#366).
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
