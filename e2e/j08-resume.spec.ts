// J8 — Resume work across sessions/books; multi-book navigation
// docs/JOURNEYS.md J8 · built in Increment 4 (#184, #185); the share leg since Increment 8.5
//
// The last two tests are the journey end to end (#185): open, draft, mark a check,
// leave (a checkpoint commits), reload, resume, share. The share leg runs the J11
// flow (e2e/helpers/door43Share.ts) against the fake Door43 and a bare remote the
// test controls, and reads the pushed commit back from that remote.
//
// Ground truth is the rig's disk: commit counts and messages come from the
// repository, never from UI state (e2e/helpers/rig.ts).
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { RIG_API, RIG_STATE, dropOrigin, fakeShare, filesHolding, git, head, makeBareRemote, shareFirstTime, USER, gateOff, turnOnInternet } from './helpers/door43Share';
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
  resetPlaces,
  writePlace,
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
  // These journeys count commits, so they start from a Translate place (writePlace).
  writePlace(project, 'TIT', { mode: 'draft', chapter: Number(chapter) });
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${project}`).getByRole('button', { name: /Titus/ }).click();
  // #329: the tile returns to the place written above: Translate, at the chapter asked
  // for. The heading is rendered only once the book is loaded (Draft and Understand
  // show a loading state before it).
  await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('tab', { name: 'Translate', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: chapter, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Titus ${chapter}`, exact: true })).toBeVisible();
  if (chapter === '1') await expect(page.getByText(READY[project]).first()).toBeVisible({ timeout: 120_000 });
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
  // #238: Draft defaults to section mode; Start this verse only exists on Verse.
  await page.getByRole('tab', { name: 'Verse', exact: true }).click();
  await page.getByRole('button', { name: 'Start this verse' }).first().click();
  const editor = page.getByRole('textbox', { name: /Verse/ });
  await editor.fill(text);
  await editor.blur();
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
}

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
});

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
        // ... and then the app lands where the translator stopped. The landing is the
        // chapter heading: Home stays mounted under the indicator until the open ends,
        // and its Resume card quotes the drafted text, so the text alone is not proof
        // that the book is open (found 2026-09-28, #185: the open grew past the 5 s
        // expect window, and the card satisfied the text match while the open ran).
        await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible({ timeout: 120_000 });
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

  test(
    'a section save that makes a verse span names the span on Resume; a save that breaks it names the first verse of the old span (#576, D94)',
    { tag: ['@inc9', '@J8'] },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await openTitusAt(page, '3');
      // Translate may reopen on Verse (an earlier test chose it); the section card is on Section.
      await page.getByRole('tab', { name: 'Section', exact: true }).click();
      // The first section of Titus 3 with two verses or more, read from the page:
      // its verses are A to B, and the journey joins A+1 to A. Verses after A+1 stay unplaced.
      const sectionButton = page.getByRole('button', { name: /^Draft section \d+–\d+$/ }).first();
      const label = (await sectionButton.textContent())!.trim();
      const [a, b] = label.replace('Draft section ', '').split('–');
      const next = String(Number(a) + 1);
      expect(Number(b)).toBeGreaterThanOrEqual(Number(next));
      const spanKey = `${a}-${next}`;
      const FIRST = 'Recuérdales que se sujeten a los gobernantes y autoridades (tramo)';
      const SECOND = 'Que a nadie difamen, que no sean pendencieros (tramo)';
      const seen: Record<string, unknown> = { section: label, spanKey };
      // The record without its timestamp, so each run writes the same artifact.
      const record = () => {
        const rec = readLastEdit();
        return rec ? { repoPath: rec.repoPath, book: rec.book, chapter: rec.chapter, verse: rec.verse, snippet: rec.snippet } : null;
      };

      await test.step(`join verse ${next} to verse ${a} and save: the Home banner reads "Last edited verse ${spanKey}" with its text`, async () => {
        await sectionButton.click();
        await page.getByRole('textbox', { name: `Section ${a}–${b}` }).fill(`${FIRST} ${SECOND}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: `Move where verse ${next} begins` }).click();
        await page.getByRole('button', { name: `Join verse ${next} to verse ${a} at Recuérdales` }).click();
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await waitForResumeRecord(SEEDED_PROJECT, 3, FIRST);
        expect(readLastEdit()?.verse).toBe(spanKey);
        // The span's text: both verses, cut at the record's 90 characters (src/state.jsx).
        const spanSnippet = `${FIRST} ${SECOND}`.slice(0, 90);
        expect(spanSnippet).toContain('Que a nadie');
        expect(readLastEdit()?.snippet).toBe(spanSnippet);
        seen.afterJoin = { record: record(), banner: '' };
        await page.goto('/');
        const card = page.getByTestId('resume-card');
        await expect(card).toContainText(`Last edited verse ${spanKey} — “${spanSnippet}”`, { timeout: 30_000 });
        (seen.afterJoin as { banner: string }).banner = (await card.textContent()) ?? '';
      });

      await test.step(`break the span and save: the Home banner reads "Last edited verse ${a}"`, async () => {
        await openTitusAt(page, '3');
        await page.getByRole('tab', { name: 'Section', exact: true }).click();
        // A section of exactly A and A+1 is now the one span verse, labelled by its key (sections.js rangeSpan).
        const joinedLabel = b === next ? `Draft section ${spanKey}` : label;
        await page.getByRole('button', { name: joinedLabel, exact: true }).click();
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        // A placed pin is picked up with the keyboard (Enter), then dropped on its word (the J2 break pattern).
        await page.getByTestId('place-words').getByRole('button', { name: `Move where verse ${next} begins` }).press('Enter');
        await page.getByRole('button', { name: `Begin verse ${next} at Que`, exact: true }).click();
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect.poll(() => readLastEdit()?.verse, { timeout: 10_000 }).toBe(a);
        // Verse A's own text only: the second verse's words left with it.
        expect(readLastEdit()?.snippet).toBe(FIRST);
        await waitForResumeRecord(SEEDED_PROJECT, 3, FIRST);
        seen.afterBreak = { record: record(), banner: '' };
        await page.goto('/');
        const card = page.getByTestId('resume-card');
        await expect(card).toContainText(`Last edited verse ${a} — “${FIRST}”`, { timeout: 30_000 });
        await expect(card).not.toContainText('Que a nadie');
        await expect(card).not.toContainText(spanKey);
        (seen.afterBreak as { banner: string }).banner = (await card.textContent()) ?? '';
      });

      // The run's artifact: the Resume record and the banner after each save.
      const artifactPath = testInfo.outputPath('j08-resume-after-span.json');
      fs.writeFileSync(artifactPath, `${JSON.stringify(seen, null, 2)}\n`);
      await testInfo.attach('j08-resume-after-span.json', { path: artifactPath, contentType: 'application/json' });
    },
  );
});

// ---- #185: the Increment 4 journey end to end ----------------------------------

// The English checking suite the rig sideloads (the J4 pattern). The seeded sample's
// Translation Notes decision file records es-419; a decision write against a drifted
// record refuses toward the gateway-change flow (D59 §3), so the record is restated
// as the pin the project now holds before the journey marks a check.
const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
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

      await test.step('reload the app and resume from Home into Check at Titus 2', async () => {
        // #268: the last act was a Check decision, so Resume reopens that tool.
        await page.reload();
        await expectAllProjectsListed(page);
        const card = page.getByTestId('resume-card');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card).toContainText(SEEDED_NAME);
        await expect(card).toContainText('Titus 2');
        await card.click();
        await expect(page.getByRole('tab', { name: 'Check', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('check-session')).toBeVisible({ timeout: 30_000 });
      });
    },
  );

  test(
    'share for the first time: Share on the Home card runs the J11 flow (sign in, the account, the check step, the push); the journey reads the pushed commit from the remote, not from the app (J11, D84, D85)',
    { tag: ['@inc4', '@inc85', '@J8'] },
    async ({ page, context }) => {
      test.setTimeout(120_000);
      const remote = makeBareRemote();
      try {
        dropOrigin(SEEDED_PROJECT);
        const fake = await fakeShare(context, remote);
        await page.goto('/');
        // D95: the internet is turned on for this page load through the account menu; the
        // dialog that a Share opens while it is off is J11 case 12 and @internet-consent.
        await turnOnInternet(page);
        const id = `_local_/_local_/${SEEDED_PROJECT}`;
        await expect(page.getByTestId(`share-card-${id}`)).toHaveAttribute('data-shared', '0');
        const commitsBefore = commitCount(SEEDED_PROJECT);
        const url = await shareFirstTime(page, id);
        expect(url).toBe(`https://qa.door43.org/${USER.username}/${SEEDED_PROJECT}`);
        // The card: "On Door43", the repository path, and Upload changes.
        await expect(page.getByTestId(`share-card-${id}`)).toHaveAttribute('data-shared', '1');
        await expect(page.getByTestId(`share-state-${id}`)).toHaveText(`Shared at qa.door43.org/${USER.username}/${SEEDED_PROJECT}`);
        await expect(page.getByTestId(`share-${id}`)).toHaveText('Upload changes');
        // A share adds nothing to the project but the D9 checkpoint of pending work
        // (J11's end state): here the resources record the resume into Check wrote.
        expect(commitCount(SEEDED_PROJECT)).toBeLessThanOrEqual(commitsBefore + 1);
        // The remote, read with git: its main is the local main, its last commit is the
        // local one, and its committed book is the local one.
        expect(remote.main()).toBe(head(SEEDED_PROJECT));
        expect(git(remote.bare, 'log', '-1', '--format=%s', 'main')).toBe(lastCommitMessage(SEEDED_PROJECT));
        expect(remote.show('main:ingredients/TIT.usfm')).toBe(committedIngredient(SEEDED_PROJECT, 'TIT.usfm'));
        // The token is on no disk of the rig (D85), and the project's git config holds no secret.
        const token = fake.tokens.get('translationCore')!;
        expect(token).toBeTruthy();
        expect(filesHolding(RIG_STATE, token)).toEqual([]);
        expect(fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), '.git', 'config'), 'utf8')).not.toContain(token);
      } finally {
        // Leave the seeded project as this test found it: unshared, and the gate off.
        dropOrigin(SEEDED_PROJECT);
        remote.dispose();
        await gateOff();
      }
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});

