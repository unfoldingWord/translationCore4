// J21 — a translator translates a story frame by frame (docs/JOURNEYS.md J21, D74;
// issue #289, proof #292). End state on disk: the story file differs from before only
// inside the written paragraph, the `# N.` line, or the closing `_…_` line; one
// `text.frame.set` or `text.story.ref.set` segment per save; one paragraph per frame.
// #573 (D94): a frame save keeps every Stories-rail row; the rows before and after
// each save go into the artifact `story-rail.txt`.
import fs from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { test, expect } from './helpers/test';
import { parseStory, storyIpath } from '../journal/story.mjs';
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
const FRAME_2 = 'Dios dijo: «¡Que haya luz!». Y hubo luz.';
const TITLE = 'La creación';
const REF = 'Una historia bíblica de Génesis 1-2';

/** The two cells of one Stories-rail row: its name and its percentage. */
const railCells = (page: Page, story: number) => page.getByTestId('story-rail').getByTestId(`story-${story}`).locator(':scope > :first-child > *');
/** The row as the user reads it: "2 · <title> 0%". With no cached progress it is "Story 2" alone. */
const railRow = async (page: Page, story: number) => (await railCells(page, story).allTextContents()).join(' ').trim();
/** The percentage of a story with `drafted` of `frames` frames drafted: rounded, and at least 1% (D74). */
const storyPct = (drafted: number, frames: number) => `${Math.max(1, Math.round((drafted / frames) * 100))}%`;

