// #519: Help and guides in the account menu (D88, #514; D95, #559). The help pages are
// `tc-help/` of the pinned tc-website commit (scripts/fetch-help.mjs), served by the
// client itself at `<base>help/`. They open in a full-window panel, in a same-origin frame.
//
// What the journeys prove, against the real client and the rig:
//   a  the row is directly below the internet switch, on Home and inside a project; the
//      arrow keys reach it and Enter opens the panel
//   b  with every request to another host refused (no network connection), the help home,
//      a second page, its images and the search results show, with zero external requests
//   c  while the internet is off, the GitHub Releases link opens "Turn on the internet?"
//      (kind helpLink); Not now makes zero external requests and opens nothing, and the
//      frame stays on its page
//   d  while the internet is on, the same link opens a new window (the system browser in
//      the desktop app), not the frame
//   e  the close button, Escape in the panel and Escape in the frame close it; the focus
//      returns to the account menu button
// The shared recorder (helpers/externalRequests.ts) writes each request log, and the
// screenshots, into the test's output folder (and attaches them).
import { test, expect } from './helpers/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { SEEDED_PROJECT, resetClientSettings, resetPlaces, resetSeededChecking } from './helpers/rig';
import { gateOff, turnOnInternet } from './helpers/door43Share';
import { CLIENT_HOST, recordExternal } from './helpers/externalRequests';

const TAG = { tag: ['@help'] };
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;
const RELEASES = 'https://github.com/unfoldingWord/translationCore4/releases';

