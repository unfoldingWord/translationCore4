// D88 (#514): "Ask before using the internet" and the Door43 account menu. Replaces the
// D86 Internet / Local journeys (internet-local.spec.ts, retired by #514).
//
// What the journeys prove, against the real client and the rig:
//   a  fresh settings ask; an old `internet: true`, an invalid flag and an unreadable
//      document ask; a gate the rig left on ends off
//   b  the preference persists across a restart; the menu switch turns it off and on;
//      sign-in and sign-out leave it alone
//   c  the account menu in its three states, on Home and inside a project
//   d  Cancel sends nothing and stores nothing; Continue starts the exact task; Share is
//      one dialog and keeps its review; "Don't ask again" persists only after Continue;
//      Upload changes opens its dialog with no request and asks when it is sent (#530)
//   e  startup, idle, the menu and local work make zero external requests, with asking
//      on and off, before and after a permitted task has turned the gate on
//   f  a gate that cannot be established stops the task and says so
//   g  sign out needs no network; a keychain that cannot forget is reported
//   h  the keyboard opens, walks and closes the menu and returns focus to its trigger
// The shared recorder (helpers/externalRequests.ts) writes each request log, and the
// menu and dialog screenshots, into the test's output folder (and attaches them).
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { SEEDED_PROJECT, readClientSettingsDoc, resetClientSettings, resetPlaces, resetSeededChecking } from './helpers/rig';
import {
  QA_SERVER, RIG_API, USER, addOrigin, askInternet, commitLocally, dropOrigin, expectCleanCard, fakeFor, fakeKeychain, fakeShare, head, makeBareRemote, signIn,
} from './helpers/door43Share';
import { recordExternal } from './helpers/externalRequests';
import { verifyAllJournaledProjects } from './helpers/journal';
import { lane } from './lane.mjs';

const TAG = { tag: ['@internet-consent', '@inc85'] };
const NO_CONSENT = 'tC4 has no permission to use the internet for this task';
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;

const gateOn = async (): Promise<boolean> =>
  ((await (await fetch(`${RIG_API}/net/status`)).json()) as { is_enabled: boolean }).is_enabled;
const storedAsk = (): unknown => readClientSettingsDoc()?.askInternet;
const trigger = (page: Page) => page.getByTestId('account-menu');
const panel = (page: Page) => page.getByTestId('account-menu-panel');
const askDialog = (page: Page) => page.getByTestId('net-ask');
const dontAsk = (page: Page) => page.getByLabel(/Don.t ask again on this computer/);

async function openMenu(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
}
async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
}
/** A screenshot into the test's output folder, attached to the report. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
async function openTitus(page: Page): Promise<void> {
  await page.getByTestId(`project-${SEEDED_ID}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByRole('tab', { name: 'Check', exact: true })).toBeVisible({ timeout: 60_000 });
}
/** Local work with installed resources: Check runs its preflight on what is installed and,
 * when the pinned notes are installed, opens the tool and reads them. A rig whose cache lacks
 * the pinned English helps (dev-env/README.md, "Journeys from a clean clone") shows the card
 * as a fetch; opening Check is still the local work, and nothing is requested. */
async function openCheckTool(page: Page): Promise<string> {
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  const card = page.getByTestId('preflight-translationNotes');
  const progress = page.getByTestId('check-progress');
  // A reopened project resumes at its remembered place (D87), which can be inside the tool.
  await expect(card.or(progress).first()).toBeVisible({ timeout: 60_000 });
  if (await progress.isVisible()) return 'ready';
  await expect(card).toHaveAttribute('data-state', /ready|fetch/, { timeout: 60_000 });
  const state = (await card.getAttribute('data-state')) ?? '';
  if (state === 'ready') {
    await page.getByTestId('open-translationNotes').or(progress).first().click();
    await expect(progress).toBeVisible({ timeout: 60_000 });
  }
  return state;
}
const backHome = async (page: Page) => {
  await page.getByTitle('Switch project').click();
  await expect(page.getByTestId(`share-${SEEDED_ID}`)).toBeVisible({ timeout: 30_000 });
};
/** Count how many times the "Use the internet?" dialog is mounted in this page load. */
async function countAsks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __asks: number };
    w.__asks = 0;
    const seen = new WeakSet<Element>();
    new MutationObserver(() => {
      document.querySelectorAll('[data-testid="net-ask"]').forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          w.__asks += 1;
        }
      });
    }).observe(document, { childList: true, subtree: true });
  });
}
const asksSeen = (page: Page) => page.evaluate(() => (window as unknown as { __asks: number }).__asks);
/** The browser refuses a request made outside a permitted task before it is sent. */
const refusedOutsideATask = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const url of ['https://qa.door43.org/api/v1/version', '/api/gitea/x']) {
      try {
        await fetch(url);
        out.push('sent');
      } catch (e) {
        out.push((e as Error).message);
      }
    }
    return out;
  });

