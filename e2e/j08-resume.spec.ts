// J8 — Resume work across sessions/books; multi-book navigation
// JOURNEYS-AND-GAPS §2 J8 · PRD FR-29, FR-34 · TEST-PLAN E-J8 · Increment 4
//
// Ground truth is the rig's disk: commit counts and messages come from the
// repository, never from UI state (e2e/helpers/rig.ts).
import { test, expect, type Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { SEEDED_PROJECT, commitCount, lastCommitMessage, listLocalRepos, readLastEdit } from './helpers/rig';

// The seeded large fixture (issue #95): Titus with 4000 journaled edits, so its
// open shows the progress indicator (J15) and a resume into it must wait it out.
const LARGE = 'sample_burrito_large';
// Display names from the fixtures' own metadata (conformance/sample-burrito and
// scripts/seed-large-project.mjs), as the Resume card shows them.
const SEEDED_NAME = 'Equipo Ejemplo — Tito y Jonás';
const LARGE_NAME = 'Equipo Ejemplo — Tito (proyecto grande)';

// "Open" means the book text is on screen. The seeded project pins ULT/UST, so its
// source pane carries this phrase; the large fixture pins no sources, so its own
// last edit ("(edición N)", as J15 waits for it) is the marker.
const READY: Record<string, RegExp> = {
  [SEEDED_PROJECT]: /an apostle of Jesus Christ/,
  [LARGE]: /\(edición \d+\)/,
};

async function openTitusAt(page: Page, chapter: string, project = SEEDED_PROJECT) {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${project}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByText(READY[project]).first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: chapter, exact: true }).click();
}

/** The Resume record is written to the rig a second after the edit (debounced).
 * A reload before that write would lose it, so wait for the disk, not a timer. */
async function waitForResumeRecord(project: string, chapter: number) {
  await expect
    .poll(() => {
      const rec = readLastEdit();
      return rec ? `${rec.repoPath}@${rec.chapter}` : null;
    }, { timeout: 10_000 })
    .toBe(`_local_/_local_/${project}@${chapter}`);
}

/** After a full reload the app knows only what the server holds: every local
 * project on the rig's disk is listed on Home. */
async function expectAllProjectsListed(page: Page) {
  const repos = listLocalRepos();
  expect(repos.length).toBeGreaterThanOrEqual(2);
  for (const name of repos) {
    await expect(page.getByTestId(`project-_local_/_local_/${name}`)).toBeVisible({ timeout: 30_000 });
  }
}

async function expectTranslateAt(page: Page, chapter: string, draftedText: string) {
  await expect(page.getByRole('tab', { name: 'Translate', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: `Titus ${chapter}`, exact: true })).toBeVisible();
  await expect(page.getByText(draftedText)).toBeVisible();
}

async function draftFirstStub(page: Page, text: string) {
  await page.getByRole('button', { name: 'Start this verse' }).first().click();
  const editor = page.getByRole('textbox', { name: /Verse/ });
  await editor.fill(text);
  await editor.blur();
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
}

test.describe('J8 — a translator resumes where they left off', () => {
  test(
    'after a restart, all projects are listed and the last position (project/book/chapter/mode) is restored (FR-29, #184)',
    { tag: ['@inc4', '@J8'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      // A fresh seed holds no Resume record (seed.zsh rebuilds the client settings):
      // no project has been edited, so Home offers no Resume card.
      expect(readLastEdit()).toBeNull();
      await page.goto('/');
      await expectAllProjectsListed(page);
      await expect(page.getByTestId('resume-card')).toHaveCount(0);

      await openTitusAt(page, '2');
      const drafted = 'Porque la gracia de Dios se ha manifestado (reanudar).';
      await draftFirstStub(page, drafted);
      await waitForResumeRecord(SEEDED_PROJECT, 2);

      // A full app restart: in-memory state is gone; what comes back comes from
      // the server (the project list) and the per-installation record (lastEdit).
      await page.reload();
      await expectAllProjectsListed(page);
      const card = page.getByTestId('resume-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      // The card names the project and the book it will open, and it is for the
      // edited project only: the never-edited large fixture is not offered.
      await expect(card).toContainText(SEEDED_NAME);
      await expect(card).toContainText('Titus 2');
      await expect(card).not.toContainText(LARGE_NAME);
      await expect(card).toContainText('reanudar');

      await card.click();
      await expect(page.getByText(drafted)).toBeVisible({ timeout: 30_000 });
      await expectTranslateAt(page, '2', drafted);
    },
  );

  test(
    'resume into a project with a large journal shows the open progress, then lands on the remembered chapter (#184, #95)',
    { tag: ['@inc4', '@J8'] },
    async ({ page }) => {
      test.setTimeout(300_000);
      await openTitusAt(page, '2', LARGE);
      const drafted = 'Enseña a los ancianos a ser sobrios (proyecto grande, reanudar).';
      await draftFirstStub(page, drafted);
      await waitForResumeRecord(LARGE, 2);

      await page.reload();
      await expectAllProjectsListed(page);
      const card = page.getByTestId('resume-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(LARGE_NAME);
      await expect(card).toContainText('Titus 2');
      await card.click();
      // The slow open shows its determinate indicator (issue #95) ...
      const progress = page.getByTestId('open-progress');
      await expect(progress).toBeVisible({ timeout: 20_000 });
      await expect(progress).toHaveAttribute('data-stage', /journal|state|prepare/);
      // ... and then the app lands where the translator stopped.
      await expect(page.getByText(drafted)).toBeVisible({ timeout: 120_000 });
      await expect(progress).toHaveCount(0);
      await expectTranslateAt(page, '2', drafted);
    },
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
