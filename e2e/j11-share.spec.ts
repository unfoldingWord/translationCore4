// J11 — Share the project to Door43: sign in once, push the working main branch, read the URL
// docs/JOURNEYS.md J11 · Increment 8.5 (#362 share operation, #203 sign-in, #120 authority, #185 journey)
//
// The sign-in cases (#203) and the share cases (#362) run here against the fake Door43
// (e2e/helpers/door43.ts), served as a Playwright route on the QA server the dev build signs
// in to. The push goes where the fake's `clone_url` points: a bare `file://` remote this spec
// makes and reads, so the remote's `main` is the ground truth, with the fake's record of
// calls, the rig's disk and the browser's storage — never the app's own claims. The live leg
// runs against qa.door43.org only when the QA credentials are present (#185) and reports a
// labelled skip otherwise. D85: nothing but a kept token is stored, so the disk checks look
// for the token, the password and the login and expect none. A repository path
// `<username>/<repository>` is not a login: a share's ops record keeps it (#474).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import type { FakeOrganization } from './helpers/door43';
import { TC4_ROOT, SEEDED_PROJECT, readClientSettingsDoc, rigRepo, listLocalRepos } from './helpers/rig';
import {
  QA_SERVER, RIG_API, RIG_STATE, USER, type BareRemote,
  dropOrigin, fakeFor, fakeShare, filesHolding, git, head, loginsHolding, makeBareRemote, pressShare, signIn, useInternet,
} from './helpers/door43Share';

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

/** The keys the app's client-settings document holds on the rig: none may record the person. */
const settingsKeys = (): string[] => Object.keys(readClientSettingsDoc() ?? {});
const PERSON_KEYS = /identity|login|user|name|email|token/i;

// D86 point 7: Home has no Door43 bar. The share dialog says who shares, and a shared card
// says who is signed in; each has Change (sign out, then the sign-in step).
const SHARING_AS = `Sharing as @${USER.username} · Change`;
const CARD_AS = `as @${USER.username} · Change`;
const CARD_KEPT = 'Signed in · Change';
const NOT_KEPT = /Stay signed in is not available on this computer/;
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;

/** Press Share on the seeded card, which is not shared, and wait for the sign-in step. */
async function openSignIn(page: Page): Promise<void> {
  await page.getByTestId(`share-${SEEDED_ID}`).click();
  await expect(page.getByTestId('share-signin')).toBeVisible();
}

/** Give the seeded project an `origin` (a bare remote), so its card is a shared card. */
const addOrigin = (remote: BareRemote): void => {
  git(rigRepo(SEEDED_PROJECT), 'remote', 'add', 'origin', pathToFileURL(remote.bare).href);
};

/** The desktop keychain bridge (#366, `tc4Desktop.keychain` of scripts/preload.cjs), faked:
 * the kept token lives in this test process, so it outlives a reload the way the operating
 * system's keychain outlives an app session. The browser build has no bridge of its own, so
 * a test without this helper is the "no keychain" case. Install before the page loads. */
async function fakeKeychain(context: BrowserContext, held: string | null = null): Promise<{ held: string | null; calls: string[] }> {
  const keychain = { held, calls: [] as string[] };
  await context.exposeBinding('__tc4Keychain', async (_source, call: string, token?: string) => {
    keychain.calls.push(call);
    if (call === 'keep') {
      keychain.held = token ?? null;
      return { kept: true };
    }
    if (call === 'read') return { token: keychain.held };
    keychain.held = null;
    return { forgotten: true };
  });
  await context.addInitScript(() => {
    const w = window as unknown as { __tc4Keychain: (call: string, token?: string) => Promise<unknown>; tc4Desktop: unknown };
    w.tc4Desktop = {
      keychain: {
        keep: (token: string) => w.__tc4Keychain('keep', token),
        read: () => w.__tc4Keychain('read'),
        forget: () => w.__tc4Keychain('forget'),
      },
    };
  });
  return keychain;
}

