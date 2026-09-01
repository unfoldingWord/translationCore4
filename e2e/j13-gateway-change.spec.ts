// J13 — Two gateway-language resource sets: the ladder, the change, the cost
// JOURNEYS-AND-GAPS §2 J3/J12 · PRD FR-12/FR-22 · BURRITO-SPEC §5.2/§5.3
// D17/D30 (two rungs) · D23a/D30.2 (the change is explicit, with consequences)
// D36 (the resource is the primary key)
//
// EVERY OTHER JOURNEY RUNS ON ENGLISH ALONE, and English hides this whole path:
// one language set cannot exercise a ladder, a change, or a carry-over. This
// spec runs the rig with a real SECOND suite installed — es-419_gl at the pins
// verified in `evidence/es419-suite-pins-2026-07-31.md` — so the two-set code
// is exercised against real resources, not fixtures.
//
// Spanish coverage is genuinely partial (es-419_tn v66 carries 3JN/JON/RUT/TIT),
// which is the condition D30.1 exists for.
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import { deriveTnItems, mergeKey } from '../src/data/derive';
import {
  SEEDED_PROJECT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readProjectPins,
  readDecisionFile,
  resetSeededChecking,
  listSideloaded,
  sideloadedIngredient,
} from './helpers/rig';

// The configured org, NOT the one the export records: es-419's sb-zip exports
// still say `Idiomas-Puentes`, an org that 404s today (PLATFORM-NOTES #30).
const ES_ORG = 'es-419_gl';
const EN = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

async function openCheck(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
}

/** A check the ENGLISH notes ask about that the Spanish notes cannot place by
 * ANY pass of the D17 re-attach: not by `checkId`, not by the §5.2 identity
 * key, and not by the cross-language key (reference + original-language quote
 * + occurrence). Found by deriving both real TSVs and differencing.
 *
 * All three exclusions are needed, and that is a measured fact about real
 * data: es-419_tn is a translation of en_tn, so it KEEPS most check ids —
 * `reattachAcrossResource` matches on `checkId` alone first, so an item picked
 * by quote difference alone still re-attaches. Measured on TIT: en_tn derives
 * 157 items, es-419_tn 112, and 58 of the English items are unplaceable. */
function englishOnlyItem(book: string) {
  type Ctx = { reference: { chapter: unknown; verse: unknown }; quoteString: string; occurrence: number };
  const crossKey = (c: Ctx) =>
    [String(c.reference.chapter), String(c.reference.verse), c.quoteString, c.occurrence].join('|');
  const es = deriveTnItems(sideloadedIngredient('es-419_tn', `${book}.tsv`), book.toLowerCase());
  const esIds = new Set(es.map((i) => i.contextId.checkId));
  const esIdentity = new Set(es.map((i) => mergeKey(i.contextId)));
  const esCross = new Set(es.map((i) => crossKey(i.contextId as unknown as Ctx)));
  const hit = deriveTnItems(sideloadedIngredient('en_tn', `${book}.tsv`), book.toLowerCase())
    .find(
      (i) =>
        i.contextId.quoteString.length > 0 &&
        !esIds.has(i.contextId.checkId) &&
        !esIdentity.has(mergeKey(i.contextId)) &&
        !esCross.has(crossKey(i.contextId as unknown as Ctx)),
    );
  if (!hit) throw new Error('every English check is placeable in Spanish — fixture broken');
  return hit;
}

