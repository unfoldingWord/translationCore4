// The share flow of J11 as a helper, so J8's share leg and the J11 cases drive one
// flow (#185, #362, #203; D84, D85): the fake Door43 (./door43.ts) on the QA server
// the dev build signs in to, a bare `file://` remote the test controls, the sign-in
// step, and the presses on the Home card and the dialog. The remote's `main` is
// the ground truth of a share — read with git, never from the app's own claims.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { FakeDoor43, type FakeDoor43Options } from './door43';
import { TC4_ROOT, readClientSettingsDoc, rigRepo } from './rig';
import { lane } from '../lane.mjs';

/** The server a development build signs in to (src/data/dcsServer.ts, #120). */
export const QA_SERVER = 'https://qa.door43.org';
export const RIG_API = lane().rigApi;
export const RIG_STATE = path.join(TC4_ROOT, 'dev-env', 'state');
/** D95 (#559): turn the internet on for this page load, the user's own way: the
 * account menu's switch, which sends nothing. Nothing is stored, so every page load
 * and reload starts off; call it after each `goto` or `reload` that internet work
 * follows. The dialog a step opens while the internet is off is the subject of the
 * `@internet-consent` journeys. */
export async function turnOnInternet(page: Page): Promise<void> {
  const trigger = page.getByTestId('account-menu');
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('data-internet')) === 'on') return;
  await trigger.click();
  const row = page.getByTestId('account-internet');
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('account-menu-panel')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('data-internet', 'on');
}

/** The platform's net gate, off. The rig boots with it off, but the gate is in memory
 * and survives a reseed: a run that went online leaves it on. The app turns it off at
 * start too (D88 point 4); a journey that reads the gate states its own start. */
export async function gateOff(): Promise<void> {
  await fetch(`${RIG_API}/net/disable`, { method: 'POST' });
}

/** The desktop keychain bridge (#366, `tc4Desktop.keychain` of scripts/preload.cjs), faked:
 * the kept token lives in this test process, so it outlives a reload the way the operating
 * system's keychain outlives an app session. The browser build has no bridge of its own, so
 * a test without this helper is the "no keychain" case. Install before the page loads.
 * `forgetFails`: forget() rejects, as a keychain that refuses to remove the token. */
