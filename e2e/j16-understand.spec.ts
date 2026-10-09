// J16 — Read a passage with helps and record a user comment
// docs/JOURNEYS.md J16 · built in Increment 4 (#104); proof in Increment 5 (#197)

import { test, expect } from './helpers/test';
import type { Page, Route, TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
import { proveHelpsDragAndToggle, proveHelpsToolbar } from './helpers/helps';
import {
  SEEDED_PROJECT,
  TC4_ROOT,
  commitCount,
  lastCommitMessage,
  pinForSideloaded,
  readIngredient,
  resetSeededChecking,
  rigRepo,
  writeProjectPins,
  resetPlaces,
  writePlace,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
});

/** The seeded project's journal segment files (every actor), newest last. */
function segmentFiles(): string[] {
  const journal = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal');
  if (!fs.existsSync(journal)) return [];
  return fs
    .readdirSync(journal)
    .flatMap((actor) => {
      const dir = path.join(journal, actor, 'segments');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).map((f) => path.join(dir, f)) : [];
    })
    .sort();
}

/** The events of one segment file (the §8.1 container: `body` is the JSON text of `{ events }`). */
function readSegmentEvents(file: string): Array<{ op: string; chapter?: string; verse?: string; text?: string }> {
  const container = JSON.parse(fs.readFileSync(file, 'utf8')) as { body: string };
  return (JSON.parse(container.body) as { events: Array<{ op: string; chapter?: string; verse?: string; text?: string }> }).events;
}

/** #599: where the mode switch, the project button and the save status sit in the top bar. */
async function topBar(page: Page) {
  const box = async (testId: string) => {
    const b = await page.getByTestId(testId).boundingBox();
    if (!b) throw new Error(`${testId} is not on the page`);
    return { left: b.x, right: b.x + b.width, width: b.width };
  };
  const indicator = page.getByTestId('save-indicator');
  return {
    window: page.viewportSize()!.width,
    state: await indicator.getAttribute('data-state'),
    status: (await indicator.textContent()) ?? '',
    switch: await box('mode-switch'),
    project: await box('project-switch'),
    indicator: await box('save-indicator'),
  };
}

/** #601: scroll the open helps article to its end, record where the title and the
 * close button sit in the article pane, then close the article from there. */
async function scrolledArticle(page: Page, testInfo: TestInfo, name: string) {
  const article = page.getByTestId('understand-article');
  await article.locator('p').last().evaluate((p) => p.scrollIntoView({ block: 'end' }));
  const box = async (testId: string) => {
    const b = await page.getByTestId(testId).boundingBox();
    if (!b) throw new Error(`${testId} is not on the page`);
    return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width };
  };
  const first = await article.locator('p').first().boundingBox();
  const last = await article.locator('p').last().boundingBox();
  const seen = {
    title: (await page.getByTestId('helps-article-title').textContent()) ?? '',
    pane: await box('helps-article-pane'),
    titleBox: await box('helps-article-title'),
    close: await box('helps-article-close'),
    firstParagraphTop: first!.y,
    lastParagraphBottom: last!.y + last!.height,
  };
  const panel = (await page.getByTestId('helps-panel').boundingBox())!;
  const shot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: shot, animations: 'disabled', clip: panel });
  await testInfo.attach(name, { path: shot, contentType: 'image/png' });
  // A click at the recorded place: a click on the locator would scroll the button
  // into view first, and so would pass with the button out of view.
  await page.mouse.click((seen.close.left + seen.close.right) / 2, (seen.close.top + seen.close.bottom) / 2);
  const closed = await expect(article).toHaveCount(0).then(() => true, () => false);
  return { ...seen, closed };
}

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
});

