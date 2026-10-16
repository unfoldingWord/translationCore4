// #762 — the compare card's column rule for 1 to 6 source texts. The product
// shows at most 2 today, so this spec renders the real CompareCard in a harness
// page (e2e/harness/compare-card.html, served by vite) instead of the Check view.
// jsdom does no layout, so a vitest file cannot count columns.
import { test, expect } from './helpers/test';

const WIDTHS = [900, 1280, 1600, 1920];

/** Each source card's box, and the width of one card at the 40ch minimum. */
async function measure(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    };
    return {
      row: box(document.querySelector('[data-testid="compare-sources"]')!),
      min: box(document.querySelector('[data-testid="harness-min"]')!).width,
      cards: [...document.querySelectorAll('[data-testid="harness-source"]')].map(box),
    };
  });
}

test.describe('#762 — the compare card places as many source texts in a row as fit at 40ch', () => {
  for (const width of WIDTHS) {
    test(`1 to 6 source texts at ${width}px @J4`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (let n = 1; n <= 6; n++) {
        await page.goto(`/e2e/harness/compare-card.html?n=${n}`);
        await expect(page.getByTestId('harness-source')).toHaveCount(n);
        const { row, min, cards } = await measure(page);
        const GAP = 6;
        const fit = Math.max(1, Math.floor((row.width + GAP) / (min + GAP)));
        const columns = Math.min(n, fit);
        // Cards in rows, top to bottom.
        const rows: (typeof cards)[] = [];
        for (const c of cards) {
          const last = rows[rows.length - 1];
          if (last && Math.abs(last[0].y - c.y) < 1) last.push(c);
          else rows.push([c]);
        }
        const label = `n=${n} at ${width}px`;
        expect(rows[0].length, label).toBe(columns);
        expect(rows.length, label).toBe(Math.ceil(n / columns));
        for (const r of rows.slice(0, -1)) expect(r.length, label).toBe(columns);
        // A full row: every card has the same width, never under the minimum.
        for (const c of rows[0]) {
          expect(Math.abs(c.width - rows[0][0].width), label).toBeLessThan(1);
          if (fit > 1 || row.width >= min) expect(c.width, label).toBeGreaterThanOrEqual(min - 1);
        }
        // A card alone in the last row takes the full width.
        const tail = rows[rows.length - 1];
        if (tail.length === 1) expect(Math.abs(tail[0].width - row.width), label).toBeLessThan(1);
      }
    });
  }
});
