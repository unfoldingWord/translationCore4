// J8 — Resume work across sessions/books; multi-book navigation
// JOURNEYS-AND-GAPS §2 J8 · PRD FR-29, FR-34 · TEST-PLAN E-J8 · Increment 4
//
// The last test is the Increment 4 journey end to end (#185): open, draft, mark a
// check, leave (a checkpoint commits), reload, resume, share. The share leg is a
// fixme until #120 (runtime server parameter, first-push identity) lands.
//
// Ground truth is the rig's disk: commit counts and messages come from the
// repository, never from UI state (e2e/helpers/rig.ts).
import { test, expect, type Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  commitCount,
  committedIngredient,
  lastCommitMessage,
  listLocalRepos,
  readLastEdit,
  resetLargeFixture,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readDecisionFile,
  resetSeededChecking,
} from './helpers/rig';

// The seeded large fixture (issue #95): Titus with 4000 journaled edits, so its
// open shows the progress indicator (J15) and a resume into it must wait it out.
const LARGE = 'sample_burrito_large';
// Display names from the fixtures' own metadata (conformance/sample-burrito and
// scripts/seed-large-project.mjs), as the Resume card shows them.
const SEEDED_NAME = 'Equipo Ejemplo — Tito y Jonás';
const LARGE_NAME = 'Equipo Ejemplo — Tito (proyecto grande)';

// "Open" means the book text is on screen. The seeded project pins ULT/UST, so its
// source pane carries this phrase; the large fixture's resources.json carries no
// extraScripture, so its own last edit ("(edición N)", as J15 waits for it) is the marker.
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
 * A reload before that write would lose it, so wait for the disk, not a timer.
 * The wait keys on THIS edit's snippet: an earlier journey (J2) drafts in the same
 * project and chapter, and its older record would satisfy a project+chapter match
 * before the new write lands (found in the J2+J8 run, Codex round 1 repair). */
async function waitForResumeRecord(project: string, chapter: number, snippetStart: string) {
  await expect
    .poll(() => {
      const rec = readLastEdit();
      return rec ? `${rec.repoPath}@${rec.chapter}:${(rec.snippet ?? '').slice(0, 24)}` : null;
    }, { timeout: 10_000 })
    .toBe(`_local_/_local_/${project}@${chapter}:${snippetStart.slice(0, 24)}`);
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
      // Journeys share one seed per run, and earlier specs (J2) draft in the seeded
      // project, so a Resume card MAY already stand here. What never stands is a card
      // for the large fixture: no journey before this one edits it (Codex review,
      // round 1). That is the "never edited, no card" criterion, stated as a
      // property that holds in a single-file run and in the full run alike.
      await page.goto('/');
      await expectAllProjectsListed(page);
      await expect(page.getByTestId('resume-card').filter({ hasText: LARGE_NAME })).toHaveCount(0);

      await openTitusAt(page, '2');
      const drafted = 'Porque la gracia de Dios se ha manifestado (reanudar).';
      await draftFirstStub(page, drafted);
      await waitForResumeRecord(SEEDED_PROJECT, 2, drafted);

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
      try {
        await openTitusAt(page, '2', LARGE);
        // Opening and reading a project is not an edit: past the write debounce
        // (1 s, src/state.jsx recordLastEdit), the Resume record still names no
        // large-fixture position (Codex review, round 3).
        await page.waitForTimeout(1500);
        expect(readLastEdit()?.repoPath ?? null).not.toBe(`_local_/_local_/${LARGE}`);

        const drafted = 'Enseña a los ancianos a ser sobrios (proyecto grande, reanudar).';
        await draftFirstStub(page, drafted);
        await waitForResumeRecord(LARGE, 2, drafted);

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
      } finally {
        // Leave the shared fixture as this test found it: J15 counts its segments.
        resetLargeFixture();
      }
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

// ---- #185: the Increment 4 journey end to end ----------------------------------

// The English checking suite the rig sideloads (the J4 pattern). The seeded sample's
// Translation Notes decision file records es-419; a decision write against a drifted
// record refuses toward the gateway-change flow (D59 §3), so the record is restated
// as the pin the project now holds before the journey marks a check.
const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});
function pinEnglishAndRestateNotesRecord(): void {
  // Start from the seeded checking surface (the J4 pattern): a pin or decision file
  // hand-written over files the app already journaled in an earlier test disagrees
  // with that journal, and the open refuses (found running J8 as a whole).
  resetSeededChecking();
  writeProjectPins(SEEDED_PROJECT, PINS());
  const en = PINS();
  const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
  if (!file) return;
  (file as { resource?: unknown }).resource = { repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'primary' };
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationNotes', 'TIT.json');
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}
type Decision = { status?: string; contextId?: { groupId?: string; reference?: { chapter?: number; verse?: number } } };
const decisions = (): Decision[] => (readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions ?? []) as Decision[];
const decisionKey = (d: Decision) => `${d.contextId?.reference?.chapter}:${d.contextId?.reference?.verse} · ${d.contextId?.groupId}`;

