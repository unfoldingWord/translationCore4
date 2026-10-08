// D95 (#559, amends D88 points 2–4): the internet is one on/off state for the app session,
// and the Door43 account menu (D88, #514). Replaces the D86 Internet / Local journeys
// (internet-local.spec.ts, retired by #514) and the D88 "Ask before using the internet" cases.
//
// What the journeys prove, against the real client and the rig:
//   a  every launch starts with the internet off, whatever the settings document holds (a D88
//      `askInternet: false`, an old `internet: true`, an unreadable document); a gate the rig
//      left on ends off
//   b  one question after launch, none after Turn on internet; the menu switch turns it off and
//      the next step asks again; a relaunch starts off and asks again; nothing is stored; sign-in
//      and sign-out leave the state alone
//   c  the account menu in its three states, on Home and inside a project; the saved sign-in
//      check and the profile link ask while the internet is off
//   d  Not now sends nothing and keeps the user where they were; Turn on internet continues the
//      exact step in place, and later steps ask nothing; Share is one dialog and keeps its review;
//      Upload changes opens its dialog with no request and asks when it is sent (#530); a step
//      whose dialog was cancelled while it waited runs nothing (#530, #540)
//   e  startup, idle, the menu and local work make zero external requests, before Turn on (a
//      request is refused) and after (a request is allowed, none is made); off in the menu
//      refuses the next request at once
//   f  a gate that cannot be established stops the step and says so
//   g  sign out needs no network; a keychain that cannot forget is reported
//   h  the keyboard opens, walks and closes the menu and returns focus to its trigger
//   i  About translationCore (#520) shows the version, the commit, the copyright line and the
//      license name; Read the license opens License (the LICENSE notice and the full GPL
//      version 2) and returns; on Home and in a project, with no network connection and
//      with zero external requests
// The shared recorder (helpers/externalRequests.ts) writes each request log, and the
// menu and dialog screenshots, into the test's output folder (and attaches them).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { SEEDED_PROJECT, readClientSettingsDoc, resetClientSettings, resetPlaces, resetSeededChecking } from './helpers/rig';
import {
  QA_SERVER, RIG_API, USER, addOrigin, commitLocally, dropOrigin, expectCleanCard, fakeFor, fakeKeychain, fakeShare, gateOff, head, makeBareRemote, signIn,
  turnOnInternet,
} from './helpers/door43Share';
import { recordExternal } from './helpers/externalRequests';
import { verifyAllJournaledProjects } from './helpers/journal';
import { lane } from './lane.mjs';
import { TC4_ROOT } from './helpers/root';

const TAG = { tag: ['@internet-consent', '@inc85'] };
const NO_CONSENT = 'tC4 has no permission to use the internet for this task';
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;
const TOOLTIP_ON = 'The internet is on. Click to turn it off.';
const UNTIL = 'tC4 will use the internet until you turn it off in the account menu, or close tC4.';

const gateOn = async (): Promise<boolean> =>
  ((await (await fetch(`${RIG_API}/net/status`)).json()) as { is_enabled: boolean }).is_enabled;
/** Nothing about the internet state is stored: the settings document has no key for it. */
const storedInternetKeys = (): string[] => Object.keys(readClientSettingsDoc() ?? {}).filter((key) => /internet/i.test(key));
const trigger = (page: Page) => page.getByTestId('account-menu');
const panel = (page: Page) => page.getByTestId('account-menu-panel');
const askDialog = (page: Page) => page.getByTestId('net-ask');
const switchRow = (page: Page) => page.getByTestId('account-internet');
const indicator = (page: Page) => page.getByTestId('internet-indicator');

async function openMenu(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
}
async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
}
/** The internet state as the account button shows it. */
async function expectInternet(page: Page, on: boolean): Promise<void> {
  await expect(trigger(page)).toHaveAttribute('data-internet', on ? 'on' : 'off');
  await expect(indicator(page)).toHaveCount(on ? 1 : 0);
  if (on) await expect(trigger(page)).toHaveAttribute('title', TOOLTIP_ON);
  else await expect(trigger(page)).not.toHaveAttribute('title', TOOLTIP_ON);
}
/** The menu's switch, turned off; the menu stays open and is closed here. */
async function turnOffInMenu(page: Page): Promise<void> {
  await openMenu(page);
  await expect(switchRow(page)).toHaveAttribute('aria-checked', 'true');
  await switchRow(page).click();
  await expect(switchRow(page)).toHaveAttribute('aria-checked', 'false');
  await expect(panel(page)).toBeVisible();
  await closeMenu(page);
  await expectInternet(page, false);
}
/** The "Turn on the internet?" dialog, as D95 words it, for one step kind. */
async function expectAsk(page: Page, kind: string, what: string): Promise<void> {
  await expect(askDialog(page)).toHaveAttribute('data-kind', kind);
  await expect(askDialog(page)).toContainText('Turn on the internet?');
  await expect(page.getByTestId('net-ask-reason')).toContainText(`This step needs the internet to ${what}`);
  await expect(askDialog(page)).toContainText(UNTIL);
  await expect(page.getByTestId('net-confirm')).toHaveText('Turn on internet');
  await expect(page.getByTestId('net-cancel')).toHaveText('Not now');
  await expect(askDialog(page).getByRole('checkbox')).toHaveCount(0);
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
/** Count how many times the "Turn on the internet?" dialog is mounted in this page load. */
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
/** What the browser does with a request that uses the internet, made outside any step: 'sent'
 * while the internet is on, the refusal text while it is off (refused before it is sent).
 * Neither probe leaves the computer: the fake Door43 answers the QA server, and the platform
 * route is answered here, so the rig never calls Door43 for it. */
const requestOutcomes = async (page: Page) => {
  await page.route('**/api/gitea/x', (route) => route.fulfill({ status: 404, body: 'probe' }));
  return page.evaluate(async () => {
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
};
const REFUSED = [NO_CONSENT, NO_CONSENT];

/** #530: hold Door43's answer to a sign-in (`GET /user` with Basic credentials) until the
 * journey releases it. The check of a saved token (`token …`) is not a sign-in and passes.
 * `hold(n)` says whether the n-th sign-in is held. `events` keeps the order of what happened. */
async function holdSignIns(page: Page, hold: (n: number) => boolean): Promise<{ sent: number; events: string[]; release: Record<number, () => void> }> {
  const signIns = { sent: 0, events: [] as string[], release: {} as Record<number, () => void> };
  await page.route(`${QA_SERVER}/api/v1/user`, async (route) => {
    if (!(route.request().headers().authorization ?? '').startsWith('Basic ')) return route.fallback();
    signIns.sent += 1;
    const n = signIns.sent;
    signIns.events.push(`sign-in ${n} sent`);
    if (hold(n)) {
      await new Promise<void>((resolve) => {
        signIns.release[n] = () => {
          signIns.events.push(`sign-in ${n} released`);
          resolve();
        };
      });
    }
    return route.fallback();
  });
  return signIns;
}
/** The push requests the page sent to the platform. */
const watchPushes = (page: Page): string[] => {
  const pushes: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/git/push/')) pushes.push(request.url());
  });
  return pushes;
};
const SHARING_AS = `Sharing as @${USER.username} · Change`;
/** #540 round 7: hold the platform's answer to the first gate read (`GET /api/net/status`)
 * until the journey releases it. `finished` counts the gate reads that have ended. */
async function holdFirstGateRead(page: Page): Promise<{ reads: () => number; finished: () => number; release: () => void }> {
  let reads = 0;
  let finished = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/net/status', async (route) => {
    reads += 1;
    if (reads === 1) await held;
    return route.fallback();
  });
  page.on('requestfinished', (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/net/status')) finished += 1;
  });
  return { reads: () => reads, finished: () => finished, release };
}

