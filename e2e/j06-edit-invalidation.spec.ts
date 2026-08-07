// J6 — Edit a checked verse → affected checks flag for re-review
// JOURNEYS-AND-GAPS §2 J6 · PRD FR-11 · TEST-PLAN E-J6 · Increment 2 (owner-approved)
//
// Two independent "the ground moved" cases, and the same promise in both:
// nothing is discarded, the user is told.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readDecisionFile,
  resetSeededChecking,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

async function openTool(page: import('@playwright/test').Page, tool: string) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByTestId(`open-${tool}`).click();
}

test.beforeEach(() => {
  // Each spec states its own starting conditions (see resetSeededChecking).
  resetSeededChecking();
});

test.describe('J6 — editing a checked verse flags its checks for re-review', () => {
  test(
    'a decision whose selected words leave the draft is flagged invalidated, and is NOT deleted (FR-11)',
    { tag: ['@inc2', '@J6'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());

      // The seeded sample has a tW decision selecting "Dios" in Titus 1:1.
      const before = readDecisionFile(SEEDED_PROJECT, 'translationWords', 'TIT');
      const target = before!.decisions.find((d) => {
        const sel = (d as { selections?: Array<{ text: string }> }).selections;
        return Array.isArray(sel) && sel.some((x) => x.text === 'Dios');
      });
      expect(target, 'the seeded sample should carry a "Dios" selection').toBeTruthy();
      const decisionsBefore = before!.decisions.length;

      // Edit the draft out from under it, on disk, exactly as a translator would
      // have done through the editor in an earlier session.
      const bookPath = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'TIT.usfm');
      const usfm = fs.readFileSync(bookPath, 'utf8');
      expect(usfm).toContain('Dios');
      fs.writeFileSync(bookPath, usfm.replace('Dios', 'Señor'));

      await openTool(page, 'translationWords');

      // The session says so, plainly, and marks the affected item.
      await expect(page.getByTestId('invalidated-notice')).toBeVisible();
      await expect(
        page.getByTestId('check-list').locator('button[data-invalid="1"]'),
      ).not.toHaveCount(0);

      // FR-11: nothing was deleted — the record is still there to be re-reviewed.
      const after = readDecisionFile(SEEDED_PROJECT, 'translationWords', 'TIT');
      expect(after!.decisions.length).toBe(decisionsBefore);
    },
  );

  test(
    'a decision file recorded against a DIFFERENT resource warns before it is used (D17)',
    { tag: ['@inc2', '@J6'] },
    async ({ page }) => {
      // The seeded sample's tN decisions were checked against es-419_tn v66.
      const stored = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      expect(stored?.resource?.repoPath).toContain('es-419_tn');

      // The project now pins the English suite: same book, different resource.
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openTool(page, 'translationNotes');

      const warning = page.getByTestId('resolution-warning');
      await expect(warning).toBeVisible();
      await expect(warning).toContainText('es-419_tn'); // what it was checked against
      await expect(warning).toContainText('en_tn'); // what it is pinned to now
    },
  );

  test(
    'agreement is silent — no warning when the pins still match what was checked',
    { tag: ['@inc2', '@J6'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      // Start from a book with no prior decisions, so the first write stamps
      // the CURRENT resolution rather than inheriting the sample's es-419
      // record (which a decision write deliberately never overwrites).
      fs.rmSync(
        path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationNotes', 'TIT.json'),
        { force: true },
      );
      await openTool(page, 'translationNotes');
      await page.getByTestId('mark-valid').click();
      await expect
        .poll(() => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.resource?.version, {
          timeout: 10_000,
        })
        .toBe('v89');

      // …so the next visit has nothing to warn about.
      await openTool(page, 'translationNotes');
      await expect(page.getByTestId('check-progress')).toBeVisible();
      await expect(page.getByTestId('resolution-warning')).toHaveCount(0);
    },
  );
});
