// J4 — Check a book: derived tW/tN item list → read note/article → triage
// docs/JOURNEYS.md J4 · shipped v4.0.0-alpha.2 · run LTR and RTL (the J10 axis)
//
// Ground truth is the rig's disk, never UI state alone: the derived list must
// come from the pinned resource's own TSV, and every decision must land in the
// §5.2 sidecar with its resolution record.
import { test, expect } from './helpers/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { holdCheckpoints } from './helpers/checkpointHold';
import { articleMarks } from './helpers/articleMarks';
import { gateOff, turnOnInternet } from './helpers/door43Share';
import { cachedZip, mockDoor43Package, type CachedRepo } from './helpers/door43Package';
import { recordExternal } from './helpers/externalRequests';
import { LOCALES } from '../src/i18n/locales.js';
import { checkLayout, expectCheckLayout, type CheckLayout } from './helpers/checkLayout';
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
  resetPlaces, readClientSettingsDoc,
  readProjectPins,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  twl: pinForSideloaded('en_twl', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
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

/** Every ingredient byte outside the checking sidecars (#50: the text must
 * not move when a translator bookmarks or comments a check). */
function textIngredients(repo: string): Record<string, string> {
  const root = path.join(rigRepo(repo), 'ingredients');
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (path.relative(root, p) !== 'checking') walk(p);
      } else {
        out[path.relative(root, p)] = fs.readFileSync(p, 'utf8');
      }
    }
  };
  walk(root);
  return out;
}

/** Open the seeded project's Titus and land on the Check view. */
async function openCheck(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
}

