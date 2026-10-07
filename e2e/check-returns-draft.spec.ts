// Issue #532 — a check shows a verse's new draft when the user returns to it (J4, J22).
// The Translate / Check switch leaves the tool open. A verse (or an OBS frame) that was
// empty when the tool opened, then drafted in Translate, must show its new text under
// "Your translation" on the return. A verse that is still empty still says so. Opening
// another book in Translate closes the open check, as opening another story does.
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { SEEDED_PROJECT, pinForSideloaded, readIngredient, resetPlaces, resetSeededChecking, writePlace, writeProjectPins } from './helpers/rig';
import { createObsProject, newSegments, segmentFiles } from './helpers/story';

const TOOL = 'translationNotes';
// Titus 2 is all stubs ("___") in the seeded fixture: 2:1 is drafted here, 2:2 stays empty.
const VERSE_TEXT = 'Pero tú habla lo que está de acuerdo con la sana doctrina.';
const FRAME_1 = 'Así fue como Dios hizo todo en el principio. Creó el universo y todo lo que hay en él en seis días.';
const FRAME_2 = 'La tierra estaba oscura y vacía, y no había nada formado en ella.';

/** The run's artifact: what "Your translation" showed for each item, before and after. */
type Seen = { project: 'bible' | 'stories'; ref: string; when: 'before' | 'after'; drafted: string | null; text: string };
async function look(page: Page, seen: Seen[], project: Seen['project'], ref: string, when: Seen['when']) {
  await page.getByTestId('check-list').locator(`button[data-ref="${ref}"]`).first().click();
  const target = page.getByTestId('check-target');
  seen.push({ project, ref, when, drafted: await target.getAttribute('data-drafted'), text: ((await target.textContent()) ?? '').trim() });
  return target;
}
async function attachSeen(seen: Seen[]) {
  await test.info().attach('check-returns-draft.json', { body: `${JSON.stringify(seen, null, 2)}\n`, contentType: 'application/json' });
}

async function openTool(page: Page) {
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId(`preflight-${TOOL}`)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByTestId(`open-${TOOL}`).click();
  await expect(page.getByTestId('check-list')).toBeVisible({ timeout: 30_000 });
}

/** Both refs must carry an item, or the journey proves nothing about them. */
async function expectItems(page: Page, refs: string[]) {
  for (const ref of refs)
    await expect(page.getByTestId('check-list').locator(`button[data-ref="${ref}"]`), `the ${TOOL} list should carry an item at ${ref}`).not.toHaveCount(0);
}

test.beforeEach(() => {
  resetSeededChecking();
  resetPlaces();
});

test.describe('#532 — the check reads the draft made while the tool stayed open', () => {
  test(
    'a Bible verse drafted in Translate shows under Your translation on the return to Check; a still-empty verse still says it is not drafted; opening another book closes the check',
    { tag: ['@inc9', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, { tn: pinForSideloaded('en_tn', 'v91'), tw: pinForSideloaded('en_tw', 'v91'), ta: pinForSideloaded('en_ta', 'v91') });
      writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 2 });
      const seen: Seen[] = [];

      await test.step('open Titus and the tool while 2:1 and 2:2 are empty', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
        await openTool(page);
        await expectItems(page, ['2:1', '2:2']);
        await expect(await look(page, seen, 'bible', '2:1', 'before')).toHaveAttribute('data-drafted', '0');
      });

      await test.step('switch to Translate and draft 2:1 (the tool stays open)', async () => {
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        await page.getByRole('button', { name: '2', exact: true }).click();
        await page.getByRole('tab', { name: 'Verse', exact: true }).click();
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
        const editor = page.getByRole('textbox', { name: 'Verse 1' });
        await editor.fill(VERSE_TEXT);
        await editor.blur();
        await expect.poll(() => readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm').toString('utf8'), { timeout: 10_000 }).toContain(VERSE_TEXT);
      });

      await test.step('switch back to Check: 2:1 shows the new text, 2:2 still says not drafted', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await expect(page.getByTestId('check-list')).toBeVisible();
        const drafted = await look(page, seen, 'bible', '2:1', 'after');
        await expect(drafted).toHaveAttribute('data-drafted', '1');
        // One button per word (#571), so the line's text has no spaces.
        await expect(drafted.locator('[data-testid^="tw-"]')).toContainText(['sana', 'doctrina']);
        const empty = await look(page, seen, 'bible', '2:2', 'after');
        await expect(empty).toHaveAttribute('data-drafted', '0');
        await expect(empty).toHaveText('This verse is not drafted yet. Draft it first, then return to check.');
      });

      await test.step('open Jonah in Translate: the Titus check closes, so Check shows the tool picker', async () => {
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        await page.getByRole('button', { name: /^Jonah/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await expect(page.getByTestId(`open-${TOOL}`)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('check-list')).toHaveCount(0);
        seen.push({ project: 'bible', ref: 'JON', when: 'after', drafted: null, text: 'tool picker shown; no check session' });
      });
      await attachSeen(seen);
    },
  );

  test(
    'an OBS frame drafted in Translate shows under Your translation on the return to Check; a still-empty frame still says it is not drafted',
    { tag: ['@inc9', '@J22'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      // Frame 1 drafted so the story opens drafted; frames 2 and 3 are empty.
      const repo = await createObsProject('c532', 'Equipo Rig — #532', (store) => store.writeFrame(1, 1, FRAME_1));
      const seen: Seen[] = [];

      await test.step('open story 1 and the tool while frames 2 and 3 are empty', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
        await page.getByRole('tab', { name: 'Translate', exact: true }).click(); // a new story opens in Understand (D87)
        await expect(page.getByTestId('story-draft')).toBeVisible({ timeout: 60_000 });
        await openTool(page);
        await expectItems(page, ['1:2', '1:3']);
        await expect(await look(page, seen, 'stories', '1:2', 'before')).toHaveAttribute('data-drafted', '0');
      });

      await test.step('switch to Translate and draft frame 2 (the tool stays open)', async () => {
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        const before = new Set(segmentFiles(repo));
        await page.getByTestId('story-frame-2').getByRole('button', { name: 'Draft frame 2' }).click();
        const box = page.getByTestId('story-frame-2').getByRole('textbox');
        await box.fill(FRAME_2);
        await box.blur();
        await expect.poll(() => newSegments(repo, before), { timeout: 15_000 }).toHaveLength(1);
      });

      await test.step('switch back to Check: frame 2 shows the new text, frame 3 still says not drafted', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await expect(page.getByTestId('check-list')).toBeVisible();
        const drafted = await look(page, seen, 'stories', '1:2', 'after');
        await expect(drafted).toHaveAttribute('data-drafted', '1');
        await expect(drafted).toContainText('oscura');
        const empty = await look(page, seen, 'stories', '1:3', 'after');
        await expect(empty).toHaveAttribute('data-drafted', '0');
        await expect(empty).toHaveText('This frame is not drafted yet. Draft it first, then return to check.');
      });
      await attachSeen(seen);
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
