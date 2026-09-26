// J21 — a translator translates a story frame by frame (docs/JOURNEYS.md J21, D74;
// issue #289, proof #292). End state on disk: the story file differs from before only
// inside the written paragraph, the `# N.` line, or the closing `_…_` line; one
// `text.frame.set` or `text.story.ref.set` segment per save; one paragraph per frame.
import { test, expect } from './helpers/test';
import { parseStory } from '../journal/story.mjs';
import { verifyAllJournaledProjects } from './helpers/journal';
import {
  createObsProject,
  newSegments,
  outsideFrameViolation,
  outsideRefViolation,
  outsideTitleViolation,
  segmentFiles,
  storyBytes,
} from './helpers/story';

const FRAME_1 = 'Así fue como Dios hizo todo en el principio. Creó el universo y todo lo que hay en él en seis días.';
const TITLE = 'La creación';
const REF = 'Una historia bíblica de Génesis 1-2';

test.describe('J21 — a translator translates a story frame by frame', () => {
  test(
    'the gateway frame and its picture show beside the field; a frame, the title and the reference line each save as one segment and touch only their own bytes',
    { tag: ['@inc7', '@J21', '@j21'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      const repo = await createObsProject('j21', 'Equipo Rig — J21');

      await test.step('open the project: story 1, the gateway text and the picture of frame 1, the field empty', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('story-source-notice')).toHaveCount(0);
        await expect(page.getByTestId('story-image-note')).toHaveCount(0);
        const frame = page.getByTestId('story-frame-1');
        await expect(frame).toContainText('This is how God made everything in the beginning.');
        await expect(frame.getByRole('img')).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Draft frame 1' })).toBeVisible();
      });

      const saveOne = async (act: () => Promise<void>) => {
        const before = new Set(segmentFiles(repo));
        await act();
        await expect.poll(() => newSegments(repo, before), { timeout: 15_000 }).toHaveLength(1);
        const [events] = newSegments(repo, before);
        expect(events).toHaveLength(1);
        return events[0];
      };

      await test.step('write frame 1: one text.frame.set segment; only the frame-1 paragraph bytes change', async () => {
        const before = storyBytes(repo, 1);
        const event = await saveOne(async () => {
          await page.getByTestId('story-frame-1').getByRole('button', { name: 'Draft frame 1' }).click();
          const box = page.getByTestId('story-frame-1').getByRole('textbox');
          await box.fill(FRAME_1);
          await box.blur();
        });
        expect(event).toMatchObject({ op: 'text.frame.set', story: 1, frame: 1, text: FRAME_1 });
        const after = storyBytes(repo, 1);
        expect(outsideFrameViolation(before, after, 1)).toBeNull();
        const story = parseStory(after);
        expect(story.frames[0].text).toBe(FRAME_1);
        expect(story.frames.slice(1).every((f) => f.text === '')).toBe(true);
        await expect(page.getByTestId('frame-marker-1')).toHaveAttribute('data-drafted', 'true');
        await expect(page.getByTestId('frame-marker-2')).toHaveAttribute('data-drafted', 'false');
      });

      await test.step('write the title: one text.frame.set segment for frame 0; only the first line changes', async () => {
        const before = storyBytes(repo, 1);
        const event = await saveOne(async () => {
          await page.getByTestId('story-title').getByRole('button', { name: 'Draft the title' }).click();
          const box = page.getByTestId('story-title').getByRole('textbox');
          await box.fill(TITLE);
          await box.blur();
        });
        expect(event).toMatchObject({ op: 'text.frame.set', story: 1, frame: 0, text: TITLE });
        const after = storyBytes(repo, 1);
        expect(outsideTitleViolation(before, after)).toBeNull();
        expect(after.split('\n')[0]).toBe(`# 1. ${TITLE}`);
      });

      await test.step('write the reference line: one text.story.ref.set segment; only the closing line changes', async () => {
        const before = storyBytes(repo, 1);
        const event = await saveOne(async () => {
          await page.getByTestId('story-ref').getByRole('button', { name: 'Draft the reference' }).click();
          const box = page.getByTestId('story-ref').getByRole('textbox');
          await box.fill(REF);
          await box.blur();
        });
        expect(event).toMatchObject({ op: 'text.story.ref.set', story: 1, text: REF });
        const after = storyBytes(repo, 1);
        expect(outsideRefViolation(before, after)).toBeNull();
        expect(parseStory(after).ref).toBe(REF);
      });

      await test.step('reopen: the three writes are what the story shows, and the other stories are untouched', async () => {
        await page.reload();
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('story-frame-1').getByTestId('story-unit-text')).toHaveText(FRAME_1);
        await expect(page.getByTestId('story-title').getByTestId('story-unit-text')).toHaveText(TITLE);
        await expect(page.getByTestId('story-ref').getByTestId('story-unit-text')).toHaveText(REF);
        const two = parseStory(storyBytes(repo, 2));
        expect(two.title).toBe('');
        expect(two.ref).toBeNull();
        expect(two.frames.every((f) => f.text === '')).toBe(true);
      });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
