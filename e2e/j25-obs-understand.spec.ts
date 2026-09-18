// J25 — a translator reads a story with helps and records a user comment
// (docs/JOURNEYS.md J25, D74; issue #290, proof #292). End state on disk: one `note.add`
// segment with a `{story, frame}` target per comment; the story file is byte-identical.
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { createObsProject, newSegments, segmentFiles, storyBytes } from './helpers/story';

const COMMENT = 'Dios crea todo en seis días: preguntar cómo decir «universo» (J25).';

test.describe('J25 — a translator reads a story with helps and records a user comment', () => {
  test(
    'Understand shows the frames with picture and gateway text, the notes and word links of the selected frame; a comment saves as one note.add segment targeting {story, frame} and the story file keeps its bytes',
    { tag: ['@inc7', '@J25', '@j25'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      const repo = await createObsProject('j25', 'Equipo Rig — J25');
      const storyBefore = storyBytes(repo, 1);

      await test.step('open the project, go to Understand: the title unit and the frames of story 1', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await page.getByRole('tab', { name: 'Understand', exact: true }).click();
        await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('story-understand-unit-0')).toBeVisible();
        const unit = page.getByTestId('story-understand-unit-1');
        await expect(unit.getByTestId('story-understand-gateway')).toContainText('This is how God made everything in the beginning.');
        await expect(unit.getByTestId('story-understand-draft')).toHaveCount(0);
        await expect(unit.getByRole('img')).toBeVisible();
      });

      await test.step('select frame 1: its notes and its word links', async () => {
        await page.getByTestId('story-understand-unit-1').click();
        await expect(page.getByTestId('story-understand-unit-1')).toHaveAttribute('data-focused', 'true');
        const helps = page.getByTestId('story-helps');
        await expect(helps.getByTestId('helps-loading')).toHaveCount(0, { timeout: 60_000 });
        await expect(helps.getByTestId('story-help-note').first()).toBeVisible();
        await helps.getByRole('tab', { name: 'Words', exact: true }).click();
        await expect(helps.getByTestId('story-help-word').first()).toBeVisible();
      });

      await test.step('write a comment on frame 1: one note.add segment, target {story: 1, frame: 1}', async () => {
        const before = new Set(segmentFiles(repo));
        const box = page.getByTestId('story-understand-unit-1').getByRole('textbox');
        await box.fill(COMMENT);
        await box.blur();
        await expect.poll(() => newSegments(repo, before), { timeout: 15_000 }).toHaveLength(1);
        const [events] = newSegments(repo, before);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ op: 'note.add', target: { story: 1, frame: 1 }, text: COMMENT });
        await expect(page.getByTestId('understand-save-error')).toHaveCount(0);
      });

      await test.step('the story file is byte-identical; the comment is what the screen shows after a reopen', async () => {
        expect(storyBytes(repo, 1)).toBe(storyBefore);
        await page.reload();
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await page.getByRole('tab', { name: 'Understand', exact: true }).click();
        await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('story-understand-unit-1').getByRole('textbox')).toHaveValue(COMMENT, { timeout: 30_000 });
        expect(storyBytes(repo, 1)).toBe(storyBefore);
      });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