test.beforeEach(() => {
  // Each spec states its own starting conditions (see resetSeededChecking).
  resetSeededChecking();
});

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
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
      // #100: the list moves at once; the write rides the check scheduler.
      // The indicator says Saved when the decision is durable — a reload
      // before that is the beforeunload case, not a restart.
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

      // Full reload: the list is re-derived from the TSV, and the saved
      // decisions must come back with it. The promise is that nothing is lost —
      // not an exact count, since re-attach and revalidation both legitimately
      // move the number.
      // #513: a restart returns to the open tool (#268, #329). The place record
      // reaches the rig 500 ms after the last change, so wait for it. A reload
      // before that opens the tool list, and a click there races the resume.
      const places = () =>
        readClientSettingsDoc()?.placeByProject as Record<string, Record<string, unknown>> | undefined;
      await expect
        .poll(() => places()?.[`_local_/_local_/${SEEDED_PROJECT}`]?.TIT, { timeout: 10_000 })
        .toMatchObject({ mode: 'check', tool: 'translationNotes' });
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
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
      // #100: the write lands behind the click; poll the file like the meter.
      const invalidOnDisk = () =>
        readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.find(
          (x) => (x as { status?: string }).status === 'invalid',
        ) as { status: string; invalidated?: boolean; selections?: unknown } | undefined;
      await expect.poll(() => invalidOnDisk()?.status, { timeout: 10_000 }).toBe('invalid');
      const inv = invalidOnDisk()!;
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
      // Two pins (D96/D97 ruling 6): the twl slot names a `_twl` repository.
      const setFor = (gw: { languageId: string; owner: string }, tn: unknown, twl: unknown, tw: unknown, ta: unknown) => ({
        gatewayLanguage: gw,
        translationNotes: tn,
        translationWordsLinks: twl,
        translationWords: tw,
        translationAcademy: ta,
      });
      const file: Record<string, unknown> = {
        schemaVersion: 2,
        languageSets: {
          primary: setFor(
            { languageId: 'fr', owner: 'unfoldingWord' },
            frPin('fr_tn', 1),
            frPin('fr_twl', 4),
            frPin('fr_tw', 2),
            frPin('fr_ta', 3),
          ),
          fallback: setFor({ languageId: 'en', owner: 'unfoldingWord' }, en.tn, en.twl, en.tw, en.ta),
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
    'a bookmark and a check comment persist in the §5.2 record, filter the rail, move no progress, and touch no text (#50, D72 point 4)',
    { tag: ['@inc6', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      restateRecordAsEnglish('translationNotes', 'TIT');
      const textBefore = textIngredients(SEEDED_PROJECT);
      const decisions = () => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions ?? [];
      const record = (id: string) => decisions().find((d) => (d.contextId as { checkId: string }).checkId === id);
      const count = async (chip: string) => Number(await page.getByTestId(`filter-${chip}`).getAttribute('data-count'));

      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();
      const progress = await page.getByTestId('check-progress').textContent();
      const before = decisions().length;
      const bookmarkedBefore = await count('bookmarked');
      const commentedBefore = await count('commented');

      // Pick an undecided check; its row tells us which disk record to watch.
      const row = page.getByTestId('check-list').locator('button[data-decided="0"]').first();
      const id = (await row.getAttribute('data-check-id')) as string;
      await row.click();

      // Bookmark → a §5.2 record with reminders:true and NO decision in it.
      await page.getByTestId('bookmark').click();
      await expect.poll(() => record(id)?.reminders, { timeout: 10_000 }).toBe(true);
      expect(decisions().length).toBe(before + 1);
      expect(record(id)?.selections).toBe(false);
      expect(record(id)?.nothingToSelect).not.toBe(true);
      const rowById = page.locator(`[data-check-id="${id}"]`);
      await expect(rowById).toHaveAttribute('data-bookmarked', '1');
      await expect(rowById).toHaveAttribute('data-decided', '0');
      await expect(rowById.getByTestId('row-bookmark')).toBeVisible();
      await expect(page.getByTestId('filter-bookmarked')).toHaveAttribute('data-count', String(bookmarkedBefore + 1));
      await expect(page.getByTestId('check-progress')).toHaveText(progress as string); // no progress moved

      // Comment → the same record's comments field, still no decision.
      await page.getByTestId('comment-toggle').click();
      await page.getByTestId('comment-text').fill('Ask the team about this one.');
      await page.getByTestId('comment-done').click();
      await expect.poll(() => record(id)?.comments, { timeout: 10_000 }).toBe('Ask the team about this one.');
      expect(decisions().length).toBe(before + 1);
      await expect(rowById).toHaveAttribute('data-commented', '1');
      await expect(rowById.getByTestId('row-comment')).toBeVisible();
      await expect(page.getByTestId('comment-toggle')).toHaveAttribute('data-written', '1');
      await expect(page.getByTestId('filter-commented')).toHaveAttribute('data-count', String(commentedBefore + 1));
      await expect(page.getByTestId('check-progress')).toHaveText(progress as string);

      // Reopen the project: both marks come back from disk, the chips filter to them.
      // #421: the tile resumes where this client last worked (#329). That is inside
      // this tool when the old page's hide save of the place reached the rig before
      // Home read it, and the tool list when it did not. Both open the same record.
      await openCheck(page);
      const toolButton = page.getByTestId('open-translationNotes');
      await expect(toolButton.or(page.getByTestId('check-progress'))).toBeVisible();
      if (await toolButton.isVisible()) await toolButton.click();
      await expect(page.getByTestId('check-progress')).toHaveText(progress as string);
      await page.getByTestId('filter-commented').click();
      await expect(page.getByTestId('check-list').locator('button')).toHaveCount(commentedBefore + 1);
      await expect(rowById).toHaveAttribute('data-bookmarked', '1');
      await expect(rowById).toHaveAttribute('data-commented', '1');
      await page.getByTestId('filter-bookmarked').click();
      await expect(page.getByTestId('check-list').locator('button')).toHaveCount(bookmarkedBefore + 1);
      await rowById.click();
      await page.getByTestId('comment-toggle').click();
      await expect(page.getByTestId('comment-text')).toHaveValue('Ask the team about this one.');

      // Edit, then delete the comment; clear the bookmark. The record stays, the fields reset.
      await page.getByTestId('comment-text').fill('Resolved with the team.');
      await page.getByTestId('comment-done').click();
      await expect.poll(() => record(id)?.comments, { timeout: 10_000 }).toBe('Resolved with the team.');
      await page.getByTestId('comment-toggle').click();
      await page.getByTestId('comment-delete').click();
      await expect.poll(() => record(id)?.comments, { timeout: 10_000 }).toBe(false);
      await expect(page.getByTestId('comment-toggle')).toHaveAttribute('data-written', '0');
      await page.getByTestId('bookmark').click();
      await expect.poll(() => record(id)?.reminders, { timeout: 10_000 }).toBe(false);
      expect(decisions().length).toBe(before + 1);
      await expect(page.getByTestId('check-progress')).toHaveText(progress as string);

      // The text ingredients are byte-identical: marks live in the sidecar only.
      expect(textIngredients(SEEDED_PROJECT)).toEqual(textBefore);
    },
  );

  // #737 (Birch: Option A, as tC3): dragging across draft words makes a real
  // selection, snapped to whole words, saved by Mark valid — in both checks.
  // The browser's text highlight does not stay behind as a fake selection.
  // `page.mouse` works in viewport coordinates: callers scroll the line into
  // view before they measure.
  const dragAcross = async (page: import('@playwright/test').Page, from: string, path: Array<{ x: number; y: number }>) => {
    const a = (await page.getByTestId(from).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (const p of path) await page.mouse.move(p.x, p.y, { steps: 12 });
    await page.mouse.up();
  };
  const selectedWords = (page: import('@playwright/test').Page) =>
    page.getByTestId('check-target').locator('[data-testid^="tw-"]').evaluateAll((els) =>
      els.filter((el) => el.getAttribute('data-selected') === '1').map((el) => el.getAttribute('data-testid')));
  const nativeSelection = (page: import('@playwright/test').Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');

  for (const tool of ['translationNotes', 'translationWords'] as const) {
    test(
      `${tool}: dragging from word 2 into the middle of word 4 selects words 2–4, whole, and Mark valid saves them (#737)`,
      { tag: ['@inc2', '@J4'] },
      async ({ page }, testInfo) => {
        writeProjectPins(SEEDED_PROJECT, { ...PINS(), twl: pinForSideloaded('en_twl', 'v91') });
        fs.rmSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', tool, 'TIT.json'), { force: true });
        await openCheck(page);
        await page.getByTestId(`open-${tool}`).click();
        await expect(page.getByTestId('check-progress')).toBeVisible();
        await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
        await expect(page.getByTestId('check-target')).toHaveAttribute('data-drafted', '1');
        await page.getByTestId('check-target').scrollIntoViewIfNeeded();

        const end = (await page.getByTestId('tw-3').boundingBox())!;
        await dragAcross(page, 'tw-1', [{ x: end.x + end.width / 2, y: end.y + end.height / 2 }]);
        expect(await selectedWords(page)).toEqual(['tw-1', 'tw-2', 'tw-3']);
        expect(await nativeSelection(page)).toBe('');
        const texts = await Promise.all([1, 2, 3].map(async (i) => (await page.getByTestId(`tw-${i}`).textContent())?.trim()));

        const shot = testInfo.outputPath(`check-737-${tool}.png`);
        await page.getByTestId('check-target').screenshot({ path: shot });
        await testInfo.attach(`check-737-${tool}.png`, { path: shot, contentType: 'image/png' });

        await page.getByTestId('mark-valid').click();
        await expect
          .poll(() => {
            const f = readDecisionFile(SEEDED_PROJECT, tool, 'TIT');
            const d = f?.decisions.find((x) => Array.isArray((x as { selections?: unknown }).selections)) as
              | { selections?: Array<{ text: string }> }
              | undefined;
            return d?.selections?.map((s) => s.text);
          }, { timeout: 10_000 })
          .toEqual(texts);

        // Leave and return: the saved selection shows on the same words.
        await page.getByTestId('check-list').locator('button[data-ref="1:2"]').first().click();
        await expect(page.getByTestId('check-list').locator('button[data-ref="1:2"]').first()).toHaveAttribute('data-selected', 'true');
        await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
        await expect(page.getByTestId('tw-3')).toHaveAttribute('data-selected', '1');
        expect(await selectedWords(page)).toEqual(['tw-1', 'tw-2', 'tw-3']);
      },
    );
  }

  test(
    'a drag that ends off the words selects the words it covered; a later click still toggles one word (#737)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
      await page.getByTestId('check-target').scrollIntoViewIfNeeded();
      const line = (await page.getByTestId('check-target').boundingBox())!;
      const w2 = (await page.getByTestId('tw-2').boundingBox())!;
      // Along the first line to word 2, then up off the words: release above
      // the line (going down would pass over the verse's next line).
      await dragAcross(page, 'tw-0', [
        { x: w2.x + w2.width / 2, y: w2.y + w2.height / 2 },
        { x: w2.x + w2.width / 2, y: line.y - 30 },
      ]);
      expect(await selectedWords(page)).toEqual(['tw-0', 'tw-1', 'tw-2']);
      expect(await nativeSelection(page)).toBe('');

      // A plain click right after a drag toggles that word, as before.
      await page.getByTestId('tw-0').click();
      await expect(page.getByTestId('tw-0')).toHaveAttribute('data-selected', '0');
      await page.getByTestId('tw-0').click();
      await expect(page.getByTestId('tw-0')).toHaveAttribute('data-selected', '1');
    },
  );

  test(
    'a drag that starts beside the words selects text to copy, selects no word, and does not look like a selected word (#737)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
      await page.getByTestId('check-target').scrollIntoViewIfNeeded();
      const w0 = (await page.getByTestId('tw-0').boundingBox())!;
      const w2 = (await page.getByTestId('tw-2').boundingBox())!;
      // Press just left of the first word (in the line's margin), drag to the
      // middle of word 2.
      await page.mouse.move(w0.x - 6, w0.y + w0.height / 2);
      await page.mouse.down();
      await page.mouse.move(w2.x + w2.width / 2, w2.y + w2.height / 2, { steps: 12 });
      await page.mouse.up();

      const words = await Promise.all([0, 1].map(async (i) => (await page.getByTestId(`tw-${i}`).textContent())!.trim()));
      const copied = await nativeSelection(page);
      expect(copied).toContain(words[0]);
      expect(copied).toContain(words[1]);
      expect(await selectedWords(page)).toEqual([]);
      // The text highlight is the system's, not the selected-word yellow.
      const colours = await page.evaluate(() => {
        const line = document.querySelector('[data-testid="check-target"]')!;
        const word = document.querySelector('[data-testid="tw-0"]')!;
        return { selection: getComputedStyle(word, '::selection').backgroundColor, picked: getComputedStyle(line).getPropertyValue('--tc-highlight-soft').trim() };
      });
      expect(colours.selection).not.toBe('');
      expect(colours.selection).not.toContain(colours.picked);
    },
  );

  test(
    'the tW tool derives its list from the en_twl pin and shows the article from the en_tw pin (D96, FR-15)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }, testInfo) => {
      writeProjectPins(SEEDED_PROJECT, { ...PINS(), twl: pinForSideloaded('en_twl', 'v91') });
      const tsv = sideloadedIngredient('en_twl', 'TIT.tsv');
      const expected = tsv.split('\n').slice(1).filter((r) => r.trim()).length;

      await openCheck(page);
      await page.getByTestId('open-translationWords').click();
      await expect(page.getByTestId('check-progress')).toHaveText(
        new RegExp(`\\d+ of ${expected} resolved`),
      );
      // The article comes out of the en_tw burrito (payload/…): two pins, one
      // for the links and one for the articles (D96). Since F1 it sits behind
      // the Academy drawer.
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toBeVisible();
      await expect(page.getByTestId('article-panel')).toContainText('payload/');

      // #619: the Translation Words article shows its `__…__` words in bold, and the
      // Translation Academy article of the first note shows its `>` lines as quote blocks.
      const words = await articleMarks(page.getByTestId('article-panel'));
      await page.getByTestId('academy-drawer').click({ position: { x: 10, y: 10 } });
      await page.getByTestId('check-back').click();
      await page.getByTestId('open-translationNotes').click();
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toContainText(/translate\/|checking\//);
      const academy = await articleMarks(page.getByTestId('article-panel'));
      const marks = testInfo.outputPath('check-article-marks.json');
      fs.writeFileSync(marks, `${JSON.stringify({ words, academy }, null, 2)}\n`);
      await testInfo.attach('check-article-marks', { path: marks, contentType: 'application/json' });
      expect(words.bold.length).toBeGreaterThan(0);
      expect(academy.quoteBlocks).toBeGreaterThan(0);
      expect(academy.bold.length).toBeGreaterThan(0);
      expect(academy.quoteIndentPx).toBeGreaterThan(0);
      expect(academy.boldWeight).toBeGreaterThanOrEqual(600);
      for (const seen of [words, academy]) {
        expect(seen.linesThatStartWithQuoteMark).toEqual([]);
        expect(seen.doubleUnderscores).toBe(0);
        expect(seen.doubleAsterisks).toBe(0);
      }
      await page.getByTestId('article-panel').locator('blockquote').first().scrollIntoViewIfNeeded();
      const shot = testInfo.outputPath('check-article-academy.png');
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach('check-article-academy', { path: shot, contentType: 'image/png' });
    },
  );

  test(
    'a notes check opened before the book text arrives shows the draft when it arrives (#722 class)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByTestId('book-tile-JON').click();
      const rail = page.getByRole('complementary');
      await expect(rail.getByRole('button', { name: /^Jonah \d+%/ })).toBeVisible();

      // Jonah → Titus while a checkpoint is held: the Titus check session is
      // new (a book switch closes the old one) and is built before the text.
      const hold = await holdCheckpoints(page);
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await expect.poll(hold.held).toBeGreaterThan(0);
      await expect(page.getByTestId('open-translationNotes')).toBeVisible();
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await rail.getByRole('button', { name: /^Titus \d+%/ }).click();
      await expect(page.getByText('Loading book…')).toBeVisible(); // the window: no book text
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();
      await page.getByTestId('check-list').locator('button[data-ref="1:1"]').first().click();
      const target = page.getByTestId('check-target');
      await expect(target).toHaveAttribute('data-drafted', '0'); // built without the text

      hold.release();
      await expect(target).toHaveAttribute('data-drafted', '1'); // TIT 1:1 is drafted in the sample
    },
  );

  // #765: a Hebrew maqaf (־) joins two words in one quote word, while the ULT
  // aligns each side on its own. Jonah is the rig's Old Testament book: in the
  // v91 pins 5 tN and 11 tW titles fell back to the Hebrew quote before the fix.
  test(
    'every Jonah title shows the ULT phrase, also for a quote with a maqaf (#765)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }, testInfo) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByTestId('book-tile-JON').click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      const list = page.getByTestId('check-list');
      const hebrewTitles = () => list.getByRole('button').filter({ hasText: /\p{Script=Hebrew}/u }).count();
      const cases = [
        { tool: 'translationNotes', id: 'z3jv', ref: '1:6', title: 'What to you' },
        { tool: 'translationWords', id: 'mtmh', ref: '1:1', title: 'the word of Yahweh' },
      ];
      for (const c of cases) {
        await page.getByTestId(`open-${c.tool}`).click();
        const row = list.locator(`button[data-check-id="${c.id}"]`);
        await expect(row).toContainText(`“${c.title}”`);
        await expect.poll(hebrewTitles).toBe(0);
        await row.click();
        await expect(page.getByTestId('ult-hl').first()).toBeVisible();
        expect((await page.getByTestId('ult-hl').allTextContents()).join(' ')).toBe(c.title);
        const shot = testInfo.outputPath(`j04-maqaf-${c.tool}-${c.ref.replace(':', '-')}.png`);
        await page.screenshot({ path: shot, animations: 'disabled' });
        await testInfo.attach(`j04-maqaf-${c.tool}`, { path: shot, contentType: 'image/png' });
        await page.getByTestId('check-back').click();
      }
    },
  );

  // #773: the ULT orders "μεγάλου Θεοῦ" and "Σωτῆρος ἡμῶν" differently from the
  // Greek, so the strict match fails. Before the fix the fallback marked every
  // group naming any quote word, and καὶ#1 ("hope and appearing") joined the
  // title as "and … of our great God and Savior Jesus Christ".
  test(
    'a Titus title for a reordered quote shows only its own ULT phrase (#773)',
    { tag: ['@inc2', '@J4'] },
    async ({ page }, testInfo) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      const phrase = 'of our great God and Savior Jesus Christ';
      const row = page.getByTestId('check-list').locator('button[data-check-id="xyz7"]');
      await expect(row).toContainText(`“${phrase}”`);
      await row.click();
      await expect(page.getByTestId('ult-hl').first()).toBeVisible();
      expect((await page.getByTestId('ult-hl').allTextContents()).join(' ')).toBe(phrase);
      const shot = testInfo.outputPath('j04-reordered-quote-tit-2-13.png');
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach('j04-reordered-quote', { path: shot, contentType: 'image/png' });
    },
  );
});