const trigger = (page: Page) => page.getByTestId('account-menu');
const menu = (page: Page) => page.getByTestId('account-menu-panel');
const helpPanel = (page: Page) => page.getByTestId('help-panel');
const frame = (page: Page) => page.frameLocator('[data-testid="help-frame"]');

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
/** No network connection: every request to a host other than the dev client fails. */
async function noNetwork(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => (new URL(route.request().url()).host === CLIENT_HOST ? route.fallback() : route.abort('internetdisconnected')));
}
async function openHelp(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await page.getByTestId('account-help').click();
  await expect(helpPanel(page)).toBeVisible();
  // The panel slides in; a click before it stops lands where the frame was.
  await expect(helpPanel(page)).toHaveCSS('transform', 'none');
  await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText('translationCore 4 Help');
}
/** The help page `file` shows in the frame (a link click navigated it). */
async function expectPage(page: Page, file: string, h1: string): Promise<void> {
  await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText(h1);
  expect(page.frames().some((f) => f.url().endsWith(`/help/${file}`))).toBe(true);
}
/** The install page, by the frame's own link to it. */
async function openInstallPage(page: Page): Promise<void> {
  await frame(page).locator('a[href="gs-install.html"]:visible').first().click();
  await expectPage(page, 'gs-install.html', 'Install and start tC4');
}
async function expectClosed(page: Page): Promise<void> {
  await expect(helpPanel(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
}

test.describe('#519 Help and guides', () => {
  test.beforeEach(async () => {
    resetPlaces();
    resetClientSettings();
    await gateOff();
  });
  test.afterAll(async () => {
    resetSeededChecking();
    resetPlaces();
    resetClientSettings();
  });

  test('a. Help and guides is directly below the internet switch on Home and in a project; the arrow keys reach it', TAG, async ({ page }, testInfo) => {
    await page.goto('/');
    for (const where of ['home', 'project']) {
      if (where === 'project') {
        await page.getByTestId(`project-${SEEDED_ID}`).getByRole('button', { name: /Titus/ }).click();
        await expect(page.getByRole('tab', { name: 'Check', exact: true })).toBeVisible({ timeout: 60_000 });
      }
      await trigger(page).click();
      await expect(menu(page)).toBeVisible();
      const ids = await menu(page).locator('[role^="menuitem"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')));
      const at = ids.indexOf('account-internet');
      expect(ids.slice(at, at + 3)).toEqual(['account-internet', 'account-help', 'account-language']);
      await expect(page.getByTestId('account-help')).toHaveText('Help and guides');
      await shot(page, testInfo, `menu-${where}`);
      // The keyboard: from the internet switch, ArrowDown reaches Help and guides; Enter opens it.
      await page.getByTestId('account-internet').focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('account-help')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(helpPanel(page)).toBeVisible();
      await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText('translationCore 4 Help');
      await page.keyboard.press('Escape');
      await expectClosed(page);
    }
  });

  test('b. with no network connection the help pages, their images and the search results show, with zero external requests', TAG, async ({ page, context }, testInfo) => {
    await noNetwork(context);
    const rec = recordExternal(page);
    await page.goto('/');
    await openHelp(page);
    await shot(page, testInfo, 'help-home');
    // Search: the results come from the pages' own index.
    await frame(page).locator('#q').fill('offline');
    const results = frame(page).locator('#search-results a');
    await expect(results.first()).toBeVisible();
    expect(await results.count()).toBeGreaterThan(0);
    await shot(page, testInfo, 'help-search');
    // A second page by a link in the frame, with its images.
    await frame(page).locator('a[href="section-align.html"]:visible').first().click();
    await expect(frame(page).locator('a[href="al-link-words.html"]:visible').first()).toBeVisible();
    await frame(page).locator('a[href="al-link-words.html"]:visible').first().click();
    await expect.poll(() => page.frames().some((f) => f.url().endsWith('/help/al-link-words.html'))).toBe(true);
    // The logo, and the page's first screenshot (the pages load their images lazily).
    for (const img of [frame(page).locator('img.brand-logo'), frame(page).locator('img[src^="img/"]').first()]) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    }
    await shot(page, testInfo, 'help-page');
    await rec.save(testInfo);
    expect(rec.external()).toEqual([]);
    expect(rec.all().some((r) => r.path.endsWith('/help/al-link-words.html'))).toBe(true);
  });

  test('c. while the internet is off, the Releases link asks first; Not now opens nothing and sends nothing', TAG, async ({ page, context }, testInfo) => {
    await noNetwork(context);
    const rec = recordExternal(page);
    let popups = 0;
    page.on('popup', () => { popups += 1; });
    await page.goto('/');
    await openHelp(page);
    await openInstallPage(page);
    await frame(page).locator(`a[href="${RELEASES}"]`).click();
    const ask = page.getByTestId('net-ask');
    await expect(ask).toHaveAttribute('data-kind', 'helpLink');
    await expect(page.getByTestId('net-ask-reason')).toHaveText('This step needs the internet to open this link in your browser.');
    await shot(page, testInfo, 'help-link-ask');
    // Escape belongs to the question, not to the panel under it.
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(helpPanel(page)).toBeVisible();
    await frame(page).locator(`a[href="${RELEASES}"]`).click();
    await page.getByTestId('net-cancel').click();
    await expect(ask).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(popups).toBe(0);
    await expectPage(page, 'gs-install.html', 'Install and start tC4');
    await expect(trigger(page)).toHaveAttribute('data-internet', 'off');
    await rec.save(testInfo);
    expect(rec.external()).toEqual([]);
  });

  test('d. while the internet is on, the Releases link opens a new window, not the frame', TAG, async ({ page, context }) => {
    // The new window would load github.com; the test answers it with a stub, so the run stays offline.
    await noNetwork(context);
    await context.route(RELEASES, (route) => route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }));
    await page.goto('/');
    await turnOnInternet(page);
    await page.keyboard.press('Escape');
    await openHelp(page);
    await openInstallPage(page);
    const opened = page.waitForEvent('popup');
    await frame(page).locator(`a[href="${RELEASES}"]`).click();
    const popup = await opened;
    expect(popup.url()).toBe(RELEASES);
    await popup.close();
    await expect(page.getByTestId('net-ask')).toHaveCount(0);
    await expectPage(page, 'gs-install.html', 'Install and start tC4');
  });

  test('e. the close button, Escape in the panel and Escape in the frame close it; the focus returns to the account menu button', TAG, async ({ page }) => {
    await page.goto('/');
    await openHelp(page);
    await page.getByTestId('help-close').click();
    await expectClosed(page);
    await openHelp(page);
    await page.getByTestId('help-close').focus();
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await openHelp(page);
    await frame(page).locator('#q').click();
    await page.keyboard.press('Escape');
    await expectClosed(page);
  });
});