test.describe('J16 — read a passage with helps and record a user comment', () => {
  test(
    'read a passage with helps and record a user comment',
    { tag: ['@inc5', '@J16'] },
    async ({ page }, testInfo) => {
      test.setTimeout(180_000);

      await verifyAllJournaledProjects();
      resetSeededChecking();
      writeProjectPins(SEEDED_PROJECT, PINS());
      // The switch to Understand below is the checkpoint that commits these pins. With
      // no place a tile opens in Understand (D87), so the open starts from a Translate place.
      writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 1 });
      // #615: the reset keeps git history, so an earlier journey's checkpoint can be HEAD.
      const commitsAtStart = commitCount(SEEDED_PROJECT);

      await page.goto('/');
      await page
        .getByTestId('project-_local_/_local_/sample_burrito')
        .getByRole('button', { name: /Titus/ })
        .click();
      await expect(page.getByText(/an apostle of Jesus Christ/).first()).toBeVisible({ timeout: 120_000 });
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByRole('tab', { name: 'Understand', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await expect(page.getByTestId('helps-loading')).toHaveCount(0);
      await expect
        .poll(() => (commitCount(SEEDED_PROJECT) > commitsAtStart ? lastCommitMessage(SEEDED_PROJECT) : ''), {
          timeout: 30_000,
        })
        .toMatch(/^Checkpoint, leaving Translate: /);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      const sourceNameBefore = await page.getByTestId('understand-source-name').textContent();
      await page.getByTestId('source-tab-ust').click();
      await expect(page.getByTestId('understand-source-name')).toBeVisible();
      await expect(page.getByTestId('understand-source-name')).not.toHaveText(sourceNameBefore ?? '');

      // #602: Understand has the same show/hide button and divider as Translate (J2).
      await test.step('the toolbar has one show/hide button and no widen button', async () => {
        await proveHelpsToolbar(page, testInfo, 'understand');
      });
      await test.step('a drag of the divider widens the panel; hide and show keep the width', async () => {
        await proveHelpsDragAndToggle(page, testInfo, 'understand');
      });

      await page.getByRole('tab', { name: 'Notes', exact: true }).click();
      await page.getByTestId('note-expand').first().click();
      await expect(page.getByTestId('note-expand').first()).toHaveAttribute('aria-expanded', 'true');

      await page.getByRole('button', { name: 'Translation Academy →', exact: true }).first().click();
      await expect(page.getByTestId('understand-article')).toBeVisible({ timeout: 30_000 });

      // #601: the title and the close button of a scrolled article stay in the pane,
      // for a Translation Academy article and for a Translation Words article.
      const academy = await scrolledArticle(page, testInfo, 'helps-article-academy-scrolled');
      await page.getByRole('tab', { name: 'Words', exact: true }).click();
      await page.getByRole('button', { name: 'Read the article →', exact: true }).first().click();
      await expect(page.getByTestId('understand-article')).toBeVisible({ timeout: 30_000 });
      const words = await scrolledArticle(page, testInfo, 'helps-article-words-scrolled');
      const articles = testInfo.outputPath('helps-article-scrolled.json');
      fs.writeFileSync(articles, `${JSON.stringify({ academy, words }, null, 2)}\n`);
      await testInfo.attach('helps-article-scrolled', { path: articles, contentType: 'application/json' });
      for (const seen of [academy, words]) {
        expect(seen.title).not.toBe('');
        // The article is scrolled: its start is above the pane and its end is inside it.
        expect(seen.firstParagraphTop).toBeLessThan(seen.pane.top);
        expect(seen.lastParagraphBottom).toBeLessThanOrEqual(seen.pane.bottom + 1);
        for (const part of [seen.titleBox, seen.close]) {
          expect(part.top).toBeGreaterThanOrEqual(seen.pane.top);
          expect(part.bottom).toBeLessThanOrEqual(seen.pane.bottom);
          expect(part.left).toBeGreaterThanOrEqual(seen.pane.left);
          expect(part.right).toBeLessThanOrEqual(seen.pane.right);
        }
        expect(seen.closed).toBe(true);
      }

      const segmentsBefore = new Set(segmentFiles());
      const comment = 'Pablo le dice a Tito qué enseñar (J16).';
      const textbox = page.getByTestId('understand-unit-v1').getByRole('textbox');
      // #599: the mode switch stays in the center of the top bar while the save status
      // changes. The comment is unsaved from the first key to the blur.
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      const saved = await topBar(page);
      await textbox.fill(comment);
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'dirty');
      const unsaved = await topBar(page);
      await textbox.blur();

      await expect
        .poll(
          () => {
            const newFiles = segmentFiles().filter((f) => !segmentsBefore.has(f));
            if (newFiles.length !== 1) return null;
            const events = readSegmentEvents(newFiles[0]);
            if (events.length !== 1) return null;
            const ev = events[0] as unknown as {
              op: string;
              target?: { book: string; chapter: string; verse: string };
              text?: string;
            };
            return {
              count: newFiles.length,
              op: ev.op,
              target: ev.target,
              text: ev.text,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({
          count: 1,
          op: 'note.add',
          target: { book: 'TIT', chapter: '2', verse: '1' },
          text: comment,
        });

      await expect(page.getByTestId('understand-save-error')).toHaveCount(0);
      expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);

      for (const name of ['TIT.usfm', 'JON.usfm']) {
        expect(
          readIngredient(SEEDED_PROJECT, path.join('ingredients', name)).equals(
            fs.readFileSync(path.join(TC4_ROOT, 'conformance', 'sample-burrito', 'ingredients', name)),
          ),
        ).toBe(true);
      }

      // #599: the longest save status in a 1024-pixel-wide window. The J16 comment above
      // is saved; the write of a second comment (verse 2) is failed once, then retried.
      const secondComment = 'Los ancianos deben ser sobrios (J16, #599).';
      const secondBox = page.getByTestId('understand-unit-v2').getByRole('textbox');
      const failWrites = (route: Route) =>
        route.request().method() === 'GET' ? route.fallback() : route.abort('failed');
      const rigApi = (url: URL) => url.pathname.startsWith('/api/');
      await page.route(rigApi, failWrites);
      await secondBox.fill(secondComment);
      await secondBox.blur();
      await expect(page.getByTestId('retry-note-save')).toBeVisible({ timeout: 10_000 });
      const wide = page.viewportSize()!;
      await page.setViewportSize({ width: 1024, height: wide.height });
      const failed = await topBar(page);
      const shot = testInfo.outputPath('top-bar-1024-save-failed.png');
      await page.screenshot({ path: shot, animations: 'disabled', clip: { x: 0, y: 0, width: 1024, height: 80 } });
      await testInfo.attach('top-bar-1024-save-failed', { path: shot, contentType: 'image/png' });
      await page.setViewportSize(wide);
      const positions = testInfo.outputPath('top-bar.json');
      fs.writeFileSync(positions, `${JSON.stringify({ saved, unsaved, failed }, null, 2)}\n`);
      await testInfo.attach('top-bar', { path: positions, contentType: 'application/json' });

      expect(saved.status).toBe('Saved');
      expect(unsaved.status).toBe('Unsaved changes');
      expect(unsaved.indicator.width).toBeGreaterThan(saved.indicator.width);
      expect(unsaved.switch.left).toBe(saved.switch.left);
      for (const bar of [saved, unsaved, failed]) {
        expect(Math.abs((bar.switch.left + bar.switch.right) / 2 - bar.window / 2)).toBeLessThanOrEqual(1);
      }
      expect(failed.status).toContain('Save failed — retry');
      expect(failed.project.right).toBeLessThanOrEqual(failed.switch.left);
      expect(failed.switch.right).toBeLessThanOrEqual(failed.indicator.left);

      await page.unroute(rigApi, failWrites);
      await page.getByTestId('retry-note-save').click();
      await expect
        .poll(
          () =>
            segmentFiles()
              .filter((f) => !segmentsBefore.has(f))
              .flatMap(readSegmentEvents)
              .map((ev) => `${ev.op} ${ev.text}`),
          { timeout: 10_000 },
        )
        .toEqual([`note.add ${comment}`, `note.add ${secondComment}`]);
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);

      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect
        .poll(() => commitCount(SEEDED_PROJECT), { timeout: 30_000 })
        .toBe(commitsBefore + 1);
      expect(lastCommitMessage(SEEDED_PROJECT)).toMatch(/^Checkpoint, leaving Understand: /);
      await expect(page.getByTestId('retry-checkpoint')).toHaveCount(0);

      await page.reload();
      await page
        .getByTestId('project-_local_/_local_/sample_burrito')
        .getByRole('button', { name: /Titus/ })
        .click();
      // #408: the tile resumes where this client last worked in Titus (#329):
      // Translate or Understand, chapter 2, as the old page's hide save of the place
      // did or did not reach the rig before Home read it (#421). Go to Titus 2 from
      // either place.
      const translate = page.getByRole('tab', { name: 'Translate', exact: true });
      await expect(translate).toBeVisible({ timeout: 120_000 });
      await translate.click();
      await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible({ timeout: 120_000 });
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByRole('tab', { name: 'Understand', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await expect(page.getByTestId('helps-loading')).toHaveCount(0);
      await expect(
        page.getByTestId('understand-unit-v1').getByRole('textbox'),
      ).toHaveValue(comment, { timeout: 30_000 });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
