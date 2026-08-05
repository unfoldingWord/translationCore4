// J4 — Check a book: derived tW/tN item list → read note/article → triage
// JOURNEYS-AND-GAPS §2 J4 · PRD FR-5, FR-13, FR-16..FR-18 · TEST-PLAN E-J4 · Increment 2
//
// Ground truth is the rig's disk, never UI state alone: the derived list must
// come from the pinned resource's own TSV, and every decision must land in the
// §5.2 sidecar with its resolution record.
import { test, expect } from '@playwright/test';
import {
  SEEDED_PROJECT,
  pinForSideloaded,
  writeProjectPins,
  readDecisionFile,
  resetSeededChecking,
  sideloadedIngredient,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

/** Open the seeded project's Titus and land on the Check view. */
async function openCheck(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
}

test.beforeEach(() => {
  // Each spec states its own starting conditions (see resetSeededChecking).
  resetSeededChecking();
});

test.describe('J4 — a checker works a book', () => {
  test(
    'opening a checking session derives the item list from the pinned TSV — the list is never stored (FR-13)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());

      // The count the UI must reproduce comes from the resource itself: rows
      // with a SupportReference are checks, the rest are plain notes.
      const tsv = sideloadedIngredient('en_tn', 'TIT.tsv');
      const expected = tsv
        .split('\n')
        .slice(1)
        .filter((r) => r.trim() && (r.split('\t')[3] ?? '') !== '').length;

      const before = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length ?? 0;

      await openCheck(page);
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute(
        'data-state',
        'ready',
      );
      await page.getByTestId('open-translationNotes').click();

      // The TOTAL is dictated by the resource. The decided count is whatever
      // re-attached from the sample's stored decisions (D17), so it is not
      // asserted as zero — only the denominator is the derivation's promise.
      await expect(page.getByTestId('check-progress')).toHaveText(
        new RegExp(`\\d+ of ${expected} decided`),
      );
      await expect(page.getByTestId('check-list').getByRole('button')).toHaveCount(expected);

      // FR-13: derived lists are disposable. The seeded sample is deliberately
      // mid-check, so the sidecar exists — what must NOT happen is the session
      // writing the derived list into it. Opening changes nothing on disk.
      const after = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      expect(after?.decisions.length).toBe(before);
      expect(after?.decisions.length).toBeLessThan(expected); // a list was not dumped in
    },
  );

  test(
    'a missing local resource at session open shows the guided fix screen, not a crash (FR-5)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      // Pin a version this machine does not have.
      const pins = PINS();
      writeProjectPins(SEEDED_PROJECT, {
        ...pins,
        tn: { ...pins.tn, version: 'v1', sha: undefined },
      });

      await openCheck(page);
      const card = page.getByTestId('preflight-translationNotes');
      await expect(card).toHaveAttribute('data-state', /fetch|unavailable/);
      // Either way the user is offered a way forward, and nothing crashed.
      await expect(card.getByRole('button').first()).toBeVisible();
      // The OTHER tool stays independently usable — D30.5.
      await expect(page.getByTestId('preflight-translationWords')).toHaveAttribute(
        'data-state',
        'ready',
      );
    },
  );

  test(
    'triage and nothing-to-select persist as full §5.2 records through the store — no browser-local layer (FR-16, FR-17, C2.7)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      // The seeded sample already carries decisions; measure the DELTA.
      const before = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length ?? 0;
      await page.getByTestId('mark-nothing').click();

      // The record must land on DISK, in the §5.2 sidecar, with its resolution.
      await expect
        .poll(
          () => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length,
          { timeout: 10_000 },
        )
        .toBe(before + 1);
      const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      // The §5.2 resolution record must NOT be relabelled by a decision write.
      // The seeded sample was checked against es-419_tn; changing which
      // resource a book is checked against is an explicit, consequences-shown
      // action (D23a/D30.2), never a side effect of marking one check.
      expect(file?.resource?.repoPath).toContain('es-419_tn');
      const d = file!.decisions.find((x) => (x as { nothingToSelect?: boolean }).nothingToSelect) as Record<string, unknown>;
      const contextId = d.contextId as Record<string, unknown>;
      expect(d.nothingToSelect).toBe(true);
      expect(d.status).toBe('valid');
      expect(d.modifiedTimestamp).toBeTruthy();
      expect(Array.isArray(contextId.quote)).toBe(true); // §5.2: tN quote stays an array
      expect(typeof contextId.checkId).toBe('string');

      // C2.7: the app keeps no browser-local persistence layer at all.
      const local = await page.evaluate(() => ({
        localStorage: Object.keys(window.localStorage).length,
        sessionStorage: Object.keys(window.sessionStorage).length,
      }));
      expect(local).toEqual({ localStorage: 0, sessionStorage: 0 });
    },
  );

  test(
    'progress is reconstructed from the derived list + saved decisions after a restart (FR-18)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      const countDecided = () =>
        page.getByTestId('check-list').locator('button[data-decided="1"]').count();
      const beforeMark = await countDecided();

      // Decide an item that is not already decided, and remember which one.
      const target = page.getByTestId('check-list').locator('button[data-decided="0"]').first();
      const targetLabel = await target.textContent();
      await target.click();
      await page.getByTestId('mark-nothing').click();
      await expect
        .poll(countDecided, { timeout: 10_000 })
        .toBe(beforeMark + 1);

      // Full reload: the list is re-derived from the TSV, and the saved
      // decisions must come back with it. The promise is that nothing is lost —
      // not an exact count, since re-attach and revalidation both legitimately
      // move the number.
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();
      expect(await countDecided()).toBeGreaterThanOrEqual(beforeMark + 1);

      // …and specifically, the item just decided is still decided.
      await expect(
        page
          .getByTestId('check-list')
          .locator(`button[data-decided="1"]:text-is("${targetLabel}")`)
          .first(),
      ).toBeVisible();
    },
  );

  test(
    'the tW tool derives from the SAME repo the links came from and shows its article (D34, FR-15)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      const tsv = sideloadedIngredient('en_tw', 'TIT.tsv');
      const expected = tsv.split('\n').slice(1).filter((r) => r.trim()).length;

      await openCheck(page);
      await page.getByTestId('open-translationWords').click();
      await expect(page.getByTestId('check-progress')).toHaveText(
        new RegExp(`\\d+ of ${expected} decided`),
      );
      // The article comes out of the very same burrito (payload/…), proving the
      // one-pin-per-language rule end to end.
      await expect(page.getByTestId('article-panel')).toBeVisible();
      await expect(page.getByTestId('article-panel')).toContainText('payload/');
    },
  );
});
