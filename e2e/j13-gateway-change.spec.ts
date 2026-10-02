// J13 — Two gateway-language resource sets: the ladder, the change, the cost
// docs/JOURNEYS.md J13 · shipped v4.0.0-alpha.2
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
import { test, expect } from './helpers/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import { deriveTnItems, isDecided, mergeKey } from '../src/data/derive';
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
  resetPlaces,
  RIG_CLIENT_SETTINGS,
} from './helpers/rig';
import { createObsProject, RIG_API } from './helpers/story';

// The configured org, NOT the one the export records: es-419's sb-zip exports
// still say `Idiomas-Puentes`, an org that 404s today (PLATFORM-NOTES #30).
const ES_ORG = 'es-419_gl';
const EN = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

const ES_KEY = 'es-419::es-419_gl';
const EN_KEY = 'en::unfoldingWord';
// The Spanish Bible-set pins and the installed repository each must equal.
const ES_SLOTS: Record<string, string> = {
  translationNotes: 'es-419_tn',
  translationWordsLinks: 'es-419_tw',
  translationWords: 'es-419_tw',
  translationAcademy: 'es-419_ta',
  simplifiedText: 'es-419_gst',
};
type PinOnDisk = { repoPath: string; sha?: string };
type ResourcesOnDisk = {
  languageSets: { primary: Record<string, PinOnDisk> & { gatewayLanguage: { languageId: string; owner: string } }; fallback: unknown };
  extraScripture: Array<{ id: string } & PinOnDisk>;
};

/** #505: Project Settings opens only from the Settings button on the project's card on Home.
 * From inside the open project, the way to Home is Switch project. */