test.describe('D95 — the internet is one on/off state for the app session, and the account menu', () => {
  test.beforeEach(async () => {
    // A Home tile reopens the place an earlier spec left (#329); these cases open Titus 1.
    resetPlaces();
    resetClientSettings();
    dropOrigin(SEEDED_PROJECT);
    await gateOff();
  });
  test.afterAll(async () => {
    try {
      await verifyAllJournaledProjects();
    } finally {
      await gateOff();
      resetSeededChecking();
      resetPlaces();
    }
  });

  // ---- a · every launch starts off ----
  test('a. a launch starts with the internet off: no indicator, the switch off, nothing stored; a gate the rig left on ends off at start', TAG, async ({ page }, testInfo) => {
    await fetch(`${RIG_API}/net/enable`, { method: 'POST' });
    expect(await gateOn()).toBe(true);
    expect(storedInternetKeys()).toEqual([]);
    await page.goto('/');
    await expect(trigger(page)).toBeVisible();
    await expect.poll(gateOn).toBe(false);
    await expectInternet(page, false);
    await openMenu(page);
    await expect(switchRow(page)).toHaveAttribute('role', 'menuitemcheckbox');
    await expect(switchRow(page)).toHaveAttribute('aria-checked', 'false');
    await expect(switchRow(page)).toContainText('Use the internet');
    await expect(switchRow(page)).toContainText('Off. A step that needs the internet asks first.');
    await shot(page, testInfo, 'menu-internet-off');
    await closeMenu(page);
    // Starting the client asked nothing, and stored nothing.
    await expect(askDialog(page)).toHaveCount(0);
    expect(storedInternetKeys()).toEqual([]);
  });

  test('a. a stored "Don\'t ask again" of D88, an old Internet choice and an unreadable document have no effect: the internet is off and Share asks', TAG, async ({ page }) => {
    const write = async (settings: Record<string, unknown>) => {
      // Keep the rest of the document (the seed's install records): only the old keys change.
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
    const offAndAsks = async () => {
      await page.goto('/');
      await expectInternet(page, false);
      await openMenu(page);
      await expect(switchRow(page)).toHaveAttribute('aria-checked', 'false');
      await closeMenu(page);
      await page.getByTestId(`share-${SEEDED_ID}`).click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
    };
    // D88 stored `askInternet: false` ("Don't ask again"); D95 reads nothing, so it asks once per session.
    await write({ askInternet: false });
    await offAndAsks();
    // The stored D88 flag is neither read nor rewritten.
    expect(readClientSettingsDoc()?.askInternet).toBe(false);
    // D86 stored `internet: true`; it has no effect either.
    await write({ internet: true });
    await offAndAsks();
    // The document cannot be read: the same.
    await page.route('**/api/client-settings/uw-tc4', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, body: 'unreadable' }) : route.fallback());
    await offAndAsks();
    await page.unroute('**/api/client-settings/uw-tc4');
  });

  // ---- b · the session state ----
  test('b. one question after launch, none after Turn on internet; off in the menu asks again; a relaunch starts off and asks again; nothing is stored', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context);
    await countAsks(page);
    const recorder = recordExternal(page);
    await page.goto('/');
    const share = page.getByTestId(`share-${SEEDED_ID}`);
    await expect(share).toBeVisible();
    await expectInternet(page, false);

    // The first step that needs the internet asks, in place.
    await share.click();
    await expectAsk(page, 'share', 'contact Door43, sign in if needed and prepare sharing.');
    await shot(page, testInfo, 'net-ask-share');
    expect(storedInternetKeys()).toEqual([]);
    // Turn on internet: on for the session, the step goes on (the sign-in step opens), and the button says so.
    await page.getByTestId('net-confirm').click();
    await expect(askDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expectInternet(page, true);
    await expect(trigger(page)).toHaveAttribute('aria-label', /The internet is on\. Click to turn it off\./);
    await shot(page, testInfo, 'account-button-internet-on');
    await page.getByTestId('signin-cancel').click();
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    expect(storedInternetKeys()).toEqual([]);

    // A second step in the same session asks nothing.
    await share.click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    await page.getByTestId('signin-cancel').click();
    expect(await asksSeen(page)).toBe(1);

    // The menu: the switch is on, and turning it off starts no request and clears the indicator.
    await openMenu(page);
    await expect(switchRow(page)).toHaveAttribute('aria-checked', 'true');
    await expect(switchRow(page)).toContainText('On until you turn it off or close tC4.');
    await shot(page, testInfo, 'menu-internet-on');
    await closeMenu(page);
    await turnOffInMenu(page);
    await expect(askDialog(page)).toHaveCount(0);
    expect(storedInternetKeys()).toEqual([]);
    // The next step asks again. Not now: nothing is sent, and the user stays on Home.
    await share.click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
    await page.getByTestId('net-cancel').click();
    await expect(askDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    await expect(page.getByTestId('share-dialog')).toHaveCount(0);
    await expectInternet(page, false);
    expect(await asksSeen(page)).toBe(2);
    // The menu switch turns it on as well: the step then asks nothing.
    await turnOnInternet(page);
    await share.click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    await page.getByTestId('signin-cancel').click();
    expect(await asksSeen(page)).toBe(2);

    // A relaunch: off again, and the first step asks again.
    await page.reload();
    await expect(share).toBeVisible();
    await expectInternet(page, false);
    await openMenu(page);
    await expect(switchRow(page)).toHaveAttribute('aria-checked', 'false');
    await closeMenu(page);
    await share.click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
    await page.getByTestId('net-cancel').click();
    expect(await asksSeen(page), 'one question in the new session').toBe(1);
    expect(storedInternetKeys()).toEqual([]);
    // No sign-in was sent in this whole case: nothing left the computer.
    await page.waitForTimeout(500);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'b-session-state-requests');
  });

  test('b. signing in and signing out leave the internet state alone', TAG, async ({ page, context }) => {
    await fakeFor(context);
    await page.goto('/');
    await turnOnInternet(page);
    await openMenu(page);
    await page.getByTestId('account-sign-in').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await signIn(page);
    await expect(askDialog(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveAttribute('data-state', 'in');
    await expectInternet(page, true);
    await openMenu(page);
    await page.getByTestId('account-sign-out').click();
    await expect(trigger(page)).toHaveAttribute('data-state', 'out');
    await expectInternet(page, true);
    expect(storedInternetKeys()).toEqual([]);
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
      await expect(switchRow(page)).toHaveAttribute('role', 'menuitemcheckbox');
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

  test('c. sign-in saved but not checked: the menu shows no identity and sends nothing; Check asks to turn the internet on, Not now sends nothing, Turn on internet checks', TAG, async ({ page, context }, testInfo) => {
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

    // Check: asks (kind checkSignIn). Not now sends nothing and keeps the sign-in saved.
    await openMenu(page);
    await page.getByTestId('account-check').click();
    await expectAsk(page, 'checkSignIn', 'check with Door43 the sign-in saved on this computer.');
    await shot(page, testInfo, 'net-ask-checkSignIn');
    await page.getByTestId('net-cancel').click();
    await expect(askDialog(page)).toHaveCount(0);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    await expectInternet(page, false);
    expect(keychain.held).toBe('kept-token');

    // Turn on internet: the saved token is checked with exactly one Door43 call.
    await openMenu(page);
    await page.getByTestId('account-check').click();
    await page.getByTestId('net-confirm').click();
    await expect(trigger(page)).toHaveAttribute('data-state', 'in');
    await expectInternet(page, true);
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${QA_SERVER}/api/v1/user`]);
    await recorder.save(testInfo, 'c-saved-requests');
  });

  test('c. signed in: the login and Open my page on Door43 on Home and in a project; the page link opens at once while the internet is on, and asks after it is turned off', TAG, async ({ page, context }, testInfo) => {
    await fakeFor(context);
    await page.goto('/');
    await turnOnInternet(page);
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
    // With the internet on, the profile link opens at once.
    let popups = 0;
    page.on('popup', () => { popups += 1; });
    const first = page.waitForEvent('popup');
    await openMenu(page);
    await page.getByTestId('account-page').click();
    await expect(askDialog(page)).toHaveCount(0);
    const popup1 = await first;
    expect(popup1.url()).toContain(`${QA_SERVER}/${USER.username}`);
    await popup1.close();
    // Off in the menu: the link asks (kind profile); Not now opens nothing; Turn on internet opens it.
    await turnOffInMenu(page);
    await openMenu(page);
    await page.getByTestId('account-page').click();
    await expectAsk(page, 'profile', 'open your Door43 profile in your browser.');
    await page.getByTestId('net-cancel').click();
    await page.waitForTimeout(500);
    expect(popups).toBe(1);
    await openMenu(page);
    const opened = page.waitForEvent('popup');
    await page.getByTestId('account-page').click();
    await page.getByTestId('net-confirm').click();
    const popup = await opened;
    expect(popup.url()).toContain(`${QA_SERVER}/${USER.username}`);
    await popup.close();
    await expectInternet(page, true);
  });

  // ---- d · Not now, Turn on internet, one dialog for Share ----
  test('d. Share: one question; Not now sends nothing and keeps the user on Home; Turn on internet goes on to sign-in and the reviewed upload with no second question; Open on Door43 asks nothing', TAG, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote);
      await countAsks(page);
      const recorder = recordExternal(page);
      await page.goto('/');
      const share = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(share).toBeVisible();

      // Not now: nothing is sent, nothing is stored, and the user stays on Home.
      await share.click();
      await expectAsk(page, 'share', 'contact Door43, sign in if needed and prepare sharing. You will review the destination and books before uploading.');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(fake.calls).toEqual([]);
      expect(recorder.external()).toEqual([]);
      expect(storedInternetKeys()).toEqual([]);
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expectInternet(page, false);
      expect(remote.main()).toBeNull();
      await recorder.save(testInfo, 'd-after-not-now-requests');

      // A new Share asks again; Turn on internet starts the step.
      await page.evaluate(() => { (window as unknown as { __asks: number }).__asks = 0; });
      await share.click();
      await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
      expect(recorder.external()).toEqual([]);
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await expectInternet(page, true);
      await signIn(page);
      // The existing review is kept: the where-it-goes step, then the upload, then the end.
      await expect(page.getByTestId('share-orgs-loading')).toHaveCount(0);
      await page.getByTestId('share-next').click();
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page), 'sign-in, destinations and the upload needed one question').toBe(1);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      expect(recorder.external().some((line) => line.includes('qa.door43.org'))).toBe(true);

      // "Open on Door43" is a step of its own; the internet is on, so it opens at once.
      const opened = page.waitForEvent('popup');
      await page.getByTestId('share-open').click();
      await expect(askDialog(page)).toHaveCount(0);
      const popup = await opened;
      expect(popup.url()).toContain(`${QA_SERVER}/${USER.username}/${SEEDED_PROJECT}`);
      await popup.close();
      expect(await asksSeen(page)).toBe(1);
      await recorder.save(testInfo, 'd-share-requests');
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #530: Upload changes opens its dialog with no internet step. The question of an upload opens
  // when its sign-in, or the upload, is sent, while the internet is off.
  test('d. Upload changes: the sign-in step and the upload dialog open with no request; the question comes when the sign-in or the upload is sent; Not now in each place pushes nothing; Turn on internet continues in place', TAG, async ({ page, context }, testInfo) => {
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

      // The sign-in is sent: the question opens (kind upload). Not now keeps the step and sends nothing.
      await signIn(page);
      await expectAsk(page, 'upload', 'sign in to Door43 if needed and upload this project’s changes to its existing repository on Door43.');
      await shot(page, testInfo, 'net-ask-upload');
      await page.getByTestId('net-cancel').click();
      await expect(askDialog(page)).toHaveCount(0);
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await page.waitForTimeout(500);
      expect(fake.calls).toEqual([]);
      expect(recorder.external()).toEqual([]);

      // Turn on internet: the sign-in is sent, and the upload dialog opens for review. Nothing is pushed.
      await signIn(page);
      await page.getByTestId('net-confirm').click();
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      expect(remote.main(), 'the sign-in pushed nothing').toBeNull();
      // The internet is on: Upload changes asks nothing more.
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page), 'one Not now and one Turn on internet').toBe(2);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      await page.getByTestId('share-close').click();
      await expectCleanCard(page, SEEDED_ID);
      await recorder.save(testInfo, 'd-upload-signed-out-requests');

      // Signed in, the internet turned off in the menu, a new upload: the dialog opens with no
      // question and no request; the question comes when Upload changes is sent.
      await turnOffInMenu(page);
      recorder.reset();
      await page.evaluate(() => { (window as unknown as { __asks: number }).__asks = 0; });
      const pushed = remote.main();
      const next = commitLocally(SEEDED_PROJECT, 'a local edit for the internet journey');
      await action.click();
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await asksSeen(page)).toBe(0);
      expect(recorder.external(), 'opening the dialog sends nothing').toEqual([]);
      await shot(page, testInfo, 'upload-dialog-review');

      // Upload changes asks. Not now returns to the review; nothing left the computer.
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
      await expectInternet(page, false);

      // Upload changes, then Turn on internet: one question, and the push.
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

  // #530 (review rounds 2 and 3): an upload belongs to the dialog it was sent from. A dialog that
  // was closed while the saved sign-in was checked runs nothing afterwards: no push, no sign-in
  // step. The internet stays on (D95: the state belongs to the session, not to the dialog), so
  // the next upload asks nothing and runs at its own click.
  test('d. Upload changes: Cancel while the saved sign-in is checked ends that upload; the dialog opened after it does not push, and its own upload runs with no second question', TAG, async ({ page, context }, testInfo) => {
    const KEPT_TOKEN = 'kept-token-for-530';
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote, { tokens: [KEPT_TOKEN] });
      await fakeKeychain(context, KEPT_TOKEN);
      addOrigin(SEEDED_PROJECT, remote);
      // Hold Door43's answer to the check of the saved sign-in until the journey releases it.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let checks = 0;
      await page.route(`${QA_SERVER}/api/v1/user`, async (route) => {
        checks += 1;
        await held;
        await route.fallback();
      });
      const pushes = watchPushes(page);
      await countAsks(page);
      await page.goto('/');
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // Upload changes, Turn on internet: the check of the saved sign-in is sent, and held.
      await action.click();
      await expect(page.getByTestId('share-account')).toHaveText('Signed in · Change');
      await page.getByTestId('share-submit').click();
      await page.getByTestId('net-confirm').click();
      await expect.poll(() => checks).toBe(1);

      // Cancel while it is held, then open the dialog again.
      await page.getByTestId('share-cancel').click();
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await action.click();
      await expect(page.getByTestId('share-upload')).toBeVisible();

      // The held check ends. The cancelled upload pushes nothing and opens no sign-in step.
      release();
      await expect.poll(() => fake.calls.length).toBe(1);
      // The signal that the cancelled upload's check ended: Door43 named the account, and the
      // open dialog shows it. What the cancelled upload does next, it has done by now.
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      expect(pushes, 'the cancelled upload pushes nothing').toEqual([]);
      expect(remote.main()).toBeNull();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await expect(page.getByTestId('share-upload')).toBeVisible();

      // The next upload runs at its own click, with no question: the internet is on.
      await page.getByTestId('share-submit').click();
      await expect(askDialog(page)).toHaveCount(0);
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(await asksSeen(page), 'one question in all').toBe(1);
      expect(pushes.length).toBe(1);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      const log = testInfo.outputPath('d-upload-cancel-reopen.json');
      fs.writeFileSync(log, JSON.stringify({ savedSignInChecks: checks, door43Calls: fake.calls.map((c) => `${c.method} ${c.url}`), pushes: pushes.length, asks: await asksSeen(page) }, null, 2));
      await testInfo.attach('d-upload-cancel-reopen', { path: log, contentType: 'application/json' });
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  test('d. Upload changes: Cancel while the sign-in is sent signs nothing in; the sign-in step opened after it sends its own sign-in, with no second question', TAG, async ({ page, context }) => {
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote);
      const keychain = await fakeKeychain(context);
      const forgets = () => keychain.calls.filter((call) => call === 'forget').length;
      addOrigin(SEEDED_PROJECT, remote);
      const signIns = await holdSignIns(page, (n) => n === 1);
      await countAsks(page);
      await page.goto('/');
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // Signed out: the sign-in step. Sign in, Turn on internet: the sign-in is sent, and held.
      await action.click();
      await signIn(page);
      await page.getByTestId('net-confirm').click();
      await expect.poll(() => signIns.sent).toBe(1);

      // Cancel while it is held, then open the sign-in step again.
      await page.getByTestId('signin-cancel').click();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      await action.click();
      await expect(page.getByTestId('share-signin')).toBeVisible();

      // The held sign-in ends. It signs nobody in, and the upload dialog does not open.
      // The signal that the app has dealt with it: the keychain was told to forget twice,
      // once by the sign-in itself (not kept), once by the Cancel that drops its token.
      const before = forgets();
      signIns.release[1]();
      await expect.poll(forgets).toBe(before + 2);
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(trigger(page)).toHaveAttribute('data-state', 'out');
      expect(remote.main()).toBeNull();

      // The new sign-in asks nothing (the internet is on) and signs in.
      await signIn(page);
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await expect(askDialog(page)).toHaveCount(0);
      expect(await asksSeen(page)).toBe(1);
      expect(remote.main(), 'the sign-in pushed nothing').toBeNull();
      expect(fake.tokens.size).toBeGreaterThan(0);
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #530 (review rounds 4 and 5): the same rule for a sign-in step that opens inside an upload
  // after Turn on internet. Two ways lead to that step: Door43 refuses the saved sign-in, or the
  // user presses Change.
  for (const way of ['a refused saved sign-in', 'Change after Turn on internet'] as const) {
    test(`d. Upload changes: ${way}, then Cancel while the new sign-in is sent: the step opened after it sends its own sign-in, and nothing is pushed`, TAG, async ({ page, context }, testInfo) => {
      const KEPT_TOKEN = 'kept-token-for-530';
      const remote = makeBareRemote();
      try {
        // "Refused": the fake knows no token. "Change": the token is good, and the push fails
        // once, so the dialog returns to its review step, where Change is.
        const refused = way === 'a refused saved sign-in';
        const fake = await fakeShare(context, remote, refused ? {} : { tokens: [KEPT_TOKEN] });
        const keychain = await fakeKeychain(context, KEPT_TOKEN);
        const forgets = () => keychain.calls.filter((call) => call === 'forget').length;
        addOrigin(SEEDED_PROJECT, remote);
        const signIns = await holdSignIns(page, (n) => n === 1);
        const pushes = watchPushes(page);
        if (!refused) await page.route('**/api/git/push/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ is_good: false, reason: 'the journey refused this push' }) }));
        await countAsks(page);
        await page.goto('/');
        const action = page.getByTestId(`share-${SEEDED_ID}`);
        await expect(action).toHaveText('Upload changes');

        // Upload changes, Turn on internet: the one question of this session.
        await action.click();
        await page.getByTestId('share-submit').click();
        await page.getByTestId('net-confirm').click();
        if (!refused) {
          await expect(page.getByTestId('share-error')).toHaveAttribute('data-code', 'share.push-failed', { timeout: 30_000 });
          await page.getByTestId('share-account-change').click();
        }
        // The sign-in step: it asks nothing more. It is sent, and held.
        await expect(page.getByTestId('share-signin')).toBeVisible();
        await signIn(page);
        await expect.poll(() => signIns.sent).toBe(1);
        expect(await asksSeen(page), 'the sign-in does not ask again').toBe(1);

        // Cancel while it is held, then press Upload changes again. No sign-in is left, in
        // memory or saved, so the sign-in step opens.
        await page.getByTestId('signin-cancel').click();
        await expect(page.getByTestId('share-signin')).toHaveCount(0);
        await action.click();
        await expect(page.getByTestId('share-signin')).toBeVisible();

        // The held sign-in ends (the signal: its own forget, and the forget of the Cancel).
        // It signs nobody in, opens nothing, and pushes nothing.
        const before = forgets();
        const pushed = pushes.length;
        signIns.release[1]();
        await expect.poll(forgets).toBe(before + 2);
        await expect(page.getByTestId('share-signin')).toBeVisible();
        await expect(page.getByTestId('share-dialog')).toHaveCount(0);
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
        await expect(trigger(page)).toHaveAttribute('data-state', 'out');
        expect(pushes.length).toBe(pushed);

        // The step opened after the Cancel sends its own sign-in, with no question.
        await signIn(page);
        await expect(page.getByTestId('share-upload')).toBeVisible();
        await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
        expect(await asksSeen(page)).toBe(1);
        expect(signIns.sent).toBe(2);
        expect(pushes.length, 'the sign-in pushed nothing').toBe(pushed);
        const log = testInfo.outputPath('d-upload-sign-in-cancel.json');
        fs.writeFileSync(log, JSON.stringify({ way, signIns: signIns.events, pushes: pushes.length, door43Calls: fake.calls.length }, null, 2));
        await testInfo.attach('d-upload-sign-in-cancel', { path: log, contentType: 'application/json' });
      } finally {
        dropOrigin(SEEDED_PROJECT);
        remote.dispose();
      }
    });
  }

  // #530 (review round 6): an upload belongs to the review it was submitted in. Change leaves
  // that review, so the upload that was waiting for the check of the saved sign-in ends. The
  // new review uploads at its own click.
  test('d. Upload changes: Change while the saved sign-in is checked ends that upload; after the new sign-in nothing is pushed until Upload changes is pressed again, and then one push', TAG, async ({ page, context }, testInfo) => {
    const KEPT_TOKEN = 'kept-token-for-530';
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote, { tokens: [KEPT_TOKEN] });
      await fakeKeychain(context, KEPT_TOKEN);
      addOrigin(SEEDED_PROJECT, remote);
      // Hold Door43's answer to the check of the saved sign-in (`token …`); a sign-in passes.
      const isCheck = (authorization: string | undefined) => (authorization ?? '').startsWith('token ');
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let checks = 0;
      await page.route(`${QA_SERVER}/api/v1/user`, async (route) => {
        if (!isCheck(route.request().headers().authorization)) return route.fallback();
        checks += 1;
        await held;
        return route.fallback();
      });
      const pushes = watchPushes(page);
      await countAsks(page);
      await page.goto('/');
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // Upload changes, Turn on internet: the check of the saved sign-in is sent, and held.
      await action.click();
      await expect(page.getByTestId('share-account')).toHaveText('Signed in · Change');
      await page.getByTestId('share-submit').click();
      await page.getByTestId('net-confirm').click();
      await expect.poll(() => checks).toBe(1);

      // Change while it is held, and sign in. No question: the internet is on.
      await page.getByTestId('share-account-change').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await signIn(page);
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      expect(pushes, 'the sign-in pushed nothing').toEqual([]);

      // The held check ends. Wait until the page has its answer and has run what follows it.
      const answered = page.waitForResponse((response) => response.url() === `${QA_SERVER}/api/v1/user` && isCheck(response.request().headers().authorization));
      release();
      await (await answered).finished();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
      // The upload that was submitted before Change does not run: the review stands, and nothing is pushed.
      await expect(page.getByTestId('share-upload')).toBeVisible();
      await expect(page.getByTestId('share-progress')).toHaveCount(0);
      await expect(page.getByTestId('share-done')).toHaveCount(0);
      expect(pushes, 'nothing is pushed without a new click').toEqual([]);
      expect(remote.main()).toBeNull();

      // Upload changes, pressed again: one push, and no second question.
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      expect(pushes.length, 'one push for the one click').toBe(1);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      expect(await asksSeen(page), 'one question').toBe(1);
      const log = testInfo.outputPath('d-upload-change-while-checking.json');
      fs.writeFileSync(log, JSON.stringify({ savedSignInChecks: checks, door43Calls: fake.calls.map((c) => `${c.method} ${c.url}`), pushes: pushes.length }, null, 2));
      await testInfo.attach('d-upload-change-while-checking', { path: log, contentType: 'application/json' });
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #540 review round 7: steps that start while the gate is checked share that one check. The
  // internet state outlives the dialog (D95): after Close a request is still allowed; off in the
  // menu refuses the next one at once.
  test('d. Upload changes: Change and a new sign-in while the gate is checked share the one gate check; after Close the internet stays on; off in the menu refuses the next request', TAG, async ({ page, context }, testInfo) => {
    const KEPT_TOKEN = 'kept-token-for-530';
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote, { tokens: [KEPT_TOKEN] });
      await fakeKeychain(context, KEPT_TOKEN);
      addOrigin(SEEDED_PROJECT, remote);
      const gate = await holdFirstGateRead(page);
      const pushes = watchPushes(page);
      await countAsks(page);
      await page.goto('/');
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // Upload changes, Turn on internet: the gate is read, and the answer is held.
      await action.click();
      await expect(page.getByTestId('share-account')).toHaveText('Signed in · Change');
      await page.getByTestId('share-submit').click();
      await page.getByTestId('net-confirm').click();
      await expect.poll(() => gate.reads()).toBe(1);

      // Change, and sign in, while the gate read is held. The sign-in waits for the same
      // check: no second question opens, and the gate is not read again.
      await page.getByTestId('share-account-change').click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await signIn(page);
      await expect.poll(() => asksSeen(page), { timeout: 1500 }).toBe(2).catch(() => {});
      expect(await asksSeen(page), 'the sign-in asks nothing').toBe(1);
      expect(gate.reads(), 'one gate check for both steps').toBe(1);

      // The held read ends: the check goes on, the sign-in is sent, and the review returns.
      gate.release();
      await expect(page.getByTestId('share-upload')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      expect(pushes, 'nothing is pushed without a new click').toEqual([]);

      // Close the dialog. The internet stays on: a request outside any step is sent. Off in the
      // menu: the next request is refused before it is sent.
      await page.getByTestId('share-cancel').click();
      await expect(page.getByTestId('share-dialog')).toHaveCount(0);
      await expectInternet(page, true);
      expect(await requestOutcomes(page), 'the internet stays on after Close').toEqual(['sent', 'sent']);
      await turnOffInMenu(page);
      expect(await requestOutcomes(page), 'off refuses at once').toEqual(REFUSED);
      expect(await asksSeen(page), 'one question in all').toBe(1);
      expect(pushes).toEqual([]);
      expect(remote.main()).toBeNull();
      const log = testInfo.outputPath('d-upload-change-while-gate-checked.json');
      fs.writeFileSync(log, JSON.stringify({ gateReads: gate.reads(), asks: await asksSeen(page), door43Calls: fake.calls.map((c) => `${c.method} ${c.url}`), pushes: pushes.length }, null, 2));
      await testInfo.attach('d-upload-change-while-gate-checked', { path: log, contentType: 'application/json' });
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #540 review round 7 (Frank): with the internet on, Sign in pressed twice while the gate is
  // checked. The two submits share one gate check; after Cancel nothing is sent.
  test('d. Upload changes: two quick Sign in submits while the gate is checked, then Cancel: one gate check, and nothing is sent', TAG, async ({ page, context }, testInfo) => {
    const remote = makeBareRemote();
    try {
      const fake = await fakeShare(context, remote);
      addOrigin(SEEDED_PROJECT, remote);
      const gate = await holdFirstGateRead(page);
      const recorder = recordExternal(page);
      await page.goto('/');
      await turnOnInternet(page);
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // The sign-in step; Sign in twice while the first gate read is held.
      await action.click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await page.getByLabel('Door43 username or email').fill(USER.username);
      await page.getByLabel('Password', { exact: true }).fill(USER.password);
      await page.getByTestId('signin-submit').click();
      await expect.poll(() => gate.reads()).toBe(1);
      await page.getByTestId('signin-submit').click();
      await expect.poll(() => gate.reads(), { timeout: 1500 }).toBe(2).catch(() => {});
      expect(gate.reads(), 'the second submit shares the gate check').toBe(1);

      // Cancel, then let the check end: read, enable, read back.
      await page.getByTestId('signin-cancel').click();
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      gate.release();
      await expect.poll(() => gate.finished(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
      await page.waitForTimeout(500);

      expect(fake.calls, 'the cancelled step signed nothing in').toEqual([]);
      expect(recorder.external(), 'nothing left the computer').toEqual([]);
      expect(remote.main()).toBeNull();
      const log = testInfo.outputPath('d-upload-two-submits-while-gate-checked.json');
      fs.writeFileSync(log, JSON.stringify({ gateReads: gate.reads(), gateReadsFinished: gate.finished(), door43Calls: fake.calls.length, external: recorder.external() }, null, 2));
      await testInfo.attach('d-upload-two-submits-while-gate-checked', { path: log, contentType: 'application/json' });
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  // #530: one sign-in is sent at a time. A sign-in sent from a step that was cancelled drops
  // its own token when it ends; it must not end after a newer sign-in and drop that one.
  test('d. Upload changes: a sign-in sent while a cancelled one is still in flight waits for it, and keeps its own session', TAG, async ({ page, context }, testInfo) => {
    const remote = makeBareRemote();
    try {
      await fakeShare(context, remote);
      addOrigin(SEEDED_PROJECT, remote);
      const signIns = await holdSignIns(page, (n) => n === 1);
      await page.goto('/');
      await turnOnInternet(page); // no questions here: the order of the sign-ins is the subject
      const action = page.getByTestId(`share-${SEEDED_ID}`);
      await expect(action).toHaveText('Upload changes');

      // The first sign-in is sent and held. Cancel, open the step again, and sign in again.
      await action.click();
      await signIn(page);
      await expect.poll(() => signIns.sent).toBe(1);
      await page.getByTestId('signin-cancel').click();
      await action.click();
      await expect(page.getByTestId('share-signin')).toBeVisible();
      await signIn(page);
      // Give a second sign-in the time to leave, if the app sends it now. Then release the first.
      await expect.poll(() => signIns.sent, { timeout: 1500 }).toBe(2).catch(() => {});
      signIns.release[1]();

      // The second sign-in left only after the first one ended, and it signed in.
      await expect(page.getByTestId('share-upload')).toBeVisible({ timeout: 30_000 });
      expect(signIns.events).toEqual(['sign-in 1 sent', 'sign-in 1 released', 'sign-in 2 sent']);
      await expect(page.getByTestId('share-account')).toHaveText(SHARING_AS);
      // Its session is whole: the upload runs with no new sign-in.
      await page.getByTestId('share-submit').click();
      await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('share-signin')).toHaveCount(0);
      expect(remote.main()).toBe(head(SEEDED_PROJECT));
      const log = testInfo.outputPath('d-upload-sign-in-order.json');
      fs.writeFileSync(log, JSON.stringify(signIns.events, null, 2));
      await testInfo.attach('d-upload-sign-in-order', { path: log, contentType: 'application/json' });
    } finally {
      dropOrigin(SEEDED_PROJECT);
      remote.dispose();
    }
  });

  test('d. sign-in from the menu asks when the password is sent; Not now keeps the dialog and sends nothing; Turn on internet signs in', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context);
    const recorder = recordExternal(page);
    await page.goto('/');
    await openMenu(page);
    await page.getByTestId('account-sign-in').click();
    // Opening the dialog is local: no question yet.
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(askDialog(page)).toHaveCount(0);
    await signIn(page);
    await expectAsk(page, 'signIn', 'send your sign-in details to Door43.');
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
    await expectInternet(page, true);
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(storedInternetKeys()).toEqual([]);
    await recorder.save(testInfo, 'd-signin-requests');
  });

  // ---- e · zero external requests, before and after Turn on internet ----
  test('e. startup, idle, the menu and local work make zero external requests, before Turn on internet (a request is refused) and after it (a request is allowed, none is made); off in the menu refuses again', TAG, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
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

    await localSession('before', true);
    expect(recorder.external(), 'before Turn on internet').toEqual([]);
    expect(fake.calls, 'a saved token sent nothing to Door43').toEqual([]);
    await expectInternet(page, false);
    expect(await requestOutcomes(page), 'off: refused before it is sent').toEqual(REFUSED);
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'e-before-turn-on');

    // Turn on internet, at a Share that goes as far as the sign-in step (nothing is held, so
    // nothing is sent); the gate turns on. Closing the step changes nothing: the internet stays on.
    expect(await gateOn()).toBe(false);
    await page.getByTestId(`share-${SEEDED_ID}`).click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await page.getByTestId('signin-cancel').click();
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    expect(await gateOn(), 'the gate stays on for the session').toBe(true);
    await expectInternet(page, true);

    const callsAtTaskEnd = fake.calls.length;
    recorder.reset();
    await localSession('after', false);
    expect(fake.calls.length, 'no Door43 call after the step closed').toBe(callsAtTaskEnd);
    expect(recorder.external(), 'after Turn on internet, with the gate on: local work still sends nothing').toEqual([]);
    await recorder.save(testInfo, 'e-after-turn-on');
    // On: a request made outside any step is allowed (the probe itself is the only external request).
    expect(await requestOutcomes(page), 'on: allowed').toEqual(['sent', 'sent']);
    recorder.reset();
    // Off in the menu: refused again, at once.
    await turnOffInMenu(page);
    expect(await requestOutcomes(page), 'off again: refused').toEqual(REFUSED);
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'e-after-turn-off');
  });

  // ---- f · a gate that cannot be established ----
  test('f. a gate that does not turn on stops the step: net-failed, nothing runs, no external request; the internet stays on, and the next press reads the gate again', TAG, async ({ page, context }, testInfo) => {
    const fake = await fakeFor(context);
    // The server answers the enable but the gate stays off.
    let enables = 0;
    await page.route('**/api/net/enable', (route) => {
      enables += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_good":true}' });
    });
    await page.route('**/api/net/status', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_enabled":false}' }) : route.fallback());
    const recorder = recordExternal(page);
    await page.goto('/');
    await page.getByTestId(`share-${SEEDED_ID}`).click();
    await expect(askDialog(page)).toHaveAttribute('data-kind', 'share');
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('net-failed')).toBeVisible();
    await expect(page.getByTestId('net-failed')).toContainText('did not start and nothing was sent');
    await shot(page, testInfo, 'net-failed');
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    await expect(page.getByTestId('share-dialog')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    expect(await gateOn(), 'the real gate was never turned on').toBe(false);
    expect(enables).toBe(1);
    await page.getByTestId('net-failed-close').click();
    await expect(page.getByTestId('net-failed')).toHaveCount(0);
    // The internet is on (the user turned it on): the next press asks nothing, reads the gate
    // again, and stops the same way.
    await expectInternet(page, true);
    await page.getByTestId(`share-${SEEDED_ID}`).click();
    await expect(askDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('net-failed')).toBeVisible();
    expect(enables).toBe(2);
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
    expect(fake.calls).toEqual([]);
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'f-requests');
  });

  test('f. a gate that cannot be read stops the step the same way', TAG, async ({ page, context }) => {
    const fake = await fakeFor(context);
    await page.route('**/api/net/status', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, body: 'no status' }) : route.fallback());
    const recorder = recordExternal(page);
    await page.goto('/');
    await turnOnInternet(page);
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
    await walk(['account-sign-in', 'account-internet', 'account-about']);
    // The switch itself works from the keyboard: Enter on the row turns the internet on, the
    // menu stays open, and Enter again turns it off.
    await trigger(page).focus();
    await page.keyboard.press('Enter');
    await expect.poll(focused).toBe('account-sign-in');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('account-internet');
    await page.keyboard.press('Enter');
    await expect(switchRow(page)).toHaveAttribute('aria-checked', 'true');
    await expect(panel(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute('data-internet', 'on');
    await page.keyboard.press('Enter');
    await expect(switchRow(page)).toHaveAttribute('aria-checked', 'false');
    await expect(trigger(page)).toHaveAttribute('data-internet', 'off');
    await page.keyboard.press('Escape');
    await fakeKeychain(context, 'kept-token');
    await page.reload();
    await expect(trigger(page)).toHaveAttribute('data-state', 'saved');
    await walk(['account-check', 'account-internet', 'account-about', 'account-sign-out']);
    // An outside click closes it as well.
    await openMenu(page);
    await page.mouse.click(5, 400);
    await expect(panel(page)).toHaveCount(0);
  });

  // ---- i · About translationCore (#520) ----
  // The build reads the version, the commit, the LICENSE notice and the GPL text. The expected
  // values come from the repository itself: package.json, git, LICENSE and COPYING.
  test('i. About translationCore and License: the keyboard opens, reads and closes them; the version, the commit, the copyright line and both license texts show, with no network and no external request', TAG, async ({ page, context }, testInfo) => {
    const version = (JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: TC4_ROOT, encoding: 'utf8' }).trim();
    const notice = fs.readFileSync(path.join(TC4_ROOT, 'LICENSE'), 'utf8');
    const gpl = fs.readFileSync(path.join(TC4_ROOT, 'COPYING'), 'utf8');
    expect(gpl).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(gpl).toContain('Version 2, June 1991');
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
    const aboutDialog = page.getByRole('dialog', { name: 'About translationCore' });
    const licenseDialog = page.getByRole('dialog', { name: 'License', exact: true });
    const region = page.getByRole('region', { name: 'License text' });
    const recorder = recordExternal(page);
    const notWhite = async (heading: ReturnType<Page['getByText']>) => {
      await expect(heading).toBeVisible();
      // The dialogs render inside the dark top bar; a title must not take the bar's white text.
      expect(await heading.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(255, 255, 255)');
    };
    /** The whole path by keyboard: menu, About, License, back to About, back to the trigger. */
    const walk = async (name: string) => {
      await trigger(page).focus();
      await page.keyboard.press('Enter');
      await expect(panel(page)).toBeVisible();
      await page.getByTestId('account-about').focus();
      await page.keyboard.press('Enter');
      await expect(panel(page)).toHaveCount(0);
      await notWhite(aboutDialog.getByText('About translationCore'));
      await expect(page.getByTestId('about-version')).toHaveText(`${version} (${commit})`);
      await expect(page.getByTestId('about-copyright')).toHaveText(notice.split('\n')[0]);
      await expect(page.getByTestId('about-license-name')).toContainText('GNU GPL v2 or later');
      await shot(page, testInfo, `about-${name}`);

      // Read the license closes About and opens License.
      await page.getByTestId('about-read-license').focus();
      await page.keyboard.press('Enter');
      await expect(aboutDialog).toHaveCount(0);
      await notWhite(licenseDialog.getByText('License', { exact: true }).first());
      await expect(page.getByTestId('license-notice')).toHaveText(notice);
      await expect(page.getByTestId('license-gpl')).toHaveText(gpl);
      // The keyboard reaches the text and scrolls it.
      await expect(region).toHaveAttribute('tabindex', '0');
      for (let i = 0; i < 4 && (await focused()) !== 'license-text'; i += 1) await page.keyboard.press('Tab');
      expect(await focused()).toBe('license-text');
      expect(await region.evaluate((el) => el.scrollTop)).toBe(0);
      await page.keyboard.press('End');
      await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await shot(page, testInfo, `license-${name}`);

      // Escape on License returns to About, with the focus on Read the license.
      await page.keyboard.press('Escape');
      await expect(licenseDialog).toHaveCount(0);
      await expect(aboutDialog).toBeVisible();
      await expect.poll(focused).toBe('about-read-license');
      // Escape on About returns the focus to the account menu trigger.
      await page.keyboard.press('Escape');
      await expect(aboutDialog).toHaveCount(0);
      await expect.poll(focused).toBe('account-menu');
    };
    await page.goto('/');
    await walk('home');
    await openTitus(page);
    await walk('project');
    // The Close buttons do the same as Escape.
    await openMenu(page);
    await page.getByTestId('account-about').click();
    await page.getByTestId('about-read-license').click();
    await page.getByTestId('license-close').click();
    await expect(licenseDialog).toHaveCount(0);
    await expect.poll(focused).toBe('about-read-license');
    await page.getByTestId('about-close').click();
    await expect(aboutDialog).toHaveCount(0);
    await expect.poll(focused).toBe('account-menu');
    // With no network connection: nothing can load, so what shows is in the bundle.
    await context.setOffline(true);
    try {
      await walk('offline');
    } finally {
      await context.setOffline(false);
    }
    expect(recorder.external()).toEqual([]);
    await recorder.save(testInfo, 'i-about-requests');
  });
});