test.describe('J8 — the Increment 4 journey: open, resume, and share a project (#185)', () => {
  test(
    'open the project, draft, mark one check, leave (a checkpoint commits), reload, resume into the remembered place',
    { tag: ['@inc4', '@J8'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      // The reset below erases what the earlier tests journaled; verify their
      // materialization first, so this test does not hide a mismatch they left.
      await verifyAllJournaledProjects();
      pinEnglishAndRestateNotesRecord();
      const commitsBefore = commitCount(SEEDED_PROJECT);
      // The seeded sample is mid-check: an undecided item may already carry a record
      // (status todo), so the proof is this item's status, not a new record.
      const statusOf = (list: Decision[], key: string | null) => list.find((d) => decisionKey(d) === key)?.status ?? 'absent';
      const itemKeyFor: { value: string | null } = { value: null };
      const drafted = 'Reprende con toda autoridad (viaje completo).';

      await test.step('open the seeded project at Titus 2 and draft a verse', async () => {
        await openTitusAt(page, '2');
        await draftFirstStub(page, drafted);
        await waitForResumeRecord(SEEDED_PROJECT, 2, drafted);
        // Saving is not a checkpoint (D9).
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });

      await test.step('switch to Check: the mode switch commits the pending text', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await expect.poll(() => commitCount(SEEDED_PROJECT), { timeout: 30_000 }).toBe(commitsBefore + 1);
        expect(lastCommitMessage(SEEDED_PROJECT)).toMatch(/^Checkpoint, leaving Translate: .*TIT text/);
        // The COMMITTED book carries the draft, not only the working tree.
        expect(committedIngredient(SEEDED_PROJECT, 'TIT.usfm')).toContain(drafted);
      });

      await test.step('mark one Translation Notes item Valid; the decision lands in the sidecar', async () => {
        await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
        await page.getByTestId('open-translationNotes').click();
        await expect(page.getByTestId('check-progress')).toBeVisible({ timeout: 30_000 });
        const item = page.getByTestId('check-list').locator('button[data-decided="0"]').first();
        // The item's title is `c:v · groupId` (Check.jsx); the sidecar record must be this one.
        const itemKey = await item.getAttribute('title');
        expect(itemKey).toBeTruthy();
        itemKeyFor.value = itemKey;
        expect(statusOf(decisions(), itemKey)).not.toBe('valid');
        await item.click();
        await page.getByTestId('mark-valid').click();
        await expect.poll(() => statusOf(decisions(), itemKey), { timeout: 10_000 }).toBe('valid');
        await expect(page.getByTestId('save-error')).toHaveCount(0);
      });

      await test.step('leave the project: the leave checkpoint commits the decision', async () => {
        await page.getByTitle('Switch project').click();
        await expect(page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => commitCount(SEEDED_PROJECT), { timeout: 30_000 }).toBe(commitsBefore + 2);
        expect(lastCommitMessage(SEEDED_PROJECT)).toMatch(/^Checkpoint, leaving the project: .*TIT/);
        // The COMMITTED sidecar carries the decision.
        const committed = committedIngredient(SEEDED_PROJECT, 'checking/translationNotes/TIT.json');
        expect(committed).not.toBeNull();
        expect(statusOf(JSON.parse(committed!).decisions as Decision[], itemKeyFor.value)).toBe('valid');
        await expect(page.getByTestId('home-checkpoint-error')).toHaveCount(0);
      });

      await test.step('reload the app and resume from Home into Translate at Titus 2', async () => {
        await page.reload();
        await expectAllProjectsListed(page);
        const card = page.getByTestId('resume-card');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card).toContainText(SEEDED_NAME);
        await expect(card).toContainText('Titus 2');
        await card.click();
        await expect(page.getByText(drafted)).toBeVisible({ timeout: 30_000 });
        await expectTranslateAt(page, '2', drafted);
      });
    },
  );

  test.fixme(
    'share for the first time: the app asks for a name and an email once, pushes to the configured test server, and the journey reads the pushed commit from the remote, not from the app (#120; L-3 #156 first)',
    { tag: ['@inc4', '@J8'] },
    async () => {},
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
