// J12 — Upgrade the pinned resources: see the offer → accept explicitly → re-derive
// docs/JOURNEYS.md J12 · Increment 6 (#40, #256, #257; decision D72 point 5)
//
// Ground truth is the rig's disk: the §5.3 pin file, the §5.2 decision files
// and every text ingredient are read as bytes before and after. DCS is a
// Playwright route on git.door43.org that serves the REAL v90 exports of the
// English helps, cached by `dev-env/scripts/cache-resource.zsh` (see
// dev-env/README.md, "J12"): the rig seeds v89, DCS's newest release is v90
// [VERIFIED 2026-09-13, `releases/latest`], so the fixture is the real world
// held still — the journey neither depends on the network nor on what Door43
// publishes next. Case 3 needs a check the new release no longer asks; v89 →
// v90 changes no Titus check id (measured on both TSVs), so the served notes
// drop ONE Titus row. The zip's declared revision is unchanged, which is what
// the D23b sha gate verifies.
import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { deriveTnItems, mergeAndReattach, mergeKey } from '../src/data/derive';
import {
  SEEDED_PROJECT,
  TC4_ROOT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readProjectPins,
  readDecisionFile,
  resetSeededChecking,
  sideloadedIngredient,
  resetPlaces,
} from './helpers/rig';

const CACHE = path.join(TC4_ROOT, 'dev-env', 'resources-cache');
const NEW_TAG = 'v90';
/** The repos the mocked DCS reports a newer release for. tq and ust stay at
 * their pins, so the fallback set's optional slots are the "current" case. */
const NEWER = ['en_tn', 'en_tw', 'en_ta'];

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

const cachedZipPath = (repo: string) => path.join(CACHE, `${repo}-${NEW_TAG}-unwrapped.zip`);

/** The commit the cached export declares — the sha the mocked tags API reports
 * for v90, so the app's D23b verification sees a consistent DCS. */
function cachedRevision(repo: string): string {
  const files = unzipSync(new Uint8Array(fs.readFileSync(cachedZipPath(repo))));
  const meta = JSON.parse(strFromU8(files['metadata.json'])) as {
    identification: { primary: { dcs: Record<string, { revision: string }> } };
  };
  return Object.values(meta.identification.primary.dcs)[0].revision;
}

/** The v90 notes with one Titus row removed (case 3's dropped check). */
let servedTn: { bytes: Uint8Array; droppedId: string } | null = null;
function servedNotes(dropId: string): Uint8Array {
  if (servedTn && servedTn.droppedId === dropId) return servedTn.bytes;
  const files = unzipSync(new Uint8Array(fs.readFileSync(cachedZipPath('en_tn'))));
  const rows = strFromU8(files['ingredients/TIT.tsv']).split('\n');
  const kept = rows.filter((r, i) => i === 0 || (r.split('\t')[1] ?? '') !== dropId);
  if (kept.length !== rows.length - 1) throw new Error(`check ${dropId} is not one row of the v90 TIT notes`);
  files['ingredients/TIT.tsv'] = strToU8(kept.join('\n'));
  servedTn = { bytes: zipSync(files, { level: 0 }), droppedId: dropId };
  return servedTn.bytes;
}

/** Door43, held still: every pinned repo answers with its pin unless it is in
 * NEWER, which answers v90 from the cache. Anything else on the host is 404. */
