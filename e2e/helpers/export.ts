// The export download capture (issue #375): every export leaves the app as a
// browser download (src/data/export/kernel.ts deliverFile), so a journey
// clicks the menu item and reads the file Playwright saved.
import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';

/** Click `menuItem` and return the downloaded file's bytes and suggested name. */
export async function captureDownload(page: Page, menuItem: Locator): Promise<{ bytes: Buffer; filename: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), menuItem.click()]);
  const saved = await download.path();
  return { bytes: fs.readFileSync(saved), filename: download.suggestedFilename() };
}
