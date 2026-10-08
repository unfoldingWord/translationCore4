// #522: App language in the account menu (D88, #514). Four catalogs ship with the app;
// a selection previews across the whole app; Apply saves on this computer through the
// per-client settings document; every dismissal restores the applied language.
//
// What the journeys prove, against the real client and the rig:
//   a  the menu row, the dialog, and the four-language preview before Apply: a known
//      catalog-backed label (the Home heading) and the dialog's own labels follow each
//      selection; Cancel restores English and nothing is stored
//   b  Apply saves `appLocale`, closes after the write, and a fresh session starts in
//      that language; the document's lang follows
//   c  from an applied Spanish: Cancel, Escape, the close button and the scrim each restore
//      Spanish and leave the document unchanged; a restart during an unapplied preview
//      starts in the saved Spanish; an invalid saved value starts in English
//   d  a failed write shows the error, keeps the preview and the dialog, saves nothing;
//      retry succeeds; a second failure then Cancel restores the applied language; while
//      the write is pending the select, Apply and every dismissal are disabled
//   e  a comprehension note and a verse typed before the switch survive it, the open book
//      and chapter stay, and every other record of the settings document is unchanged;
//      the internet stays off
//   f  startup, the menu, the preview, Cancel and Apply make zero external requests;
//      the keyboard opens the dialog, picks a language, applies, and the focus returns to
//      the account trigger
// The shared recorder (helpers/externalRequests.ts) writes each request log, and the
// screenshots, into the test's output folder (and attaches them).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import type { Page, TestInfo } from '@playwright/test';
import { RIG_CLIENT_SETTINGS, SEEDED_PROJECT, readClientSettingsDoc, resetClientSettings, resetPlaces, resetSeededChecking } from './helpers/rig';
import { dropOrigin, gateOff } from './helpers/door43Share';
import { recordExternal } from './helpers/externalRequests';
import { TC4_ROOT } from './helpers/root';

const TAG = { tag: ['@app-language'] };
const SEEDED_ID = `_local_/_local_/${SEEDED_PROJECT}`;

// The expected strings come from the shipped catalogs, never from memory.
const catalog = (id: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'src', 'i18n', `${id}.json`), 'utf8'));
const EN = catalog('en');
const ES = catalog('es-419');
const FR = catalog('fr');
const HI = catalog('hi');
const BY_ID: Record<string, Record<string, string>> = { en: EN, 'es-419': ES, fr: FR, hi: HI };
const LABEL: Record<string, string> = { en: 'English', 'es-419': 'Español (Latinoamérica)', fr: 'Français', hi: 'हिन्दी' };