// #329 — a Home tile returns to where the user last worked in that book or story.
test.describe('#329 — a Home tile returns to the place last worked', () => {
  test(
    'a book tile: Understand on Titus 2 is where the Titus tile reopens; a never-opened book opens at chapter 1 in Understand (D87)',
    { tag: ['@inc7', '@J8'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      await openTitusAt(page, '2');
      await page.getByRole('tab', { name: 'Understand', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible();
      await page.waitForTimeout(800); // the place record's debounced write
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await expect(page.getByRole('tab', { name: 'Understand', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible();
      // The restore itself is an observation and must not corrupt the record: a
      // second open lands in the same place (Codex round 1 of #339).
      await page.waitForTimeout(800);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await expect(page.getByRole('tab', { name: 'Understand', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Titus 2', exact: true })).toBeVisible();
      // Jonah has no place record: the plain open, Understand at chapter 1 (D87).
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Jonah/ }).click();
      await expect(page.getByRole('tab', { name: 'Understand', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Jonah 1', exact: true })).toBeVisible();
    },
  );

  test(
    'a story tile: Understand on story 3, frame 4 is where the story-3 tile reopens',
    { tag: ['@inc7', '@J8', '@j25'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      const { createObsProject } = await import('./helpers/story');
      const repo = await createObsProject('j8tile', 'Equipo Rig — J8 tile');
      await page.goto('/');
      const card = page.getByTestId(`project-_local_/_local_/${repo}`);
      await card.getByTestId(`toggle-stories-_local_/_local_/${repo}`).click();
      await card.getByTestId('story-tile-3').click();
      // No place record yet: the story opens in Understand (D87).
      await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('story-understand-unit-4').click();
      await expect(page.getByTestId('story-understand-unit-4')).toHaveAttribute('data-focused', 'true');
      await page.waitForTimeout(800); // the place record's debounced write
      await page.goto('/');
      await card.getByTestId('story-tile-3').click(); // no edits yet: the collapsed row is stories 1 to 3
      await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Story 3', exact: true })).toBeVisible();
      await expect(page.getByTestId('story-understand-unit-4')).toHaveAttribute('data-focused', 'true', { timeout: 30_000 });
      // A second open lands in the same place: the restore did not overwrite the frame.
      await page.waitForTimeout(800);
      await page.goto('/');
      await card.getByTestId('story-tile-3').click();
      await expect(page.getByTestId('story-understand')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('story-understand-unit-4')).toHaveAttribute('data-focused', 'true', { timeout: 30_000 });
    },
  );
});
