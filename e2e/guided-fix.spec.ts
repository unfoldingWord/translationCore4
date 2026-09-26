// The guided fix screen (#9, D72 point 6): a tool's preflight finds the pinned
// resource missing on this machine, and the screen offers the three ways out —
// fetch the pinned version, re-pin to an installed version, sideload a file.
// Not a journey of its own: it is the FR-5 preflight-failure branch of J4
// (docs/JOURNEYS.md), proven here against the rig with the disk as ground truth.
//
// Fixture: the rig seeds the English helps at v89; the project pins a release of
// one repo that the rig lacks. Door43 is a Playwright route serving the cached
// real export (dev-env/README.md, "J12"). The cases run in this order on
// purpose — an install stays on the rig until the next reseed, and J12 (which
// runs after this file) must still find en_tn v90 ABSENT, so the fetch case
// takes en_tn v88 instead:
//   1. re-pin  (en_tw v90 missing, offline → the installed v89)
//   2. fetch   (en_tn v88 missing, online → downloaded through the sha gate)
//   3. sideload (en_tw v90 still missing → a v89 file is refused, the v90 file installs)
import { test, expect } from './helpers/test';
import type { Page, BrowserContext } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import {
  SEEDED_PROJECT,
  TC4_ROOT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readProjectPins,
  resetSeededChecking,
  sideloadedRepo,
  resetPlaces,
} from './helpers/rig';

const CACHE = path.join(TC4_ROOT, 'dev-env', 'resources-cache');
const zipPath = (repo: string, tag: string) => path.join(CACHE, `${repo}-${tag}-unwrapped.zip`);

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

/** The commit a cached export declares — the sha the project pins and the mocked tags API reports. */
function cachedRevision(repo: string, tag: string): string {
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath(repo, tag))));
  const meta = JSON.parse(strFromU8(files['metadata.json'])) as { identification: { primary: { dcs: Record<string, { revision: string }> } } };
  return Object.values(meta.identification.primary.dcs)[0].revision;
}

/** A pin of `repo` at `tag` — a release the rig does not hold, from the cached export's own metadata. */
const missingPin = (repo: 'en_tn' | 'en_tw', tag: string) => {
  const base = pinForSideloaded(repo, 'v89');
  return { ...base, version: tag, sha: cachedRevision(repo, tag) };
};

/** Door43, held still: only `repo` at `tag` answers, from the cache. */
async function mockDcs(context: BrowserContext, repo: string, tag: string) {
  const cors = { 'access-control-allow-origin': '*' };
  const sha = cachedRevision(repo, tag);
  await context.route(/^https:\/\/git\.door43\.org\//, async (route) => {
    const url = new URL(route.request().url());
    const m = /^\/(?:api\/v1\/repos\/)?unfoldingWord\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!m || m[1] !== repo) return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
    const rest = m[2];
    if (rest.startsWith('tags')) {
      const page = Number(url.searchParams.get('page') ?? '1');
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(page === 1 ? [{ name: tag, commit: { sha } }] : []) });
    }
    if (rest === `sb/${tag}.zip`) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/zip', body: fs.readFileSync(zipPath(repo, tag)) });
    }
    return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
  });
}

const NEEDED: Array<[string, string]> = [['en_tn', 'v88'], ['en_tw', 'v90'], ['en_tw', 'v89']];

const setNet = (on: boolean) => fetch(`http://127.0.0.1:19998/api/net/${on ? 'enable' : 'disable'}`, { method: 'POST' });

async function openCheck(page: Page) {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
}

const installDir = (repo: string) => sideloadedRepo(`unfoldingword--${repo}`);

test.beforeEach(async () => {
  resetSeededChecking();
  test.skip(!NEEDED.every(([r, tag]) => fs.existsSync(zipPath(r, tag))), 'en_tn v88 / en_tw v89+v90 are not cached under dev-env/resources-cache — see dev-env/README.md, "J12"');
});

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
});

