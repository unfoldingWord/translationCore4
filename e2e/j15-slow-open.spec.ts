// J15 — Opening a project: a small one shows nothing new; a large one shows
// determinate progress; a broken one shows its error, never a stuck bar.
// Issue #95 · needs-rig · the seeded large fixture is sample_burrito_large
// (dev-env/scripts/seed.zsh → scripts/seed-large-project.mjs: Titus + 4000
// saved edits, one journal segment each).
//
// The open time this spec measures is the number docs/evidence/open-time-*.md
// records (machine, commit, date). It is printed, not asserted: the criterion
// is progress, not speed (owner's ruling, 2026-08-25).
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
import { rigRepo, SEEDED_PROJECT } from './helpers/rig';

const LARGE = 'sample_burrito_large';
const FIXTURE_ACTOR = 'fixture-large';

/** Install an in-page observer BEFORE the click, so the whole open is watched:
 * every mount of the indicator and every progressbar value it shows. */
async function watchProgress(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __open: { mounts: number; values: number[]; stages: string[]; texts: string[]; unmountedAt: number | null; readyAt: number | null } };
    w.__open = { mounts: 0, values: [], stages: [], texts: [], unmountedAt: null, readyAt: null };
    let mounted = false;
    const record = () => {
      if (w.__open.readyAt == null && /\(edición \d+\)/.test(document.body.textContent ?? '')) w.__open.readyAt = performance.now();
      const el = document.querySelector('[data-testid="open-progress"]');
      if (!el) {
        if (mounted && w.__open.unmountedAt == null) w.__open.unmountedAt = performance.now();
        return;
      }
      mounted = true;
      const text = el.querySelector('[data-testid="open-progress-stage"]')?.textContent ?? '';
      if (w.__open.texts.at(-1) !== text) w.__open.texts.push(text);
      const stage = el.getAttribute('data-stage') ?? '';
      if (w.__open.stages.at(-1) !== stage) w.__open.stages.push(stage);
      const bar = el.querySelector('[role="progressbar"]');
      const now = bar?.getAttribute('aria-valuenow');
      if (now != null) {
        const n = Number(now);
        if (w.__open.values.at(-1) !== n) w.__open.values.push(n);
      }
    };
    new MutationObserver((mutations) => {
      for (const m of mutations)
        for (const node of m.addedNodes)
          if (node instanceof Element && (node.matches('[data-testid="open-progress"]') || node.querySelector('[data-testid="open-progress"]')))
            w.__open.mounts += 1;
      record();
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

async function watched(page: Page): Promise<{ mounts: number; values: number[]; stages: string[]; texts: string[]; unmountedAt: number | null; readyAt: number | null }> {
  return page.evaluate(() => (window as unknown as { __open: { mounts: number; values: number[]; stages: string[]; texts: string[]; unmountedAt: number | null; readyAt: number | null } }).__open);
}

function segmentFiles(): string[] {
  const dir = path.join(rigRepo(LARGE), 'ingredients', 'checking', 'journal', FIXTURE_ACTOR, 'segments');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).sort();
}

test.describe('J15 — a translator opens a project', () => {
  test(
    'a small project opens with no progress indicator at all (no flash)',
    { tag: ['@inc6', '@J15'] },
    async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)).toBeVisible({ timeout: 20_000 });
      await watchProgress(page);
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 30_000 });
      const seen = await watched(page);
      expect(seen.mounts, 'the indicator never mounted').toBe(0);
      await expect(page.getByTestId('open-progress')).toHaveCount(0);
    },
  );

  test(
    'a large project shows determinate progress on real segment counts, then opens',
    { tag: ['@inc6', '@J15'] },
    async ({ page }) => {
      const segments = segmentFiles().length;
      expect(segments).toBeGreaterThan(1000);
      await page.goto('/');
      const card = page.getByTestId(`project-_local_/_local_/${LARGE}`);
      await expect(card).toBeVisible({ timeout: 20_000 });
      await watchProgress(page);
      const t0 = Date.now();
      await card.getByRole('button', { name: /Titus/ }).click();
      const bar = page.getByTestId('open-progress');
      await expect(bar).toBeVisible({ timeout: 20_000 });
      await expect(bar).toHaveAttribute('data-stage', /journal|state|prepare/);
      // The app stays alive until the project is ready: the fixture's last edit is on screen.
      await expect(page.getByText(/\(edición \d+\)/).first()).toBeVisible({ timeout: 120_000 });
      const openMs = Date.now() - t0;
      await expect(page.getByTestId('open-progress')).toHaveCount(0);
      const seen = await watched(page);
      console.log(`J15 open-time: ${LARGE} · ${segments} segments · ${openMs} ms click-to-text · stages ${seen.stages.join('>')} · ${seen.values.length} distinct values, first ${seen.values[0]}, last ${seen.values.at(-1)}`);
      expect(seen.stages[0]).toBe('journal');
      // Real counts: every displayed total is the fixture's own segment count, and the
      // last journal count is within the 1% reporting step of it. (The final "N of N"
      // dispatch lands in the same React batch as the state-stage dispatch that follows
      // it, so it is never painted on its own.)
      const counts = seen.texts.map((t) => /(\d+) of (\d+) saved actions/.exec(t)).filter((m): m is RegExpExecArray => m !== null);
      expect(counts.length).toBeGreaterThanOrEqual(2);
      expect(counts.every((m) => Number(m[2]) === segments)).toBe(true);
      expect(Number(counts.at(-1)![1])).toBeGreaterThanOrEqual(segments - Math.max(1, Math.floor(segments / 100)));
      expect(seen.stages).toEqual(['journal', 'state', 'prepare']);
      // Determinate: at least two distinct rising values, all within 0..100.
      expect(seen.values.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < seen.values.length; i++) expect(seen.values[i]).toBeGreaterThan(seen.values[i - 1]);
      expect(Math.max(...seen.values)).toBeLessThanOrEqual(100);
      // Alive until ready: the indicator left the page no earlier than the book text arrived.
      expect(seen.readyAt).not.toBeNull();
      expect(seen.unmountedAt).not.toBeNull();
      expect(seen.unmountedAt!).toBeGreaterThanOrEqual(seen.readyAt!);
    },
  );

  test(
    'a broken journal stops the open with its report, and no progress bar is left standing',
    { tag: ['@inc6', '@J15'] },
    async ({ page }) => {
      const files = segmentFiles();
      const victim = path.join(rigRepo(LARGE), 'ingredients', 'checking', 'journal', FIXTURE_ACTOR, 'segments', files[files.length - 1]);
      const original = fs.readFileSync(victim);
      fs.writeFileSync(victim, '{"container":1,"body":"{');
      try {
        await page.goto('/');
        const card = page.getByTestId(`project-_local_/_local_/${LARGE}`);
        await expect(card).toBeVisible({ timeout: 20_000 });
        await card.getByRole('button', { name: /Titus/ }).click();
        const error = page.getByTestId('home-open-error');
        await expect(error).toBeVisible({ timeout: 120_000 });
        await expect(error).toContainText(/unusable files/);
        await expect(page.getByTestId('open-progress')).toHaveCount(0);
      } finally {
        fs.writeFileSync(victim, original);
      }
    },
  );
});

// Issue #62 teardown: every journaled local project — the large fixture
// included — must still be a verified materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
