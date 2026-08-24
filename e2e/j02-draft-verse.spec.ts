// J2 — Open book → draft verses beside sources → autosave → progress updates
// JOURNEYS-AND-GAPS §2 J2 (the hole in the middle) · PRD FR-6..FR-10 · TEST-PLAN E-J2
// Increment 1 slice (@inc1): draft one verse in the seeded project and prove on disk —
//   · the typed text was saved to ingredients/TIT.usfm through the store (FR-6)
//   · D8 byte-strict: nothing outside the edited verse changed (FR-7)
//   · no alignment markup written at rest (FR-8, I-1)
//   · no auto-commit — commits happen only at checkpoints (FR-34, W-4)
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import {
  SEEDED_PROJECT,
  readIngredient,
  commitCount,
  byteStrictViolation,
} from './helpers/rig';

const BOOK_IPATH = 'ingredients/TIT.usfm';
// TIT 2:1 is an undrafted stub ("___") in the seeded fixture — the natural first draft.
const CHAPTER = 2;
const VERSE = 1;
const DRAFT_TEXT = 'Pero tú habla lo que está de acuerdo con la sana doctrina.';

test.describe('J2 — a translator drafts a verse', () => {
  test(
    'open the seeded project, draft verse Titus 2:1, and the save is byte-strict with no auto-commit',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      await test.step('open the app — the seeded project is listed', async () => {
        await page.goto('/');
        await expect(
          page.getByText('Equipo Ejemplo — Tito y Jonás').first(),
        ).toBeVisible();
      });

      await test.step('open the book Titus at chapter 2', async () => {
        await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('button', { name: '2', exact: true }).click();
      });

      await test.step('verse 1 is undrafted — start it (the first stub in the chapter)', async () => {
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
      });

      await test.step('type the draft and leave the verse (blur saves)', async () => {
        const editor = page.getByRole('textbox', { name: 'Verse 1' });
        await editor.fill(DRAFT_TEXT);
        await editor.blur();
      });

      await test.step('the save indicator confirms a real write', async () => {
        await expect(page.getByText('Saved')).toBeVisible();
      });

      await test.step('the typed text is on disk in ingredients/TIT.usfm (FR-6)', async () => {
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), {
            timeout: 10_000,
          })
          .toContain(DRAFT_TEXT);
      });

      await test.step('the write was byte-strict outside Titus 2:1 (FR-7 / D8)', async () => {
        const bytesAfter = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
        expect(byteStrictViolation(bytesBefore, bytesAfter, CHAPTER, VERSE)).toBeNull();
      });

      await test.step('no alignment markup was written at rest (FR-8 / I-1)', async () => {
        const after = readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8');
        expect(after).not.toContain('\\zaln');
      });

      await test.step('nothing auto-committed — commits are checkpoint-only (FR-34 / W-4)', async () => {
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });
    },
  );

  test(
    'source panes render beside the draft: ULT/UST tabs from pinned extraScripture (FR-10 — the orig pane is the alignment increment, D24a)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      // ULT is the default tab: real pinned text for Titus 1:1
      await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 20_000 });
      // Switch to UST: a genuinely different rendering of the same verse
      await page.getByRole('button', { name: 'UST' }).click();
      await expect(page.getByText('a representative of Jesus the Messiah')).toBeVisible();
      await expect(page.getByText('an apostle of Jesus Christ')).not.toBeVisible();
    },
  );

  test(
    'idle debounce also saves — no blur — and the indicator binds to the actual write (FR-6/FR-32)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      const TEXT = 'Enséñales a los ancianos a ser sobrios.';
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      await page.getByRole('textbox', { name: /Verse/ }).fill(TEXT);
      // Do NOT blur. The 2 s idle debounce must flush the write on its own.
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', {
        timeout: 10_000,
      });
      await expect
        .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), {
          timeout: 10_000,
        })
        .toContain(TEXT);
    },
  );

  test(
    'drafting an undrafted verse updates the progress display (FR-9)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      // Every rail row may show a percent now (design 2026-07-31) — read the
      // percent inside TITUS's own row, not the first one in the aside.
      const pctText = () =>
        page
          .locator('aside button', { hasText: 'Titus' })
          .first()
          .getByText(/%$/)
          .textContent();
      const before = parseInt((await pctText()) || '0', 10);
      await page.getByRole('button', { name: '3', exact: true }).click();
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      await page.getByRole('textbox', { name: /Verse/ }).fill('Recuérdales que se sometan.');
      await page.getByRole('textbox', { name: /Verse/ }).blur();
      await expect
        .poll(async () => parseInt((await pctText()) || '0', 10))
        .toBeGreaterThan(before);
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
