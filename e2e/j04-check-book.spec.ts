// J4 — Check a book: derived tW/tN item list → read note/article → triage
// JOURNEYS-AND-GAPS §2 J4 · PRD FR-5, FR-13, FR-16..FR-18 · TEST-PLAN E-J4 · Increment 2
//
// Ground truth is the rig's disk, never UI state alone: the derived list must
// come from the pinned resource's own TSV, and every decision must land in the
// §5.2 sidecar with its resolution record.
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  rigRepo,
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

function writeDecisionFile(repo: string, tool: string, book: string, file: unknown): void {
  const p = path.join(rigRepo(repo), 'ingredients', 'checking', tool, `${book}.json`);
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

/** Restate the seeded sample's checked-against record as the pin the project
 * now holds (the j13 pattern). The sample records es-419; these tests pin the
 * sideloaded English suite, and under D59 §3 a decision write against a
 * DRIFTED record REFUSES toward the gateway-change flow — so a journey about
 * something else first aligns the record with what it pins. */
function restateRecordAsEnglish(tool: string, book: string): void {
  const en = PINS();
  const file = readDecisionFile(SEEDED_PROJECT, tool, book);
  if (!file) return;
  (file as { resource?: unknown }).resource = {
    repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'primary',
  };
  writeDecisionFile(SEEDED_PROJECT, tool, book, file);
}

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
    'writeProjectPins carries the seed document forward: resources groups, extraScripture, and same-gateway optional slots survive a pin rewrite (#123/#124 review)',
    { tag: ['@inc2', '@J4'] },
    async () => {
      const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json');
      const seed = JSON.parse(fs.readFileSync(p, 'utf8'));
      writeProjectPins(SEEDED_PROJECT, PINS());
      const file = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(Object.keys(file.resources ?? {})).toEqual(
        expect.arrayContaining(['originalLanguage', 'lexicon']),
      );
      expect((file.extraScripture ?? []).map((e: { id: string }) => e.id)).toEqual(['ult', 'ust']);
      // §5.3/D64 optional slots: the seed's fallback set is the SAME gateway
      // (en/unfoldingWord) as the one written, so its extra slots carry over…
      expect(file.languageSets.fallback.simplifiedText).toEqual(
        seed.languageSets.fallback.simplifiedText,
      );
      expect(file.languageSets.fallback.translationQuestions).toEqual(
        seed.languageSets.fallback.translationQuestions,
      );
      // …while the seed's primary (es-419_gl) is a DIFFERENT gateway identity:
      // it is replaced wholesale, and none of its slots leak into the new set.
      expect(file.languageSets.primary.gatewayLanguage).toEqual({
        languageId: 'en',
        owner: 'unfoldingWord',
      });
      expect(file.languageSets.primary.translationNotes.repoPath).not.toContain('es-419');
    },
  );

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
        new RegExp(`\\d+ of ${expected} resolved`),
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
    'a full checking session emits no missing-i18n-key console warning (issue #12)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      // The i18n resolver (src/i18n/index.js) warns "[i18n] missing key: <key>"
      // once per gap. This journey drives a full session — open the project,
      // open the tool, read an item, decide it — and asserts the console stayed
      // clean. The static half of the proof is test/i18n-keys.test.ts.
      const missing: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'warning' && msg.text().includes('[i18n] missing key')) {
          missing.push(msg.text());
        }
      });

      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute(
        'data-state',
        'ready',
      );
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      // Work one undecided item end to end.
      await page.getByTestId('check-list').locator('button[data-decided="0"]').first().click();
      await page.getByTestId('mark-valid').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      expect(missing, `missing i18n keys during the session: ${missing.join(', ')}`).toEqual([]);
    },
  );

  test(
    'a missing local resource at session open shows the guided fix screen, not a crash (FR-5)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      // Pin a commit this machine does not have (D58: identity is the sha —
      // a well-formed sha that matches no local install is "not local").
      const pins = PINS();
      writeProjectPins(SEEDED_PROJECT, {
        ...pins,
        tn: { ...pins.tn, version: 'v1', sha: '1'.repeat(40) },
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

      // Phase 1 — the DRIFTED record (D59 §3). The sample records es-419_tn;
      // the project now pins English. A decision write must neither relabel
      // the file nor silently journal under the old record: it REFUSES, the
      // session says so, and the file is byte-untouched.
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();
      await expect(page.getByTestId('resolution-warning')).toBeVisible(); // D17 warned update
      const drifted = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length ?? 0;
      await page.getByTestId('mark-valid').click();
      await expect(page.getByTestId('save-error')).toBeVisible();
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length).toBe(drifted);
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.resource?.repoPath).toContain('es-419_tn');

      // Phase 2 — the ALIGNED record: restate the checked-against record as
      // the pinned English suite (the explicit act a gateway change performs),
      // and triage persists as a full §5.2 record.
      restateRecordAsEnglish('translationNotes', 'TIT');
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      // The seeded sample already carries decisions; measure the DELTA.
      const before = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length ?? 0;
      // Mark valid with no target word tapped is the "nothing to select" path.
      await page.getByTestId('mark-valid').click();

      // The record must land on DISK, in the §5.2 sidecar, with its resolution.
      await expect
        .poll(
          () => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length,
          { timeout: 10_000 },
        )
        .toBe(before + 1);
      const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      // The record stays the one the session checked against (no relabel).
      expect(file?.resource?.repoPath).toContain('en_tn');
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
      // Align the checked-against record with the English pins (D59 §3 — a
      // drifted record refuses decision writes; this journey is about FR-18).
      restateRecordAsEnglish('translationNotes', 'TIT');
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      const countDecided = () =>
        page.getByTestId('check-list').locator('button[data-decided="1"]').count();
      const beforeMark = await countDecided();

      // Decide an item that is not already decided, and remember which one —
      // by its title (`c:v · groupId`), which is stable across a re-derive.
      const target = page.getByTestId('check-list').locator('button[data-decided="0"]').first();
      const targetTitle = await target.getAttribute('title');
      await target.click();
      await page.getByTestId('mark-valid').click();
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
          .locator(`button[data-decided="1"][title="${targetTitle}"]`)
          .first(),
      ).toBeVisible();
    },
  );

  test(
    'tapping the target word(s) that render the quote and marking valid persists a §5.2 selection (B23, D2)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      // Clear the seeded sample's decisions for this book so the only selection
      // on disk is the one this test makes — the assertion targets MY decision,
      // not a pre-existing sample record.
      fs.rmSync(
        path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationNotes', 'TIT.json'),
        { force: true },
      );
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      // Land on an item whose verse is drafted (TIT 1:1 carries Spanish text in
      // the seeded sample), so the "Your translation" pane renders tappable words.
      await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
      const target = page.getByTestId('check-target');
      await expect(target).toHaveAttribute('data-drafted', '1');

      // Tap the first target word, then mark valid.
      const firstWord = page.getByTestId('tw-0');
      const wordText = (await firstWord.textContent())?.trim();
      await firstWord.click();
      await expect(firstWord).toHaveAttribute('data-selected', '1');
      await page.getByTestId('mark-valid').click();

      // The §5.2 record on disk carries a real selections array — a tapped word,
      // not the nothing-to-select fallback — with its occurrence bookkeeping.
      await expect
        .poll(
          () => {
            const f = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
            const d = f?.decisions.find(
              (x) => Array.isArray((x as { selections?: unknown }).selections),
            ) as { selections?: Array<Record<string, unknown>>; status?: string } | undefined;
            return d?.selections?.[0]?.text;
          },
          { timeout: 10_000 },
        )
        .toBe(wordText);

      const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      const d = file!.decisions.find(
        (x) => Array.isArray((x as { selections?: unknown }).selections),
      ) as { selections: Array<Record<string, unknown>>; nothingToSelect?: boolean; status?: string };
      expect(d.status).toBe('valid');
      expect(d.nothingToSelect).toBe(false);
      expect(typeof d.selections[0].occurrence).toBe('number');
      expect(typeof d.selections[0].occurrences).toBe('number');

      // Re-open: the stored selection re-highlights the same token (round-trip).
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
      await expect(page.getByTestId('tw-0')).toHaveAttribute('data-selected', '1');
    },
  );

  test(
    'an Invalid triage is decided in BOTH the progress meter and the item list — never one but not the other (B23)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      fs.rmSync(
        path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationNotes', 'TIT.json'),
        { force: true },
      );
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();

      const list = page.getByTestId('check-list');
      const meterDecided = async () =>
        Number((await page.getByTestId('check-progress').textContent())!.match(/(\d+) of/)![1]);
      const listDecided = () => list.locator('button[data-decided="1"]').count();

      // Take an undecided item and reject its rendering.
      const before = { meter: await meterDecided(), list: await listDecided() };
      const target = list.locator('button[data-decided="0"]').first();
      const targetRef = await target.getAttribute('data-ref');
      await target.click();
      await page.getByTestId('mark-invalid').click();

      // The meter AND the list must both move by exactly one — the defect was the
      // meter counting the Invalid while the list button still read undecided.
      await expect.poll(meterDecided, { timeout: 10_000 }).toBe(before.meter + 1);
      expect(await listDecided()).toBe(before.list + 1);
      await expect(
        list.locator(`button[data-ref="${targetRef}"][data-decided="1"]`).first(),
      ).toBeVisible();

      // On disk it is a real invalid decision, not an invalidation carry-over.
      const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      const inv = file!.decisions.find(
        (x) => (x as { status?: string }).status === 'invalid',
      ) as { status: string; invalidated?: boolean; selections?: unknown };
      expect(inv.status).toBe('invalid');
      expect(inv.invalidated).not.toBe(true);
      expect(inv.selections).toBe(false);
    },
  );

  test(
    'a pinned primary that is not installed opens the English fallback but WARNS and offers to fetch it — never silent (B20, D41)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      // Fallback = the installed English suite (covers TIT). Primary = a French
      // suite that is NOT installed in the rig, so it has no local coverage and
      // the resolver falls to the fallback. That is exactly the warned case.
      const en = PINS();
      // A real flavor and a sha are required: the fold refuses a pin entry
      // without them (D56 seedability, D58 sha identity). The French suite is
      // deliberately NOT installed, so any well-formed sha serves.
      const frPin = (name: string, n: number) => ({
        repoPath: `git.door43.org/fr_gl/${name}`,
        version: 'v10',
        sha: String(n).repeat(40).slice(0, 40),
        flavor: name.endsWith('_ta') ? 'peripheral/x-peripheralArticles' : name.endsWith('_tn') ? 'parascriptural/x-bcvnotes' : 'parascriptural/x-bcvarticles',
      });
      const setFor = (gw: { languageId: string; owner: string }, tn: unknown, tw: unknown, ta: unknown) => ({
        gatewayLanguage: gw,
        translationNotes: tn,
        translationWordsLinks: tw,
        translationWords: tw,
        translationAcademy: ta,
      });
      const file: Record<string, unknown> = {
        schemaVersion: 2,
        languageSets: {
          primary: setFor(
            { languageId: 'fr', owner: 'unfoldingWord' },
            frPin('fr_tn', 1),
            frPin('fr_tw', 2),
            frPin('fr_ta', 3),
          ),
          fallback: setFor({ languageId: 'en', owner: 'unfoldingWord' }, en.tn, en.tw, en.ta),
        },
        // Projection form only: empty groups are omitted (D56 seedability).
      };
      const dir = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking');
      const p = path.join(dir, 'resources.json');
      // Same carry-forward rule as writeProjectPins (issue #123/#124 review):
      // a whole-document rewrite keeps every top-level field it does not own
      // (extraScripture, the resources groups).
      if (fs.existsSync(p)) {
        const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
        for (const [key, value] of Object.entries(existing)) {
          if (key === 'schemaVersion' || key === 'languageSets') continue;
          file[key] = value;
        }
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);

      await openCheck(page);
      // The card is READY (the fallback works) — the fallback never blocks…
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByTestId('open-translationNotes')).toBeVisible();
      // …but it is NOT silent: the missing pinned primary is named, with a fetch offer.
      const warn = page.getByTestId('fallback-warning-translationNotes');
      await expect(warn).toBeVisible();
      await expect(warn).toContainText('fr_tn');
      await expect(page.getByTestId('fetch-primary-translationNotes')).toBeVisible();
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
        new RegExp(`\\d+ of ${expected} resolved`),
      );
      // The article comes out of the very same burrito (payload/…), proving the
      // one-pin-per-language rule end to end. Since F1 it sits behind the
      // Academy drawer.
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toBeVisible();
      await expect(page.getByTestId('article-panel')).toContainText('payload/');
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
