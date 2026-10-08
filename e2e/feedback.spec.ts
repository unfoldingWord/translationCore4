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
// Each run writes the payloads that reached the fake bridge and the request log into the
// test's output folder (and attaches them).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { SEEDED_PROJECT, resetClientSettings, resetSeededChecking, rigRepo } from './helpers/rig';
import { recordExternal } from './helpers/externalRequests';
import { verifyAllJournaledProjects } from './helpers/journal';

const TAG = { tag: ['@feedback', '@inc9'] };
const OUTSIDE_FILE = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'custom', 'notes.json');
const CODE = 'open.unexplained-divergence';
const ASK_REASON = 'This step needs the internet to send your report to the unfoldingWord help desk';

interface Answer { ok: boolean; status?: number; reason?: string }

/** The desktop help-desk bridge, faked: each call is recorded, and answered from
 * `answers` in order after `delayMs`. Install before the page loads. */
async function fakeFeedbackBridge(context: BrowserContext, answers: Answer[], delayMs = 400) {
  const calls: Array<Record<string, string>> = [];
  await context.exposeFunction('__tc4Feedback', async (payload: Record<string, string>) => {
    calls.push(payload);
    await new Promise((r) => setTimeout(r, delayMs));
    return answers[calls.length - 1] ?? { ok: false, reason: 'refused' };
  });
  await context.addInitScript(() => {
    const w = window as unknown as { __tc4Feedback: (p: unknown) => Promise<unknown>; tc4Desktop: unknown };
    w.tc4Desktop = { feedback: { send: (payload: unknown) => w.__tc4Feedback(payload) } };
  });
  return calls;
}

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
    expect(requests.external()).toEqual([]);
    await requests.save(testInfo, 'feedback-requests-no-bridge');
  });
});

test.afterAll(async () => {
  fs.rmSync(OUTSIDE_FILE, { force: true });
  await verifyAllJournaledProjects();
});