async function mockDcs(context: BrowserContext, dropId: string) {
  const pinsFile = readProjectPins(SEEDED_PROJECT);
  const pinned: Record<string, { version: string; sha: string }> = {};
  for (const set of Object.values(pinsFile.languageSets)) {
    for (const entry of Object.values(set)) {
      const pin = entry as { repoPath?: string; version?: string; sha?: string };
      if (pin?.repoPath && pin.sha) pinned[pin.repoPath.split('/').pop() as string] = { version: pin.version ?? '', sha: pin.sha };
    }
  }
  const cors = { 'access-control-allow-origin': '*' };
  await context.route(/^https:\/\/git\.door43\.org\//, async (route) => {
    const url = new URL(route.request().url());
    const m = /^\/(?:api\/v1\/repos\/)?unfoldingWord\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!m) return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
    const [, repo, rest] = m;
    const newer = NEWER.includes(repo);
    const tag = newer ? NEW_TAG : pinned[repo]?.version;
    const sha = newer ? cachedRevision(repo) : pinned[repo]?.sha;
    if (!tag || !sha) return route.fulfill({ status: 404, headers: cors, body: 'unknown repo' });
    if (rest === 'releases/latest') {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ tag_name: tag, published_at: newer ? '2026-08-17T19:15:10Z' : '2026-06-23T22:01:21Z' }) });
    }
    if (rest.startsWith('tags')) {
      const page = Number(url.searchParams.get('page') ?? '1');
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify(page === 1 ? [{ name: tag, commit: { sha } }] : []) });
    }
    if (rest === `sb/${NEW_TAG}.zip` && newer) {
      const bytes = repo === 'en_tn' ? servedNotes(dropId) : new Uint8Array(fs.readFileSync(cachedZipPath(repo)));
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/zip', body: Buffer.from(bytes) });
    }
    return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
  });
}

function writeDecisionFile(repo: string, tool: string, book: string, file: unknown): void {
  fs.writeFileSync(path.join(rigRepo(repo), 'ingredients', 'checking', tool, `${book}.json`), `${JSON.stringify(file, null, 2)}\n`);
}

/** The sample records es-419; the project now pins English v89 — restate the
 * checked-against record as that pin (the J4/J13 pattern), and add ONE valid
 * decision on a real v89 Titus check that the served v90 notes will not ask. */
function seedDecisionsUnderV89(): {
  dropped: ReturnType<typeof deriveTnItems>[number];
  count: number;
  orphans: number;
  /** The sample decisions that DO place on the v89 list — the ones the upgrade carries. */
  carried: Array<Record<string, unknown>>;
} {
  const en = PINS();
  const file = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
  file.resource = { repoPath: en.tn.repoPath, version: en.tn.version, sha: en.tn.sha, languageSet: 'primary' } as never;
  const items = deriveTnItems(sideloadedIngredient('en_tn', 'TIT.tsv'), 'tit');
  // Place the sample's decisions on the v89 list with the app's OWN re-attach
  // (derive.ts mergeAndReattach — the same passes the upgrade runs): the
  // dropped check must carry no decision, or dropping it would invalidate a
  // sample decision as well; and a sample decision that places on NO v89 check
  // is an orphan already — the upgrade invalidates it too (D36), on top of the
  // dropped one. (Measured: the sample's `swi9` collides with a different v89
  // check id over a different quote, so it is an orphan under English.)
  const placement = mergeAndReattach(items, file.decisions as never);
  const dropped = items.find((i) => i.contextId.quoteString.length > 0 && !placement.placed.has(i));
  if (!dropped) throw new Error('no undecided Titus check to drop — fixture broken');
  const orphans = placement.unplaced.length;
  const unplaced = new Set(placement.unplaced as unknown as Array<Record<string, unknown>>);
  const carried = file.decisions.filter((d) => !unplaced.has(d));
  file.decisions.push({
    ...dropped,
    selections: [{ text: 'Pablo', occurrence: 1, occurrences: 1 }],
    comments: false, reminders: false, nothingToSelect: false, verseEdits: false, invalidated: false,
    status: 'valid',
  } as never);
  writeDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT', file);
  return { dropped, count: file.decisions.length, orphans, carried };
}

const pinsBytes = () => fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json'));
const decisionBytes = () => fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationNotes', 'TIT.json'));

/** The pin IDENTITIES (§5.3: repoPath + sha, version as label) per set and
 * slot. Opening a project materializes the pin file from the journal, may
 * record coverage (`books`, D41) and adopts installed OPTIONAL slots (tq,
 * simplifiedText — D64) into a set that lacks them: byte changes and added
 * slots that move no pin. `onlyWritten` picks the slots a case wrote. */
const WRITTEN_SLOTS = ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
const onlyWritten = (ids: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(ids).filter(([k]) => WRITTEN_SLOTS.includes(k.split('.')[1])));
function pinIdentities() {
  const out: Record<string, unknown> = {};
  for (const [rung, set] of Object.entries(readProjectPins(SEEDED_PROJECT).languageSets)) {
    for (const [slot, entry] of Object.entries(set)) {
      const pin = entry as { repoPath?: string; version?: string; sha?: string };
      if (pin?.repoPath) out[`${rung}.${slot}`] = { repoPath: pin.repoPath, version: pin.version, sha: pin.sha };
    }
  }
  return out;
}

