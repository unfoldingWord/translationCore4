// J16 — Read a passage with helps and record a user comment
// docs/JOURNEYS.md J16 · built in Increment 4 (#104); proof in Increment 5 (#197)

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
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
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
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

test.describe('J16 — read a passage with helps and record a user comment', () => {
  test(
    'read a passage with helps and record a user comment',
    { tag: ['@inc5', '@J16'] },
    async ({ page }) => {
      test.setTimeout(180_000);

      await verifyAllJournaledProjects();
      resetSeededChecking();
      writeProjectPins(SEEDED_PROJECT, PINS());

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
        .poll(() => lastCommitMessage(SEEDED_PROJECT), { timeout: 30_000 })
        .toMatch(/^Checkpoint, leaving Translate: /);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      const sourceNameBefore = await page.getByTestId('understand-source-name').textContent();
      await page.getByTestId('source-tab-ust').click();
      await expect(page.getByTestId('understand-source-name')).toBeVisible();
      await expect(page.getByTestId('understand-source-name')).not.toHaveText(sourceNameBefore ?? '');

      await page.getByRole('tab', { name: 'Notes', exact: true }).click();
      await page.getByTestId('note-expand').first().click();
      await expect(page.getByTestId('note-expand').first()).toHaveAttribute('aria-expanded', 'true');

      await page.getByRole('tab', { name: 'Academy', exact: true }).click();
      await page.getByTestId('academy-article').first().click();
      await expect(page.getByTestId('understand-article')).toBeVisible({ timeout: 30_000 });

      const segmentsBefore = new Set(segmentFiles());
      const comment = 'Pablo le dice a Tito qué enseñar (J16).';
      const textbox = page.getByTestId('understand-unit-v1').getByRole('textbox');
      await textbox.fill(comment);
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
            fs.readFileSync(path.join(TC4_ROOT, 'sample-burrito', 'ingredients', name)),
          ),
        ).toBe(true);
      }

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
      await expect(page.getByText(/an apostle of Jesus Christ/).first()).toBeVisible({ timeout: 120_000 });
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