async function openSettingsFromHome(page: import('@playwright/test').Page, project = SEEDED_PROJECT) {
  const leave = page.getByTitle('Switch project');
  if (await leave.count()) await leave.click();
  else await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${project}`).getByRole('button', { name: 'Settings' }).click();
}

/** A change from Home opens the project on its first book and leaves it open. Reach Titus on
 * Check in that same session, so the check reads the pins the change just wrote in memory. */
async function titusCheckInPlace(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Translate', exact: true }).click();
  await page.getByRole('complementary').getByRole('button', { name: /Titus/ }).click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
}

/** #412: the change starts in Project Settings. */
async function chooseInSettings(page: import('@playwright/test').Page, key: string) {
  await openSettingsFromHome(page);
  await page.getByTestId(`settings-gateway-${key}`).click();
  await expect(page.getByTestId('gateway-change')).toBeVisible();
}

/** A language set's pins as identities (repoPath + sha, D58): an open legally
 * adds the recorded coverage `books` to a pin (D41), which is not a change. */
function identities(set: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(set as Record<string, PinOnDisk & { languageId?: string }>)
    .map(([slot, pin]) => [slot, pin.repoPath ? `${pin.repoPath}@${pin.sha}` : pin]));
}

/** The first frame's text of story 1 in an installed OBS source. */
function firstFrame(name: string): string {
  const paragraphs = sideloadedIngredient(name, 'content/01.md').split(/\n\s*\n/).map((p) => p.trim());
  const frame = paragraphs.find((p) => p && !p.startsWith('#') && !p.startsWith('!['));
  if (!frame) throw new Error(`${name}: story 1 has no frame text`);
  return frame.split('\n')[0].slice(0, 40);
}

/** Confirm the change and wait for its one journal action. A refused change
 * keeps the dialogue open with its error, which is the failure reported. */
async function confirmChange(page: import('@playwright/test').Page) {
  await page.getByTestId('gateway-confirm').click();
  await expect(page.getByTestId('gateway-change').or(page.getByTestId('gateway-error'))).toHaveCount(0, { timeout: 30_000 });
}

/** Every file under the project's checking/ folder, as bytes. */
function checkingBytes(repo: string): Record<string, string> {
  const root = path.join(rigRepo(repo), 'ingredients', 'checking');
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(root, p)] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(root);
  return out;
}

/** A Spanish package with no Bible, for one test: the install records place the
 * rig's es-419 Bibles in the org their exports name (Idiomas-Puentes, PLATFORM-NOTES
 * #30), so es-419_gl has none. Call it before the page opens, and restore after
 * the page closes: the app is the file's other writer. */
function hideSpanishBibles(): void {
  const place = (org: string) => {
    const settings = JSON.parse(fs.readFileSync(RIG_CLIENT_SETTINGS, 'utf8')) as { installedResources: Record<string, { repoPath: string }> };
    for (const name of ['es-419_glt', 'es-419_gst'])
      settings.installedResources[`_local_/_sideloaded_/${name}`].repoPath = `git.door43.org/${org}/${name}`;
    fs.writeFileSync(RIG_CLIENT_SETTINGS, JSON.stringify(settings));
  };
  place('Idiomas-Puentes');
  // Only the two records go back, so the app's own writes in between stay.
  restoreSpanishBibles = () => place(ES_ORG);
}

/** Set while the Spanish Bibles are hidden. It runs before the next test and after
 * the last: the #417 fixture has settled the page's writes by then (test.ts). */
let restoreSpanishBibles: (() => void) | null = null;

async function openCheck(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
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
  restoreSpanishBibles?.();
  restoreSpanishBibles = null;
  resetSeededChecking();
});

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
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
    'Project Settings shows the current package and lists the installed packages from disk, with the network off; Home and Check have no Source texts button (#412)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      await fetch(`${RIG_API}/net/disable`, { method: 'POST' });
      await page.goto('/');
      await expect(page.getByTestId('open-sources')).toHaveCount(0);

      // From the project card on Home.
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByTestId('settings-gateway-current')).toHaveText('This project checks in English · unfoldingWord.');
      await expect(page.getByTestId(`settings-gateway-${EN_KEY}`)).toHaveAttribute('data-current', '1');
      await expect(page.getByTestId(`settings-gateway-${ES_KEY}`)).toHaveAttribute('data-current', '0');
      await page.getByRole('button', { name: 'Cancel' }).click();

      // Inside the open project the Check tab has no Source texts button and the top bar has no
      // Project settings button (#505); Settings opens from the Home card.
      await openCheck(page);
      await expect(page.getByTestId('open-sources')).toHaveCount(0);
      for (const tab of ['Understand', 'Translate', 'Check']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('project-settings')).toHaveCount(0);
      }
      await openSettingsFromHome(page);
      await expect(page.getByTestId(`settings-gateway-${ES_KEY}`)).toBeVisible();
      await expect(page.getByTestId('settings-gateway').locator('[data-testid^="settings-gateway-"][data-current]')).toHaveCount(2);

      // Manage source texts opens the existing Source texts screen.
      await page.getByTestId('settings-manage-sources').click();
      await expect(page.getByTestId('sources-modal')).toBeVisible({ timeout: 60_000 });
    },
  );

  test(
    'a project pinned to Latin American Spanish shows Spanish as its current package',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      await chooseInSettings(page, ES_KEY);
      await confirmChange(page);
      await openSettingsFromHome(page);
      await expect(page.getByTestId('settings-gateway-current')).toHaveText('This project checks in Spanish (Latin American) · es-419_gl.');
      await expect(page.getByTestId(`settings-gateway-${ES_KEY}`)).toHaveAttribute('data-current', '1');
      await expect(page.getByTestId(`settings-gateway-${EN_KEY}`)).toHaveAttribute('data-current', '0');
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

      await openSettingsFromHome(page);
      await expect(page.getByTestId(`settings-gateway-${ES_KEY}`)).toBeVisible();
      await page.getByTestId(`settings-gateway-${ES_KEY}`).click();

      const dialogue = page.getByTestId('gateway-change');
      await expect(dialogue).toBeVisible();
      // #471: the open-time backfill may write the pin file up until the
      // dialogue opens (the preview awaits it before reading). "Declining
      // changes NOTHING" means: nothing moves from the moment the question
      // is on screen — so capture the bytes once the dialogue is visible.
      const bytesBefore = checkingBytes(SEEDED_PROJECT);
      await expect(page.locator('[data-harmless]')).toHaveAttribute('data-harmless', '0');
      // Not "some checks may be affected" — a count and named books.
      await expect(page.getByTestId('gateway-headline'))
        .toHaveText(/decisions? in .+ were made against the notes you are leaving/);
      // The exact outcome per book, derived from the NEW resource.
      await expect(page.getByTestId('gateway-plan'))
        .toContainText(/carried over, \d+ to check again/);

      // Declining changes NOTHING on disk. From Home, choosing a package has closed Settings.
      await page.getByTestId('gateway-cancel').click();
      await expect(dialogue).toHaveCount(0);
      expect(checkingBytes(SEEDED_PROJECT)).toEqual(bytesBefore);
      await expect(page.getByTestId('settings-gateway')).toHaveCount(0);
      expect(checkingBytes(SEEDED_PROJECT)).toEqual(bytesBefore);
      expect(readProjectPins(SEEDED_PROJECT).languageSets.primary.gatewayLanguage.languageId)
        .toBe('en');
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.decisions)
        .toHaveLength(before!.decisions.length);
    },
  );

  test(
    'from Home: choosing a package opens the project, then the dialogue; Cancel writes nothing of the change (#412)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: 'Settings' }).click();
      await page.getByTestId(`settings-gateway-${ES_KEY}`).click();
      await expect(page.getByTestId('gateway-change')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTitle('Switch project')).toBeVisible();
      await expect(page.getByTestId('project-settings')).toHaveCount(0);
      // The open adopts installed optional slots (D64) on its own schedule; wait
      // until the pin file is stable, then nothing of the change may move it.
      const pinBytes = () => fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json'), 'utf8');
      let last = '';
      await expect.poll(() => { const now = pinBytes(); const same = now === last; last = now; return same; }, { intervals: [1500], timeout: 30_000 }).toBe(true);
      const atQuestion = pinBytes();
      const decisionsAtQuestion = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT');
      await page.getByTestId('gateway-cancel').click();
      await expect(page.getByTestId('gateway-change')).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(pinBytes()).toBe(atQuestion);
      expect(readProjectPins(SEEDED_PROJECT).languageSets.primary.gatewayLanguage.languageId).toBe('en');
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')).toEqual(decisionsAtQuestion);
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
      await openSettingsFromHome(page);
      await expect(page.getByTestId(`settings-gateway-${ES_KEY}`)).toBeVisible();
      await page.getByTestId(`settings-gateway-${ES_KEY}`).click();
      await expect(page.getByTestId('gateway-change')).toBeVisible();
      // The fallback as the project holds it when the change is asked for: the open that the choice
      // starts legally adopts the installed optional slots (D64), and it is done before the dialogue.
      const fallbackBefore = identities((readProjectPins(SEEDED_PROJECT) as unknown as ResourcesOnDisk).languageSets.fallback);
      await confirmChange(page);

      // The primary rung moved; the English FALLBACK did not (D30.2).
      const pins = readProjectPins(SEEDED_PROJECT) as unknown as ResourcesOnDisk;
      expect(pins.languageSets.primary.gatewayLanguage).toEqual({
        languageId: 'es-419',
        owner: ES_ORG,
      });
      expect(identities(pins.languageSets.fallback)).toEqual(fallbackBefore);
      // Each primary pin is the installed copy (#412 data check).
      for (const [slot, name] of Object.entries(ES_SLOTS)) {
        expect(pins.languageSets.primary[slot]?.sha, slot).toBe(pinForSideloaded(name, '', ES_ORG).sha);
      }
      // The source panes name the package's Bibles (owner Q3).
      expect(pins.extraScripture.map((e) => [e.id, e.repoPath, e.sha])).toEqual([
        ['glt', `git.door43.org/${ES_ORG}/es-419_glt`, pinForSideloaded('es-419_glt', '', ES_ORG).sha],
        ['gst', `git.door43.org/${ES_ORG}/es-419_gst`, pinForSideloaded('es-419_gst', '', ES_ORG).sha],
      ]);

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
      await chooseInSettings(page, ES_KEY);
      await confirmChange(page);
      await titusCheckInPlace(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toHaveText(/\d+ of \d+ resolved/);
      // The session states which resource it derived from, and it is Spanish.
      await expect(page.getByTestId('check-session')).toContainText('es-419_tn');
      // The note prose the user reads is Spanish now.
      await expect(page.getByTestId('check-note')).toContainText(/[áéíóúñ¿]/u);

      // Translate: the source panes are the Spanish Bibles (owner Q3).
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect(page.getByTestId('source-tab-glt')).toBeVisible();
      await expect(page.getByTestId('source-tab-gst')).toBeVisible();
      await expect(page.getByTestId('source-tab-ult')).toHaveCount(0);
      await expect(page.getByTestId('source-name')).toContainText('v42');
      // Understand: the notes are the Spanish ones.
      await page.getByRole('tab', { name: 'Understand', exact: true }).click();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await expect(page.getByTestId('helps-loading')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Notes', exact: true }).click();
      await expect(page.getByTestId('note-expand').first().locator('..')).toContainText(/[áéíóúñ¿]/u);
    },
  );

  test(
    'a switch from Settings after a check session: the open project derives its next session from the Spanish notes, and the next decision saves against them (#412)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      writeProjectPins(SEEDED_PROJECT, EN());
      // The sample's record names the Spanish notes; state it as the English pin
      // the project now holds, so a decision in the English session saves.
      const en = EN();
      const asEnglish = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      asEnglish.resource = { repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'fallback' } as never;
      writeDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT', asEnglish);
      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-session')).toContainText('en_tn');
      // A decision made just before the switch is saved before the plan reads the files.
      await page.getByTestId('check-list').locator('button[data-decided="0"]').first().click();
      await page.getByTestId('mark-valid').click();
      await chooseInSettings(page, ES_KEY);
      await confirmChange(page);
      await titusCheckInPlace(page);
      // The session derived from English is closed; the picker is back.
      await expect(page.getByTestId('check-session')).toHaveCount(0);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-session')).toContainText('es-419_tn');
      const before = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.decisions.length;
      await page.getByTestId('check-list').locator('button[data-decided="0"]').last().click();
      await page.getByTestId('mark-valid').click();
      await expect.poll(() => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')?.decisions.length, { timeout: 10_000 }).toBe(before + 1);
      expect(readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.resource?.repoPath).toContain('es-419_tn');
    },
  );

  test(
    'checks decided in English can be decided again after the change to Spanish: counted, shown with the Spanish quote, saved against es-419_tn (#448)',
    { tag: ['@inc8', '@J13'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      writeProjectPins(SEEDED_PROJECT, EN());
      const en = EN();
      const asEnglish = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      asEnglish.resource = { repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'fallback' } as never;
      writeDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT', asEnglish);

      // Three English checks, taken from the two real TSVs and the sample's records.
      // es-419_tn keeps the English check ids, so the change meets three cases:
      //  carried  — same id and quote in Spanish: carried over.
      //  recheck  — same id, another quote in Spanish: to check again.
      //  collided — as `recheck`, and a sample record with another id (swi9) is
      //             carried onto the Spanish check by reference + quote (D17): two
      //             records for one check id.
      const crossOf = (i: { contextId: { reference: unknown; quoteString: string; occurrence: number } }) => {
        const r = i.contextId.reference as { chapter: unknown; verse: unknown };
        return [String(r.chapter), String(r.verse), i.contextId.quoteString, i.contextId.occurrence].join('|');
      };
      const esItems = deriveTnItems(sideloadedIngredient('es-419_tn', 'TIT.tsv'), 'tit');
      const esByKey = new Map(esItems.map((i) => [mergeKey(i.contextId), i]));
      const esById = new Map(esItems.map((i) => [i.contextId.checkId, i]));
      const sampleCross = new Set(asEnglish.decisions.map((d) => crossOf(d as never)));
      const sampleIds = new Set(asEnglish.decisions.map((d) => (d.contextId as { checkId: string }).checkId));
      const enItems = deriveTnItems(sideloadedIngredient('en_tn', 'TIT.tsv'), 'tit').filter((i) => !sampleIds.has(i.contextId.checkId));
      const otherQuote = (i: (typeof enItems)[number]) => {
        const es = esById.get(i.contextId.checkId);
        return !!es && es.contextId.quoteString !== i.contextId.quoteString && !esByKey.has(mergeKey(i.contextId));
      };
      const carried = enItems.find((i) => esByKey.has(mergeKey(i.contextId)))!;
      const recheck = enItems.find((i) => otherQuote(i) && !sampleCross.has(crossOf(esById.get(i.contextId.checkId)!)))!;
      const collided = enItems.find((i) => otherQuote(i) && sampleCross.has(crossOf(esById.get(i.contextId.checkId)!)))!;
      expect(carried && recheck && collided, 'the real TSVs and the sample give one check of each kind').toBeTruthy();
      const checks = [carried, recheck, collided];

      await openCheck(page);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-session')).toContainText('en_tn');
      const item = (id: string) => page.locator(`[data-testid="check-list"] button[data-check-id="${id}"]`);
      const record = (id: string) => readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.decisions
        .find((d) => (d.contextId as { checkId: string }).checkId === id);
      const englishTitle: Record<string, string> = {};
      for (const one of checks) {
        const id = one.contextId.checkId;
        await item(id).click();
        englishTitle[id] = (await page.getByTestId('check-quote').textContent())!;
        await page.getByTestId('mark-valid').click();
        // The indicator may still read Saved from the last check: the record on disk is the proof.
        await expect.poll(() => record(id)?.status, { timeout: 10_000 }).toBe('valid');
      }

      await chooseInSettings(page, ES_KEY);
      await confirmChange(page);
      await titusCheckInPlace(page);
      await expect(page.getByTestId('check-session')).toHaveCount(0);
      // The picker card counts the Spanish list once it is current; a click before that opens the English one.
      await expect(page.getByTestId('preflight-translationNotes')).toContainText(`of ${esItems.length}`);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-session')).toContainText('es-419_tn');

      // Every carried-over decision is counted. The change kept `carried` and, for `collided`, the
      // record that the sample's swi9 brought: one record for the check id, not marked to check again.
      const kept = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!.decisions.filter((d) => d.invalidated !== true);
      const keptIds = kept.map((d) => (d.contextId as { checkId: string }).checkId);
      expect(keptIds).toEqual(expect.arrayContaining([carried.contextId.checkId, collided.contextId.checkId]));
      expect(keptIds.filter((id) => id === collided.contextId.checkId)).toHaveLength(1);
      const decided = kept.filter((d) => isDecided(d as never));
      await expect(page.getByTestId('check-progress')).toHaveText(new RegExp(`^${decided.length} of ${esItems.length} resolved`));

      // Deciding again saves, for all three, against the Spanish notes and with the Spanish quote.
      for (const one of checks) {
        const id = one.contextId.checkId;
        await item(id).click();
        await expect(page.getByTestId('check-quote')).not.toHaveText(englishTitle[id]);
        await page.getByTestId('mark-valid').click();
        await expect.poll(() => record(id)?.modifiedTimestamp, { timeout: 10_000 }).not.toBe(undefined);
        await expect.poll(() => [record(id)?.status, record(id)?.invalidated], { timeout: 10_000 }).toEqual(['valid', false]);
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('save-error')).toHaveCount(0);
      }
      const after = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      expect(after.resource?.repoPath).toContain('es-419_tn');
      for (const one of checks)
        expect(record(one.contextId.checkId)).toMatchObject({
          contextId: { quoteString: esById.get(one.contextId.checkId)!.contextId.quoteString },
        });
    },
  );

  test(
    'a package with no Bible installed: the source panes show the English ULT and UST, and extraScripture names them (owner Q5)',
    { tag: ['@inc2', '@J13'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, EN());
      // Start from Spanish panes, so the change must move them back to English.
      const pins = readProjectPins(SEEDED_PROJECT) as unknown as ResourcesOnDisk;
      pins.extraScripture = [
        { id: 'glt', ...pinForSideloaded('es-419_glt', 'v42', ES_ORG) },
        { id: 'gst', ...pinForSideloaded('es-419_gst', 'v40', ES_ORG) },
      ];
      hideSpanishBibles();
      {
        fs.writeFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json'), `${JSON.stringify(pins, null, 2)}\n`);
        await chooseInSettings(page, ES_KEY);
        await confirmChange(page);
        const after = readProjectPins(SEEDED_PROJECT) as unknown as ResourcesOnDisk;
        expect(after.languageSets.primary.gatewayLanguage.languageId).toBe('es-419');
        expect(after.extraScripture.map((e) => [e.id, e.repoPath, e.sha])).toEqual([
          ['ult', 'git.door43.org/unfoldingWord/en_ult', pinForSideloaded('en_ult', 'v89').sha],
          ['ust', 'git.door43.org/unfoldingWord/en_ust', pinForSideloaded('en_ust', 'v89').sha],
        ]);
        await page.getByRole('tab', { name: 'Translate', exact: true }).click();
        await expect(page.getByTestId('source-tab-ult')).toBeVisible();
        await expect(page.getByTestId('source-tab-ust')).toBeVisible();
      }
    },
  );

  test(
    'an OBS project changes its package from Settings: the OBS language set moves, the fallback and extraScripture do not (owner Q4)',
    { tag: ['@inc7', '@J13'] },
    async ({ page }) => {
      const repo = await createObsProject('j13obs', 'J13 OBS');
      const before = readProjectPins(repo) as unknown as ResourcesOnDisk;
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${repo}`).getByTestId('story-tile-1').click();
      await page.getByRole('tab', { name: 'Translate', exact: true }).click(); // a new story opens in Understand (D87)
      await expect(page.getByTestId('story-draft')).toContainText(firstFrame('en_obs'));
      await openSettingsFromHome(page, repo);
      await expect(page.getByTestId(`settings-gateway-${EN_KEY}`)).toHaveAttribute('data-current', '1');
      await page.getByTestId(`settings-gateway-${ES_KEY}`).click();
      await expect(page.getByTestId('gateway-change')).toBeVisible();
      await confirmChange(page);
      // The project opened for the change and is still open: its story shows the Spanish source
      // without leaving it, and names v2.
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect(page.getByTestId('story-draft')).toContainText(firstFrame('es-419_obs'));
      await expect(page.getByTestId('source-name')).toContainText('v2');
      await openSettingsFromHome(page, repo);
      await expect(page.getByTestId('settings-gateway-current')).toHaveText('This project checks in Spanish (Latin American) · es-419_gl.');
      const after = readProjectPins(repo) as unknown as ResourcesOnDisk;
      expect(after.languageSets.primary.gatewayLanguage).toEqual({ languageId: 'es-419', owner: ES_ORG });
      for (const name of ['es-419_obs', 'es-419_obs-tn', 'es-419_obs-twl', 'es-419_tw', 'es-419_ta']) {
        const slot = { 'es-419_obs': 'obs', 'es-419_obs-tn': 'obs-tn', 'es-419_obs-twl': 'obs-twl', 'es-419_tw': 'translationWords', 'es-419_ta': 'translationAcademy' }[name]!;
        expect(after.languageSets.primary[slot]?.sha, slot).toBe(pinForSideloaded(name, '', ES_ORG).sha);
      }
      expect(identities(after.languageSets.fallback)).toEqual(identities(before.languageSets.fallback));
      expect(after.extraScripture.map((e) => [e.id, e.repoPath, e.sha])).toEqual(before.extraScripture.map((e) => [e.id, e.repoPath, e.sha]));
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  restoreSpanishBibles?.();
  restoreSpanishBibles = null;
  await verifyAllJournaledProjects();
});
