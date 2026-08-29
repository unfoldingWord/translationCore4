// J5 — Align a verse: link/unlink pairs → persists in the §5.1 sidecar
// JOURNEYS-AND-GAPS §2 J5 · PRD FR-19..FR-21 · TEST-PLAN E-J5 · Increment 2
// (owner-approved placement, 2026-08-03).
//
// Ground truth is the sidecar on disk. Wordmap suggestions (AD-7) are deferred
// out of this increment (D35a), so nothing here asserts them.
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  resetSeededChecking,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

/** The project must also pin an original-language text for alignment. */
function writePinsWithOriginal() {
  writeProjectPins(SEEDED_PROJECT, PINS());
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json');
  const file = JSON.parse(fs.readFileSync(p, 'utf8'));
  // MERGE the originalLanguage group in — replacing the whole `resources`
  // object dropped the seed's lexicon group that writeProjectPins carries
  // forward (#124 review round 2, same unrelated-state loss as issue #123).
  file.resources = {
    ...(file.resources ?? {}),
    originalLanguage: {
      nt: pinForSideloaded('el-x-koine_ugnt', 'v0.34'),
      ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'v2.1.30', sha: '106a441a788d9465846cd427538ea80b8cec6770', flavor: 'scripture/textTranslation' },
    },
  };
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

const alignmentFile = () => {
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'alignments', 'TIT.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

async function openAlign(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-align').click();
  await expect(page.getByTestId('align-session')).toBeVisible();
}

test.beforeEach(() => {
  resetSeededChecking();
});

test.describe('J5 — a translator aligns a verse', () => {
  test(
    'writePinsWithOriginal merges, never replaces: the seed lexicon group and extraScripture survive (#123/#124 review)',
    { tag: ['@inc2', '@J5'] },
    async () => {
      const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json');
      const seed = JSON.parse(fs.readFileSync(p, 'utf8'));
      writePinsWithOriginal();
      const after = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(after.resources.lexicon).toEqual(seed.resources.lexicon);
      expect(after.extraScripture).toEqual(seed.extraScripture);
      expect(Object.keys(after.resources.originalLanguage)).toEqual(['nt', 'ot']);
    },
  );

  test(
    'the alignment surface loads the stored §5.1 record: word bank + one card per original word (FR-19)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      const stored = alignmentFile()!.chapters['1']['1'];
      const placedInFile = stored.alignments.reduce(
        (n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length,
        0,
      );

      await openAlign(page);

      // One card per original-language word, and the stored links are shown.
      await expect(page.locator('[data-testid^="align-card-"]')).toHaveCount(
        stored.alignments.length,
      );
      await expect(page.getByTestId('align-progress')).toHaveText(
        new RegExp(`${placedInFile} of \\d+ words placed`),
      );
      // The bank holds exactly the words that are not placed.
      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(
        stored.wordBank.length,
      );
    },
  );

  test(
    'linking a word moves it from the bank into the card AND persists to the sidecar (FR-20)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);

      const bank = page.getByTestId('align-bank').getByRole('button');
      const bankBefore = await bank.count();
      const word = (await bank.first().textContent()) ?? '';

      // Click the word, then a card that currently has nothing under it.
      await bank.first().click();
      await expect(bank.first()).toHaveAttribute('data-armed', '1');
      const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
      const cardId = await emptyCard.getAttribute('data-testid');
      await emptyCard.click();

      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(bankBefore - 1);
      await expect(page.locator(`[data-testid="${cardId}"]`)).toHaveAttribute('data-count', '1');

      // …and it is on DISK, under the original word, with integer occurrences.
      await expect
        .poll(
          () => {
            const rec = alignmentFile()?.chapters?.['1']?.['1'];
            return rec?.alignments?.some((a: { bottomWords: Array<{ word: string }> }) =>
              a.bottomWords.some((w) => w.word === word.trim()),
            );
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      const rec = alignmentFile()!.chapters['1']['1'];
      const everyWord = [
        ...rec.wordBank,
        ...rec.alignments.flatMap((a: { topWords: unknown[]; bottomWords: unknown[] }) => [
          ...a.topWords,
          ...a.bottomWords,
        ]),
      ] as Array<{ occurrence: unknown; occurrences: unknown }>;
      // I-2: the alignment stack fails wholesale on string occurrences.
      expect(everyWord.every((w) => typeof w.occurrence === 'number')).toBe(true);
      expect(everyWord.every((w) => typeof w.occurrences === 'number')).toBe(true);
      // I-3: the record states which draft it was made against.
      expect(rec.targetVerseMd5).toMatch(/^[0-9a-f]{32}$/);
      expect(rec.sourceVersion).toContain('el-x-koine_ugnt');
    },
  );

  test(
    'un-aligning returns the word to the bank, on screen and on disk (FR-20)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);

      // The seeded sample already has placed words; take one back.
      const placedCard = page.locator('[data-testid^="align-card-"][data-count="1"]').first();
      const chip = placedCard.getByRole('button').first();
      const word = ((await chip.textContent()) ?? '').trim();
      const bankBefore = await page.getByTestId('align-bank').getByRole('button').count();
      await chip.click();

      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(bankBefore + 1);
      await expect
        .poll(
          () => {
            const rec = alignmentFile()?.chapters?.['1']?.['1'];
            return rec?.wordBank?.some((w: { word: string }) => w.word === word);
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    },
  );

  test(
    'a word is never in two places: total word count is conserved across edits',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const totalOf = (rec: {
        wordBank: unknown[];
        alignments: Array<{ bottomWords: unknown[] }>;
      }) => rec.wordBank.length + rec.alignments.reduce((n, a) => n + a.bottomWords.length, 0);

      const before = totalOf(alignmentFile()!.chapters['1']['1']);

      await page.getByTestId('align-bank').getByRole('button').first().click();
      await page.locator('[data-testid^="align-card-"][data-count="0"]').first().click();
      await expect(page.getByTestId('align-progress')).toBeVisible();

      await expect
        .poll(() => totalOf(alignmentFile()!.chapters['1']['1']), { timeout: 10_000 })
        .toBe(before);
    },
  );

  test(
    'without an original-language text pinned, alignment says so instead of failing (C2.9 pattern)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      // This spec NEEDS the originalLanguage pins absent — drop the seed's
      // resources groups explicitly (the helper now carries them forward).
      writeProjectPins(SEEDED_PROJECT, PINS(), { dropResources: true });
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
      await page.getByRole('button', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-align').click();

      const unavailable = page.getByTestId('align-unavailable');
      await expect(unavailable).toBeVisible();
      await expect(unavailable).toContainText(/original-language/i);
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