/** Open the project, land on Check, open the notes tool once: the app's own
 * open-time writes (journal seed, coverage backfill) have run, so what the
 * cases snapshot afterwards is exactly what the offer and the cancel touch. */
async function settleOpen(page: Page) {
  await openSources(page);
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByTestId('sources-modal')).toHaveCount(0);
  await page.getByTestId('open-translationNotes').click();
  await expect(page.getByTestId('check-progress')).toBeVisible();
}

/** Every ingredient byte outside the checking sidecars. */
function textIngredients(): Record<string, Buffer> {
  const root = path.join(rigRepo(SEEDED_PROJECT), 'ingredients');
  const out: Record<string, Buffer> = {};
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { if (path.relative(root, p) !== 'checking') walk(p); }
      else out[path.relative(root, p)] = fs.readFileSync(p);
    }
  };
  walk(root);
  return out;
}

async function openSources(page: Page) {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-sources').click();
  await expect(page.getByTestId('sources-modal')).toBeVisible();
}

async function goOnline(page: Page) {
  const online = page.getByRole('button', { name: 'Go online' });
  if (await online.count()) await online.first().click();
  await expect(page.getByTestId('check-updates')).toBeEnabled();
}

/** Check for updates, accept the primary set's offer, and wait for the
 * confirmation to open — the release is downloaded and installed by then. */
async function acceptPrimaryOffer(page: Page) {
  await page.getByTestId('check-updates').click();
  const offer = page.getByTestId('upgrade-offer-primary');
  await expect(offer).toHaveAttribute('data-upgrades', String(NEWER.length));
  await page.getByTestId('upgrade-set-primary').click();
  await expect(page.getByTestId('upgrade-confirm')).toBeVisible({ timeout: 150_000 });
}

/** The rig boots net-disabled, but the gate is in-memory and survives a reseed:
 * a previous run that went online leaves it on. Each case states its own
 * starting condition (POST /net/disable is the platform's own switch). */
async function forceOffline() {
  await fetch('http://127.0.0.1:19998/api/net/disable', { method: 'POST' });
}

test.beforeEach(async () => {
  resetSeededChecking();
  await forceOffline();
  test.skip(!NEWER.every((r) => fs.existsSync(cachedZipPath(r))),
    `the v90 exports are not cached under dev-env/resources-cache — see dev-env/README.md, "J12"`);
});

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
});

