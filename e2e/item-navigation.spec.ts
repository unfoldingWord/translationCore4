// #726 / #728: exercise the real controls against the seeded project. Every run
// records the rows and section heading, including Arabic and a narrow window.
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/test';
import {
  RIG_CLIENT_SETTINGS, SEEDED_PROJECT, TC4_ROOT, readClientSettingsDoc,
  resetClientSettings, resetSeededChecking, pinForSideloaded, writeProjectPins,
} from './helpers/rig';

const catalog = (locale: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(TC4_ROOT, 'src/i18n', `${locale}.json`), 'utf8'));

async function shot(loc: Locator, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await loc.page().mouse.move(0, 0);
  await loc.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function openBook(page: Page, locale: string) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
}

async function proveRow(page: Page, ids: string[], locale: string) {
  const row = page.getByTestId(ids[0]).locator('..');
  await expect(row.locator('button')).toHaveCount(ids.length);
  expect(await row.locator('button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-testid')))).toEqual(ids);
  const boxes = await row.locator('button').evaluateAll((buttons) => buttons.map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  }));
  const rtl = locale === 'ar';
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs((boxes[i].y + boxes[i].bottom) / 2 - (boxes[0].y + boxes[0].bottom) / 2)).toBeLessThan(1);
    expect(rtl ? boxes[i - 1].x - boxes[i].right : boxes[i].x - boxes[i - 1].right).toBeGreaterThanOrEqual(10);
  }
  expect(rtl ? boxes[0].x - boxes[1].right : boxes[1].x - boxes[0].right).toBeCloseTo(14, 0);
  const last = boxes.length - 1;
  expect(rtl ? boxes[last - 1].x - boxes[last].right : boxes[last].x - boxes[last - 1].right).toBeCloseTo(14, 0);
  const c = catalog(locale);
  for (const [index, which] of [[0, 'prev'], [last, 'next']] as const) {
    const button = page.getByTestId(ids[index]);
    await expect(button).toHaveAttribute('title', c[`check.${which}Item`]);
    const arrow = (which === 'prev') === rtl ? '→' : '←';
    await expect(button).toHaveText(which === 'prev' ? `${arrow} ${c['check.prevLabel']}` : `${c['check.nextLabel']} ${arrow}`);
    const look = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { height: s.height, radius: s.borderRadius, color: s.color };
    });
    expect(look.height).toBe('30px');
    expect(parseFloat(look.radius)).toBeGreaterThan(100);
  }
  // Start at the enabled Previous button; Tab must follow the painted row.
  await page.getByTestId(ids[0]).focus();
  for (const id of ids.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(id)).toBeFocused();
  }
  return boxes;
}

async function proveWrap(page: Page, ids: string[], info: TestInfo, name: string) {
  await page.setViewportSize({ width: 620, height: 1100 });
  const row = page.getByTestId(ids[0]).locator('..');
  const boxes = await row.locator('button').evaluateAll((buttons) => buttons.map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  }));
  expect(new Set(boxes.map((b) => Math.round((b.y + b.bottom) / 2))).size).toBeGreaterThan(1);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
  }
  await shot(row, info, name);
  return boxes;
}

// Leave the next journey in the seeded interface language after Arabic.
// afterAll runs after the fixture has drained the page's pending writes.
test.afterAll(() => resetClientSettings());

