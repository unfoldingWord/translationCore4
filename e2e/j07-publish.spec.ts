// J7 — Publish: typeset preview → PDF → aligned USFM export
// docs/JOURNEYS.md J7 · Increment 8 · run LTR and RTL (the J10 axis)
//
// The kernel case (#375) proves the export plumbing every producer sits on,
// with the dev-only fake producer (src/data/export/producers.ts): the export
// menu renders it, a click downloads the file, and the project repository is
// byte-identical except at most one D9 checkpoint commit. The producer cases
// (USFM #19, Scripture Burrito zip #359, PDF #20, OBS #360) add their own blocks.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { captureDownload } from './helpers/export';
import { assertProjectUnchanged } from '../test/helpers/export';
import { SEEDED_PROJECT, readIngredient, resetPlaces, resetSeededChecking, rigRepo } from './helpers/rig';

test.beforeEach(() => {
  resetSeededChecking();
  resetPlaces();
});

test.describe('J7 — a facilitator publishes the book', () => {
  test(
    'kernel: the export menu renders the producer table, a click downloads the file, and the project is unchanged except one checkpoint',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('tc4.e2e.fakeExport', '1'));
      const repo = rigRepo(SEEDED_PROJECT);

      await test.step('open Titus, then Community Checking from Check', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-community-checking').click();
        await expect(page.getByTestId('export-menu')).toBeVisible();
      });

      await test.step('the mode-switch checkpoint (D9) has settled: the working tree is clean', async () => {
        await expect.poll(() => execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');
      });

      await test.step('the fake export downloads the book as it is on disk; the project does not change', async () => {
        let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
        const commits = await assertProjectUnchanged(repo, async () => {
          await page.getByTestId('export-menu-trigger').click();
          download = await captureDownload(page, page.getByRole('menuitem', { name: 'Fake export (e2e)' }));
        });
        expect(commits).toBe(0); // a clean project makes no checkpoint
        expect(download.filename).toMatch(/-TIT-\d{4}-\d{2}-\d{2}\.txt$/);
        expect(download.bytes.equals(readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm'))).toBe(true);
        await expect(page.getByTestId('export-failure')).toHaveCount(0);
      });
    },
  );
});
