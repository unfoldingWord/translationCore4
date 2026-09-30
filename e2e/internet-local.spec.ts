// D86 (#486, slice A): the Internet / Local status beside "Saved". A new
// installation starts as Local; the user changes it through a dialog; the
// choice is stored in the per-client settings and set again at every start;
// in Local the app talks to no host but the local server.
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { SEEDED_PROJECT, readClientSettingsDoc, resetPlaces } from './helpers/rig';
import { RIG_API, useInternet } from './helpers/door43Share';

const gateOn = async (): Promise<boolean> =>
  ((await (await fetch(`${RIG_API}/net/status`)).json()) as { is_enabled: boolean }).is_enabled;
const storedChoice = (): unknown => readClientSettingsDoc()?.internet;
const status = (page: Page) => page.getByTestId('net-status');

test.describe('D86 — Internet / Local', () => {
  test.beforeEach(async () => {
    // A Home tile reopens the place an earlier spec left (#329); these cases open Titus 1.
    resetPlaces();
    await useInternet(false);
  });
  test.afterAll(async () => {
    await useInternet(false);
  });

  test('no stored choice is Local, even when the gate was left on', { tag: ['@inc85'] }, async ({ page }) => {
    // pankosmia-web 0.18.10 can start with the gate on; the app turns it off.
    await fetch(`${RIG_API}/net/enable`, { method: 'POST' });
    expect(storedChoice()).toBeUndefined();
    await page.goto('/');
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    await expect(status(page)).toHaveText('Local');
    await expect.poll(gateOn).toBe(false);
  });

  test('the status shows on Home and in a project, beside Saved', { tag: ['@inc85'] }, async ({ page }) => {
    await page.goto('/');
    await expect(status(page)).toBeVisible();
    await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
    await expect(page.getByTestId('save-indicator')).toBeVisible({ timeout: 20_000 });
    await expect(status(page)).toBeVisible();
    // Beside Saved: the status comes directly before the save indicator.
    const order = await page.evaluate(() => {
      const net = document.querySelector('[data-testid="net-status"]')!.parentElement!;
      return net.nextElementSibling?.getAttribute('data-testid') ?? null;
    });
    expect(order).toBe('save-indicator');
  });

  test('Local to Internet asks first; Cancel changes nothing; Allow is stored and survives a restart', { tag: ['@inc85'] }, async ({ page }) => {
    await page.goto('/');
    await status(page).click();
    await expect(page.getByTestId('net-allow')).toContainText('Allow tC4 to use the internet for Share and downloads?');
    // The dialog sits outside the dark top bar: its title and Cancel are dark
    // text on the white card (a copy inside the bar drew them white on white).
    for (const target of [page.getByRole('dialog', { name: 'Allow internet' }).getByText('Allow internet'), page.getByTestId('net-cancel')]) {
      const luminance = await target.evaluate((el) => {
        const [r, g, b] = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      });
      expect(luminance).toBeLessThan(0.6);
    }
    await page.getByTestId('net-cancel').click();
    await expect(page.getByTestId('net-allow')).toHaveCount(0);
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    expect(await gateOn()).toBe(false);
    expect(storedChoice()).toBeUndefined();

    await status(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(status(page)).toHaveAttribute('data-state', 'internet');
    await expect(status(page)).toHaveText('Internet');
    expect(await gateOn()).toBe(true);
    await expect.poll(storedChoice).toBe(true);

    // A restart of the client: the gate is turned off behind its back, and the
    // stored choice turns it on again at start.
    await fetch(`${RIG_API}/net/disable`, { method: 'POST' });
    await page.reload();
    await expect(status(page)).toHaveAttribute('data-state', 'internet');
    await expect.poll(gateOn).toBe(true);
  });

  test('Internet to Local uses the dialog, removes the stored flag, and survives a restart', { tag: ['@inc85'] }, async ({ page }) => {
    await useInternet(true);
    await page.goto('/');
    await expect(status(page)).toHaveAttribute('data-state', 'internet');
    await status(page).click();
    await expect(page.getByTestId('net-to-local')).toContainText('sends nothing and downloads nothing');
    await page.getByTestId('net-confirm').click();
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    expect(await gateOn()).toBe(false);
    await expect.poll(storedChoice).toBeUndefined();
    await page.reload();
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    expect(await gateOn()).toBe(false);
  });

  test('a gate that does not change: the status stays Local and says so; nothing is stored', { tag: ['@inc85'] }, async ({ page }) => {
    await page.goto('/');
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    // The server answers the enable but the gate stays off.
    await page.route('**/api/net/enable', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_good":true}' }));
    await status(page).click();
    await page.getByTestId('net-confirm').click();
    await expect(page.getByTestId('net-error')).toContainText('Could not allow the internet.');
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    expect(storedChoice()).toBeUndefined();
  });

  test('the barrier: a Local choice whose gate stays on is Local, says so, and asks before Share (D86 point 3)', { tag: ['@inc85'] }, async ({ page }) => {
    await fetch(`${RIG_API}/net/enable`, { method: 'POST' });
    // The disable is answered but does nothing: the gate stays on.
    await page.route('**/api/net/disable', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_good":true}' }));
    await page.goto('/');
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    await expect(page.getByTestId('net-error')).toContainText('Could not turn the internet off.');
    expect(await gateOn()).toBe(true);
    await page.getByTestId(`share-_local_/_local_/${SEEDED_PROJECT}`).click();
    await expect(page.getByTestId('net-allow')).toContainText('tC4 is set to Local.');
    await page.getByTestId('net-cancel').click();
    await expect(page.getByTestId('share-signin')).toHaveCount(0);
  });

  test('in Local, a session with a restart talks to no host but the local server', { tag: ['@inc85'] }, async ({ page }) => {
    const hosts = new Map<string, Set<string>>();
    const seen = (url: string) => {
      const u = new URL(url);
      if (!hosts.has(u.host)) hosts.set(u.host, new Set());
      hosts.get(u.host)!.add(u.pathname);
    };
    page.on('request', (req) => seen(req.url()));
    page.on('websocket', (ws) => seen(ws.url()));
    await page.goto('/');
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
    await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(status(page)).toHaveAttribute('data-state', 'local');
    await page.waitForTimeout(1000);
    const external = [...hosts.keys()].filter((h) => h !== 'localhost:5199').sort();
    expect(external, `hosts contacted other than the local server: ${external.join(', ')}`).toEqual([]);
    expect([...(hosts.get('localhost:5199') ?? [])].some((p) => p.startsWith('/api/'))).toBe(true);
  });
});