for (const locale of ['en', 'ar']) {
  test.describe(`#726 / #728 — ${locale}`, () => {
    test.setTimeout(60_000);
    test.beforeEach(() => {
      resetSeededChecking();
      resetClientSettings();
      fs.writeFileSync(RIG_CLIENT_SETTINGS, JSON.stringify({ ...readClientSettingsDoc(), appLocale: locale }));
      writeProjectPins(SEEDED_PROJECT, {
        tn: pinForSideloaded('en_tn', 'v91'), twl: pinForSideloaded('en_twl', 'v91'),
        tw: pinForSideloaded('en_tw', 'v91'), ta: pinForSideloaded('en_ta', 'v91'),
      });
    });

    for (const tool of ['translationNotes', 'translationWords']) {
      test(`${tool}: marking row, boundaries, Tab and wrapping`, { tag: ['@navigation'] }, async ({ page }, info) => {
        const c = catalog(locale);
        await openBook(page, locale);
        await page.getByRole('tab', { name: c['nav.check'], exact: true }).click();
        await page.getByTestId(`open-${tool}`).click();
        const items = page.getByTestId('check-list').getByRole('button');
        // The tW rail groups by word, so DOM order is not item order.
        await page.locator('[data-testid="check-list"] [data-rail-index="0"]').click();
        await expect(page.getByTestId('check-prev')).toBeDisabled();
        await page.getByTestId('check-next').click();
        await expect(page.locator('[data-testid="check-list"] [data-rail-index="1"]')).toHaveAttribute('aria-current', 'true');
        const ids = ['check-prev', 'mark-valid', 'mark-invalid', 'mark-todo', 'check-next'];
        const row = page.getByTestId('check-prev').locator('..');
        await shot(row.locator('..'), info, `${tool}-${locale}`);
        const boxes = await proveRow(page, ids, locale);
        const header = page.getByTestId('check-item-counter').locator('..');
        await expect(header.locator('button')).toHaveCount(0);
        await page.getByTestId('check-prev').click();
        await expect(page.locator('[data-testid="check-list"] [data-rail-index="0"]')).toHaveAttribute('aria-current', 'true');
        const last = Math.max(...await items.evaluateAll((buttons) => buttons.map((b) => Number(b.getAttribute('data-rail-index')))));
        await page.locator(`[data-testid="check-list"] [data-rail-index="${last}"]`).click();
        await expect(page.getByTestId('check-next')).toBeDisabled();
        const wrapped = await proveWrap(page, ids, info, `${tool}-${locale}-narrow`);
        await info.attach('row-geometry', { body: JSON.stringify({ boxes, wrapped }, null, 2), contentType: 'application/json' });
      });
    }

    test('Align: marking row, boundaries and Tab', { tag: ['@navigation', '@keyboard'] }, async ({ page }, info) => {
      const c = catalog(locale);
      await openBook(page, locale);
      await page.getByRole('tab', { name: c['nav.check'], exact: true }).click();
      await page.getByTestId('open-align').click();
      const items = page.getByTestId('align-verse-list').locator('button[data-ref]:enabled');
      await items.first().click();
      await expect(page.getByTestId('align-prev')).toBeDisabled();
      await page.getByTestId('align-next').click();
      await expect(items.nth(1)).toHaveAttribute('data-selected', 'true');
      const ids = ['align-prev', 'align-mark-valid', 'align-next'];
      await shot(page.getByTestId('align-session'), info, `align-${locale}`);
      const boxes = await proveRow(page, ids, locale);
      await expect(page.getByTestId('align-session').locator('div').first().getByTestId('align-prev')).toHaveCount(0);
      await page.getByTestId('align-prev').click();
      await expect(items.first()).toHaveAttribute('data-selected', 'true');
      await items.last().click();
      await expect(page.getByTestId('align-next')).toBeDisabled();
      const wrapped = await proveWrap(page, ids, info, `align-${locale}-narrow`);
      await info.attach('row-geometry', { body: JSON.stringify({ boxes, wrapped }, null, 2), contentType: 'application/json' });
    });

    test('Draft section: visible at rest, hover, focus and end alignment', { tag: ['@navigation', '@keyboard'] }, async ({ page }, info) => {
      const c = catalog(locale);
      await openBook(page, locale);
      await page.getByRole('tab', { name: c['nav.draft'], exact: true }).click();
      await page.getByRole('tab', { name: c['understand.bySection'], exact: true }).click();
      const label = c['draft.draftSection'].split('{')[0];
      const button = page.getByRole('button', { name: new RegExp(label) }).first();
      await expect(button).toBeVisible();
      await page.mouse.move(0, 0);
      await shot(button.locator('../..'), info, `draft-${locale}`);
      const appearance = await button.evaluate((el) => {
        const s = getComputedStyle(el), b = el.getBoundingClientRect(), p = el.parentElement!.getBoundingClientRect();
        return { background: s.backgroundColor, radius: s.borderRadius, endGap: s.direction === 'rtl' ? b.left - p.left : p.right - b.right };
      });
      expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(parseFloat(appearance.radius)).toBeGreaterThan(100);
      expect(appearance.endGap).toBeCloseTo(0, 0);
      await button.hover();
      const hovered = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(hovered).not.toBe(appearance.background);
      await button.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(button).toBeFocused();
      expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await shot(button.locator('../..'), info, `draft-${locale}-focus`);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: new RegExp(c['draft.sectionLabel'].split('{')[0]) })).toBeVisible();
      await info.attach('section-appearance', { body: JSON.stringify({ ...appearance, hovered }, null, 2), contentType: 'application/json' });
    });
  });
}