test.describe('#9 — the guided fix screen for a pinned resource this computer lacks', () => {
  test(
    'offline, the screen refuses to download and re-pins to the installed version, with the D36 counts confirmed first',
    { tag: ['@inc6', '@J4'] },
    async ({ page }) => {
      await setNet(false);
      const pins = PINS();
      const missing = missingPin('en_tw', 'v90');
      writeProjectPins(SEEDED_PROJECT, { ...pins, tw: missing });
      const installed = pins.tw;

      await openCheck(page);
      const card = page.getByTestId('preflight-translationWords');
      await expect(card).toHaveAttribute('data-state', 'unavailable');
      await card.getByTestId('fix-translationWords').click();
      const screen = page.getByTestId('guided-fix');
      await expect(screen).toBeVisible();
      await expect(screen.getByTestId('fix-pin')).toContainText(missing.sha);
      // 1 · fetch is offered but cannot run offline — it says so and offers the switch.
      await expect(screen.getByTestId('fix-fetch-go')).toBeDisabled();
      await expect(screen.getByTestId('fix-go-online')).toBeVisible();
      // 2 · re-pin lists the installed v89 of the same repo.
      await expect(screen.getByTestId('fix-repin')).toHaveAttribute('data-candidates', '1');
      await screen.getByTestId(`fix-repin-${installed.sha!.slice(0, 12)}`).click();

      // The move is confirmed with the carry-over counts before the pins move (D36).
      const confirm = page.getByTestId('upgrade-confirm');
      await expect(confirm).toBeVisible({ timeout: 30_000 });
      await expect(confirm).toHaveAttribute('data-kind', 'repin');
      await expect(confirm.getByTestId('upgrade-moves')).toContainText('en_tw: v90 → v89');
      expect((readProjectPins(SEEDED_PROJECT).languageSets.primary.translationWordsLinks as { sha: string }).sha).toBe(missing.sha);
      await confirm.getByTestId('upgrade-apply').click();
      await expect(confirm).toHaveCount(0);

      // Both tW slots of the primary rung moved to the installed identity. The
      // fallback rung (which the fixture also pinned at v90) is not touched: a
      // re-pin moves the rung the tool resolves through, nothing else.
      const after = readProjectPins(SEEDED_PROJECT);
      for (const slot of ['translationWordsLinks', 'translationWords'] as const) {
        expect((after.languageSets.primary[slot] as { sha: string; version: string }).sha).toBe(installed.sha);
        expect((after.languageSets.primary[slot] as { sha: string; version: string }).version).toBe('v89');
      }
      expect((after.languageSets.fallback.translationWordsLinks as { sha: string }).sha).toBe(missing.sha);
      await expect(card).toHaveAttribute('data-state', 'ready');
      expect(fs.existsSync(installDir('en_tw'))).toBe(false); // nothing was downloaded
    },
  );

  test(
    'online, fetch downloads the pinned version, verifies its commit, installs it, and the tool turns ready; the pins do not move',
    { tag: ['@inc6', '@J4'] },
    async ({ page, context }) => {
      test.setTimeout(180_000);
      await setNet(true);
      const missing = missingPin('en_tn', 'v88');
      writeProjectPins(SEEDED_PROJECT, { ...PINS(), tn: missing });
      await mockDcs(context, 'en_tn', 'v88');
      const pinsBefore = fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json'));

      await openCheck(page);
      const card = page.getByTestId('preflight-translationNotes');
      await expect(card).toHaveAttribute('data-state', 'fetch');
      await card.getByTestId('fix-translationNotes').click();
      const screen = page.getByTestId('guided-fix');
      await expect(screen.getByTestId('fix-fetch-go')).toBeEnabled();
      await screen.getByTestId('fix-fetch-go').click();
      await expect(screen).toHaveCount(0, { timeout: 150_000 });

      await expect(card).toHaveAttribute('data-state', 'ready');
      // Installed at the canonical path, declaring the pinned commit.
      const meta = JSON.parse(fs.readFileSync(path.join(installDir('en_tn'), 'metadata.json'), 'utf8')) as { identification: { primary: { dcs: Record<string, { revision: string }> } } };
      expect(Object.values(meta.identification.primary.dcs)[0].revision).toBe(missing.sha);
      // A fetch satisfies the pin; it never moves it. The open-time write
      // (coverage backfill) is the app's own — compare identities, not bytes.
      const after = readProjectPins(SEEDED_PROJECT);
      expect((after.languageSets.primary.translationNotes as { sha: string; version: string })).toMatchObject({ sha: missing.sha, version: 'v88' });
      expect(JSON.parse(pinsBefore.toString()).languageSets.primary.translationNotes.sha).toBe(missing.sha);
    },
  );

  test(
    'sideload: a file of another commit is refused with nothing installed; the file of the pinned commit installs and the tool turns ready',
    { tag: ['@inc6', '@J4'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      await setNet(false);
      const missing = missingPin('en_tw', 'v90');
      writeProjectPins(SEEDED_PROJECT, { ...PINS(), tw: missing });
      expect(fs.existsSync(installDir('en_tw'))).toBe(false);

      await openCheck(page);
      const card = page.getByTestId('preflight-translationWords');
      await expect(card).toHaveAttribute('data-state', 'unavailable');
      await card.getByTestId('fix-translationWords').click();
      const screen = page.getByTestId('guided-fix');

      // Wrong commit: the v89 export for a v90 pin — refused before any install.
      await screen.getByTestId('fix-sideload-file').setInputFiles(zipPath('en_tw', 'v89'));
      const error = screen.getByTestId('fix-error');
      await expect(error).toBeVisible({ timeout: 60_000 });
      await expect(error).toContainText('not installed');
      await expect(error).toContainText(missing.sha.slice(0, 12));
      expect(fs.existsSync(installDir('en_tw'))).toBe(false);
      await expect(card).toHaveAttribute('data-state', 'unavailable');

      // The pinned commit's export installs.
      await screen.getByTestId('fix-sideload-file').setInputFiles(zipPath('en_tw', 'v90'));
      await expect(screen).toHaveCount(0, { timeout: 150_000 });
      await expect(card).toHaveAttribute('data-state', 'ready');
      const meta = JSON.parse(fs.readFileSync(path.join(installDir('en_tw'), 'metadata.json'), 'utf8')) as { identification: { primary: { dcs: Record<string, { revision: string }> } } };
      expect(Object.values(meta.identification.primary.dcs)[0].revision).toBe(missing.sha);
      // The other tool was never blocked (D30.5).
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'ready');
    },
  );
});

test.afterAll(async () => {
  try {
    await verifyAllJournaledProjects();
  } finally {
    resetSeededChecking();
    await setNet(false);
  }
});
