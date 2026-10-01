// Issue #434 — Check uses the OPEN project's pins after a switch between a Bible
// project and an OBS project in one session (J4, J22). The previous project's tool
// verdicts must never open a session in the next project: the resolved resource
// (the check rail's data-resource) belongs to the project that is open.
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { SEEDED_PROJECT, pinForSideloaded, resetPlaces, resetSeededChecking, writeProjectPins } from './helpers/rig';
import { createObsProject } from './helpers/story';
import { EN_HELPS } from '../src/data/installedSuite';

const BIBLE = {
  translationNotes: pinForSideloaded('en_tn', 'v89'),
  translationWords: pinForSideloaded('en_tw', 'v89'),
};
const STORIES = {
  translationNotes: EN_HELPS['obs-tn'],
  translationWords: EN_HELPS['obs-twl'],
};
const TOOLS = ['translationNotes', 'translationWords'] as const;

/** The run's artifact: each session's project kind, tool, and resolved resource. */
type Seen = { project: 'bible' | 'stories'; tool: string; resource: string | null };
async function recordSession(page: Page, seen: Seen[], project: Seen['project'], tool: string) {
  seen.push({ project, tool, resource: await page.getByTestId('check-rail').getAttribute('data-resource') });
}
async function attachSeen(seen: Seen[]) {
  await test.info().attach('check-project-switch.json', { body: `${JSON.stringify(seen, null, 2)}\n`, contentType: 'application/json' });
}

/** From the Check picker: open one tool and prove the session resolved `repoPath`. */
async function openToolExpecting(page: Page, tool: string, repoPath: string, seen: Seen[], project: Seen['project']) {
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId(`preflight-${tool}`)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByTestId(`open-${tool}`).click();
  await expect(page.getByTestId('check-rail')).toHaveAttribute('data-resource', repoPath, { timeout: 30_000 });
  await expect(page.getByTestId('check-empty')).toHaveCount(0);
  await expect(page.getByTestId('check-list').getByRole('button').first()).toBeVisible();
  await recordSession(page, seen, project, tool);
  await page.getByRole('button', { name: '← All checking tools' }).click();
}

/** Check both tools, then leave through Translate so the Home tile reopens in Translate. */
async function checkBothTools(page: Page, pins: Record<string, { repoPath: string }>, seen: Seen[], project: Seen['project']) {
  for (const tool of TOOLS) await openToolExpecting(page, tool, pins[tool].repoPath, seen, project);
  await page.getByRole('tab', { name: 'Translate', exact: true }).click();
  await page.getByTitle('Switch project').click();
}

async function openTitus(page: Page) {
  await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByRole('tab', { name: 'Check', exact: true })).toBeVisible({ timeout: 60_000 });
}

/** `screen`: a first open has no place, so Understand (D87); a later one has the
 * Translate place that checkBothTools leaves (#329). */
async function openStory(page: Page, repo: string, screen: 'story-understand' | 'story-draft') {
  await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
  await expect(page.getByTestId(screen)).toBeVisible({ timeout: 60_000 });
}

test.beforeEach(() => {
  resetSeededChecking();
  resetPlaces();
});

test(
  'Check resolves the open project\'s own pins after a switch: stories → Bible → stories in one session (#434)',
  { tag: ['@J4', '@J22', '@434'] },
  async ({ page }) => {
    test.setTimeout(300_000);
    writeProjectPins(SEEDED_PROJECT, { tn: BIBLE.translationNotes, tw: BIBLE.translationWords, ta: pinForSideloaded('en_ta', 'v89') });
    const stories = await createObsProject('j434', 'Equipo Rig — 434');
    const seen: Seen[] = [];
    await page.goto('/');

    await test.step('stories project: tN and tW resolve en_obs-tn and en_obs-twl', async () => {
      await openStory(page, stories, 'story-understand');
      await checkBothTools(page, STORIES, seen, 'stories');
    });

    await test.step('then the Bible project: tN and tW resolve en_tn and en_tw', async () => {
      await openTitus(page);
      await checkBothTools(page, BIBLE, seen, 'bible');
    });

    await test.step('then the stories project again: tN and tW resolve en_obs-tn and en_obs-twl', async () => {
      await openStory(page, stories, 'story-draft');
      await checkBothTools(page, STORIES, seen, 'stories');
    });
    await attachSeen(seen);
  },
);

/** A Home tile whose last place is a Check tool reopens that tool (#329 Resume):
 * the reopened session must resolve `repoPath`, then Switch project from inside it. */
async function expectResumedTool(page: Page, repoPath: string, seen: Seen[], project: Seen['project']) {
  await expect(page.getByTestId('check-rail')).toHaveAttribute('data-resource', repoPath, { timeout: 60_000 });
  await expect(page.getByTestId('check-empty')).toHaveCount(0);
  await expect(page.getByTestId('check-list').getByRole('button').first()).toBeVisible();
  await recordSession(page, seen, project, 'translationNotes');
  await page.getByTitle('Switch project').click();
}

test(
  'a Home tile that resumes into Check opens the tool with the open project\'s own pin after a switch: Bible ↔ stories (#434)',
  { tag: ['@J4', '@J22', '@J8', '@434'] },
  async ({ page }) => {
    test.setTimeout(300_000);
    writeProjectPins(SEEDED_PROJECT, { tn: BIBLE.translationNotes, tw: BIBLE.translationWords, ta: pinForSideloaded('en_ta', 'v89') });
    const stories = await createObsProject('j434r', 'Equipo Rig — 434 resume');
    const seen: Seen[] = [];
    await page.goto('/');

    await test.step('precondition: each project was left inside its translationNotes session', async () => {
      await openTitus(page);
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      await page.getByTestId('open-translationNotes').click();
      await expectResumedTool(page, BIBLE.translationNotes.repoPath, seen, 'bible');
      await openStory(page, stories, 'story-understand');
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      await page.getByTestId('open-translationNotes').click();
      await expectResumedTool(page, STORIES.translationNotes.repoPath, seen, 'stories');
    });

    await test.step('stories → Bible: the Titus tile resumes translationNotes on en_tn', async () => {
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await expectResumedTool(page, BIBLE.translationNotes.repoPath, seen, 'bible');
    });

    await test.step('Bible → stories: the story tile resumes translationNotes on en_obs-tn', async () => {
      await page.getByTestId(`project-_local_/_local_/${stories}`).getByTestId('story-tile-1').click();
      await expectResumedTool(page, STORIES.translationNotes.repoPath, seen, 'stories');
    });
    await attachSeen(seen);
  },
);

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
