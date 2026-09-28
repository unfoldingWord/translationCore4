// The share flow of J11 as a helper, so J8's share leg and the J11 cases drive one
// flow (#185, #362, #203; D84, D85): the fake Door43 (./door43.ts) on the QA server
// the dev build signs in to, a bare `file://` remote the test controls, the sign-in
// step, and the presses on the Home card and the dialog. The remote's `main` is
// the ground truth of a share — read with git, never from the app's own claims.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { FakeDoor43, type FakeDoor43Options } from './door43';
import { TC4_ROOT, rigRepo } from './rig';

/** The server a development build signs in to (src/data/dcsServer.ts, #120). */
export const QA_SERVER = 'https://qa.door43.org';
export const RIG_API = 'http://127.0.0.1:19998/api';
export const RIG_STATE = path.join(TC4_ROOT, 'dev-env', 'state');
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

/** The fake whose created repositories clone from the bare remote. */
export const fakeShare = (context: BrowserContext, remote: BareRemote, extra: Partial<FakeDoor43Options> = {}) =>
  fakeFor(context, { cloneUrlFor: () => `file://${remote.bare}`, ...extra });

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
