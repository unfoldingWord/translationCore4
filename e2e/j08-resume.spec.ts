// J8 — Resume work across sessions/books; multi-book navigation
// JOURNEYS-AND-GAPS §2 J8 · PRD FR-29, FR-34 · TEST-PLAN E-J8 · Increment 4
//
// Ground truth is the rig's disk: commit counts and messages come from the
// repository, never from UI state (e2e/helpers/rig.ts).
import { test, expect, type Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { SEEDED_PROJECT, commitCount, lastCommitMessage } from './helpers/rig';

async function openTitusAt(page: Page, chapter: string) {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: chapter, exact: true }).click();
}

async function draftFirstStub(page: Page, text: string) {
  await page.getByRole('button', { name: 'Start this verse' }).first().click();
  const editor = page.getByRole('textbox', { name: /Verse/ });
  await editor.fill(text);
  await editor.blur();
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
}

test.describe('J8 — a translator resumes where they left off', () => {
  test.fixme(
    'after a restart, all projects are listed and the last position (project/book/chapter/mode) is restored (FR-29)',
    { tag: ['@inc4', '@J8'] },
    async () => {},
  );

  test(
    'commits happen at exactly the checkpoints — a mode switch and leaving the project commit pending work; a switch with nothing pending commits nothing (FR-34 / W-4, D9, #183)',
    { tag: ['@inc4', '@J8'] },
    async ({ page }) => {
      const before = commitCount(SEEDED_PROJECT);
      await openTitusAt(page, '2');
      await draftFirstStub(page, 'Pero tú, habla lo que conviene a la sana enseñanza.');
      // Saving is not a checkpoint (J2 proves the same; restated here beside the checkpoints).
      expect(commitCount(SEEDED_PROJECT)).toBe(before);

      // Checkpoint 1: switching mode. The commit is started, not awaited, so poll the disk.
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await expect.poll(() => commitCount(SEEDED_PROJECT), { timeout: 30_000 }).toBe(before + 1);
      const first = lastCommitMessage(SEEDED_PROJECT);
      expect(first).toMatch(/^Checkpoint, leaving Translate: /);
      expect(first).toContain('TIT text');
      // The indicator never showed a checkpoint failure.
      await expect(page.getByTestId('retry-checkpoint')).toHaveCount(0);

      // No pending work: switching back commits nothing (the empty-commit trap, PLATFORM-NOTES #9).
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      // Translate reopens at the chapter the translator left (2): the drafted verse is on screen.
      await expect(page.getByText('Pero tú, habla lo que conviene')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      expect(commitCount(SEEDED_PROJECT)).toBe(before + 1);

      // Checkpoint 2: leaving the project, after another edit. The app starts it after the
      // synchronous store teardown and does not await it, so poll the disk.
      await page.getByRole('button', { name: '2', exact: true }).click();
      await draftFirstStub(page, 'Enseña a los ancianos a ser sobrios.');
      await page.getByTitle('Switch project').click();
      await expect(page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => commitCount(SEEDED_PROJECT), { timeout: 30_000 }).toBe(before + 2);
      expect(lastCommitMessage(SEEDED_PROJECT)).toMatch(/^Checkpoint, leaving the project: .*TIT text/);
      await expect(page.getByTestId('home-open-error')).toHaveCount(0);
    },
  );

  test(
    'typing never produces a commit (FR-34)',
    { tag: ['@inc4', '@J8'] },
    async ({ page }) => {
      await openTitusAt(page, '3');
      const before = commitCount(SEEDED_PROJECT);
      // Two edits in one editing session, then the blur save, then the idle window: no commit.
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      const editor = page.getByRole('textbox', { name: /Verse/ });
      await editor.fill('Recuérdales que se sometan a los gobernantes.');
      await editor.fill('Recuérdales que se sometan a los gobernantes y autoridades.');
      await editor.blur();
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      await page.waitForTimeout(2500);
      expect(commitCount(SEEDED_PROJECT)).toBe(before);
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