export async function fakeKeychain(
  context: BrowserContext,
  held: string | null = null,
  opts: { forgetFails?: boolean } = {},
): Promise<{ held: string | null; calls: string[] }> {
  const keychain = { held, calls: [] as string[] };
  await context.exposeBinding('__tc4Keychain', async (_source, call: string, token?: string) => {
    keychain.calls.push(call);
    if (call === 'keep') {
      keychain.held = token ?? null;
      return { kept: true };
    }
    if (call === 'read') return { token: keychain.held };
    if (opts.forgetFails) throw new Error('the keychain refused to forget the token');
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

export const USER = { username: 'facilitator-zq', password: 'a pass-word', email: 'facilitator-zq@example.org' };

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

/** The local project's `HEAD`. */
export const head = (repo: string): string => git(rigRepo(repo), 'rev-parse', 'HEAD');

/** Unshare: drop the `origin` remote (the one record of a share, D84 point 1). */
export const dropOrigin = (repo: string): void => {
  try {
    git(rigRepo(repo), 'remote', 'remove', 'origin');
  } catch {
    // no origin: not shared
  }
};

/** Give a project an `origin` (a bare remote), so its card is a shared card. */
export const addOrigin = (repo: string, remote: { bare: string }): void => {
  git(rigRepo(repo), 'remote', 'add', 'origin', pathToFileURL(remote.bare).href);
};

/** A new local commit with no change, so an upload has something to push. Returns the new `HEAD`. */
export const commitLocally = (repo: string, message: string): string => {
  git(rigRepo(repo), '-c', 'user.name=rig', '-c', 'user.email=rig@local', 'commit', '-q', '--allow-empty', '-m', message);
  return head(repo);
};

/** A screenshot of the page into the test's output folder, attached to the report (#530). */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** #530: a shared card shows the action and nothing under it: no account line, no
 * "Uploaded." and no refusal. */
export async function expectCleanCard(page: Page, id: string): Promise<void> {
  const card = page.getByTestId(`share-card-${id}`);
  await expect(card).toHaveAttribute('data-shared', '1');
  await expect(card).toHaveText('Upload changes');
  await expect(card.getByRole('button')).toHaveCount(1);
  await expect(card.getByRole('alert')).toHaveCount(0);
}

/** Every file under `dir` whose bytes contain `needle`. */
export const filesHolding = (dir: string, needle: string): string[] => {
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

/** Every file under `dir` that stores `username` as a login (D85): the username
 * anywhere except as the owner of a repository — a path `<username>/<repository>` after
 * a quote, a space or the start of a line, or the first segment after the server in an
 * `http(s)` URL. A
 * share's ops record keeps that path, and the Home card shows it; a path names where a
 * project lives, not who signed in (#474). An API route such as
 * `/api/v1/users/<username>/tokens` still counts. */
export const loginsHolding = (dir: string, username: string): string[] => {
  const name = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const asOwner = new RegExp(`(^|["'\\s]|https?://[^/\\s"']+/)${name}/(?=[A-Za-z0-9._-])`, 'gm');
  return filesHolding(dir, username).filter((file) =>
    fs.readFileSync(path.join(dir, file), 'utf8').replace(asOwner, '$1').includes(username));
};

/** A bare git remote in a temporary directory: where the fake's `clone_url` points. */
export interface BareRemote {
  tmp: string;
  bare: string;
  /** The remote's `main`, or null when nothing was pushed. */
  main(): string | null;
  /** `git show <spec>` on the remote, for example `main:ingredients/TIT.usfm`; the bytes as
   * committed, not trimmed (a comparison with `committedIngredient` is byte for byte). */
  show(spec: string): string;
  dispose(): void;
}

export function makeBareRemote(): BareRemote {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j11-'));
  const bare = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  return {
    tmp,
    bare,
    main() {
      try {
        return git(bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/main');
      } catch {
        return null;
      }
    },
    show: (spec) => execFileSync('git', ['-C', bare, 'show', spec], { encoding: 'utf8', stdio: 'pipe' }),
    dispose: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

export async function fakeFor(context: BrowserContext, extra: Partial<FakeDoor43Options> = {}): Promise<FakeDoor43> {
  const fake = new FakeDoor43({ server: QA_SERVER, user: USER, ...extra });
  await fake.route(context);
  return fake;
}

/** The fake whose created repositories clone from the bare remote. The URL is
 * built by pathToFileURL, never by prefixing the path: `file://${path}` on
 * Windows gives `file://C:\...`, which the server's libgit2 push cannot
 * resolve ("failed to resolve path", os error 2); the encoded form
 * `file:///C:/...` works on every platform. */
export const fakeShare = (context: BrowserContext, remote: BareRemote, extra: Partial<FakeDoor43Options> = {}) =>
  fakeFor(context, { cloneUrlFor: () => pathToFileURL(remote.bare).href, ...extra });

export async function signIn(page: Page, password = USER.password): Promise<void> {
  await page.getByLabel('Door43 username or email').fill(USER.username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('signin-submit').click();
}

/** Press Share (or Upload changes) on a card, and sign in when the step appears. */
export async function pressShare(page: Page, id: string): Promise<void> {
  await page.getByTestId(`share-${id}`).click();
  // A page holds no token at first, so the sign-in step comes first; a later press in
  // the same session shows none (the wait is short, and only then).
  const signin = page.getByTestId('share-signin');
  await signin.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await signin.isVisible()) await signIn(page);
  await expect(signin).toHaveCount(0);
}

/** #530: Upload changes on a shared card, through its dialog: the review step, the
 * upload, the end, then Close. Signs in first when the sign-in step appears. */
export async function uploadChanges(page: Page, id: string): Promise<void> {
  await pressShare(page, id);
  await expect(page.getByTestId('share-upload')).toBeVisible();
  await page.getByTestId('share-submit').click();
  await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('share-close').click();
  await expect(page.getByTestId('share-dialog')).toHaveCount(0);
}

/** The first share of a project through the dialog: the account as the target, the
 * check step as it stands, the push, then Close. Returns the URL the end step showed. */
export async function shareFirstTime(page: Page, id: string): Promise<string> {
  await pressShare(page, id);
  await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
  await page.getByTestId('share-next').click();
  await page.getByTestId('share-submit').click();
  await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
  const url = await page.getByTestId('share-url').textContent();
  await page.getByTestId('share-close').click();
  await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  return url ?? '';
}