// ---- #762: the Check view's widths ----
// Widest first: each step is a live resize of one page, with no reload.
const WIDTHS_762 = [1920, 1600, 1280, 900];
/** The tN check (SupportReference set) with the longest note in the fixture's Titus. */
function longestNoteId(): string {
  const rows = sideloadedIngredient('en_tn', 'TIT.tsv').split('\n').slice(1)
    .map((r) => r.split('\t')).filter((c) => (c[3] ?? '') !== '');
  return rows.reduce((a, b) => ((b[6] ?? '').length > (a[6] ?? '').length ? b : a))[1];
}
async function openLongestNote(page: import('@playwright/test').Page) {
  writeProjectPins(SEEDED_PROJECT, PINS());
  await openCheck(page);
  await page.getByTestId('open-translationNotes').click();
  await page.getByTestId('check-list').locator(`[data-check-id="${longestNoteId()}"]`).click();
  await expect(page.getByTestId('note-expand')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('orig-pane').locator('p')).toBeVisible();
  await expect(page.getByTestId('ult-pane-text')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('#762 — the Check view uses the window width and keeps lines readable', () => {
  test('the longest note, at 1920, 1600, 1280 and 900px: 80ch text, one leading edge, the scripture texts side by side when they fit, and the buttons on screen @J4', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: WIDTHS_762[0], height: 800 });
    await openLongestNote(page);
    const seen: Record<number, CheckLayout> = {};
    for (const width of WIDTHS_762) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
      seen[width] = await checkLayout(page);
      const picture = testInfo.outputPath(`check-${width}.png`);
      await page.screenshot({ path: picture });
      await testInfo.attach(`check-${width}`, { path: picture, contentType: 'image/png' });
    }
    const file = testInfo.outputPath('check-layout.json');
    fs.writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`);
    await testInfo.attach('check-layout', { path: file, contentType: 'application/json' });
    for (const width of WIDTHS_762) expectCheckLayout(seen[width], `${width}px`);
    expect(seen[1920].card.width, 'the check column is wider than the old 760px cap').toBeGreaterThan(760);
    expect(seen[900].horizontalScroll, 'no horizontal scroll bar at 900px').toBe(false);
    // The resize from 1920 to 900 reflowed the two texts: side by side, then stacked.
    expect(seen[1920].cards[0].top).toBe(seen[1920].cards[1].top);
    expect(seen[900].cards[1].top).toBeGreaterThan(seen[900].cards[0].top);
    // The buttons stay on screen without scrolling at 1280×800 and wider.
    for (const width of [1920, 1600, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const id of ['mark-valid', 'mark-invalid', 'mark-todo']) {
        await expect(page.getByTestId(id), `${id} at ${width}px`).toBeInViewport({ ratio: 1 });
      }
    }
  });

  test('a right-to-left interface: the leading edge is the right edge and the first scripture text is at the right @J4', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLongestNote(page);
    // The App language dialog previews Arabic at once; Cancel restores English.
    await page.getByTestId('account-menu').click();
    await page.getByTestId('account-language').click();
    await page.getByTestId('language-select').click();
    await page.getByRole('option', { name: LOCALES.find((l) => l.id === 'ar')!.label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const seen = await checkLayout(page);
    const picture = testInfo.outputPath('check-rtl-1280.png');
    await page.screenshot({ path: picture });
    await testInfo.attach('check-rtl-1280', { path: picture, contentType: 'image/png' });
    await page.getByTestId('language-cancel').click();
    expectCheckLayout(seen, 'rtl 1280px');
    expect(seen.cards[0].top).toBe(seen.cards[1].top);
    expect(seen.cards[0].left, 'the first text is at the right').toBeGreaterThan(seen.cards[1].left);
  });
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

// ---- #650: the Arabic package (BSOJ) and an Arabic right-to-left project ----
// Run with the fixture selected: TC4_ARABIC_FIXTURE=1 npx playwright test e2e/j04-check-book.spec.ts
// The seed then builds `arabic_burrito` (scripts/seed-arabic-project.mjs), and Door43 is held
// still for BSOJ from the resource cache (helpers/door43Package.ts). The interface is English.
const ARABIC_PROJECT = 'arabic_burrito';
// BSOJ's catalogue entries as Door43 reports them [VERIFIED — git.door43.org
// /api/v1/catalog/search?owner=BSOJ&lang=ar&stage=latest, 2026-10-14]: flavor and topics as
// listed; the book lists cut to the rig's books. The catalogue also lists three Bibles
// (ar_avd, ar_arst, ar_nav: textTranslation, tc-ready) and ar_glt/ar_gst (no topics).
const BSOJ: CachedRepo[] = [
  { repo: 'ar_tn', tag: 'v6.1', flavor: 'x-bcvnotes', topics: ['tc-ready'], books: ['tit', 'jon'] },
  { repo: 'ar_twl', tag: 'v5.1', flavor: 'x-bcvarticles', topics: ['tc-ready'], books: ['tit', 'jon'] },
  { repo: 'ar_tw', tag: 'v5', flavor: 'x-peripheralArticles', topics: ['tc-ready'], books: [] },
  { repo: 'ar_ta', tag: 'v3', flavor: 'x-peripheralArticles', topics: ['tc-ready'], books: [] },
  { repo: 'ar_tq', tag: 'v3.1', flavor: 'x-bcvquestions', topics: ['tc-ready'], books: ['tit', 'jon'] },
];
// The catalogue held still lists the helps only. A Bible row is always downloaded, and
// served from the route the 90 MB ar_avd export closed the test's browser; a checking set
// needs tN, TWL, tW and tA (D17), not a Bible. The seed sideloads ar_avd instead (#704),
// so the gateway change finds BSOJ's literal Bible on the machine.
const arabicMissing = (): string | null => {
  if (process.env.TC4_ARABIC_FIXTURE !== '1') return 'the Arabic fixture is not selected: run with TC4_ARABIC_FIXTURE=1';
  const absent = BSOJ.filter((r) => !fs.existsSync(cachedZip(r.repo, r.tag))).map((r) => `${r.repo} ${r.tag}`);
  if (absent.length) return `not cached under dev-env/resources-cache: ${absent.join(', ')} — see dev-env/README.md`;
  if (!fs.existsSync(rigRepo(ARABIC_PROJECT))) return `the seed did not build ${ARABIC_PROJECT}`;
  return null;
};
// #704: a phrase of Titus 1:1 in each source Bible, NFC as the app may render either form.
const nfc = (s: string | null | undefined): string => (s ?? '').normalize('NFC');
const AR_AVD_TIT_1_1 = nfc('عَبْدُ ٱللهِ');
const EN_ULT_TIT_1_1 = 'a servant of God';
/** `dir` and the computed direction of each match of `loc`. */
const directionsOf = (loc: import('@playwright/test').Locator) =>
  loc.evaluateAll((els) => els.map((el) => ({ dir: el.getAttribute('dir'), direction: getComputedStyle(el).direction })));
/** `dir` and the computed direction of the first match, read on that one element. */
const directionOf = async (loc: import('@playwright/test').Locator) => {
  await expect(loc.first()).toBeVisible({ timeout: 30_000 });
  return loc.first().evaluate((el) => ({ dir: el.getAttribute('dir'), direction: getComputedStyle(el).direction }));
};
async function openArabicTitus(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${ARABIC_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
  await expect(page.getByTestId('understand')).toBeVisible({ timeout: 30_000 });
}

test.describe.serial('J4 — the Arabic package, in an Arabic right-to-left project (#650)', () => {
  test.beforeEach(() => {
    const missing = arabicMissing();
    test.skip(missing !== null, missing ?? '');
  });

  test('AC5: the Arabic project opens with right-to-left scripture panes @J4', async ({ page }, testInfo) => {
    await openArabicTitus(page);
    await page.getByRole('tab', { name: 'Translate', exact: true }).click();
    const target = page.getByTestId('draft-target-text');
    await expect(target.first()).toBeVisible({ timeout: 30_000 });
    const seen = { target: await directionsOf(target), document: await page.evaluate(() => document.documentElement.dir) };
    const file = testInfo.outputPath('arabic-scripture-direction.json');
    fs.writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`);
    await testInfo.attach('arabic-scripture-direction', { path: file, contentType: 'application/json' });
    const picture = testInfo.outputPath('arabic-project-translate.png');
    await page.screenshot({ path: picture });
    await testInfo.attach('arabic-project-translate', { path: picture, contentType: 'image/png' });
    expect(seen.document).toBe('ltr');
    expect(seen.target.length).toBeGreaterThan(0);
    for (const el of seen.target) expect(el.direction).toBe('rtl');
  });

  test('AC1: the project downloads BSOJ in the app and checks in it; the pins name BSOJ with a sha @J4', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await page.goto('/');
    await turnOnInternet(page);
    const stop = await mockDoor43Package(page, 'BSOJ', BSOJ);
    try {
      await page.getByTestId(`project-_local_/_local_/${ARABIC_PROJECT}`).getByRole('button', { name: 'Settings' }).click();
      await page.getByTestId('settings-manage-sources').click();
      const sources = page.getByTestId('sources-modal');
      await expect(sources).toBeVisible({ timeout: 60_000 });
      // AC6 (D100): the language step lists one Arabic package, BSOJ's.
      await expect(sources.getByText('العربية', { exact: true })).toHaveCount(1);
      await expect(sources.getByText(/^(BSOJ|ar_gt) · /)).toHaveText([/^BSOJ · /]);
      await sources.getByText(/^BSOJ · /).click();
      await page.getByTestId('sources-download').click();
      await expect(page.getByTestId('sources-done')).toBeVisible({ timeout: 240_000 });
      await page.getByTestId('use-for-checking').click();
      await expect(page.getByTestId('gateway-change')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('gateway-confirm').click();
      await expect(page.getByTestId('gateway-change').or(page.getByTestId('gateway-error'))).toHaveCount(0, { timeout: 60_000 });
    } finally {
      await stop();
      await gateOff();
    }
    const primary = readProjectPins(ARABIC_PROJECT).languageSets.primary as Record<string, { repoPath?: string; sha?: string }> & { gatewayLanguage: unknown };
    const file = testInfo.outputPath('arabic-pins.json');
    fs.writeFileSync(file, `${JSON.stringify(primary, null, 2)}\n`);
    await testInfo.attach('arabic-pins', { path: file, contentType: 'application/json' });
    expect(primary.gatewayLanguage).toEqual({ languageId: 'ar', owner: 'BSOJ' });
    for (const [slot, repo] of [['translationNotes', 'ar_tn'], ['translationWordsLinks', 'ar_twl'], ['translationWords', 'ar_tw'], ['translationAcademy', 'ar_ta']]) {
      expect(primary[slot]?.repoPath, slot).toMatch(new RegExp(`/BSOJ/${repo}$`));
      expect(primary[slot]?.sha, slot).toMatch(/^[0-9a-f]{40}$/);
    }
    // #704 AC1: the literal source pane names BSOJ's Bible (the seed installs ar_avd).
    const panes = (readProjectPins(ARABIC_PROJECT) as { extraScripture?: Array<{ id: string; repoPath: string; sha?: string }> }).extraScripture ?? [];
    const panesFile = testInfo.outputPath('arabic-source-panes.json');
    fs.writeFileSync(panesFile, `${JSON.stringify(panes, null, 2)}\n`);
    await testInfo.attach('arabic-source-panes', { path: panesFile, contentType: 'application/json' });
    const literal = panes.find((p) => p.id === 'ult' || p.id === 'glt');
    expect(literal?.repoPath).toMatch(/\/BSOJ\/ar_avd$/);
    expect(literal?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test('AC2 and AC4: with the internet off and an English interface, the Arabic helps read right to left, the tW list comes from ar_twl, and nothing leaves the computer @J4', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await gateOff();
    const external = recordExternal(page);
    const seen: Record<string, unknown> = {};
    await openArabicTitus(page);
    // The helps panel of Understand.
    const helps = page.getByTestId('helps-panel');
    seen.note = await directionOf(page.getByTestId('helps-note'));
    await helps.getByRole('button', { name: 'Translation Academy →', exact: true }).first().click();
    seen.article = await directionOf(page.getByTestId('understand-article'));
    seen.articleTitle = await directionOf(page.getByTestId('helps-article-title'));
    await page.getByTestId('helps-article-close').click();
    await helps.getByRole('tab', { name: 'Words', exact: true }).click();
    seen.word = await directionOf(page.getByTestId('helps-word'));
    await helps.getByRole('button', { name: 'Read the article →', exact: true }).first().click();
    seen.wordArticle = await directionOf(page.getByTestId('understand-article'));
    seen.wordArticleTitle = await directionOf(page.getByTestId('helps-article-title'));
    seen.wordArticleText = (await page.getByTestId('understand-article').textContent())?.slice(0, 80);
    await page.getByTestId('helps-article-close').click();
    const understandPicture = testInfo.outputPath('arabic-helps-understand.png');
    await page.screenshot({ path: understandPicture });
    await testInfo.attach('arabic-helps-understand', { path: understandPicture, contentType: 'image/png' });
    // #704 AC2: Translate's source pane shows BSOJ's Arabic Bible, not the English ULT.
    await page.getByRole('tab', { name: 'Translate', exact: true }).click();
    const source = page.getByTestId('draft-source-text');
    await expect(source.first()).toBeVisible({ timeout: 30_000 });
    seen.translateSource = nfc(await source.first().textContent());
    const translatePicture = testInfo.outputPath('arabic-source-translate.png');
    await page.screenshot({ path: translatePicture });
    await testInfo.attach('arabic-source-translate', { path: translatePicture, contentType: 'image/png' });
    // Check: tN, then tW.
    await page.getByRole('tab', { name: 'Check', exact: true }).click();
    await page.getByTestId('open-translationNotes').click();
    seen.checkNote = await directionOf(page.getByTestId('check-note-text'));
    // #762: an Arabic note obeys the same width rules.
    await page.evaluate(() => document.fonts.ready);
    expectCheckLayout(await checkLayout(page), 'Arabic note');
    // #704 AC2: the Check view's gateway row shows the same Bible.
    await expect(page.getByTestId('ult-pane-text')).toBeVisible({ timeout: 30_000 });
    seen.checkGatewayRow = nfc(await page.getByTestId('ult-pane-text').textContent());
    const sourcePicture = testInfo.outputPath('arabic-source-check.png');
    await page.screenshot({ path: sourcePicture, animations: 'disabled' });
    await testInfo.attach('arabic-source-check', { path: sourcePicture, contentType: 'image/png' });
    await page.getByTestId('open-academy').click();
    seen.checkArticle = await directionOf(page.getByTestId('academy-drawer').getByTestId('article-panel'));
    await page.keyboard.press('Escape');
    await page.getByTestId('check-back').click();
    await page.getByTestId('open-translationWords').click();
    const twSource = page.getByText(/git\.door43\.org\/BSOJ\/ar_twl/);
    await expect(twSource).toBeVisible({ timeout: 30_000 });
    seen.twSource = (await twSource.textContent())?.trim();
    seen.twProgress = (await page.getByTestId('check-progress').textContent())?.trim();
    await page.getByTestId('open-academy').click();
    seen.checkWordArticle = await directionOf(page.getByTestId('academy-drawer').getByTestId('article-panel'));
    seen.checkWordArticleText = (await page.getByTestId('academy-drawer').getByTestId('article-panel').textContent())?.slice(0, 80);
    const checkPicture = testInfo.outputPath('arabic-helps-check.png');
    await page.screenshot({ path: checkPicture, animations: 'disabled' });
    await testInfo.attach('arabic-helps-check', { path: checkPicture, contentType: 'image/png' });
    seen.external = external.external();
    seen.document = await page.evaluate(() => document.documentElement.dir);
    const file = testInfo.outputPath('arabic-helps-direction.json');
    fs.writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`);
    await testInfo.attach('arabic-helps-direction', { path: file, contentType: 'application/json' });
    await external.save(testInfo);

    expect(seen.document).toBe('ltr');
    for (const part of ['note', 'article', 'articleTitle', 'word', 'wordArticle', 'wordArticleTitle', 'checkNote', 'checkArticle', 'checkWordArticle']) {
      expect(seen[part], part).toEqual({ dir: 'rtl', direction: 'rtl' });
    }
    expect(seen.twSource).toContain('git.door43.org/BSOJ/ar_twl');
    // The tW list has items: "0 of N resolved", N > 0.
    expect(Number(/of (\d+)/.exec(String(seen.twProgress))?.[1] ?? 0)).toBeGreaterThan(0);
    // The tW articles are Arabic text.
    for (const part of ['wordArticleText', 'checkWordArticleText']) expect(String(seen[part]), part).toMatch(/[\u0600-\u06FF]/);
    expect(seen.external).toEqual([]);
    // #704 AC2: Titus 1:1 in BSOJ's ar_avd v6.9 and in the English ULT v91 (both from their cached exports).
    for (const part of ['translateSource', 'checkGatewayRow']) {
      expect(String(seen[part]), part).toContain(AR_AVD_TIT_1_1);
      expect(String(seen[part]), part).not.toContain(EN_ULT_TIT_1_1);
    }
  });
});