test.describe('D88 — ask before using the internet, and the account menu', () => {
  test.beforeEach(async () => {
    // A Home tile reopens the place an earlier spec left (#329); these cases open Titus 1.
    resetPlaces();
    resetClientSettings();
    dropOrigin(SEEDED_PROJECT);
    await fetch(`${RIG_API}/net/disable`, { method: 'POST' });
  });
  test.afterAll(async () => {
    try {
      await verifyAllJournaledProjects();
    } finally {
      await askInternet(true);
      resetSeededChecking();
      resetPlaces();
    }
  });

  // ---- a · defaults ----
  test('a. fresh settings ask, and a gate the rig left on ends off at start', TAG, async ({ page }) => {
    await fetch(`${RIG_API}/net/enable`, { method: 'POST' });
    expect(await gateOn()).toBe(true);
    expect(storedAsk()).toBeUndefined();
    await page.goto('/');
    await expect(trigger(page)).toBeVisible();
    await expect.poll(gateOn).toBe(false);
    await openMenu(page);
    await expect(page.getByTestId('account-ask')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('account-ask')).toContainText('Internet actions ask for confirmation.');
    await closeMenu(page);
    // Starting the client asked nothing.
    await expect(askDialog(page)).toHaveCount(0);
  });

  test('a. an old Internet choice, an invalid flag and an unreadable document do not turn asking off', TAG, async ({ page }) => {
    const write = async (settings: Record<string, unknown>) => {
      // Keep the rest of the document (the seed's install records): only the preference changes.
      const rest = { ...(readClientSettingsDoc() ?? {}) };
      delete rest.internet;
      delete rest.askInternet;
      const res = await fetch(`${RIG_API}/client-settings/uw-tc4`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { ...rest, ...settings } }),
      });
      expect(res.ok).toBe(true);
    };
    const asksOnShare = async () => {
      await page.goto('/');
      await openMenu(page);
      await expect(page.getByTestId('account-ask')).toHaveAttribute('aria-checked', 'true');
      await closeMenu(page);
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
    };
    // D86 stored `internet: true`; D88 ignores it.
    await write({ internet: true });
    await asksOnShare();
    // Only the boolean `false` turns asking off.
    for (const invalid of ['false', 0, null]) {
      await write({ askInternet: invalid });
      await asksOnShare();
    }
    // The document cannot be read: the client asks.
    await write({ askInternet: false });
    await page.route('**/api/client-settings/uw-tc4', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, body: 'unreadable' }) : route.fallback());
    await asksOnShare();
  });

  // ---- b · persistence ----
  test('b. the preference persists across a restart; the menu switch turns it off and on and stays open', TAG, async ({ page }, testInfo) => {
    await page.goto('/');
    await openMenu(page);
    const row = page.getByTestId('account-ask');
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await row.click();
    await expect(row).toHaveAttribute('aria-checked', 'false');
    await expect(row).toContainText('Internet actions continue without asking.');
    await expect(panel(page)).toBeVisible(); // the menu stays open
    await expect.poll(storedAsk).toBe(false);
    await shot(page, testInfo, 'menu-ask-off');
    await closeMenu(page);

    await page.reload();
    await openMenu(page);
    await expect(row).toHaveAttribute('aria-checked', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect.poll(storedAsk).toBeUndefined();
    await closeMenu(page);
    await page.reload();
    await openMenu(page);
    await expect(row).toHaveAttribute('aria-checked', 'true');
    // Turning the switch on or off started no task.
    await expect(askDialog(page)).toHaveCount(0);
  });

  test('b. signing in and signing out do not change the preference (asking off, and asking on)', TAG, async ({ page, context }) => {
    await fakeFor(context);
    for (const ask of [false, true]) {
      await askInternet(ask);
      await page.goto('/');
      await openMenu(page);
      await page.getByTestId('account-sign-in').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await signIn(page);
      if (ask) {
        await expect(askDialog(page)).toHaveAttribute('data-kind', 'signIn');
        await page.getByTestId('net-confirm').click();
      }
      await expect(trigger(page)).toHaveAttribute('data-state', 'in');
      expect(storedAsk()).toBe(ask ? undefined : false);
      await openMenu(page);
      await page.getByTestId('account-sign-out').click();
      await expect(trigger(page)).toHaveAttribute('data-state', 'out');
      expect(storedAsk()).toBe(ask ? undefined : false);
    }
  });

  // ---- c · the three account states, on Home and in a project ----
  test('c. signed out: Sign in to Door43 on Home and in a project; no Sign out', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context);
    const recorder = recordExternal(page);
    await page.goto('/');
    for (const where of ['home', 'project']) {
      if (where === 'project') await openTitus(page);
      await expect(trigger(page)).toHaveAttribute('data-state', 'out');
      await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'menu');
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
      await openMenu(page);
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByTestId('account-sign-in')).toContainText('Sign in to Door43');
      await expect(page.getByTestId('account-sign-in')).toContainText('Sign in to share projects on Door43.');
      await expect(page.getByTestId('account-ask')).toHaveAttribute('role', 'menuitemcheckbox');
      await expect(page.getByTestId('account-page')).toHaveCount(0);
      await expect(page.getByTestId('account-check')).toHaveCount(0);
      await expect(page.getByTestId('account-sign-out')).toHaveCount(0);
      await shot(page, testInfo, `account-menu-out-${where}`);
      await closeMenu(page);
    }
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'c-out-requests');
  });

  test('c. sign-in saved but not checked: the menu shows no identity and sends nothing; Check asks, Cancel sends nothing, Continue checks', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context, { tokens: ['kept-token'] });
    const keychain = await fakeKeychain(context, 'kept-token');
    const recorder = recordExternal(page);
    await page.goto('/');
    for (const where of ['home', 'project']) {
      if (where === 'project') await openTitus(page);
      await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
      await openMenu(page);
      await expect(page.getByTestId('account-check')).toContainText('Sign-in saved on this computer');
      await expect(page.getByTestId('account-check')).toContainText('Check which Door43 account is saved');
      await expect(page.getByTestId('account-page')).toHaveCount(0);
      await expect(page.getByTestId('account-sign-out')).toBeVisible();
      await expect(panel(page)).not.toContainText(USER.username);
      await shot(page, testInfo, `account-menu-saved-${where}`);
      await closeMenu(page);
    }
    await page.waitForTimeout(500);
    expect(fake.calls, 'opening the menu fetched no identity').toEqual([]);
    expect(recorder.external()).toEqual([]);

    // Check: asks (kind checkSignIn). Cancel sends nothing and keeps the sign-in.
    await openMenu(page);
    await page.getByTestId('account-check').click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'checkSignIn');
    await shot(page, testInfo, 'net-ask-checkSignIn');
    await page.getByTestId('net-cancel').click();
    await expect(askDialog(page)).toHaveCount(0);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    expect(keychain.held).toBe('kept-token');
    expect(storedAsk()).toBeUndefined();

    // Continue: the saved token is checked with exactly one Door43 call.
    await openMenu(page);
    await page.getByTestId('account-check').click();
    await page.getByTestId('net-confirm').click();
    await expect(trigger(page)).toHaveAttribute('data-state', 'in');
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${QA_SERVER}/api/v1/user`]);
    await recorder.save(testInfo, 'c-saved-requests');
  });

  test('c. signed in: the login and Open my page on Door43 on Home and in a project; the page link asks first', TAG, async ({ page, context }, testInfo) => {
    await fakeFor(context);
    await askInternet(false);
    await page.goto('/');
    await openMenu(page);
    await page.getByTestId('account-sign-in').click();
    await signIn(page);
    await expect(trigger(page)).toHaveAttribute('data-state', 'in');
    for (const where of ['home', 'project']) {
      if (where === 'project') await openTitus(page);
      await expect(trigger(page)).toHaveAttribute('data-state', 'in');
      await openMenu(page);
      await expect(page.getByTestId('account-page')).toContainText(`@${USER.username}`);
      await expect(page.getByTestId('account-page')).toContainText('Open my page on Door43');
      await expect(page.getByTestId('account-sign-out')).toBeVisible();
      await expect(page.getByTestId('account-sign-in')).toHaveCount(0);
      await shot(page, testInfo, `account-menu-in-${where}`);
      await closeMenu(page);
    }
    // With asking on, the profile link asks (kind profile); Cancel opens nothing.
    await askInternet(true);
    await page.reload();
    await signInAgain(page);
    let popups = 0;
    page.on('popup', () => { popups += 1; });
    await openMenu(page);
    await page.getByTestId('account-page').click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'profile');
    await page.getByTestId('net-cancel').click();
    await page.waitForTimeout(500);
    expect(popups).toBe(0);
    await openMenu(page);
    const opened = page.waitForEvent('popup');
    await page.getByTestId('account-page').click();
    await page.getByTestId('net-confirm').click();
    const popup = await opened;
    expect(popup.url()).toContain(`${QA_SERVER}/${USER.username}`);
    await popup.close();
  });

  // ---- d · Cancel, Continue, one dialog for Share ----
  test('d. Share: one dialog; Cancel sends and stores nothing (also with the box checked); Continue goes on to sign-in and the reviewed upload; the page link asks first', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote);
      await countAsks(page);
      const recorder = recordExternal(page);
      await page.goto('/');
      const share = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(share).toBeVisible();

      // Cancel, with the box checked: nothing is sent and nothing is stored.
      await share.click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
      await expect(askDialog(page)).toContainText('Use the internet?');
      await expect(page.getByTestId('net-ask-reason')).toContainText('This will contact Door43');
      await expect(page.getByTestId('net-confirm')).toHaveText('Continue');
      await expect(page.getByTestId('net-cancel')).toHaveText('Cancel');
      await expect(dontAsk(page)).not.toBeChecked();
      await shot(page, testInfo, 'net-ask-share');
      await dontAsk(page).check();
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(fake.calls).toEqual([]);
      expect(recorder.external()).toEqual([]);
      expect(storedAsk()).toBeUndefined();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      expect(remote.main()).toBeNull();
      await recorder.save(testInfo, 'd-after-cancel-requests');

      // A new Share asks again; Continue (box unchecked) starts the task.
      await page.evaluate(() => { (window as unknown as { __asks: number }).__asks = 0; });
      await share.click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
      await expect(dontAsk(page)).not.toBeChecked();
      expect(recorder.external()).toEqual([]);
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      expect(storedAsk()).toBeUndefined();
      await signIn(page);
      // The existing review is kept: the where-it-goes step, then the upload, then the end.
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page), 'sign-in, destinations and the upload share one dialog').toBe(1);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      expect(recorder.external().some((line) => line.includes('qa.door43.org'))).toBe(true);

      // "Open on Door43" is a task of its own: it asks (kind repoLink).
      let popups = 0;
      page.on('popup', () => { popups += 1; });
      await page.getByTestId('share-open').click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'repoLink');
      await page.getByTestId('net-cancel').click();
      await page.waitForTimeout(500);
      expect(popups).toBe(0);
      const opened = page.waitForEvent('popup');
      await page.getByTestId('share-open').click();
      await page.getByTestId('net-confirm').click();
      const popup = await opened;
      expect(popup.url()).toContain(`${QA_SERVER}/${USER.username}/${SEEDED_PROJECT}`);
      await popup.close();
      await recorder.save(testInfo, 'd-share-requests');
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #530: Upload changes opens its dialog with no internet task. The one "Use the internet?"
  // dialog of an upload opens when its sign-in, or the upload, is sent.
  test('d. Upload changes: the sign-in step and the upload dialog open with no request; the question comes when the sign-in or the upload is sent, once for each upload; Cancel in each place pushes nothing', TAG, async ({ page, context }, testInfo) => {
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote);
      addOrigin(SEEDED_PROJECT, remote);
      await countAsks(page);
      const recorder = recordExternal(page);
      await page.goto('/');
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');
      await expectCleanCard(page, SEEDED_ID);
      await shot(page, testInfo, 'upload-card-clean');

      // Signed out: the click opens the sign-in step. No question yet, and nothing is sent.
      await action.click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await asksSeen(page)).toBe(0);
      expect(recorder.external()).toEqual([]);

      // The sign-in is sent: the question opens (kind upload). Cancel keeps the step and sends nothing.
      await signIn(page);
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'upload');
      await expect(page.getByTestId('net-ask-reason')).toContainText('upload this project’s changes to its existing repository on Door43');
      await shot(page, testInfo, 'net-ask-upload');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await page.waitForTimeout(500);
      expect(fake.calls).toEqual([]);
      expect(recorder.external()).toEqual([]);

      // Continue: the sign-in is sent, and the upload dialog opens for review. Nothing is pushed.
      await signIn(page);
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await expect(page.getByTestId('share-account')).toHaveText(`Sharing as @${USER.username} · Change`);
      expect(remote.main(), 'the sign-in pushed nothing').toBeNull();
      // That one consent covers the upload: Upload changes asks nothing more.
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page), 'the sign-in and the upload share one answered question (one Cancel, one Continue)').toBe(2);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      await page.getByTestId('share-close').click();
      await expectCleanCard(page, SEEDED_ID);
      await recorder.save(testInfo, 'd-upload-signed-out-requests');

      // Signed in, a new upload: the dialog opens with no question and no request.
      recorder.reset();
      await page.evaluate(() => { (window as unknown as { __asks: number }).__asks = 0; });
      const pushed = remote.main();
      const next = commitLocally(SEEDED_PROJECT, 'a local edit for the consent journey');
      await action.click();
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await asksSeen(page)).toBe(0);
      expect(recorder.external(), 'opening the dialog sends nothing').toEqual([]);
      await shot(page, testInfo, 'upload-dialog-review');

      // Upload changes asks. Cancel returns to the review; nothing left the computer.
      await page.getByTestId('share-submit').click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'upload');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await page.waitForTimeout(500);
      expect(recorder.external()).toEqual([]);
      expect(remote.main()).toBe(pushed);

      // Cancel in the dialog: no push, and the project keeps its repository.
      await page.getByTestId('share-cancel').click();
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      expect(recorder.external()).toEqual([]);
      expect(remote.main()).toBe(pushed);
      await expectCleanCard(page, SEEDED_ID);

      // Upload changes, then Continue: one question, and the push.
      await page.evaluate(() => { (window as unknown as { __asks: number }).__asks = 0; });
      await action.click();
      await page.getByTestId('share-submit').click();
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page)).toBe(1);
      expect(remote.main()).toBe(next);
      expect(recorder.external().some((line) => line.includes('/api/git/push/'))).toBe(true);
      await shot(page, testInfo, 'upload-dialog-done');
      await recorder.save(testInfo, 'd-upload-signed-in-requests');
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  test('d. "Don\'t ask again" is stored only by Continue; the menu switch restores asking', TAG, async ({ page }) => {
    await page.goto('/');
    const share = page.getByTestId(`share-${SEEDED_ID}`);
    await share.click();
    await dontAsk(page).check();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect.poll(storedAsk).toBe(false);
    await page.getByTestId('signin-cancel').click();

    // After a restart there is no dialog: Share goes straight to the sign-in step.
    await page.reload();
    await openMenu(page);
    await expect(page.getByTestId('account-ask')).toHaveAttribute('aria-checked', 'false');
    await closeMenu(page);
    await share.click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    await page.getByTestId('signin-cancel').click();

    // The menu switch restores asking, and starts no task.
    await openMenu(page);
    await page.getByTestId('account-ask').click();
    await expect(page.getByTestId('account-ask')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(storedAsk).toBeUndefined();
    await expect(askDialog(page)).toHaveCount(0);
    await closeMenu(page);
    await share.click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
    await page.getByTestId('net-cancel').click();
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
  });

  test('d. sign-in from the menu asks when the password is sent; Cancel keeps the dialog and sends nothing; Continue signs in', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context);
    const recorder = recordExternal(page);
    await page.goto('/');
    await openMenu(page);
    await page.getByTestId('account-sign-in').click();
    // Opening the dialog is local: no question yet.
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    await signIn(page);
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'signIn');
    await expect(page.getByTestId('net-confirm')).toHaveText('Sign in');
    await shot(page, testInfo, 'net-ask-signIn');
    await page.getByTestId('net-cancel').click();
    await expect(askDialog(page)).toHaveCount(0);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await expect(trigger(page)).toHaveAttribute('data-state', 'out');
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await page.getByTestId('signin-submit').click();
    await page.getByTestId('net-confirm').click();
    await expect(trigger(page)).toHaveAttribute('data-state', 'in');
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(storedAsk()).toBeUndefined();
    await recorder.save(testInfo, 'd-signin-requests');
  });

  // ---- e · zero external requests, before and after a permitted task ----
  for (const ask of [true, false]) {
    test(`e. startup, idle, the menu and local work make zero external requests; the same after a permitted task has turned the gate on (asking ${ask ? 'on' : 'off'})`, TAG, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await askInternet(ask);
      const recorder = recordExternal(page);
      // A saved sign-in token must not change this, so the page holds a keychain with one. The
      // fake Door43 knows no token, so the Share step below never reaches the real server.
      const fake = await fakeFor(page.context());
      await fakeKeychain(page.context(), 'kept-token');
      const localSession = async (label: string, first: boolean) => {
        if (first) await page.goto('/');
        await expect(trigger(page)).toBeVisible();
        await page.waitForTimeout(5_000); // idle
        await openMenu(page);
        await closeMenu(page);
        await openTitus(page);
        await openCheckTool(page);
        await openMenu(page);
        await shot(page, testInfo, `menu-in-project-${label}`);
        await closeMenu(page);
        await page.waitForTimeout(1_000);
        await backHome(page);
      };

      await localSession('before-task', true);
      expect(recorder.external(), 'before any permitted task').toEqual([]);
      expect(fake.calls, 'a saved token sent nothing to Door43 before a task').toEqual([]);
      expect(await refusedOutsideATask(page)).toEqual([NO_CONSENT, NO_CONSENT]);
      expect(recorder.external()).toEqual([]);
      await recorder.save(testInfo, `e-before-task-ask-${ask ? 'on' : 'off'}`);

      // One permitted task: Share goes as far as the sign-in step (nothing is held, so nothing is sent),
      // and turns the gate on. Closing the step ends the task.
      expect(await gateOn()).toBe(false);
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      if (ask) {
        await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
        await page.getByTestId('net-confirm').click();
      } else {
        await expect(askDialog(page)).toHaveCount(0);
      }
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await page.getByTestId('signin-cancel').click();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      expect(await gateOn(), 'the gate stays on for the session').toBe(true);

      const callsAtTaskEnd = fake.calls.length;
      recorder.reset();
      await localSession('after-task', false);
      expect(fake.calls.length, 'no Door43 call after the task closed').toBe(callsAtTaskEnd);
      expect(recorder.external(), 'after a permitted task, with the gate on').toEqual([]);
      expect(await refusedOutsideATask(page), 'consent ended with the task').toEqual([NO_CONSENT, NO_CONSENT]);
      expect(recorder.external()).toEqual([]);
      await recorder.save(testInfo, `e-after-task-ask-${ask ? 'on' : 'off'}`);
    });
  }

  // ---- f · a gate that cannot be established ----
  for (const ask of [true, false]) {
    test(`f. a gate that does not turn on stops the task: net-failed, nothing runs, no external request (asking ${ask ? 'on' : 'off'})`, TAG, async ({ page, context }, testInfo) => {
      const fake = await fakeFor(context);
      await askInternet(ask);
      // The server answers the enable but the gate stays off.
      await page.route('**/api/net/enable', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_good":true}' }));
      await page.route('**/api/net/status', (route) =>
        route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_enabled":false}' }) : route.fallback());
      const recorder = recordExternal(page);
      await page.goto('/');
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      if (ask) {
        await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
        await page.getByTestId('net-confirm').click();
      }
      await expect(page.getByTestId('net-failed')).toBeVisible();
      await expect(page.getByTestId('net-failed')).toContainText('did not start and nothing was sent');
      await shot(page, testInfo, `net-failed-ask-${ask ? 'on' : 'off'}`);
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(fake.calls).toEqual([]);
      expect(recorder.external()).toEqual([]);
      expect(await gateOn(), 'the real gate was never turned on').toBe(false);
      await page.getByTestId('net-failed-close').click();
      await expect(page.getByTestId('net-failed')).toHaveCount(0);
      // The profile link has no gate step (the browser opens it): it is not blocked by a gate failure.
      await recorder.save(testInfo, `f-requests-ask-${ask ? 'on' : 'off'}`);
    });
  }

  test('f. a gate that cannot be read stops the task the same way', TAG, async ({ page, context }) => {
    const fake = await fakeFor(context);
    await askInternet(false);
    await page.route('**/api/net/status', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, body: 'no status' }) : route.fallback());
    const recorder = recordExternal(page);
    await page.goto('/');
    await page.getByTestId(`share-${SEEDED_ID}`).click();
    await expect(page.getByTestId('net-failed')).toBeVisible();
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
  });

  // ---- g · sign out ----
  test('g. sign out sends no request, removes the saved token, and stays out after a restart', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context, { tokens: ['kept-token'] });
    const keychain = await fakeKeychain(context, 'kept-token');
    // No network at all beyond the local server: any attempt fails and is recorded.
    await context.route((url) => url.protocol.startsWith('http') && url.host !== lane().clientHost, (route) => route.abort('internetdisconnected'));
    const recorder = recordExternal(page);
    await page.goto('/');
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    await openMenu(page);
    await page.getByTestId('account-sign-out').click();
    await expect(trigger(page)).toHaveAttribute('data-state', 'out');
    expect(keychain.calls.at(-1)).toBe('forget');
    expect(keychain.held).toBeNull();
    await expect(page.getByTestId('account-error')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(recorder.external(), 'sign out used no network').toEqual([]);
    expect(fake.calls).toEqual([]);
    await page.reload();
    await expect(trigger(page)).toHaveAttribute('data-state', 'out');
    await openMenu(page);
    await expect(page.getByTestId('account-sign-out')).toHaveCount(0);
    // Local projects stay.
    await expect(page.getByTestId(`project-${SEEDED_ID}`)).toBeVisible();
    await recorder.save(testInfo, 'g-sign-out-requests');
  });

  test('g. a keychain that cannot forget the token: the failure is shown and the sign-in stays saved', TAG, async ({ page, context }, testInfo) => {
    const keychain = await fakeKeychain(context, 'kept-token', { forgetFails: true });
    const recorder = recordExternal(page);
    await page.goto('/');
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    await openMenu(page);
    await page.getByTestId('account-sign-out').click();
    await openMenu(page);
    await expect(page.getByTestId('account-error')).toContainText('could not be removed from this computer');
    await shot(page, testInfo, 'account-error-sign-out');
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    expect(keychain.held, 'the token is still in the keychain, and the menu does not claim otherwise').toBe('kept-token');
    expect(recorder.external()).toEqual([]);
  });

  // ---- h · keyboard ----
  // The role="menu" contract (AC 1): Enter opens with focus on the first row, the arrows,
  // Home and End move between rows, Escape closes and focus returns to the trigger, and
  // Tab leaves the menu (as the owner's mockup does).
  test('h. keyboard: Enter opens on the first row, the arrows move, Escape closes and focus returns to the trigger (signed out and saved)', TAG, async ({ page, context }) => {
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
    const walk = async (rows: string[]) => {
      await trigger(page).focus();
      await page.keyboard.press('Enter');
      await expect(panel(page)).toBeVisible();
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(focused).toBe(rows[0]);
      for (const row of rows.slice(1)) {
        await page.keyboard.press('ArrowDown');
        await expect.poll(focused).toBe(row);
      }
      await page.keyboard.press('ArrowDown'); // wraps
      await expect.poll(focused).toBe(rows[0]);
      await page.keyboard.press('ArrowUp');
      await expect.poll(focused).toBe(rows[rows.length - 1]);
      await page.keyboard.press('Home');
      await expect.poll(focused).toBe(rows[0]);
      await page.keyboard.press('End');
      await expect.poll(focused).toBe(rows[rows.length - 1]);
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(focused).toBe('account-menu');
      // Tab leaves the menu.
      await page.keyboard.press('Enter');
      await expect.poll(focused).toBe(rows[0]);
      await page.keyboard.press('Tab');
      await expect(panel(page)).toHaveCount(0);
    };
    await page.goto('/');
    await walk(['account-sign-in', 'account-ask']);
    await fakeKeychain(context, 'kept-token');
    await page.reload();
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    await walk(['account-check', 'account-ask', 'account-sign-out']);
    // An outside click closes it as well.
    await openMenu(page);
    await page.mouse.click(5, 400);
    await expect(panel(page)).toHaveCount(0);
  });
});

/** After a reload the page holds no token: sign in again through the menu (asking is on, so Continue). */
async function signInAgain(page: Page): Promise<void> {
  await openMenu(page);
  await page.getByTestId('account-sign-in').click();
  await signIn(page);
  await expect(askDialog(page)).toHaveAttribute('data-kind', 'signIn');
  await page.getByTestId('net-confirm').click();
  await expect(trigger(page)).toHaveAttribute('data-state', 'in');
}
