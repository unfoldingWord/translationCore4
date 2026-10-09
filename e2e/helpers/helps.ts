// #602: the helps panel is resized by dragging its divider, and every screen
// has one show/hide button for it. J2 (Translate) and J16 (Understand) prove
// both with these steps and write the same artifacts.
import fs from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './test';

/** The drag distance in px, toward the editing pane. It stays inside the 280–720 px limits. */
export const HELPS_DRAG = 120;

/** The toolbar has one show/hide button and no widen button. Attaches a screenshot of the toolbar. */
export async function proveHelpsToolbar(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  const toggle = page.getByTestId('toggle-helps');
  await expect(page.getByTestId('helps-widen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Widen the helps panel|Restore the helps panel width/ })).toHaveCount(0);
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('title', 'Toggle helps panel');
  const box = (await toggle.boundingBox())!;
  const shot = testInfo.outputPath(`helps-toolbar-${screen}.png`);
  await page.screenshot({ path: shot, animations: 'disabled', clip: { x: 0, y: Math.max(0, box.y - 12), width: page.viewportSize()!.width, height: box.height + 24 } });
  await testInfo.attach(`helps-toolbar-${screen}.png`, { path: shot, contentType: 'image/png' });
}

/** Drag the divider toward the editing pane, then hide and show the panel.
 * Writes the widths to `helps-widths-<screen>.txt` and returns the dragged width. */
export async function proveHelpsDragAndToggle(page: Page, testInfo: TestInfo, screen: string): Promise<number> {
  const panel = page.getByTestId('helps-panel');
  const width = async () => (await panel.boundingBox())!.width;
  await expect(panel).toBeVisible();
  const before = await width();

  const divider = (await page.getByTestId('helps-divider').boundingBox())!;
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - HELPS_DRAG, y, { steps: 8 });
  await page.mouse.up();
  const after = await width();
  expect(after).toBeCloseTo(before + HELPS_DRAG, 0);
  // The width stays after the release (the release stores it in app state).
  await page.waitForTimeout(300);
  expect(await width()).toBe(after);

  await page.getByTestId('toggle-helps').click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId('toggle-helps').click();
  await expect(panel).toBeVisible();
  const reshown = await width();
  expect(reshown).toBe(after);

  const textPath = testInfo.outputPath(`helps-widths-${screen}.txt`);
  fs.writeFileSync(textPath, `before=${before}\nafter-drag=${after}\nafter-hide-and-show=${reshown}\n`);
  await testInfo.attach(`helps-widths-${screen}.txt`, { path: textPath, contentType: 'text/plain' });
  return after;
}
