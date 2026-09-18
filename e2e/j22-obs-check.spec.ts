// J22 — a translator checks an OBS story (docs/JOURNEYS.md J22, D74; issue #291, proof
// #292). End state on disk: §5.2 decision records under the `story:frame` key for
// translationNotes and translationWords (`checking/<toolId>/OBS.json`, R-10.5.1); a
// later frame edit flags them invalid and retains them (D36); the story file is
// byte-identical through the checking. The Community Checking preview renders the story.
import { test, expect, type Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { readDecisionFile } from './helpers/rig';
import { createObsProject, newSegments, segmentFiles, storyBytes } from './helpers/story';

const FRAME_1 = 'Así fue como Dios hizo todo en el principio. Creó el universo y todo lo que hay en él en seis días.';
const FRAME_1_EDITED = 'Así fue como el Señor hizo todo al comienzo.';
const TOOLS = ['translationNotes', 'translationWords'] as const;

type Decision = { contextId: { reference: unknown }; selections?: unknown[]; status?: string };
const decisions = (repo: string, tool: string): Decision[] =>
  (readDecisionFile(repo, tool, 'OBS')?.decisions ?? []) as Decision[];

async function openTool(page: Page, tool: string) {
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId(`preflight-${tool}`)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByTestId(`open-${tool}`).click();
  await expect(page.getByTestId('check-list')).toBeVisible({ timeout: 30_000 });
}

test.describe('J22 — a translator checks an OBS story', () => {
  test(
    'a note and a word link of frame 1 record decisions under story:frame with the selected target words; a frame edit flags both invalid and keeps them; Community Checking renders the story',
    { tag: ['@inc7', '@J22', '@j22'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      // Precondition J21: frame 1 is drafted (the target words to select).
      const repo = await createObsProject('j22', 'Equipo Rig — J22', (store) => store.writeFrame(1, 1, FRAME_1));
      const storyBefore = storyBytes(repo, 1);

      await test.step('open the project', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('story-frame-1').getByTestId('story-unit-text')).toHaveText(FRAME_1);
      });

      for (const tool of TOOLS) {
        await test.step(`${tool}: open a frame-1 item, see the gateway phrase, select target words, mark valid — the record lands under {story: 1, frame: 1}`, async () => {
          expect(decisions(repo, tool)).toHaveLength(0);
          await openTool(page, tool);
          await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
          await expect(page.getByTestId('story-pane-text')).toContainText('This is how God made everything');
          await expect(page.getByTestId('check-target')).toHaveAttribute('data-drafted', '1');
          // A word the later edit removes, so the edit invalidates this decision (D36).
          const word = page.getByTestId('check-target').locator('[data-testid^="tw-"]', { hasText: 'universo' }).first();
          await word.click();
          await expect(word).toHaveAttribute('data-selected', '1');
          await page.getByTestId('mark-valid').click();
          await expect.poll(() => decisions(repo, tool), { timeout: 15_000 }).toHaveLength(1);
          const [record] = decisions(repo, tool);
          expect(record.contextId.reference).toEqual({ story: 1, frame: 1 });
          expect(record.status).toBe('valid');
          expect(record.selections).toEqual([{ text: 'universo', occurrence: 1, occurrences: 1 }]);
          expect(readDecisionFile(repo, tool, 'OBS')).toMatchObject({ book: 'OBS', resource: { repoPath: expect.stringContaining('_obs-') } });
          await expect(page.getByTestId('check-list').locator('button[data-ref="1:1"][data-decided="1"]').first()).toBeVisible();
          await page.getByRole('button', { name: '← All checking tools' }).click();
        });
      }

      await test.step('checking wrote nothing into the story file', async () => {
        expect(storyBytes(repo, 1)).toBe(storyBefore);
      });

      await test.step('edit frame 1 in Translate: the draft changes under the two decisions', async () => {
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        const before = new Set(segmentFiles(repo));
        await page.getByTestId('story-frame-1').getByTestId('story-unit-text').click();
        const box = page.getByTestId('story-frame-1').getByRole('textbox');
        await box.fill(FRAME_1_EDITED);
        await box.blur();
        await expect.poll(() => newSegments(repo, before), { timeout: 15_000 }).toHaveLength(1);
        expect(newSegments(repo, before)[0][0]).toMatchObject({ op: 'text.frame.set', story: 1, frame: 1, text: FRAME_1_EDITED });
      });

      for (const tool of TOOLS) {
        await test.step(`${tool}: the decision is flagged invalid and retained (D36)`, async () => {
          await openTool(page, tool);
          await expect(page.getByTestId('invalidated-notice')).toBeVisible();
          await expect(page.getByTestId('check-list').locator('button[data-ref="1:1"][data-invalid="1"]').first()).toBeVisible();
          const kept = decisions(repo, tool);
          expect(kept).toHaveLength(1);
          expect(kept[0].contextId.reference).toEqual({ story: 1, frame: 1 });
          expect(kept[0].selections).toHaveLength(1);
          await page.getByRole('button', { name: '← All checking tools' }).click();
        });
      }

      await test.step('Community Checking renders the story: title, frame 1 with its picture, the undrafted frames stated', async () => {
        await page.getByTestId('open-community-checking').click();
        const story = page.getByTestId('cc-story');
        await expect(story).toBeVisible();
        await expect(story.getByTestId('cc-frame-1')).toContainText(FRAME_1_EDITED);
        await expect(story.getByTestId('cc-picture-1')).toBeVisible();
        await expect(story.getByTestId('cc-frame-2')).toContainText('[ frame not yet drafted ]');
        await page.getByTestId('cc-pictures').click();
        await expect(story).toHaveAttribute('data-pictures', '0');
        await expect(story.getByTestId('cc-picture-1')).toHaveCount(0);
      });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
