// #378: "Ask for help" on a refused open, and the Feedback dialog that sends the
// report to the help desk through the desktop bridge (`tc4Desktop.feedback.send`,
// faked here; the real send runs in the main process, scripts/desktop-feedback.cjs).
//
// What the journeys prove, against the real client and the rig:
//   a  the #156 scenario (a file that the app does not derive, written into the project)
//      refuses the open, and the Home banner has "Ask for help" for its refusal code
//   b  the dialog opens as a Bug Report with the code and the banner's diagnosis, the
//      email hint, and the attachment: the version line, then the open's own Report
//   c  opening the dialog and typing in it make zero external requests
//   d  Send asks "Turn on the internet?" for the `feedback` task; Not now sends nothing and
//      keeps the dialog; Turn on internet sends once
//   e  while a send runs, Send, Cancel and the fields are disabled; a refused send (timeout)
//      keeps the message; a double click sends one report; an accepted send clears it
//   f  the bridge receives exactly the attachment text the dialog showed
//   g  with no desktop bridge, Send says that sending works only in the desktop app, asks
//      nothing, and keeps the message
//   h  Report a problem in the account menu (#521) starts a new report over that kept one
//   i  #634: in every installed language, the Message, Name and Email boxes have the name
//      of their labels; a click on the Message label puts the cursor in its box. Case b
//      checks the Message label on the banner's path
// Each run writes the payloads that reached the fake bridge and the request log into the
// test's output folder (and attaches them).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { RIG_CLIENT_SETTINGS, SEEDED_PROJECT, readClientSettingsDoc, resetClientSettings, resetSeededChecking, rigRepo } from './helpers/rig';
import { recordExternal } from './helpers/externalRequests';
import { fakeFeedbackBridge } from './helpers/feedbackBridge';
import { verifyAllJournaledProjects } from './helpers/journal';
import { TC4_ROOT } from './helpers/root';
import { LOCALES } from '../src/i18n/locales.js';

const TAG = { tag: ['@feedback', '@inc9'] };
const OUTSIDE_FILE = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'custom', 'notes.json');
const CODE = 'open.unexplained-divergence';
const ASK_REASON = 'This step needs the internet to send your report to the unfoldingWord help desk';

/** The #156 scenario: an outside file makes the open of Titus refuse. */
async function refuseOpen(page: Page) {
  fs.mkdirSync(path.dirname(OUTSIDE_FILE), { recursive: true });
  fs.writeFileSync(OUTSIDE_FILE, '{"note":"written outside the app (#378 journey)"}\n');
  await page.goto('/');
  const card = page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: /Titus/ }).click();
  const banner = page.getByTestId('home-open-error');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  return banner;
}

