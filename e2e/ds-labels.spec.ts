// #614: four labels that the design system draws follow the app language.
//
// The design system (src/ds) holds no catalog. Each of the four components takes its
// label as a prop, and the view passes the catalog text. With Spanish applied, each
// test reaches one of the four the way a user does and reads the label on the page:
//   a  the close button of the Translation Academy drawer, in Check
//   b  the dismiss button of the export toast, in Community Checking
//   c  the clear button of the search field in the Add a book select
//   d  the name a screen reader gives a verse number, in Place verse numbers
// The expected strings come from the shipped catalogs, never from memory.
// Each test writes the label it read into its output folder (and attaches it).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  RIG_CLIENT_SETTINGS, SEEDED_PROJECT, pinForSideloaded, readClientSettingsDoc, resetClientSettings,
  resetPlaces, resetSeededChecking, writeProjectPins,
} from './helpers/rig';
import { captureDownload } from './helpers/export';
import { TC4_ROOT } from './helpers/root';

const TAG = { tag: ['@ds-labels'] };
const LOCALE = 'es-419';
const catalog = (id: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'src', 'i18n', `${id}.json`), 'utf8'));
const EN = catalog('en');
const ES = catalog(LOCALE);
const SEEDED_CARD = `project-_local_/_local_/${SEEDED_PROJECT}`;

/** The catalog text of `key` in Spanish. It must exist and differ from the English text. */
function spanish(key: string, vars: Record<string, string | number> = {}): string {
  expect(ES[key], `${key}: in the Spanish catalog`).toBeTruthy();
  expect(ES[key], `${key}: translated`).not.toBe(EN[key]);
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), ES[key]);
}
async function record(testInfo: TestInfo, name: string, attribute: string, el: Locator): Promise<void> {
  const file = testInfo.outputPath(`${name}.txt`);
  fs.writeFileSync(file, `${LOCALE} ${attribute}=${await el.getAttribute(attribute)}\n`);
  await testInfo.attach(name, { path: file, contentType: 'text/plain' });
}
async function openTitus(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(LOCALE);
  await page.getByTestId(SEEDED_CARD).getByRole('button', { name: /Titus/ }).click();
}

test.describe('#614 — the design-system labels follow the app language', () => {
  test.beforeEach(() => {
    resetSeededChecking();
    resetPlaces();
    resetClientSettings();
    // Spanish, as a previous session's Apply left it (the pattern of app-language.spec.ts).
    fs.writeFileSync(RIG_CLIENT_SETTINGS, JSON.stringify({ ...(readClientSettingsDoc() ?? {}), appLocale: LOCALE }));
  });
  test.afterAll(() => {
    resetSeededChecking();
    resetPlaces();
    resetClientSettings();
  });

  test('a. the Translation Academy drawer: the close button', TAG, async ({ page }, testInfo) => {
    writeProjectPins(SEEDED_PROJECT, {
      tn: pinForSideloaded('en_tn', 'v91'),
      tw: pinForSideloaded('en_tw', 'v91'),
      ta: pinForSideloaded('en_ta', 'v91'),
    });
    await openTitus(page);
    await page.getByRole('tab', { name: spanish('nav.check'), exact: true }).click();
    await page.getByTestId('open-translationWords').click();
    await page.getByTestId('open-academy').click();
    await expect(page.getByTestId('article-panel')).toBeVisible();
    const close = page.getByRole('dialog').locator('button', { hasText: '✕' });
    await expect(close).toHaveAttribute('title', spanish('common.close'));
    await record(testInfo, 'drawer-close', 'title', close);
    await close.click();
    await expect(page.getByTestId('article-panel')).toHaveCount(0);
  });

  test('b. the export toast: the dismiss button', TAG, async ({ page }, testInfo) => {
    await openTitus(page);
    await page.getByRole('tab', { name: spanish('nav.check'), exact: true }).click();
    await page.getByTestId('open-community-checking').click();
    await page.getByTestId('export-menu-trigger').click();
    await captureDownload(page, page.getByRole('menuitem', { name: spanish('cc.exportUsfmPlain'), exact: true }));
    const dismiss = page.getByTestId('export-toast').getByRole('button');
    await expect(dismiss).toHaveAttribute('title', spanish('common.dismiss'));
    await record(testInfo, 'toast-dismiss', 'title', dismiss);
    await dismiss.click();
    await expect(page.getByTestId('export-toast')).toHaveCount(0);
  });

  test('c. the Add a book select: the clear button of the search field', TAG, async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByTestId(SEEDED_CARD).getByRole('button', { name: spanish('home.addBookTile') }).click();
    await page.getByText(spanish('addBook.blankTitle')).click();
    await page.locator('#ab-book').click();
    const search = page.getByPlaceholder(spanish('addBook.findBook'));
    await search.fill('rut');
    const clear = search.locator('xpath=ancestor::*[.//button][1]').getByRole('button');
    await expect(clear).toHaveAttribute('title', spanish('common.clear'));
    await record(testInfo, 'search-clear', 'title', clear);
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
  });

  test('d. Place verse numbers: the name of a verse number', TAG, async ({ page }, testInfo) => {
    await openTitus(page);
    await page.getByRole('tab', { name: spanish('nav.draft'), exact: true }).click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: spanish('draft.draftSection', { span: '9–10' }) }).click();
    await page.getByRole('textbox', { name: spanish('draft.sectionLabel', { span: '9–10' }) })
      .fill('Exhorta a los siervos a que se sujeten a sus amos no defraudando');
    await page.getByRole('tab', { name: spanish('draft.modePlace') }).click();
    const pin = page.getByTestId('pin-bank').getByTestId('pin-10');
    await expect(pin).toHaveAttribute('aria-label', spanish('draft.moveVerse', { n: 10 }));
    await record(testInfo, 'verse-marker', 'aria-label', pin);
    // Nothing is saved: the card is cancelled.
    await page.getByTestId('section-editor').getByRole('button', { name: spanish('draft.cancelVerse'), exact: true }).click();
    await expect(page.getByTestId('section-editor')).toHaveCount(0);
  });
});