function writeDecisionFile(repo: string, tool: string, book: string, file: unknown): void {
  const p = path.join(rigRepo(repo), 'ingredients', 'checking', tool, `${book}.json`);
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

test.beforeEach(() => {
  resetSeededChecking();
});

test.describe('J13 — the rig really holds two gateway-language suites', () => {
  test(
    'a complete second suite is installed, with real release pins (FR-12)',
    { tag: ['@inc2', '@J13'] },
    async () => {
      for (const [name, version] of [
        ['es-419_tn', 'v66'],
        ['es-419_tw', 'v37'],
        ['es-419_ta', 'v4'],
      ] as const) {
        expect(listSideloaded()).toContain(name);
        const pin = pinForSideloaded(name, version, ES_ORG);
        expect(pin.version).toMatch(/^v[\d.]+$/);
        expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(pin.repoPath).toBe(`git.door43.org/${ES_ORG}/${name}`);
      }
    },
  );

  test(
    'the Spanish notes are real Spanish notes over the ORIGINAL-language quotes (D17)',
    { tag: ['@inc2', '@J13'] },
    async () => {
      // This is what makes cross-language re-attach possible at all: the two
      // resources differ in note language and check id, but quote the SAME
      // original-language words.
      const es = sideloadedIngredient('es-419_tn', 'TIT.tsv');
      const en = sideloadedIngredient('en_tn', 'TIT.tsv');
      expect(es.split('\n')[0]).toBe(en.split('\n')[0]); // same versioned header (§4.2)
      expect(es).toMatch(/[ἀ-ῼ]/u); // Greek quotes
      expect(es).toMatch(/[áéíóúñ¿]/u); // Spanish note prose
    },
  );

  test(
    'Spanish coverage is PARTIAL, which is exactly the case the ladder exists for (D30.1)',
    { tag: ['@inc2', '@J13'] },
    async () => {
      // es-419_tn v66 carries four books. The rig's books are among them; most
      // of the canon is not — so a project pinned Spanish-primary must still
      // work everywhere, via the English fallback rung.
      expect(() => sideloadedIngredient('es-419_tn', 'TIT.tsv')).not.toThrow();
      expect(() => sideloadedIngredient('es-419_tn', 'HEB.tsv')).toThrow();
      expect(() => sideloadedIngredient('en_tn', 'HEB.tsv')).not.toThrow();
    },
  );
});

test.describe('J13 — changing the project’s checking language', () => {
  test(
    'the change is offered where the user is choosing languages, and only for a COMPLETE installed suite (D30.2)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      await openCheck(page);
      await page.getByTestId('open-sources').click();
      await expect(page.getByTestId('sources-modal')).toBeVisible();

      // English IS the project's checking language: no change is offered.
      await page.getByRole('button', { name: /English/ }).first().click();
      await expect(page.getByTestId('already-checking-in')).toBeVisible();
      await expect(page.getByTestId('use-for-checking')).toHaveCount(0);

      // Spanish is installed and is NOT the current language: it is offered.
      await page.getByRole('button', { name: /Change language/ }).click();
      await page.getByRole('button', { name: /Español/ }).first().click();
      await expect(page.getByTestId('use-for-checking')).toBeVisible();
    },
  );

  test(
    'the consequences are shown BEFORE anything is written, with the exact per-book outcome (D23a / D36)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      // The sample's decisions record they were checked against the SPANISH
      // notes — under exact pin identity (D58) a change TO Spanish would be
      // genuinely harmless. This test is about LEAVING the checked-against
      // resource, so restate the record as the English pin the project now
      // holds (as if the book had been checked under English).
      const en = EN();
      const asCheckedUnderEnglish = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      asCheckedUnderEnglish.resource = {
        repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'fallback',
      } as never;
      writeDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT', asCheckedUnderEnglish);
      const before = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      expect(before!.decisions.length).toBeGreaterThan(0);

      await openCheck(page);
      await page.getByTestId('open-sources').click();
      await page.getByRole('button', { name: /Español/ }).first().click();
      await page.getByTestId('use-for-checking').click();

      const dialogue = page.getByTestId('gateway-change');
      await expect(dialogue).toBeVisible();
      await expect(page.locator('[data-harmless]')).toHaveAttribute('data-harmless', '0');
      // Not "some checks may be affected" — a count and named books.
      await expect(page.getByTestId('gateway-headline'))
        .toHaveText(/decisions? in .+ were made against the notes you are leaving/);
      // The exact outcome per book, derived from the NEW resource.
      await expect(page.getByTestId('gateway-plan'))
        .toContainText(/carried over, \d+ to check again/);

      // Declining changes NOTHING on disk.
      await page.getByTestId('gateway-cancel').click();
      await expect(dialogue).toHaveCount(0);
      expect(readProjectPins(SEEDED_PROJECT).languageSets.primary.gatewayLanguage.languageId)
        .toBe('en');
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.decisions)
        .toHaveLength(before!.decisions.length);
    },
  );

  test(
    'confirming moves the pins AND reconciles the decisions against the new resource (D36)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());

      // Give the book one decision that the SPANISH notes demonstrably do not
      // ask about — an English-only check. Without it nothing would be
      // invalidated: measured on this data, every decision the sample carries
      // re-attaches across the language change (D17 working), which is a real
      // outcome but leaves the invalidation branch unproven.
      const enOnly = englishOnlyItem('TIT');
      const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      // As in the consequences test: the change must LEAVE the checked-against
      // resource, so the record states the English pin (D58 exact identity).
      const en = EN();
      file.resource = {
        repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'fallback',
      } as never;
      const countBefore = file.decisions.length + 1;
      file.decisions.push({
        ...enOnly,
        selections: [{ text: 'siervo', occurrence: 1, occurrences: 1 }],
        comments: false,
        reminders: false,
        nothingToSelect: false,
        verseEdits: false,
        invalidated: false,
        status: 'valid',
      } as never);
      writeDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT', file);

      await openCheck(page);
      await page.getByTestId('open-sources').click();
      await page.getByRole('button', { name: /Español/ }).first().click();
      await page.getByTestId('use-for-checking').click();
      await expect(page.getByTestId('gateway-change')).toBeVisible();
      await page.getByTestId('gateway-confirm').click();
      await expect(page.getByTestId('gateway-change')).toHaveCount(0);

      // The primary rung moved; the English FALLBACK did not (D30.2).
      const pins = readProjectPins(SEEDED_PROJECT);
      expect(pins.languageSets.primary.gatewayLanguage).toEqual({
        languageId: 'es-419',
        owner: ES_ORG,
      });
      expect(pins.languageSets.fallback.gatewayLanguage.languageId).toBe('en');

      // The decision file was reconciled against the resource it now checks
      // with — the resource is the primary key.
      const after = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      expect(after.resource?.repoPath).toContain('es-419_tn');

      // NOTHING was deleted, and the English-only decision came back
      // invalidated — that check no longer exists, so it is work to do again.
      // Under the journal (§8.5 R-8.5.11) a RE-ATTACHED decision's old-identity
      // record is invalidated and RETAINED — never deleted — so the file holds
      // the original records PLUS the re-attached ones. The sample's two tN
      // decisions both re-attach (the fixture is built for that), so the count
      // grows by exactly those two; the pre-journal byte-replace semantics
      // (count unchanged) are retired with #62.
      expect(after.decisions.length).toBe(countBefore + 2);
      // Every original record survived — conservation, not replacement.
      for (const original of file.decisions) {
        expect(
          after.decisions.some((d) => mergeKey((d as never)['contextId']) === mergeKey((original as never)['contextId'])),
          'an original decision record was deleted by the change',
        ).toBe(true);
      }
      const carriedBack = after.decisions.find(
        (d) => mergeKey((d as never)['contextId']) === mergeKey(enOnly.contextId),
      );
      expect(carriedBack, 'the English-only decision is kept, not deleted').toBeTruthy();
      expect(carriedBack!.invalidated).toBe(true);
      expect(carriedBack!.status).toBe('invalid');

      // …while the decisions the Spanish notes DO ask about carried over.
      expect(after.decisions.filter((d) => d.invalidated !== true).length)
        .toBeGreaterThan(0);
    },
  );

  test(
    'after the change, the check session derives from the SPANISH notes (D30.1)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      await openCheck(page);
      await page.getByTestId('open-sources').click();
      await page.getByRole('button', { name: /Español/ }).first().click();
      await page.getByTestId('use-for-checking').click();
      await page.getByTestId('gateway-confirm').click();
      await expect(page.getByTestId('gateway-change')).toHaveCount(0);
      await page.getByRole('button', { name: /Close/ }).first().click();

      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toHaveText(/\d+ of \d+ resolved/);
      // The session states which resource it derived from, and it is Spanish.
      await expect(page.getByTestId('check-session')).toContainText('es-419_tn');
      // The note prose the user reads is Spanish now.
      await expect(page.getByTestId('check-note')).toContainText(/[áéíóúñ¿]/u);
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