const save = async (testInfo: TestInfo, name: string, value: unknown) => {
  const file = testInfo.outputPath(name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
};

test.describe('Ask for help: the Feedback dialog (#378)', () => {
  test.beforeEach(() => {
    resetSeededChecking();
    resetClientSettings();
  });
  test.afterEach(() => {
    fs.rmSync(OUTSIDE_FILE, { force: true });
    resetClientSettings();
  });

  test('a refused open asks for help; the report goes to the bridge once, as shown (#378)', TAG, async ({ page, context }, testInfo) => {
    const calls = await fakeFeedbackBridge(context, [{ ok: false, reason: 'timeout' }, { ok: true, status: 202 }]);
    const requests = recordExternal(page);

    // a: the refusal and its control.
    const banner = await refuseOpen(page);
    const ask = banner.getByTestId('ask-for-help');
    await expect(ask).toHaveAttribute('data-code', CODE);
    const diagnosis = (await banner.textContent()) ?? '';

    // b: the filled-in dialog.
    await ask.click();
    const dialog = page.getByTestId('feedback');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Category' })).toContainText('Bug Report');
    const message = dialog.getByTestId('feedback-message');
    await expect(message).toHaveValue(new RegExp(`^Refusal code: ${CODE.replace('.', '\\.')}\\n\\n`));
    // #634: opened from the banner, the Message box has the name of its label too.
    await expect(dialog.getByLabel('Message', { exact: true })).toHaveAttribute('data-testid', 'feedback-message');
    expect(diagnosis).toContain((await message.inputValue()).split('\n\n')[1].slice(0, 60));
    await expect(dialog).toContainText('Without an email, the help desk cannot answer you.');
    const attachment = (await dialog.getByTestId('feedback-attachment').textContent()) ?? '';
    const [versionLine, label, ...json] = attachment.split('\n');
    expect(versionLine).toMatch(/^translationCore \S+ \(\S+\) · \S/);
    expect(label).toMatch(/^Report: open, \d{4}-\d\d-\d\dT/);
    const report = JSON.parse(json.join('\n'));
    expect(report).toMatchObject({ op: 'open', ok: false, code: CODE });

    // c: typing makes no request.
    await dialog.getByLabel('Name (optional)').fill('Journey Tester');
    await dialog.getByLabel('Email (optional)').fill('journey@example.invalid');
    const shot = testInfo.outputPath('feedback-dialog.png');
    await page.screenshot({ path: shot, animations: 'disabled' });
    await testInfo.attach('feedback-dialog.png', { path: shot, contentType: 'image/png' });
    expect(requests.external()).toEqual([]);

    // d: Not now sends nothing and keeps the report.
    const send = dialog.getByTestId('feedback-send');
    await send.click();
    const askNet = page.getByTestId('net-ask');
    await expect(askNet).toHaveAttribute('data-kind', 'feedback');
    await expect(askNet.getByTestId('net-ask-reason')).toContainText(ASK_REASON);
    await page.getByTestId('net-cancel').click();
    await expect(askNet).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(message).toHaveValue(/^Refusal code: /);
    expect(calls).toHaveLength(0);

    // d, e: Turn on internet sends; while it runs, nothing can be changed; a timeout keeps the message.
    await send.click();
    await page.getByTestId('net-confirm').click();
    await expect(send).toBeDisabled();
    await expect(dialog.getByTestId('feedback-cancel')).toBeDisabled();
    await expect(message).toBeDisabled();
    await expect(dialog.getByTestId('feedback-result')).toHaveAttribute('data-result', 'timeout');
    await expect(message).toHaveValue(/^Refusal code: /);
    expect(calls).toHaveLength(1);

    // e: a double click sends one report, with no second question; it is accepted and cleared.
    await send.dblclick();
    await expect(dialog.getByTestId('feedback-result')).toHaveAttribute('data-result', 'sent');
    await expect(askNet).toHaveCount(0);
    expect(calls).toHaveLength(2);

    // f: the bridge got the report exactly as the dialog showed it.
    for (const payload of calls) {
      expect(payload).toEqual({
        category: 'Bug Report',
        message: payload.message,
        name: 'Journey Tester',
        email: 'journey@example.invalid',
        version: versionLine.split(' · ')[0],
        attachment,
      });
      expect(payload.message).toMatch(new RegExp(`^Refusal code: ${CODE.replace('.', '\\.')}`));
    }
    expect(requests.external()).toEqual([]);
    await save(testInfo, 'feedback-payloads.json', calls);
    await requests.save(testInfo, 'feedback-requests');
    await dialog.getByTestId('feedback-close').click();
    await expect(dialog).toHaveCount(0);
  });

  test('without the desktop bridge, Send says so, asks nothing and keeps the message (#378)', TAG, async ({ page }, testInfo) => {
    const requests = recordExternal(page);
    const banner = await refuseOpen(page);
    await banner.getByTestId('ask-for-help').click();
    const dialog = page.getByTestId('feedback');
    const message = dialog.getByTestId('feedback-message');
    await message.fill('The open of Titus was refused. Kept text.');
    await dialog.getByTestId('feedback-send').click();
    await expect(dialog.getByTestId('feedback-result')).toHaveAttribute('data-result', 'no-desktop');
    await expect(dialog.getByTestId('feedback-result')).toContainText('Sending works only in the desktop app.');
    await expect(page.getByTestId('net-ask')).toHaveCount(0);
    await expect(message).toHaveValue('The open of Titus was refused. Kept text.');
    // Cancel keeps the report in memory; the dialog closes.
    await dialog.getByTestId('feedback-cancel').click();
    await expect(dialog).toHaveCount(0);
    // #521: Report a problem in the account menu starts a new report; it does not open the
    // kept Bug Report of the refusal.
    await page.getByTestId('account-menu').click();
    await page.getByTestId('account-report').click();
    await expect(dialog.getByRole('combobox', { name: 'Category' })).toContainText('General Feedback');
    await expect(message).toHaveValue('');
    await expect(dialog.getByTestId('feedback-result')).toHaveCount(0);
    await dialog.getByTestId('feedback-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(requests.external()).toEqual([]);
    await requests.save(testInfo, 'feedback-requests-no-bridge');
  });

  // i · #634: a label is the name of its box. The labels come from the shipped catalogs.
  test('in every installed language, each box of Report a problem has the name of its label; a click on Message puts the cursor in its box (#634)', TAG, async ({ page }, testInfo) => {
    const dialog = page.getByTestId('feedback');
    const FIELDS = ['feedback.message', 'feedback.name', 'feedback.email'];
    const wiring: Record<string, Record<string, { label: string; labelFor: string | null; boxId: string | null; aria: string }>> = {};
    for (const { id } of LOCALES) {
      const catalog: Record<string, string> = JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'src', 'i18n', `${id}.json`), 'utf8'));
      // The language as the Apply of a previous session left it (#522).
      fs.writeFileSync(RIG_CLIENT_SETTINGS, JSON.stringify({ ...(readClientSettingsDoc() ?? {}), appLocale: id }));
      await page.goto('/');
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(id);
      await page.getByTestId('account-menu').click();
      await page.getByTestId('account-report').click();
      await expect(dialog).toBeVisible();
      // The control: a label that the dialog does not have finds no box.
      await expect(dialog.getByLabel('No such label (#634)', { exact: true })).toHaveCount(0);
      wiring[id] = {};
      for (const key of FIELDS) {
        const box = dialog.getByLabel(catalog[key], { exact: true });
        await expect(box, `${id}: ${key}`).toHaveCount(1);
        await expect(box, `${id}: ${key}`).toHaveRole('textbox');
        await expect(box, `${id}: ${key}`).toHaveAccessibleName(catalog[key]);
        const label = dialog.locator('label').filter({ hasText: catalog[key] });
        wiring[id][key] = { label: catalog[key], labelFor: await label.getAttribute('for'), boxId: await box.getAttribute('id'), aria: await box.ariaSnapshot() };
      }
      // The Message label names the Message box, and a click on it moves the cursor there.
      const message = dialog.getByLabel(catalog['feedback.message'], { exact: true });
      await expect(message).toHaveAttribute('data-testid', 'feedback-message');
      await dialog.getByLabel(catalog['feedback.name'], { exact: true }).focus();
      await expect(message).not.toBeFocused();
      await dialog.locator('label').filter({ hasText: catalog['feedback.message'] }).click();
      await expect(message, `${id}: focus after a click on the label`).toBeFocused();
      await page.keyboard.type(`Typed after a click on the label (${id}).`);
      await expect(message).toHaveValue(`Typed after a click on the label (${id}).`);
      await dialog.getByTestId('feedback-cancel').click();
      await expect(dialog).toHaveCount(0);
    }
    await save(testInfo, 'feedback-labels.json', wiring);
  });
});

test.afterAll(async () => {
  fs.rmSync(OUTSIDE_FILE, { force: true });
  await verifyAllJournaledProjects();
});