const trigger = (page: Page) => page.getByTestId('account-menu');
const panel = (page: Page) => page.getByTestId('account-menu-panel');
const row = (page: Page) => page.getByTestId('account-language');
const dialog = (page: Page) => page.getByTestId('language-dialog');
const select = (page: Page) => page.getByTestId('language-select');
const apply = (page: Page) => page.getByTestId('language-apply');
const cancel = (page: Page) => page.getByTestId('language-cancel');
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const storedLocale = (): unknown => readClientSettingsDoc()?.appLocale;

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
async function openMenu(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
}
async function openDialog(page: Page): Promise<void> {
  await openMenu(page);
  await row(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
}
/** Choose a language in the dialog's select (a mouse choice). */
async function choose(page: Page, id: string): Promise<void> {
  await select(page).click();
  await page.getByRole('option', { name: LABEL[id], exact: true }).click();
  await expect(select(page)).toContainText(LABEL[id]);
}
/** The app shows `id`: the Home heading, the dialog's labels when it is open, and the document's lang. */
async function expectLanguage(page: Page, id: string): Promise<void> {
  const c = BY_ID[id];
  await expect(heading(page)).toHaveText(c['home.yourProjects']);
  if (await dialog(page).count()) {
    await expect(dialog(page)).toContainText(c['language.title']);
    await expect(dialog(page)).toContainText(c['language.hint']);
    await expect(apply(page)).toHaveText(c['language.apply']);
    await expect(cancel(page)).toHaveText(c['language.cancel']);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(id);
}
/** Save `locale` as the rig holds it, the way a previous session's Apply left it. */
function writeStoredLocale(locale: unknown): void {
  const doc = readClientSettingsDoc() ?? {};
  fs.writeFileSync(RIG_CLIENT_SETTINGS, JSON.stringify({ ...doc, appLocale: locale }));
}
const isSettingsWrite = (url: string, method: string): boolean => method === 'POST' && /\/api\/client-settings\//.test(url);

test.describe('#522 — App language in the account menu', () => {
  test.beforeEach(async () => {
    resetPlaces();
    resetClientSettings();
    dropOrigin(SEEDED_PROJECT);
    await gateOff();
  });
  test.afterAll(async () => {
    resetSeededChecking();
    resetPlaces();
    resetClientSettings();
  });

  // ---- a · the row, the dialog and the preview ----
  test('a. the menu row shows the applied language; each selection previews across the app and the dialog before Apply; Cancel restores English and stores nothing', TAG, async ({ page }, testInfo) => {
    const external = recordExternal(page);
    await page.goto('/');
    await expectLanguage(page, 'en');
    await openMenu(page);
    await expect(row(page)).toContainText(EN['account.language']);
    await expect(row(page)).toContainText('English');
    await shot(page, testInfo, 'menu-row-english');
    await row(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(select(page)).toContainText('English');
    // The picker offers exactly the four installed catalogs, native names, in order.
    await select(page).click();
    // The selected row carries the tick glyph before its label.
    await expect(page.getByRole('option')).toHaveText([/English$/, /^Español \(Latinoamérica\)$/, /^Français$/, /^हिन्दी$/]);
    await expect(page.getByRole('option', { selected: true })).toContainText('English');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    // Apply is disabled while the choice is the applied one.
    await expect(apply(page)).toBeDisabled();
    for (const id of ['es-419', 'fr', 'hi'] as const) {
      await choose(page, id);
      await expectLanguage(page, id);
      await expect(apply(page)).toBeEnabled();
      await shot(page, testInfo, `preview-${id}`);
      expect(storedLocale(), `${id}: a preview stores nothing`).toBeUndefined();
    }
    await choose(page, 'en');
    await expect(apply(page)).toBeDisabled();
    await choose(page, 'hi');
    await cancel(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'en');
    expect(storedLocale()).toBeUndefined();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('account-menu');
    expect(external.external()).toEqual([]);
    await external.save(testInfo);
  });

  // ---- b · Apply and restart ----
  test('b. Apply saves the choice and closes after the write; a fresh session starts in that language', TAG, async ({ page }, testInfo) => {
    const external = recordExternal(page);
    await page.goto('/');
    await openDialog(page);
    await choose(page, 'es-419');
    // The dialog closes only after the settings write has answered.
    const written = page.waitForResponse((r) => isSettingsWrite(r.url(), r.request().method()));
    await apply(page).click();
    await written;
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'es-419');
    expect(storedLocale()).toBe('es-419');
    await openMenu(page);
    await expect(row(page)).toContainText(ES['account.language']);
    await expect(row(page)).toContainText(LABEL['es-419']);
    await shot(page, testInfo, 'applied-es-419');
    await page.keyboard.press('Escape');
    // A fresh session.
    await page.reload();
    await expectLanguage(page, 'es-419');
    await openDialog(page);
    await expect(select(page)).toContainText(LABEL['es-419']);
    await expect(apply(page)).toBeDisabled();
    await shot(page, testInfo, 'restart-es-419');
    await cancel(page).click();
    expect(external.external()).toEqual([]);
    await external.save(testInfo);
  });

  // ---- c · each cancellation path, from an applied non-English language ----
  test('c. Cancel, Escape, the close button and the scrim each restore the applied Spanish and leave the document unchanged; an unapplied preview does not survive a restart; an invalid saved value starts in English', TAG, async ({ page }, testInfo) => {
    writeStoredLocale('es-419');
    await page.goto('/');
    await expectLanguage(page, 'es-419');
    const before = JSON.stringify(readClientSettingsDoc());
    // The close button's label follows the preview, like every other label of the dialog.
    const dismiss: Array<[string, string, (p: Page) => Promise<void>]> = [
      ['fr', 'cancel', async (p) => { await cancel(p).click(); }],
      ['hi', 'escape', async (p) => { await p.keyboard.press('Escape'); }],
      ['fr', 'close-button', async (p) => { await dialog(p).getByRole('button', { name: FR['common.close'], exact: true }).click(); }],
      ['hi', 'scrim', async (p) => { await p.mouse.click(5, 400); }],
    ];
    for (const [id, way, go] of dismiss) {
      await openDialog(page);
      await choose(page, id);
      await expectLanguage(page, id);
      await go(page);
      await expect(dialog(page)).toHaveCount(0);
      await expectLanguage(page, 'es-419');
      expect(JSON.stringify(readClientSettingsDoc()), `${way}: the document is unchanged`).toBe(before);
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')), `${way}: focus returns`).toBe('account-menu');
    }
    await shot(page, testInfo, 'rollback-es-419');
    // A restart during an unapplied preview: the saved Spanish, not the preview.
    await openDialog(page);
    await choose(page, 'hi');
    await expectLanguage(page, 'hi');
    await page.reload();
    await expectLanguage(page, 'es-419');
    expect(storedLocale()).toBe('es-419');
    // An unsupported or malformed saved value: English, and the document is left as it is.
    for (const bad of ['de', 'EN', 42, { id: 'fr' }]) {
      writeStoredLocale(bad);
      await page.reload();
      await expectLanguage(page, 'en');
      expect(storedLocale()).toEqual(bad);
    }
  });

  // ---- d · a failed Apply, the retry, and the pending state ----
  test('d. a failed write shows the error, keeps the preview and the dialog, saves nothing; retry succeeds; a second failure then Cancel restores; while the write is pending every control and dismissal is disabled', TAG, async ({ page }, testInfo) => {
    writeStoredLocale('es-419');
    await page.goto('/');
    await expectLanguage(page, 'es-419');
    let failWrites = true;
    let hold: (() => void) | null = null;
    await page.route('**/api/client-settings/**', async (route) => {
      if (!isSettingsWrite(route.request().url(), route.request().method())) return route.fallback();
      if (hold) await new Promise<void>((resolve) => { hold = resolve; });
      if (failWrites) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'disk full' });
      return route.fallback();
    });
    await openDialog(page);
    await choose(page, 'fr');
    await apply(page).click();
    await expect(page.getByTestId('language-error')).toHaveText(FR['language.saveFailed']);
    await expect(dialog(page)).toBeVisible();
    await expectLanguage(page, 'fr');
    await expect(select(page)).toContainText(LABEL.fr);
    expect(storedLocale()).toBe('es-419');
    await expect(apply(page)).toBeEnabled();
    await expect(cancel(page)).toBeEnabled();
    await shot(page, testInfo, 'apply-failed');
    // Retry succeeds.
    failWrites = false;
    await apply(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'fr');
    expect(storedLocale()).toBe('fr');
    // A second failure, then Cancel: the applied French comes back, nothing is saved.
    failWrites = true;
    await openDialog(page);
    await choose(page, 'hi');
    await apply(page).click();
    await expect(page.getByTestId('language-error')).toHaveText(HI['language.saveFailed']);
    await cancel(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'fr');
    expect(storedLocale()).toBe('fr');
    // The pending state: the write is held; the select, Apply, Cancel, Escape, the close
    // button and the scrim do nothing until it answers.
    failWrites = false;
    hold = () => {};
    await openDialog(page);
    await choose(page, 'es-419');
    await apply(page).click();
    await expect(dialog(page)).toHaveAttribute('data-saving', 'true');
    await expect(select(page)).toBeDisabled();
    await expect(apply(page)).toBeDisabled();
    await expect(cancel(page)).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
    await dialog(page).getByRole('button', { name: ES['common.close'], exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('data-saving', 'true');
    await expectLanguage(page, 'es-419');
    await shot(page, testInfo, 'apply-pending');
    const release = hold as unknown as () => void;
    hold = null;
    release();
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'es-419');
    expect(storedLocale()).toBe('es-419');
    await page.unroute('**/api/client-settings/**');
  });

  // ---- e · existing edits and independent preferences ----
  test('e. a verse typed before the switch survives it; the open book and chapter stay; every other settings record is unchanged; the internet stays off', TAG, async ({ page }, testInfo) => {
    const TEXT = 'Pablo, siervo de Dios y apóstol de Jesucristo.';
    await page.goto('/');
    const NOTE = 'Pablo se presenta como siervo y apóstol.';
    await expect(page.getByText('Equipo Ejemplo — Tito y Jonás').first()).toBeVisible();
    await page.getByTestId(`project-${SEEDED_ID}`).getByRole('button', { name: /Titus/ }).click();
    // The project opens in Understand: a comprehension note first (its blur saves it,
    // like the verse's), then drafting in the Translate view.
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('tab', { name: EN['understand.byVerse'], exact: true }).click();
    const note = page.getByPlaceholder(EN['understand.commentsPlaceholderVerse']).first();
    await note.fill(NOTE);
    await note.blur();
    await page.getByRole('tab', { name: EN['nav.draft'], exact: true }).click();
    await page.getByRole('tab', { name: 'Verse', exact: true }).click();
    await page.getByRole('button', { name: 'Start this verse' }).first().click();
    const editor = page.getByRole('textbox', { name: 'Verse 1' });
    await editor.fill(TEXT);
    // Opening the menu leaves the editor: the blur commits the text (J2), so the
    // switch can never lose it. The document is read once the write has settled.
    await openMenu(page);
    await expect(page.getByText(TEXT)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => readClientSettingsDoc()?.lastEdit).toBeTruthy();
    const { appLocale: _before, ...docBefore } = readClientSettingsDoc() ?? {};
    void _before;
    await expect(trigger(page)).toHaveAttribute('data-internet', 'off');
    await openDialog(page);
    await choose(page, 'es-419');
    await expect(page.getByRole('tab', { name: ES['understand.byVerse'], exact: true })).toBeVisible();
    await expect(page.getByText(TEXT)).toBeVisible();
    await apply(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText(TEXT)).toBeVisible();
    // The chapter rail marks every chapter but the open one as a choice (railChrome.jsx).
    await expect(page.getByRole('button', { name: '2', exact: true })).not.toHaveAttribute('data-i', 'choice');
    await expect(page.getByRole('button', { name: '1', exact: true })).toHaveAttribute('data-i', 'choice');
    await expect(page.getByRole('textbox', { name: ES['draft.verseLabel'].replace('{n}', '1') })).toHaveCount(0);
    await shot(page, testInfo, 'edit-survives-es-419');
    await expect.poll(storedLocale).toBe('es-419');
    const { appLocale: after, ...docAfter } = readClientSettingsDoc() ?? {};
    expect(after).toBe('es-419');
    expect(docAfter).toEqual(docBefore);
    await expect(trigger(page)).toHaveAttribute('data-internet', 'off');
    // The committed text opens again for editing, in Spanish, unchanged.
    await page.getByTitle(ES['draft.editVerse']).first().click();
    await expect(page.getByRole('textbox', { name: ES['draft.verseLabel'].replace('{n}', '1') })).toHaveValue(TEXT);
    // The comprehension note survives too, in Understand, now in Spanish.
    await page.getByRole('tab', { name: ES['nav.understand'], exact: true }).click();
    await expect(page.getByPlaceholder(ES['understand.commentsPlaceholderVerse']).first()).toHaveValue(NOTE);
  });

  // ---- f · offline, and the keyboard ----
  test('f. startup, the menu, the preview, Cancel and Apply make zero external requests; the keyboard opens the dialog, picks a language, applies, and the focus returns to the account trigger', TAG, async ({ page }, testInfo) => {
    const external = recordExternal(page);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.getAttribute('role') ?? null);
    await page.goto('/');
    await trigger(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect.poll(focused).toBe('account-sign-in');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('account-internet');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('account-language');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    // The focus is trapped in the dialog: Tab reaches the select; the arrows open it and
    // move; Enter chooses.
    await select(page).focus();
    await expect.poll(focused).toBe('language-select');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select(page)).toContainText(LABEL['es-419']);
    await expectLanguage(page, 'es-419');
    await expect.poll(focused).toBe('language-select');
    await shot(page, testInfo, 'keyboard-preview');
    // Escape with a preview: the rollback, and the focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'en');
    await expect.poll(focused).toBe('account-menu');
    // Open again from the keyboard, choose Hindi, Tab to Apply, Enter.
    await page.keyboard.press('Enter');
    await expect.poll(focused).toBe('account-sign-in');
    await page.keyboard.press('End');
    await expect.poll(focused).toBe('account-about');
    await page.keyboard.press('ArrowUp');
    await expect.poll(focused).toBe('account-language');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await select(page).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(select(page)).toContainText(LABEL.hi);
    await expectLanguage(page, 'hi');
    await page.keyboard.press('Tab');
    await expect.poll(focused).toBe('language-cancel');
    await page.keyboard.press('Tab');
    await expect.poll(focused).toBe('language-apply');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expectLanguage(page, 'hi');
    await expect.poll(storedLocale).toBe('hi');
    await expect.poll(focused).toBe('account-menu');
    await shot(page, testInfo, 'keyboard-applied-hi');
    expect(external.external()).toEqual([]);
    await external.save(testInfo);
  });
});