test.describe('J11 — a facilitator shares the project to Door43', () => {
  test.describe('sign in (#203)', () => {
    test.beforeAll(async () => {
      // The rig boots with the net gate off; sign-in refuses offline before any Door43 call.
      await useInternet(true);
    });
    test.afterAll(async () => {
      await useInternet(false);
    });
    test.beforeEach(async ({ page }) => {
      // Sign-in starts at Share (D86 point 7); the seeded card is not shared, so Share
      // opens the first-share dialog after the sign-in step, and pushes nothing.
      dropOrigin(SEEDED_PROJECT);
      await page.goto('/');
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toBeVisible();
    });

    test('0. Home has no Door43 bar, and the top bar has no Door43 item (D86 point 7)', { tag: ['@inc85', '@J11'] }, async ({ page }) => {
      await expect(page.getByTestId('net-status')).toBeVisible();
      await expect(page.getByTestId('door43-bar')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /sign (in|out)/i })).toHaveCount(0);
      await expect(page.getByText(/signed in to Door43/i)).toHaveCount(0);
    });

    test('1. the sign-in step shows the fields, the checkbox, the author notice and the server; Cancel creates and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await openSignIn(page);
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
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
    });

    test('2. the share dialog says who shares; Change signs out and opens the sign-in step, which asks everything again (D86 point 7)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await openSignIn(page);
      await signIn(page);
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      const account = page.getByTestId('share-account');
      await expect(account).toHaveText(SHARING_AS);
      // The fake minted the app's token with the adapter's scopes (test 3, the fake leg).
      expect(fake.tokenRows.map((row) => [row.name, row.scopes])).toEqual([['translationCore', scopesInSource()]]);
      // D85: the username shown is Door43's answer; the rig's settings hold no record of it.
      expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);

      // Change: the share dialog closes, the sign-in step opens with nothing filled in.
      await page.getByTestId('share-account-change').click();
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await expect(page.getByLabel('Door43 username or email')).toHaveValue('');
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      // Signed out: after Cancel, Share asks the sign-in again.
      await page.getByTestId('signin-cancel').click();
      await openSignIn(page);
      const created = fake.calls.filter((c) => c.method === 'POST').length;
      await signIn(page);
      // The share continues with the new sign-in.
      await expect(account).toHaveText(SHARING_AS);
      expect(fake.calls.filter((c) => c.method === 'POST').length).toBe(created + 1);
    });

    test('3. (live) the token on qa.door43.org has the scopes the adapter names, and creates a repository (#467)', { tag: ['@inc85', '@J11'] }, async () => {
      const user = process.env.DCS_QA_USER;
      const secret = process.env.DCS_QA_PASSWORD ?? process.env.DCS_QA_TOKEN;
      test.skip(!user || !secret, 'labelled skip: set DCS_QA_USER and DCS_QA_PASSWORD (or DCS_QA_TOKEN) to run the live leg on qa.door43.org');
      // The Basic credentials over UTF-8, as the adapter builds them.
      const basic = `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
      const headers = { Authorization: basic, Accept: 'application/json', 'Content-Type': 'application/json' };
      const me = await fetch(`${QA_SERVER}/api/v1/user`, { headers });
      // Door43's own message names the cause: 401 is a wrong secret; 403 is a secret Door43 knows
      // but refuses here (a token without `read:user`, or an account that must act on the website first).
      expect(me.status, `GET /user with the QA credentials: ${await me.clone().text()}`).toBe(200);
      const { login } = (await me.json()) as { login: string };
      const tokensRoute = `${QA_SERVER}/api/v1/users/${encodeURIComponent(login)}/tokens`;
      // The adapter's own sequence, on the real server: drop a stale translationCore, mint it again.
      const listed = (await (await fetch(`${tokensRoute}?limit=50`, { headers })).json()) as Array<{ id: number; name: string }>;
      for (const token of listed) if (token.name === 'translationCore') await fetch(`${tokensRoute}/${token.id}`, { method: 'DELETE', headers });
      const created = await fetch(tokensRoute, { method: 'POST', headers, body: JSON.stringify({ name: 'translationCore', scopes: scopesInSource() }) });
      // A response body reads once: read it here, then parse it (the failure message needs it too).
      const createdText = await created.text();
      expect(created.status, createdText).toBe(201);
      const after = (await (await fetch(`${tokensRoute}?limit=50`, { headers })).json()) as Array<{ name: string; scopes: string[] }>;
      const minted = JSON.parse(createdText) as { sha1: string };
      expect(after.find((token) => token.name === 'translationCore')?.scopes.sort()).toEqual([...scopesInSource()].sort());
      // #467: the minted token reads what the share reads, and creates on the account (and on
      // DCS_QA_ORG when it is set); each repository made here is deleted again.
      const auth = { ...headers, Authorization: `token ${minted.sha1}` };
      for (const route of ['/user', '/user/orgs'])
        expect((await fetch(`${QA_SERVER}/api/v1${route}`, { headers: auth })).status, `GET ${route}`).toBe(200);
      const org = process.env.DCS_QA_ORG;
      const name = `tc4-467-${Date.now()}`;
      for (const [route, owner] of [['/user/repos', login], ...(org ? [[`/orgs/${org}/repos`, org]] : [])]) {
        const made = await fetch(`${QA_SERVER}/api/v1${route}`, { method: 'POST', headers: auth, body: JSON.stringify({ name, auto_init: false, private: false }) });
        const text = await made.text();
        if (made.status === 201) await fetch(`${QA_SERVER}/api/v1/repos/${owner}/${name}`, { method: 'DELETE', headers: auth });
        expect(made.status, `POST ${route}: ${text}`).toBe(201);
      }
      // The push with this token is the live leg of #185.
    });

    // 4. The pushed commit's author is the computer's account name: the OBS case of the
    // share block below asserts it on the remote (PLATFORM-NOTES #47, D85). Door43's own
    // display of it is the live leg (#185).

    test('5. a sign-in failure names the cause with its code, and stores nothing', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      await openSignIn(page);
      await signIn(page, 'wrong');
      const error = page.getByTestId('signin-error');
      await expect(error).toHaveAttribute('data-code', 'share.auth-failed');
      await expect(error).toContainText('did not accept that username or password');
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);
      // The other causes (no network, a 5xx) are test/share/signin.test.ts: the real server cannot fail on demand.
    });

    test('6. after a sign-in without "Stay signed in", the token, the password and the login are on no disk and in no storage', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      await openSignIn(page);
      await signIn(page);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      const token = fake.tokens.get('translationCore');
      expect(token).toBeTruthy();
      // The rig's disk (its state: repos, client settings, temp) holds no file with the token or
      // the password, and no file stores the login (a repository path is not a login, #474).
      for (const secret of [token!, USER.password]) expect(filesHolding(RIG_STATE, secret), secret).toEqual([]);
      expect(loginsHolding(RIG_STATE, USER.username), USER.username).toEqual([]);
      // The app's storage in the browser: localStorage and sessionStorage hold no value with them.
      const stored = await page.evaluate(() => {
        const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
        return [...dump(localStorage), ...dump(sessionStorage)];
      });
      expect(stored.filter((entry) => [token!, USER.password, USER.username].some((s) => entry.includes(s)))).toEqual([]);
      // The negative control: the seed's install records ARE on the rig's disk, so the search can find things.
      expect(filesHolding(RIG_STATE, 'installedResources')).not.toEqual([]);
    });

    test('6b. the login check passes a repository path and fails a stored login (#474)', { tag: ['@inc85', '@J11'] }, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-login-'));
      try {
        const settings = path.join(dir, 'uw-tc4.json');
        const repository = `${USER.username}/${SEEDED_PROJECT}`;
        // What a share's ops record keeps: the repository path and its URL.
        fs.writeFileSync(settings, JSON.stringify({ opsLog: [{ report: { facts: { repository, url: `${QA_SERVER}/${repository}` } } }] }));
        expect(filesHolding(dir, USER.username)).toEqual(['uw-tc4.json']);
        expect(loginsHolding(dir, USER.username)).toEqual([]);
        // The firing cases: a stored login, alone and beside the path; an email; the
        // username inside an API route, which is not a repository path.
        for (const stored of [
          { login: USER.username },
          { login: USER.username, opsLog: [{ report: { facts: { repository } } }] },
          { email: USER.email },
          { failed: `${QA_SERVER}/api/v1/users/${USER.username}/tokens` },
        ]) {
          fs.writeFileSync(settings, JSON.stringify(stored));
          expect(loginsHolding(dir, USER.username), JSON.stringify(stored)).toEqual(['uw-tc4.json']);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('7. a new app session without a kept token asks the sign-in again, and says why in one line; "Stay signed in" off never asks the keychain to keep (#366 test 2)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      const keychain = await fakeKeychain(context);
      await page.goto('/');
      await openSignIn(page);
      await expect(page.getByLabel('Stay signed in on this computer')).not.toBeChecked();
      await signIn(page);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      await expect(page.getByTestId('signin-not-kept')).toHaveCount(0);
      // The keychain was only read (at start and at Share) and found nothing; the box was
      // off, so no keep, only the forget that clears a token an earlier session kept.
      expect(keychain.calls.filter((c) => c !== 'read')).toEqual(['forget']);
      expect(keychain.held).toBeNull();
      // A new app session: the token was in renderer memory only, and nothing else was stored.
      await page.reload();
      await openSignIn(page);
      await expect(page.getByLabel('Door43 username or email')).toHaveValue('');
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.getByTestId('signin-reason')).toHaveText(SESSION_NOTE);
      await expect(page.getByTestId('signin-notice')).toHaveText(AUTHOR_NOTICE);
      await signIn(page);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
    });

    // 7b. A later share in the same session asks nothing: the "Upload changes" case of the
    // share block below (its second upload runs with the token of the first).
    test('7c. a kept token: no Door43 request at start; the shared card says "Signed in"; Upload changes resumes it and asks nothing; the keychain holds the token only; Change on the card empties it (#366 tests 1, 4, 6; D86 points 7 and 8)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      const keychain = await fakeKeychain(context);
      const remote = makeBareRemote();
      try {
        await page.goto('/');
        await openSignIn(page);
        await page.getByLabel('Stay signed in on this computer').check();
        await signIn(page);
        await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
        await expect(page.getByTestId('signin-not-kept')).toHaveCount(0);
        await page.getByTestId('share-cancel').click();
        const token = fake.tokens.get('translationCore')!;
        // Test 6: the keychain took the token and nothing else; the rig's disk holds no token,
        // no password and no stored login, and the browser's storage holds none of the three.
        expect(keychain.calls.filter((c) => c !== 'read')).toEqual(['keep']);
        expect(keychain.held).toBe(token);
        expect(token).not.toContain(USER.username);
        for (const secret of [token, USER.password]) expect(filesHolding(RIG_STATE, secret), secret).toEqual([]);
        expect(loginsHolding(RIG_STATE, USER.username), USER.username).toEqual([]);
        const stored = await page.evaluate(() => {
          const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
          return [...dump(localStorage), ...dump(sessionStorage)];
        });
        expect(stored.filter((entry) => [token, USER.password, USER.username].some((s) => entry.includes(s)))).toEqual([]);
        expect(settingsKeys().filter((key) => PERSON_KEYS.test(key))).toEqual([]);

        // D86 point 8: a new app session sends no request to Door43 at start. The keychain is
        // read (locally), so the shared card says a sign-in is kept, without a username.
        addOrigin(remote);
        const before = fake.calls.length;
        const reads = keychain.calls.length;
        await page.reload();
        const account = page.getByTestId(`share-account-${SEEDED_ID}`);
        await expect(account).toHaveText(CARD_KEPT);
        expect(keychain.calls.slice(reads)).toEqual(['read']);
        await page.waitForTimeout(1000);
        expect(fake.calls.slice(before), 'no Door43 request at start').toEqual([]);

        // Test 1: Upload changes resumes the kept token (Door43 says who it is), asks nothing, and pushes.
        await page.getByTestId(`share-${SEEDED_ID}`).click();
        await expect(page.getByTestId(`share-uploaded-${SEEDED_ID}`)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('share-signin')).toHaveCount(0);
        expect(remote.main()).toBe(head(SEEDED_PROJECT));
        const resumed = fake.calls.slice(before);
        expect(resumed.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${QA_SERVER}/api/v1/user`]);
        expect(resumed[0].headers.authorization ?? resumed[0].headers.Authorization).toBe(`token ${token}`);
        expect(resumed[0].url).not.toContain(token);
        await expect(account).toHaveText(CARD_AS);

        // Test 4, D86 point 7: Change on the card signs out (the keychain is emptied) and opens
        // the sign-in step; the next session asks the password again.
        await page.getByTestId(`share-account-${SEEDED_ID}-change`).click();
        await expect(page.getByTestId('share-signin')).toBeVisible();
        expect(keychain.calls.at(-1)).toBe('forget');
        expect(keychain.held).toBeNull();
        await page.getByTestId('signin-cancel').click();
        await expect(account).toHaveCount(0);
        await page.reload();
        await expect(page.getByTestId(`share-${SEEDED_ID}`)).toHaveText('Upload changes');
        await expect(account).toHaveCount(0);
        await page.getByTestId(`share-${SEEDED_ID}`).click();
        await expect(page.getByTestId('share-signin')).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
        await expect(page.getByTestId('signin-reason')).toHaveText(SESSION_NOTE);
      } finally {
        dropOrigin(SEEDED_PROJECT);
        remote.dispose();
      }
    });

    test('7d. a kept token Door43 refuses is forgotten at the first Share, and the app asks the password again (#366 test 5)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      // The fake knows no token, so the kept one is revoked; the negative control of test 7c.
      const fake = await fakeFor(context);
      const keychain = await fakeKeychain(context, 'revoked-token');
      await page.goto('/');
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toBeVisible();
      await page.waitForTimeout(1000);
      expect(fake.calls, 'no Door43 request at start').toEqual([]);
      await openSignIn(page);
      expect(keychain.calls).toEqual(['read', 'read', 'forget']);
      expect(keychain.held).toBeNull();
      expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${QA_SERVER}/api/v1/user`]);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await signIn(page);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
    });

    test('7e. the browser build has no keychain: "Stay signed in" keeps the token in memory and says so in one line (#366 test 3)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeFor(context);
      // No fakeKeychain: `window.tc4Desktop` is absent, as in the browser build.
      expect(await page.evaluate(() => 'tc4Desktop' in window)).toBe(false);
      await openSignIn(page);
      await page.getByLabel('Stay signed in on this computer').check();
      await signIn(page);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      await expect(page.getByTestId('signin-not-kept')).toHaveText(NOT_KEPT);
      // The next session asks again: the token was in memory only.
      await page.reload();
      await openSignIn(page);
      await expect(page.getByTestId('signin-not-kept')).toHaveCount(0);
    });

    test('7f. the change to Local with a kept sign-in: "Also sign out of Door43 on this computer" is on, and removes the kept token; off keeps it (D86 point 7)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeFor(context);
      const keychain = await fakeKeychain(context);
      try {
        // No kept token: the change-to-Local dialog has no checkbox.
        await page.goto('/');
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'internet');
        await page.getByTestId('net-status').click();
        await expect(page.getByTestId('net-to-local')).toBeVisible();
        await expect(page.getByTestId('net-sign-out')).toHaveCount(0);
        await page.getByTestId('net-cancel').click();

        // A kept token, the box turned off: Local, and the token stays kept.
        keychain.held = 'kept-token';
        await page.reload();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'internet');
        await page.getByTestId('net-status').click();
        const box = page.getByTestId('net-to-local').getByLabel('Also sign out of Door43 on this computer');
        await expect(box).toBeChecked();
        await box.uncheck();
        await page.getByTestId('net-confirm').click();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'local');
        expect(keychain.held).toBe('kept-token');
        expect(keychain.calls).not.toContain('forget');

        // Cancel signs nothing out.
        await useInternet(true);
        await page.reload();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'internet');
        await page.getByTestId('net-status').click();
        await page.getByTestId('net-cancel').click();
        expect(keychain.held).toBe('kept-token');

        // The box on (the default): the kept token is removed, and the status is Local.
        await page.getByTestId('net-status').click();
        await expect(box).toBeChecked();
        await page.getByTestId('net-confirm').click();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'local');
        expect(keychain.calls.at(-1)).toBe('forget');
        expect(keychain.held).toBeNull();
        // The sign-out is local: no Door43 request in this whole case.
        expect(fake.calls).toEqual([]);
      } finally {
        await useInternet(true);
      }
    });
  });

  // ---- The share cases (#362, D84). Each test starts with the seeded project unshared
  //      (its `origin` dropped) and a fresh bare remote; a new page holds no token, so
  //      each Share begins with the sign-in step. ----
  test.describe('share (#362)', () => {
    let remote: BareRemote;
    const ORGS: FakeOrganization[] = [
      { username: 'orgA', fullName: 'Equipo A', canCreateRepository: true, repositories: { 'es-419': 3 } },
      { username: 'orgB', fullName: 'Equipo B', canCreateRepository: true, repositories: { 'es-419': 1 } },
      { username: 'orgLocked', fullName: 'Locked', canCreateRepository: false, repositories: { 'es-419': 9 } },
    ];
    const remotesOf = async (id: string): Promise<Array<{ name: string; url: string }>> => {
      const body = (await (await fetch(`${RIG_API}/git/remotes/${id}`)).json()) as { payload?: { remotes?: Array<{ name: string; url: string }> } };
      return body.payload?.remotes ?? [];
    };
    /** The ops log as the rig holds it (#374): `op` and the Report's code of each closed record. */
    const opsCodes = (): string[] => {
      const entries = (readClientSettingsDoc()?.opsLog ?? []) as Array<{ op: string; report?: { code?: string } }>;
      return entries.filter((e) => e.op === 'share' && e.report?.code).map((e) => e.report!.code!);
    };

    test.beforeAll(async () => {
      await useInternet(true);
    });
    test.afterAll(async () => {
      await useInternet(false);
    });
    test.beforeEach(async ({ page }) => {
      remote = makeBareRemote();
      dropOrigin(SEEDED_PROJECT);
      await page.goto('/');
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toBeVisible();
    });
    test.afterEach(() => {
      remote.dispose();
    });

    test('1. Share beside Settings: sign in, the account, the check step, one progress line, the end; the remote main equals the local main; the token is nowhere; Community Checking has no Share', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote);
      const logs: string[] = [];
      page.on('console', (message) => logs.push(message.text()));
      const card = page.getByTestId(`project-${SEEDED_ID}`);
      // The action sits in the card header beside Settings, and reads Share before a share.
      await expect(card.getByTestId(`share-${SEEDED_ID}`)).toHaveText('Share');
      await expect(card.getByRole('button', { name: 'Settings' })).toBeVisible();
      await expect(page.getByTestId(`share-card-${SEEDED_ID}`)).toHaveAttribute('data-shared', '0');

      await pressShare(page, SEEDED_ID);
      const dialog = page.getByTestId('share-dialog');
      await expect(dialog).toBeVisible();
      // Where it goes: the account is chosen; this user has no organization.
      await expect(page.getByTestId('share-target-user')).toContainText(USER.username);
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      // The check step: the folder name as the default, and the books in canon order (D84 point 4).
      await expect(page.getByLabel('Repository name')).toHaveValue(SEEDED_PROJECT);
      await expect(page.getByTestId('share-items')).toHaveText('Jonah, Titus');
      await expect(page.getByTestId('share-where')).toContainText(USER.username);
      await expect(dialog).not.toContainText(/licen[cs]e|private/i);
      await page.getByTestId('share-submit').click();
      // The end: the URL, Copy link, Open on Door43, and the sentence (D84 point 5).
      const done = page.getByTestId('share-done');
      await expect(done).toBeVisible({ timeout: 30_000 });
      // One progress line showed "Creating the repository…" then "Pushing…" (the two steps, in order).
      await expect(done).toHaveAttribute('data-steps', 'create,push');
      const url = `${QA_SERVER}/${USER.username}/${SEEDED_PROJECT}`;
      await expect(page.getByTestId('share-url')).toHaveText(url);
      await expect(page.getByTestId('share-copy')).toHaveText('Copy link');
      await expect(page.getByTestId('share-open')).toHaveAttribute('href', url);
      await expect(page.getByTestId('share-done-text')).toHaveText('Others can read it on Door43.');
      await expect(dialog).not.toContainText('translationCore');
      // Copy link puts the URL on the clipboard (the browser context grants the permission here).
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByTestId('share-copy').click();
      await expect(page.getByTestId('share-copy')).toHaveText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await page.getByTestId('share-close').click();
      await expect(dialog).toHaveCount(0);

      // The remote: created on the fake under the account, pushed to the bare remote.
      expect([...fake.repositories.keys()]).toEqual([`${USER.username}/${SEEDED_PROJECT}`]);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      // Every Door43 call went to the QA server (test 9), with the token in no URL (test 10).
      const token = fake.tokens.get('translationCore')!;
      expect(fake.calls.every((c) => c.url.startsWith(`${QA_SERVER}/`))).toBe(true);
      expect(fake.calls.some((c) => c.url.includes(token))).toBe(false);
      // The token is on no disk (the rig's state, the project's git config), and in no console line.
      expect(filesHolding(RIG_STATE, token)).toEqual([]);
      expect(fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), '.git', 'config'), 'utf8')).not.toContain(token);
      expect(logs.filter((line) => line.includes(token))).toEqual([]);

      // The card now (test 2): "On Door43", the repository path, and Upload changes.
      await expect(page.getByTestId(`share-card-${SEEDED_ID}`)).toHaveAttribute('data-shared', '1');
      await expect(page.getByTestId(`share-state-${SEEDED_ID}`)).toHaveText(`On Door43 · ${USER.username}/${SEEDED_PROJECT}`);
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toHaveText('Upload changes');

      // Community Checking has no Share action.
      await card.getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-community-checking').click();
      await expect(page.getByTestId('export-menu')).toBeVisible();
      await expect(page.getByTestId('community-checking').getByRole('button', { name: /share|upload/i })).toHaveCount(0);
    });

    test('2. the shared card after a new session reads its state from origin; Upload changes pushes a new commit with no dialog, and asks nothing the second time (#203 7b); the installation store holds no remote', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      await fakeShare(context, remote);
      await pressShare(page, SEEDED_ID);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('share-close').click();
      const first = remote.main();
      expect(first).toBe(head(SEEDED_PROJECT));

      // A new app session: the card's state is derived from the repository's own origin (D84
      // point 1) — here the spec's bare `file://` remote, read back as its path (`.git` dropped);
      // on Door43 the url reads back as `<owner>/<name>`, as test 1 showed after the share.
      // The expected path comes from the URL the fake served (pathToFileURL), not from the
      // filesystem path: on Windows the URL's pathname is `/C:/…` with forward slashes.
      await page.reload();
      await expect(page.getByTestId(`share-state-${SEEDED_ID}`)).toHaveText(`On Door43 · ${pathToFileURL(remote.bare).pathname.replace(/^\//, '').replace(/\.git$/, '')}`);
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toHaveText('Upload changes');
      expect((await remotesOf(SEEDED_ID)).map((r) => r.name)).toEqual(['origin']);
      // The installation store (the rig's client settings) holds nothing about the remote.
      expect(JSON.stringify(readClientSettingsDoc() ?? {})).not.toContain(remote.bare);
      expect(JSON.stringify(readClientSettingsDoc() ?? {})).not.toContain('origin');

      // A new local commit, then Upload changes: the token is asked (a new session, D85), then no dialog.
      git(rigRepo(SEEDED_PROJECT), '-c', 'user.name=rig', '-c', 'user.email=rig@local', 'commit', '-q', '--allow-empty', '-m', 'local edit 1');
      const second = head(SEEDED_PROJECT);
      expect(second).not.toBe(first);
      await pressShare(page, SEEDED_ID);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`share-uploaded-${SEEDED_ID}`)).toBeVisible({ timeout: 30_000 });
      expect(remote.main()).toBe(second);

      // The same session again (#203 test 7b): nothing is asked, no dialog, pushed.
      git(rigRepo(SEEDED_PROJECT), '-c', 'user.name=rig', '-c', 'user.email=rig@local', 'commit', '-q', '--allow-empty', '-m', 'local edit 2');
      const third = head(SEEDED_PROJECT);
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expect.poll(() => remote.main(), { timeout: 30_000 }).toBe(third);
    });

    test('2b. with "Stay signed in", Upload changes in a new app session asks nothing (#366 test 1)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote);
      const keychain = await fakeKeychain(context);
      await page.goto('/');
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await page.getByLabel('Stay signed in on this computer').check();
      await signIn(page);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('share-close').click();
      const first = remote.main();
      expect(first).toBe(head(SEEDED_PROJECT));
      expect(keychain.held).toBe(fake.tokens.get('translationCore'));

      // A new app session, a new local commit: Upload changes asks nothing, no dialog, pushed.
      await page.reload();
      await expect(page.getByTestId(`share-account-${SEEDED_ID}`)).toHaveText(CARD_KEPT);
      await expect(page.getByTestId(`share-${SEEDED_ID}`)).toHaveText('Upload changes');
      git(rigRepo(SEEDED_PROJECT), '-c', 'user.name=rig', '-c', 'user.email=rig@local', 'commit', '-q', '--allow-empty', '-m', 'local edit 1');
      const second = head(SEEDED_PROJECT);
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`share-uploaded-${SEEDED_ID}`)).toBeVisible({ timeout: 30_000 });
      expect(remote.main()).toBe(second);
      // The token is on no disk of the rig.
      expect(filesHolding(RIG_STATE, keychain.held!)).toEqual([]);
    });

    test('2c. a token kept by an earlier version without the create scopes: the share asks the password once, says why, replaces the token, and shares (#467)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const OLD = 'kept-before-467';
      const fake = await fakeShare(context, remote, { tokens: [OLD], tokenScopes: { [OLD]: ['write:repository', 'read:organization', 'read:user'] } });
      const keychain = await fakeKeychain(context, OLD);
      await page.goto('/');
      // The old token still reads the account, so Share resumes on it and asks nothing.
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      // Door43 refuses the create (403, a missing scope): the app forgets the token and asks the
      // password once, with one line, and no repeated or raw server text.
      const signin = page.getByTestId('share-signin');
      await expect(signin).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('signin-renew')).toHaveText('Sign in again: your earlier sign-in cannot create repositories on Door43.');
      await expect(signin).not.toContainText(/scope|\/user\/repos|HTTP/);
      expect(keychain.held).toBeNull();
      expect(fake.repositories.size).toBe(0);
      expect(remote.main()).toBeNull();
      await page.getByLabel('Stay signed in on this computer').check();
      await signIn(page);
      // The new token has the scopes; the share continues in the dialog and completes.
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-url')).toHaveText(`${QA_SERVER}/${USER.username}/${SEEDED_PROJECT}`, { timeout: 30_000 });
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      const minted = fake.tokenRows.find((row) => row.name === 'translationCore')!;
      expect(minted.scopes).toEqual(scopesInSource());
      expect(keychain.held).toBe(minted.secret);
      // The sign-in was asked once: one token minted.
      expect(fake.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tokens')).length).toBe(1);
    });

    test('3. organizations: one cannot be chosen and says why; the one with the most repositories in the language is Recommended; a share goes there', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote, { organizations: ORGS });
      await pressShare(page, SEEDED_ID);
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      const locked = page.getByTestId('share-org-orgLocked');
      await expect(locked).toBeVisible();
      await expect(locked).toBeDisabled();
      await expect(locked).toContainText('You cannot create repositories in this organization.');
      // Recommended: orgA (3 in es-419) over orgB (1); orgLocked's 9 never counts (D84 point 3).
      await expect(page.getByTestId('share-org-orgA')).toHaveAttribute('data-recommended', '1');
      await expect(page.getByTestId('share-org-orgA')).toContainText('Recommended');
      await expect(page.getByTestId('share-org-orgB')).toHaveAttribute('data-recommended', '0');
      await expect(locked).toHaveAttribute('data-recommended', '0');
      // The count came from the search with limit=1, per organization (test 4's request shape).
      const searches = fake.calls.filter((c) => c.url.includes('/repos/search')).map((c) => new URL(c.url));
      expect(searches.map((u) => `${u.searchParams.get('owner')}:${u.searchParams.get('lang')}:${u.searchParams.get('limit')}`).sort())
        .toEqual(['orgA:es-419:1', 'orgB:es-419:1', 'orgLocked:es-419:1']);
      // The locked one cannot be picked: a click leaves the account chosen.
      await locked.click({ force: true });
      await page.getByTestId('share-org-orgA').click();
      await page.getByTestId('share-next').click();
      await expect(page.getByTestId('share-where')).toContainText('orgA');
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-url')).toHaveText(`${QA_SERVER}/orgA/${SEEDED_PROJECT}`, { timeout: 30_000 });
      expect([...fake.repositories.keys()]).toEqual([`orgA/${SEEDED_PROJECT}`]);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      await page.getByTestId('share-close').click();
      await expect(page.getByTestId(`share-state-${SEEDED_ID}`)).toHaveText(`On Door43 · orgA/${SEEDED_PROJECT}`);
    });

    test('6. refusals: the name exists on the account and on an organization; a non-fast-forward push; each with its code, nothing pushed, and in the ops log', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote, {
        organizations: [ORGS[0]],
        existingRepositories: [`${USER.username}/${SEEDED_PROJECT}`, `orgA/${SEEDED_PROJECT}`],
      });
      const before = opsCodes().length;
      await pressShare(page, SEEDED_ID);
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      const error = page.getByTestId('share-error');
      await expect(error).toHaveAttribute('data-code', 'share.name-exists', { timeout: 30_000 });
      await expect(error).toContainText('That name exists on this account or organization; pick another.');
      await expect(page.getByTestId('share-check')).toBeVisible();
      expect(remote.main()).toBeNull();
      expect((await remotesOf(SEEDED_ID)).find((r) => r.name === 'origin')).toBeUndefined();
      // The same name on the organization.
      await page.getByTestId('share-back').click();
      await page.getByTestId('share-org-orgA').click();
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(error).toHaveAttribute('data-code', 'share.name-exists', { timeout: 30_000 });
      expect(remote.main()).toBeNull();
      expect(fake.repositories.size).toBe(2);
      // Another name shares.
      await page.getByLabel('Repository name').fill(`${SEEDED_PROJECT}_2`);
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-url')).toHaveText(`${QA_SERVER}/orgA/${SEEDED_PROJECT}_2`, { timeout: 30_000 });
      await page.getByTestId('share-close').click();
      const shared = head(SEEDED_PROJECT);
      expect(remote.main()).toBe(shared);

      // Another device pushes; this device commits; Upload changes is refused, the remote keeps theirs.
      const other = path.join(remote.tmp, 'other');
      execFileSync('git', ['clone', '-q', pathToFileURL(remote.bare).href, other]); // `file://${path}` breaks on Windows (door43Share.ts)
      fs.writeFileSync(path.join(other, 'other-device.txt'), 'x\n');
      git(other, 'add', 'other-device.txt');
      git(other, '-c', 'user.email=o@x', '-c', 'user.name=other', 'commit', '-qm', 'other device');
      git(other, 'push', '-q', 'origin', 'main');
      const theirs = remote.main();
      expect(theirs).not.toBe(shared);
      git(rigRepo(SEEDED_PROJECT), '-c', 'user.name=rig', '-c', 'user.email=rig@local', 'commit', '-q', '--allow-empty', '-m', 'local edit');
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      const cardError = page.getByTestId(`share-card-error-${SEEDED_ID}`);
      await expect(cardError).toHaveAttribute('data-code', 'share.non-fast-forward', { timeout: 30_000 });
      await expect(cardError).toContainText('team sync is coming and your work is safe');
      expect(remote.main()).toBe(theirs);
      // Each refusal is in the ops log (#374, test 13).
      await expect.poll(() => opsCodes().slice(before)).toEqual(['share.name-exists', 'share.name-exists', 'share.non-fast-forward']);
    });

    test('11. an OBS project shares the same way: the check step lists the stories; the pushed commit\'s author is the computer\'s account name (J24; #203 test 4)', { tag: ['@inc85', '@J11', '@J24'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote);
      const abbr = `obs_share_${Date.now()}`;
      const id = `_local_/_local_/${abbr}`;
      const created = await fetch(`${RIG_API}/git/new-obs-resource`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_name: 'Historias compartidas', content_abbr: abbr, content_language_code: 'es', branch_name: null }),
      });
      expect(created.ok, await created.text().catch(() => '')).toBe(true);
      expect(listLocalRepos()).toContain(abbr);
      await page.reload();
      const card = page.getByTestId(`project-${id}`);
      await expect(card.getByTestId('obs-marker')).toHaveText('OBS');
      await pressShare(page, id);
      await page.getByTestId('share-next').click();
      await expect(page.getByLabel('Repository name')).toHaveValue(abbr);
      await expect(page.getByTestId('share-items')).toHaveText('Stories 1 to 50');
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-url')).toHaveText(`${QA_SERVER}/${USER.username}/${abbr}`, { timeout: 30_000 });
      expect([...fake.repositories.keys()]).toEqual([`${USER.username}/${abbr}`]);
      expect(remote.main()).toBe(head(abbr));
      // The platform set the author at creation to the computer's account name (PLATFORM-NOTES #47).
      expect(git(remote.bare, 'log', '-1', '--format=%an', 'main')).toBe(os.userInfo().username);
      await page.getByTestId('share-close').click();
      await expect(page.getByTestId(`share-state-${id}`)).toHaveText(`On Door43 · ${USER.username}/${abbr}`);
      await fetch(`${RIG_API}/git/delete/${id}`, { method: 'POST' });
    });

    test('12. Local: Share asks to allow the internet; Cancel sends nothing; Allow continues the share (D86 point 4)', { tag: ['@inc85', '@J11'] }, async ({ page, context }) => {
      const fake = await fakeShare(context, remote);
      await useInternet(false);
      try {
        await page.reload();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'local');
        const share = page.getByTestId(`share-${SEEDED_ID}`);
        await expect(share).toBeEnabled();
        await share.click();
        await expect(page.getByTestId('net-allow')).toContainText('tC4 is set to Local.');
        await page.getByTestId('net-cancel').click();
        await expect(page.getByTestId('share-signin')).toHaveCount(0);
        await expect(page.getByTestId('share-dialog')).toHaveCount(0);
        expect(fake.calls, 'no Door43 request after Cancel').toEqual([]);
        expect(remote.main(), 'nothing pushed').toBeNull();

        // Allow: the gate turns on, and the share continues where the click left off.
        await share.click();
        await page.getByTestId('net-confirm').click();
        await expect(page.getByTestId('net-status')).toHaveAttribute('data-state', 'internet');
        await expect(page.getByTestId('share-signin')).toBeVisible();
      } finally {
        await useInternet(true);
      }
      // A push that meets HTTP 401 "offline mode" is test/share/shareOperation.test.ts.
    });
  });
});
