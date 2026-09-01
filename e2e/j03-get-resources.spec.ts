// J3 — Get resources (orig, tN, tW, tA at pinned versions)
// JOURNEYS-AND-GAPS §2 J3 · PRD FR-12, FR-14, FR-15 · TEST-PLAN E-J3 · Increment 2
//
// The fetch itself (sb-zip + SHA verification, refusal on mismatch) is proven
// in test/resourceFetch.test.ts, which can exercise failure paths a live
// download cannot. What the journey proves is the part only the real rig can
// show: what a pinned, installed resource does for a session — including when
// it has nothing to offer for a book.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  pinForSideloaded,
  writeProjectPins,
  readProjectPins,
  resetSeededChecking,
  sideloadedRepo,
  listSideloaded,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v89'),
  tw: pinForSideloaded('en_tw', 'v89'),
  ta: pinForSideloaded('en_ta', 'v89'),
});

async function openTool(page: import('@playwright/test').Page, tool: string) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByTestId(`open-${tool}`).click();
}

test.beforeEach(() => {
  resetSeededChecking();
});

test.describe('J3 — a facilitator fetches the project’s resources', () => {
  test(
    'resources are pinned at explicit release versions — never a default branch (FR-12)',
    { tag: ['@inc2', '@J3'] },
    async () => {
      // Every installed resource carries its own declared commit revision, and
      // the pin names a release tag (vNN) — never "master" or a branch.
      // en_tq and en_ust are part of the shipped English package too: D64/#110
      // made `translationQuestions` and `simplifiedText` §5.3 slots, and the
      // package the app ships pins both.
      for (const name of ['en_tn', 'en_tw', 'en_ta', 'en_tq', 'en_ust']) {
        expect(listSideloaded()).toContain(name);
        const pin = pinForSideloaded(name, 'v89');
        expect(pin.version).toMatch(/^v[\d.]+$/);
        expect(pin.version).not.toBe('master');
        expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(pin.repoPath).toMatch(/^git\.door43\.org\//);
      }
      // The version above is an argument this helper echoes back, so it proves
      // nothing on its own. Locality is an exact (repoPath + sha) match
      // (D58/D59): a cache holding a DIFFERENT commit than the project pins
      // would leave isLocal() false, and the Understand helps would read
      // fetch/unavailable instead of showing content. Compare the two
      // independent sources — the resource's own metadata against the
      // project's §5.3 pin file.
      const fallback = readProjectPins(SEEDED_PROJECT).languageSets.fallback as Record<
        string,
        { repoPath: string; sha: string } | undefined
      >;
      for (const [slot, repo] of [
        ['translationQuestions', 'en_tq'],
        ['simplifiedText', 'en_ust'],
      ] as const) {
        const pinned = fallback[slot];
        expect(pinned, `the seeded project must pin fallback.${slot} (D64)`).toBeTruthy();
        const cached = pinForSideloaded(repo, 'v89');
        expect(cached.sha, `${repo} cache vs pinned sha`).toBe(pinned!.sha);
        // BOTH halves of the identity, not just the sha: a cache from a fork or
        // a renamed org can carry the same commit under a different repoPath,
        // and isLocal() would still be false. Paths compare case-insensitively,
        // as samePath does (D37).
        expect(cached.repoPath.toLowerCase(), `${repo} cache vs pinned repoPath`).toBe(
          pinned!.repoPath.toLowerCase(),
        );
      }
    },
  );

  test(
    'once installed, a checking session works with no network at all (FR-12, FR-31)',
    { tag: ['@inc2', '@J3'] },
    async ({ page, context }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());
      // Cut the browser off from everything except the local platform.
      await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());

      await openTool(page, 'translationNotes');
      await expect(page.getByTestId('check-progress')).toHaveText(/\d+ of \d+ resolved/);
      // …including the article, which must come from the installed burrito —
      // behind the F1 Academy drawer now.
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toBeVisible();
    },
  );

  test(
    'a book the pinned resource does not carry shows a designed empty state — no crash (FR-14)',
    { tag: ['@inc2', '@J3'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());

      // Remove just this book's file, leaving the resource pinned and present.
      const tsv = path.join(sideloadedRepo('en_tn'), 'ingredients', 'TIT.tsv');
      const saved = fs.readFileSync(tsv);
      fs.rmSync(tsv);
      try {
        await openTool(page, 'translationNotes');
        const empty = page.getByTestId('check-empty');
        await expect(empty).toBeVisible();
        await expect(empty).toHaveAttribute('data-empty', 'missing');
        await expect(empty).toContainText('en_tn');
      } finally {
        fs.writeFileSync(tsv, saved);
      }
    },
  );

  test(
    'a resource whose file carries no checks for the book shows the other empty state (FR-14)',
    { tag: ['@inc2', '@J3'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());

      // Header only: a legitimate file with nothing to decide in it.
      const tsv = path.join(sideloadedRepo('en_tn'), 'ingredients', 'TIT.tsv');
      const saved = fs.readFileSync(tsv, 'utf8');
      fs.writeFileSync(tsv, `${saved.split('\n')[0]}\n`);
      try {
        await openTool(page, 'translationNotes');
        const empty = page.getByTestId('check-empty');
        await expect(empty).toBeVisible();
        await expect(empty).toHaveAttribute('data-empty', 'none');
      } finally {
        fs.writeFileSync(tsv, saved);
      }
    },
  );

  test(
    'tW and tA articles render from the pinned resource versions (FR-15)',
    { tag: ['@inc2', '@J3'] },
    async ({ page }) => {
      writeProjectPins(SEEDED_PROJECT, PINS());

      // tW: the article lives in the same burrito as the links (D34).
      await openTool(page, 'translationWords');
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toContainText('payload/');
      await page.getByTestId('close-academy').click();

      // tN: the groupId is a tA module, resolved inside the pinned en_ta.
      await openTool(page, 'translationNotes');
      await page.getByTestId('open-academy').click();
      await expect(page.getByTestId('article-panel')).toContainText(/translate\/|checking\//);
    },
  );
});

// Leave the shared fixture as we found it (#124 review round 3): this file
// hand-mutates the seeded project's pins via writeProjectPins.
test.afterAll(() => {
  resetSeededChecking();
});
