// J5 — Align a verse: link/unlink pairs → persists in the §5.1 sidecar
// docs/JOURNEYS.md J5 · shipped v4.0.0-alpha.2 · run LTR and RTL (the J10 axis)
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
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
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
    '#271 Mark valid: the translator says the verse is done with words in the bank; an edit takes it back; Mark valid again restores it',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const button = page.getByTestId('align-mark-valid');
      await expect(button).toHaveAttribute('data-active', '0');
      expect(alignmentFile()!.chapters['1']['1'].done).toBeUndefined();

      // Mark valid with 21 words still in the bank (the seeded 1:1).
      await button.click();
      await expect(button).toHaveAttribute('data-active', '1');
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.done, { timeout: 10_000 }).toBe(true);
      const marked = alignmentFile()!.chapters['1']['1'];
      expect(marked.wordBank.length).toBeGreaterThan(0);
      expect(marked.targetVerseMd5).toMatch(/^[0-9a-f]{32}$/);

      // Un-align one placed word: the edit takes Mark valid back, on screen and on disk.
      const placedChip = page.locator('[data-testid^="align-card-"][data-count="1"]').first().getByRole('button').first();
      await placedChip.click();
      await expect(button).toHaveAttribute('data-active', '0');
      await expect.poll(() => 'done' in (alignmentFile()?.chapters?.['1']?.['1'] ?? {}), { timeout: 10_000 }).toBe(false);

      // Mark valid again: valid again, with the word now in the bank.
      await button.click();
      await expect(button).toHaveAttribute('data-active', '1');
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.done, { timeout: 10_000 }).toBe(true);
    },
  );

  test(
    '#1 suggestions: off until switched on; a shown, unconfirmed suggestion leaves no trace; Mark valid is refused while it stands',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const row = page.getByTestId('align-suggestions');
      const toggle = page.getByTestId('align-suggest-switch');
      // The switch is per client (platform client-settings); start from OFF
      // whatever an earlier run left, then prove OFF offers nothing.
      if (await toggle.isChecked()) await toggle.click();
      await expect(row).toHaveAttribute('data-status', 'off');
      await expect(page.getByTestId('align-suggest')).toHaveCount(0);

      // ON: the engine trains on the one aligned verse of the seed and says so.
      await toggle.click();
      await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await expect(page.getByTestId('align-suggest-status')).toContainText('1 verses');

      const before = JSON.stringify(alignmentFile());
      const segmentsBefore = fs.readdirSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal')).length;
      // The one-verse corpus's answer is not deterministic and multi-card
      // phrases are omitted (O1), so wait for the reply either way; every
      // invariant below holds with chips or without, the chip-only steps run
      // when there is a chip.
      const chips = page.locator('[data-testid^="align-suggested-"]');
      const status = page.getByTestId('align-suggest-status');
      const replied = async () => (await chips.count()) > 0 || (await status.innerText()).includes('Nothing to suggest');
      await page.getByTestId('align-suggest').click();
      await expect.poll(replied, { timeout: 15_000 }).toBe(true);
      // Shown, not written: the sidecar and the journal are byte-identical,
      // the placed count ignores the proposal.
      await expect(page.getByTestId('align-progress')).toContainText('6 of 27');
      expect(JSON.stringify(alignmentFile())).toBe(before);
      expect(fs.readdirSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal')).length).toBe(segmentsBefore);
      if ((await chips.count()) > 0) {
        // Mark valid is refused while a suggestion stands.
        await page.getByTestId('align-mark-valid').click();
        await expect(page.getByTestId('align-mark-valid-refused')).toBeVisible();
        expect(alignmentFile()!.chapters['1']['1'].done).toBeUndefined();
        // Reject all: the words are back in the bank; still nothing on disk.
        await page.getByTestId('align-suggest-reject-all').click();
        await expect(chips).toHaveCount(0);
        expect(JSON.stringify(alignmentFile())).toBe(before);
      }
      // Leaving the verse discards a fresh proposal too (and writes nothing).
      await page.getByTestId('align-suggest').click();
      await expect.poll(replied, { timeout: 15_000 }).toBe(true);
      await page.getByTestId('align-next').click();
      await expect(page.getByTestId('align-ref-text')).not.toContainText('1:1');
      await expect(chips).toHaveCount(0);
      expect(JSON.stringify(alignmentFile())).toBe(before);
    },
  );

  test(
    '#1 suggestions: an accepted suggestion writes exactly what a manual link writes, through the same save path',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const toggle = page.getByTestId('align-suggest-switch');
      if (!(await toggle.isChecked())) await toggle.click();
      await expect(page.getByTestId('align-suggestions')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await page.getByTestId('align-suggest').click();
      // The engine's answer for a one-verse corpus is not deterministic (the
      // booster's split is randomized), and a prediction whose source words
      // span several cards is omitted (#1, option O1). Wait for the reply —
      // chips, or the "nothing to suggest" line — then take what appears.
      const chips = page.locator('[data-testid^="align-suggested-"]');
      await expect
        .poll(async () => (await chips.count()) > 0 || (await page.getByTestId('align-suggest-status').innerText()).includes('Nothing to suggest'), { timeout: 15_000 })
        .toBe(true);
      const recordBefore = alignmentFile()!.chapters['1']['1'];
      const placedBefore = recordBefore.alignments.reduce((n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length, 0);
      let cardIndex: number;
      let word: string;
      if ((await chips.count()) > 0) {
        // Confirm the one chip by its check mark.
        const chip = chips.first();
        cardIndex = Number((await chip.getAttribute('data-testid'))!.replace('align-suggested-', ''));
        word = ((await chip.textContent()) ?? '').replace('✓', '').trim();
        await chip.click();
      } else {
        // Nothing proposed this run: place one bank word by hand on an empty
        // card — the manual path the accepted path must equal.
        const bank = page.getByTestId('align-bank').getByRole('button');
        word = ((await bank.first().textContent()) ?? '').trim();
        await bank.first().click();
        const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
        cardIndex = Number((await emptyCard.getAttribute('data-testid'))!.replace('align-card-', ''));
        await emptyCard.click();
      }
      await expect
        .poll(() => alignmentFile()?.chapters?.['1']?.['1']?.alignments?.[cardIndex]?.bottomWords?.some((w: { word: string }) => w.word === word), { timeout: 10_000 })
        .toBe(true);
      const rec = alignmentFile()!.chapters['1']['1'];
      // The same shape a manual link writes (FR-20 case above): the word left
      // the bank, sits under the card, integers throughout, hash restamped.
      expect(rec.alignments.reduce((n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length, 0)).toBe(placedBefore + 1);
      // Exactly one bank entry left, and it is this word (other occurrences of
      // the same text — "de" has five — stay banked).
      expect(recordBefore.wordBank.length - rec.wordBank.length).toBe(1);
      const gone = (recordBefore.wordBank as Array<{ word: string; occurrence: number }>).filter(
        (b) => !rec.wordBank.some((w: { word: string; occurrence: number }) => w.word === b.word && w.occurrence === b.occurrence),
      );
      expect(gone.map((w) => w.word)).toEqual([word]);
      const everyWord = [...rec.wordBank, ...rec.alignments.flatMap((a: { bottomWords: unknown[] }) => a.bottomWords)] as Array<{ occurrence: unknown; occurrences: unknown }>;
      expect(everyWord.every((w) => typeof w.occurrence === 'number' && typeof w.occurrences === 'number')).toBe(true);
      expect(rec.targetVerseMd5).toBe(recordBefore.targetVerseMd5);
      expect(rec.done).toBeUndefined(); // words remain in the bank
      // Un-aligning it by hand returns the word to the bank — the two paths meet.
      await page.locator(`[data-testid="align-card-${cardIndex}"]`).getByRole('button', { name: word }).click();
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.wordBank?.some((w: { word: string }) => w.word === word), { timeout: 10_000 }).toBe(true);
    },
  );

  test(
    'without an original-language text pinned, alignment says so instead of failing (C2.9 pattern)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      // This spec NEEDS the originalLanguage pins absent — drop exactly that
      // group (the helper carries everything else forward, lexicon included).
      writeProjectPins(SEEDED_PROJECT, PINS(), { dropOriginalLanguage: true });
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
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
  try {
    await verifyAllJournaledProjects();
  } finally {
    // Leave the shared fixture as we found it (#124 review round 3): this
    // file hand-mutates the seeded project's pins, and without the restore a
    // targeted or failed run leaves the rig stripped for the next user.
    resetSeededChecking();
  }
});
