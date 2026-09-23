// The import journey helper (issue #361): drive the import screen from Home the
// way a facilitator does — open Import, pick the kind, choose the files, read
// the review page, and (by default) import.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { zipDirectory } from '../../test/helpers/import';

export type FixturePayload = { name: string; mimeType: string; buffer: Buffer };

/** A file path as the file picker receives it: a directory becomes one zip of its files. */
export function fixturePayload(file: string | FixturePayload): string | FixturePayload {
  if (typeof file !== 'string' || !fs.statSync(file).isDirectory()) return file;
  return { name: `${path.basename(file)}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zipDirectory(file)) };
}

/** From Home: import `file` (one path, a directory, a payload, or several) with
 * the kind `kind`, laying `edits` over the review page's name and language.
 * With `confirm: false` it stops on the review page. Else it clicks Import and
 * waits for the result: the success toast or the failure screen. */
export async function importFixture(
  page: Page,
  file: string | FixturePayload | Array<string | FixturePayload>,
  { kind = 'e2e-fake', edits = {}, confirm = true }: { kind?: string; edits?: { name?: string; language?: string }; confirm?: boolean } = {},
): Promise<void> {
  await page.getByTestId('open-import').click();
  await page.getByTestId(`import-kind-${kind}`).click();
  await page.getByTestId('import-file-input').setInputFiles((Array.isArray(file) ? file : [file]).map(fixturePayload) as never);
  await page.getByTestId('import-to-review').click();
  await expect(page.getByTestId('import-review')).toBeVisible();
  if (edits.name !== undefined) await page.getByTestId('import-name').fill(edits.name);
  if (edits.language !== undefined) await page.getByTestId('import-lang').fill(edits.language);
  if (!confirm) return;
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-toast').or(page.getByTestId('import-failed'))).toBeVisible({ timeout: 60_000 });
}