test.describe('J21 — a translator translates a story frame by frame', () => {
  test(
    'the gateway frame and its picture show beside the field; a frame, the title and the reference line each save as one segment and touch only their own bytes',
    { tag: ['@inc7', '@J21', '@j21'] },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const repo = await createObsProject('j21', 'Equipo Rig — J21');
      const rail: string[] = [];
      let story2Before = '';

      await test.step('open the project: story 1 opens in Understand (D87)', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await expect(page.getByRole('tab', { name: 'Understand', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
        await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('heading', { name: 'Story 1', exact: true })).toBeVisible();
      });

      await test.step('Translate: story 1, the gateway text and the picture of frame 1, the field empty', async () => {
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('story-source-notice')).toHaveCount(0);
        await expect(page.getByTestId('story-image-note')).toHaveCount(0);
        const frame = page.getByTestId('story-frame-1');
        await expect(frame).toContainText('This is how God made everything in the beginning.');
        await expect(frame.getByRole('img')).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Draft frame 1' })).toBeVisible();
        // #573: before any save, the rail row of another story has its number, title and percentage.
        await expect(railCells(page, 2).first()).toHaveText(/^2 · \S/);
        await expect(railCells(page, 2).last()).toHaveText('0%');
        await expect(railCells(page, 1).last()).toHaveText('0%');
        story2Before = await railRow(page, 2);
        rail.push(`before a save: ${await railRow(page, 1)} | ${story2Before}`);
        // Every text that row shows from here on: a row that goes to "Story 2" and comes back is seen.
        await page.evaluate(() => {
          const row = () => document.querySelector('[data-testid="story-rail"] [data-testid="story-2"]')?.textContent ?? '(no row)';
          const seen = new Set([row()]);
          Object.assign(window, { __story2Texts: seen });
          new MutationObserver(() => seen.add(row())).observe(document.querySelector('[data-testid="story-rail"]')!, { subtree: true, childList: true, characterData: true });
        });
      });

      /** #573: after a frame save, story 1's row counts the drafted frames and story 2's row is as before. */
      const expectRailAfter = async (label: string, drafted: number) => {
        const frames = parseStory(storyBytes(repo, 1)).frames.length;
        await expect(railCells(page, 1).last()).toHaveText(storyPct(drafted, frames), { timeout: 15_000 });
        expect(await railRow(page, 2)).toBe(story2Before);
        rail.push(`${label}: ${await railRow(page, 1)} | ${await railRow(page, 2)}`);
      };

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
        await expectRailAfter('after frame 1, saved by a click outside', 1);
      });

      await test.step('write frame 2 with the Save button: the rail rows stay, and story 1 counts both frames (#573)', async () => {
        const event = await saveOne(async () => {
          await page.getByTestId('story-frame-2').getByRole('button', { name: 'Draft frame 2' }).click();
          await page.getByTestId('story-frame-2').getByRole('textbox').fill(FRAME_2);
          await page.getByTestId('story-unit-editor').getByRole('button', { name: 'Save', exact: true }).click();
        });
        expect(event).toMatchObject({ op: 'text.frame.set', story: 1, frame: 2, text: FRAME_2 });
        await expectRailAfter('after frame 2, saved by the Save button', 2);
        // The row of story 2 showed one text through both saves.
        const seen = await page.evaluate(() => [...(window as unknown as { __story2Texts: Set<string> }).__story2Texts]);
        expect(seen).toHaveLength(1);
        const textPath = testInfo.outputPath('story-rail.txt');
        fs.writeFileSync(textPath, [...rail, `texts the row of story 2 showed: ${seen.length}`].join('\n') + '\n');
        await testInfo.attach('story-rail.txt', { path: textPath, contentType: 'text/plain' });
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
        // #573: with another story open, the row of story 1 shows the drafted title, not the gateway's.
        await page.getByTestId('story-rail').getByTestId('story-2').click();
        await expect(page.getByTestId('story-rail').getByTestId('story-2')).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
        await expect(railCells(page, 1).first()).toHaveText(`1 · ${TITLE}`, { timeout: 15_000 });
        await page.getByTestId('story-rail').getByTestId('story-1').click();
        await expect(page.getByTestId('story-title').getByTestId('story-unit-text')).toHaveText(TITLE, { timeout: 30_000 });
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
        // #329: the tile returns to Translate once its place record is written (debounced);
        // with no record yet, Understand (D87).
        const translate = page.getByRole('tab', { name: 'Translate', exact: true });
        await expect(translate).toBeVisible({ timeout: 60_000 });
        if ((await translate.getAttribute('aria-selected')) !== 'true') await translate.click();
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

  test(
    'a frame save keeps the Stories rail when the progress re-read fails, when a newer save overtakes it, and when the user opens another project during it (#573)',
    { tag: ['@inc9', '@J21', '@j21'] },
    async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const repo = await createObsProject('j21r', 'Equipo Rig — J21 rail');
      const other = await createObsProject('j21o', 'Equipo Rig — J21 other');
      const frames = parseStory(storyBytes(repo, 1)).frames.length;
      const lines: string[] = [];
      /** The app's read of one story file of `repo`: the progress re-read reads all fifty, in order. */
      const storyRead = (story: number) => (url: URL) =>
        url.pathname.includes('/burrito/ingredient/raw/') && url.pathname.endsWith(`/${repo}`) && url.searchParams.get('ipath') === storyIpath(story);
      /** Hold the next read of story 50 — the end of a re-read — until `release`. */
      const holdReread = async () => {
        let open = () => {};
        const gate = new Promise<void>((resolve) => { open = resolve; });
        let reached = (_request: Request) => {};
        const held = new Promise<Request>((resolve) => { reached = resolve; });
        let first = true;
        const match = storyRead(50);
        await page.route(match, async (route) => {
          if (!first) return route.fallback();
          first = false;
          reached(route.request());
          await gate;
          return route.fallback();
        });
        return {
          held,
          release: async () => {
            open();
            await (await held).response();
            await page.unroute(match);
            await settle();
          },
        };
      };
      /** The page's turn after a response: a re-read that ends writes its rows, or drops them, here. */
      const settle = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      const draft = async (frame: number) => {
        const before = new Set(segmentFiles(repo));
        await page.getByTestId(`story-frame-${frame}`).getByRole('button', { name: `Draft frame ${frame}` }).click();
        const box = page.getByTestId(`story-frame-${frame}`).getByRole('textbox');
        await box.fill(`Texto del cuadro ${frame}.`);
        await box.blur();
        await expect.poll(() => newSegments(repo, before), { timeout: 15_000 }).toHaveLength(1);
      };
      const record = async (label: string) => lines.push(`${label}: ${await railRow(page, 1)} | ${await railRow(page, 2)}`);

      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
      await expect(railCells(page, 2).first()).toHaveText(/^2 · \S/);
      await expect(railCells(page, 2).last()).toHaveText('0%');
      const story2 = await railRow(page, 2);
      await record('before a save');

      await test.step('the re-read fails: every row keeps its last known title and percentage, and the next save reads again', async () => {
        const failing = storyRead(2);
        await page.route(failing, (route) => route.fulfill({ status: 500, body: '{"is_good":false,"reason":"injected by #573"}' }));
        // The end of this re-read: the read of story 50 that follows the failed read of story 2.
        let failed = false;
        const end = page.waitForResponse((response) => {
          const url = new URL(response.url());
          if (failing(url)) failed = true;
          return failed && storyRead(50)(url);
        });
        await draft(1);
        await end;
        await settle();
        expect(await railRow(page, 2)).toBe(story2);
        await expect(railCells(page, 1).last()).toHaveText('0%');
        await record('after frame 1, the re-read failed');
        await page.unroute(failing);
        await draft(2);
        await expect(railCells(page, 1).last()).toHaveText(storyPct(2, frames), { timeout: 15_000 });
        expect(await railRow(page, 2)).toBe(story2);
        await record('after frame 2, the re-read answered');
      });

      await test.step('a second save while a re-read is pending: the newer re-read wins', async () => {
        const hold = await holdReread();
        await draft(3);
        await hold.held; // the first re-read has read story 1 with three frames, and waits
        await draft(4);
        await expect(railCells(page, 1).last()).toHaveText(storyPct(4, frames), { timeout: 15_000 });
        await hold.release(); // the first re-read ends after the second
        await expect(railCells(page, 1).last()).toHaveText(storyPct(4, frames));
        expect(await railRow(page, 2)).toBe(story2);
        await record('after frames 3 and 4, the older re-read ended last');
      });

      await test.step('the user opens another project during a re-read: its rail shows its own rows, and Home shows the new percentage', async () => {
        const hold = await holdReread();
        await draft(5);
        await hold.held;
        await page.getByTitle('Switch project').click();
        await page.getByTestId(`project-_local_/_local_/${other}`).getByTestId('story-tile-1').click();
        await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 60_000 });
        await expect(railCells(page, 1).last()).toHaveText('0%');
        await hold.release();
        await expect(railCells(page, 1).last()).toHaveText('0%');
        await record('in the other project, after the re-read of the first ended');
        await page.getByTitle('Switch project').click();
        const tile = page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1');
        await expect(tile).toContainText(storyPct(5, frames), { timeout: 30_000 });
        lines.push(`Home tile of the first project, after frame 5: ${storyPct(5, frames)}`);
      });

      const textPath = testInfo.outputPath('story-rail-interruptions.txt');
      fs.writeFileSync(textPath, lines.join('\n') + '\n');
      await testInfo.attach('story-rail-interruptions.txt', { path: textPath, contentType: 'text/plain' });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