test.describe('J12 — a facilitator upgrades the pinned resources', () => {
  test(
    'pins never move without the explicit accept: open, Check, preflight, the offer, close — resources.json is byte-identical (FR-22, #3)',
    { tag: ['@inc6', '@J12'] },
    async ({ page, context }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      const { dropped } = seedDecisionsUnderV89();
      await mockDcs(context, dropped.contextId.checkId);
      const written = onlyWritten(pinIdentities());

      // Opening the project, opening Check and running the preflight move no pin.
      await settleOpen(page);
      expect(onlyWritten(pinIdentities())).toEqual(written);
      const before = pinsBytes();

      await openSources(page);
      // Offline: the action is disabled and says why.
      await expect(page.getByTestId('check-updates')).toBeDisabled();
      await expect(page.getByTestId('upgrade-offline')).toContainText(/offline/i);
      await goOnline(page);

      // Online: the offer lists, per set, each newer release with label and date.
      await page.getByTestId('check-updates').click();
      const primary = page.getByTestId('upgrade-offer-primary');
      await expect(primary).toHaveAttribute('data-upgrades', String(NEWER.length));
      await expect(primary).toContainText(/en_tn v89 → v90 · 2026-08-17/);
      await expect(page.getByTestId('upgrade-offer-fallback')).toHaveAttribute('data-upgrades', String(NEWER.length));

      // Close without accepting. Nothing moved — not a byte.
      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByTestId('sources-modal')).toHaveCount(0);
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toBeVisible();
      expect(pinsBytes().equals(before)).toBe(true);
      expect(onlyWritten(pinIdentities())).toEqual(written);
    },
  );

  test(
    'accepting moves the set to the new release: pins carry the new commit and label, the list re-derives, matching decisions re-attach; a dropped check is invalidated and kept, progress drops; the other set and the text are byte-identical (D36, D72)',
    { tag: ['@inc6', '@J12'] },
    async ({ page, context }) => {
      test.setTimeout(240_000);
      writeProjectPins(SEEDED_PROJECT, PINS());
      const { dropped, count, orphans, carried } = seedDecisionsUnderV89();
      expect(carried.length).toBeGreaterThan(0);
      await mockDcs(context, dropped.contextId.checkId);
      const textBefore = textIngredients();

      // Progress under v89, with the seeded decision counted.
      await settleOpen(page);
      // Snapshots AFTER the app's own open-time writes (journal seed, coverage backfill).
      const fallbackBefore = JSON.stringify(readProjectPins(SEEDED_PROJECT).languageSets.fallback);
      const groupsBefore = JSON.stringify((readProjectPins(SEEDED_PROJECT) as { resources?: unknown }).resources ?? null);
      const shaBefore = readProjectPins(SEEDED_PROJECT).languageSets.primary.translationNotes as { sha: string };
      await expect(page.getByTestId('check-progress')).toHaveText(/\d+ of \d+ resolved/);
      const progressBefore = /(\d+) of (\d+) resolved/.exec((await page.getByTestId('check-progress').textContent()) ?? '')!;
      const [decidedBefore, totalBefore] = [Number(progressBefore[1]), Number(progressBefore[2])];
      expect(decidedBefore).toBeGreaterThan(0);

      await openSources(page);
      await goOnline(page);
      await acceptPrimaryOffer(page);

      // The confirmation states the exact outcome per book and tool BEFORE the pins move…
      const confirm = page.getByTestId('upgrade-confirm');
      await expect(confirm.getByTestId('upgrade-moves')).toContainText('en_tn: v89 → v90');
      await expect(page.locator('[data-harmless]')).toHaveAttribute('data-harmless', '0');
      // The exact per-(book, tool) outcome: the dropped check, plus any sample
      // decision that already placed on no v89 check (an orphan is invalidated
      // by the change too — the resource is the primary key, D36).
      await expect(confirm.getByTestId('upgrade-plan')).toContainText(
        new RegExp(`Titus · Translation Notes: \\d+ carried over, ${orphans + 1} to check again`),
      );
      // …and nothing has moved yet: the release is installed, the project is untouched.
      expect((readProjectPins(SEEDED_PROJECT).languageSets.primary.translationNotes as { sha: string }).sha).toBe(shaBefore.sha);

      await confirm.getByTestId('upgrade-apply').click();
      await expect(confirm).toHaveCount(0);

      // Case 2: the pins carry the new release's commit hash and version label (§5.3).
      const pins = readProjectPins(SEEDED_PROJECT);
      for (const [slot, repo] of [['translationNotes', 'en_tn'], ['translationWordsLinks', 'en_tw'], ['translationWords', 'en_tw'], ['translationAcademy', 'en_ta']] as const) {
        const pin = pins.languageSets.primary[slot] as { repoPath: string; version: string; sha: string; flavor: string };
        expect(pin.repoPath).toBe(`git.door43.org/unfoldingWord/${repo}`);
        expect(pin.version).toBe(NEW_TAG);
        expect(pin.sha).toBe(cachedRevision(repo));
        expect(pin.flavor).toBeTruthy();
      }
      // Case 4: the other set's pins and every text ingredient are byte-identical.
      expect(JSON.stringify(pins.languageSets.fallback)).toBe(fallbackBefore);
      expect(JSON.stringify((pins as { resources?: unknown }).resources ?? null)).toBe(groupsBefore); // the text pins (original language) too
      expect(Object.keys(textIngredients())).toEqual(Object.keys(textBefore));
      for (const [rel, bytes] of Object.entries(textIngredients())) expect(bytes.equals(textBefore[rel]), rel).toBe(true);

      // Case 2/3: the decision file was reconciled against the new release.
      const after = readDecisionFile(SEEDED_PROJECT, 'translationNotes', 'TIT')!;
      expect(after.resource?.repoPath).toContain('en_tn');
      expect((after.resource as unknown as { sha: string }).sha).toBe(cachedRevision('en_tn'));
      // Nothing deleted: every original record is still there (§8.5 R-8.5.11 keeps
      // a re-attached decision's old-identity record as well, so the count grows).
      expect(after.decisions.length).toBeGreaterThanOrEqual(count);
      const kept = after.decisions.find((d) => mergeKey((d as never)['contextId']) === mergeKey(dropped.contextId));
      expect(kept, 'the decision on the dropped check is kept, not deleted').toBeTruthy();
      expect(kept!.invalidated).toBe(true);
      expect(kept!.status).toBe('invalid');
      expect(kept!.selections).toEqual([{ text: 'Pablo', occurrence: 1, occurrences: 1 }]);
      // …while every decision the new release still asks about carried over:
      // a record under the v90 check's identity, with the SAME selections and
      // the same state (the sample's `gr8c` was already invalidated; carry-over
      // keeps state, it does not launder it — D36/F5), beside the retained
      // old-identity record (§8.5 R-8.5.11).
      for (const c of carried) {
        const ctx = c.contextId as { checkId: string };
        const twin = after.decisions.find((d) =>
          (d as never)['contextId']['checkId'] !== ctx.checkId && JSON.stringify(d.selections) === JSON.stringify(c.selections));
        expect(twin, `decision ${ctx.checkId} carried to a v90 identity`).toBeTruthy();
        expect(twin!.invalidated).toBe(c.invalidated);
        expect(after.decisions.some((d) => (d as never)['contextId']['checkId'] === ctx.checkId), 'old identity retained').toBe(true);
      }

      // Case 3: the list re-derives from v90 and progress drops by the dropped check.
      await page.getByRole('button', { name: 'Close' }).last().click();
      await page.getByTestId('open-translationNotes').click();
      await expect(page.getByTestId('check-progress')).toHaveText(`${decidedBefore - 1} of ${totalBefore - 1} resolved`);
      await expect(page.getByTestId('check-session')).toContainText(NEW_TAG);
    },
  );

  test(
    'cancelling at the confirmation leaves the pins and the decisions untouched, and the fallback set can be upgraded on its own (D72: one step per set)',
    { tag: ['@inc6', '@J12'] },
    async ({ page, context }) => {
      test.setTimeout(240_000);
      writeProjectPins(SEEDED_PROJECT, PINS());
      const { dropped } = seedDecisionsUnderV89();
      await mockDcs(context, dropped.contextId.checkId);
      await settleOpen(page);
      const pinsBefore = pinsBytes();
      const decisionsBefore = decisionBytes();

      await openSources(page);
      await goOnline(page);
      await acceptPrimaryOffer(page);
      // The release is installed and verified; the project is untouched until the user says so.
      await page.getByTestId('upgrade-cancel').click();
      await expect(page.getByTestId('upgrade-confirm')).toHaveCount(0);
      expect(pinsBytes().equals(pinsBefore)).toBe(true);
      expect(decisionBytes().equals(decisionsBefore)).toBe(true);

      // The fallback set has its own offer and its own step. The fallback's
      // decisions are none (the sample records primary), so the change is harmless.
      await page.getByTestId('upgrade-set-fallback').click();
      await expect(page.getByTestId('upgrade-confirm')).toBeVisible({ timeout: 150_000 });
      await page.getByTestId('upgrade-apply').click();
      await expect(page.getByTestId('upgrade-confirm')).toHaveCount(0);
      const pins = readProjectPins(SEEDED_PROJECT);
      expect((pins.languageSets.fallback.translationNotes as { sha: string }).sha).toBe(cachedRevision('en_tn'));
      expect((pins.languageSets.primary.translationNotes as { sha: string }).sha).toBe(PINS().tn.sha);
      await expect(page.getByTestId('upgrade-current-fallback')).toBeVisible();
      await expect(page.getByTestId('upgrade-set-primary')).toBeVisible();
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  try {
    await verifyAllJournaledProjects();
  } finally {
    resetSeededChecking();
  }
});
